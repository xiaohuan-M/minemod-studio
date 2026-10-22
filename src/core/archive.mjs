import {crc32,deflateRawSync,inflateRawSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {AppError} from './errors.mjs';
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export function safeArchivePath(path) {
  if (typeof path !== 'string' || path.length > 220 || !/^[A-Za-z0-9_./-]+$/.test(path) || path.startsWith('/') || path.split('/').some(part=>!part || part==='.' || part==='..')) throw new AppError(422,'UNSAFE_PATH','工程文件路径不合法。');
  return path;
}
export function zipFiles(files) {
  const local=[],central=[];let offset=0;let total=0;
  const entries=Object.entries(files).sort(([a],[b])=>a.localeCompare(b));
  if(entries.length>2048)throw new AppError(422,'ARCHIVE_LIMIT','工程文件数量超限。');
  for(const [path,input] of entries){
    safeArchivePath(path);const data=Buffer.from(input);total+=data.length;
    if(total>32*1024*1024)throw new AppError(422,'ARCHIVE_LIMIT','源码包超过 32 MiB。');
    const name=Buffer.from(path),compressed=deflateRawSync(data),crc=crc32(data);
    const header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);header.writeUInt16LE(0x800,6);header.writeUInt16LE(8,8);header.writeUInt16LE(33,12);header.writeUInt32LE(crc,14);header.writeUInt32LE(compressed.length,18);header.writeUInt32LE(data.length,22);header.writeUInt16LE(name.length,26);
    local.push(header,name,compressed);
    const record=Buffer.alloc(46);record.writeUInt32LE(0x02014b50);record.writeUInt16LE(0x314,4);record.writeUInt16LE(20,6);record.writeUInt16LE(0x800,8);record.writeUInt16LE(8,10);record.writeUInt16LE(33,14);record.writeUInt32LE(crc,16);record.writeUInt32LE(compressed.length,20);record.writeUInt32LE(data.length,24);record.writeUInt16LE(name.length,28);record.writeUInt32LE(((path==='gradlew'?0o100755:0o100644)*65536)>>>0,38);record.writeUInt32LE(offset,42);central.push(record,name);offset+=header.length+name.length+compressed.length;
  }
  const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...local,directory,end]);
}
export function readZipEntry(zip,name,maxBytes=1024*1024){
  try{
    let end=-1;for(let i=zip.length-22;i>=Math.max(0,zip.length-65557);i--)if(zip.readUInt32LE(i)===0x06054b50&&i+22+zip.readUInt16LE(i+20)===zip.length){end=i;break;}
    if(end<0)throw new Error('directory');const count=zip.readUInt16LE(end+10);if(count>10000)throw new Error('count');let cursor=zip.readUInt32LE(end+16);
    for(let i=0;i<count;i++){
      if(cursor+46>end||zip.readUInt32LE(cursor)!==0x02014b50)throw new Error('entry');
      const n=zip.readUInt16LE(cursor+28),x=zip.readUInt16LE(cursor+30),c=zip.readUInt16LE(cursor+32);const filename=zip.subarray(cursor+46,cursor+46+n).toString();
      if(filename===name){
        const method=zip.readUInt16LE(cursor+10),size=zip.readUInt32LE(cursor+24),compressedSize=zip.readUInt32LE(cursor+20),crc=zip.readUInt32LE(cursor+16),at=zip.readUInt32LE(cursor+42);
        if(size>maxBytes||(zip.readUInt16LE(cursor+8)&1)||at+30>zip.length||zip.readUInt32LE(at)!==0x04034b50)throw new Error('limits');
        const start=at+30+zip.readUInt16LE(at+26)+zip.readUInt16LE(at+28);if(start+compressedSize>cursor)throw new Error('bounds');const data=zip.subarray(start,start+compressedSize);
        const result=method===0?Buffer.from(data):method===8?inflateRawSync(data,{maxOutputLength:maxBytes}):null;
        if(!result||result.length!==size||crc32(result)!==crc)throw new Error('integrity');return result;
      }
      cursor+=46+n+x+c;
    }
    throw new Error('missing');
  }catch{throw new AppError(422,'INVALID_ARCHIVE','构建产物缺少所需文件或 ZIP 校验失败。');}
}
