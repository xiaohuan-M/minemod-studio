import {mkdirSync,realpathSync,lstatSync,readFileSync,writeFileSync,renameSync,unlinkSync,readdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {AppError} from '../core/errors.mjs';
export class JsonDirectory {
  constructor(root){mkdirSync(root,{recursive:true,mode:0o700});this.root=realpathSync(resolve(root));}
  path(id){if(typeof id!=='string'||!/^([a-f0-9]{64}|[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})$/.test(id))throw new AppError(400,'INVALID_ID','记录 ID 不合法。');return join(this.root,id+'.json');}
  read(id){const path=this.path(id);try{const stat=lstatSync(path);if(!stat.isFile()||stat.size>16*1024*1024)throw new AppError(409,'INVALID_RECORD','记录必须是大小受限的普通文件。');return JSON.parse(readFileSync(path,'utf8'));}catch(error){if(error.code==='ENOENT')throw new AppError(404,'RECORD_NOT_FOUND','没有找到该记录。');if(error instanceof AppError)throw error;throw new AppError(500,'RECORD_CORRUPT','记录损坏，请从备份恢复。');}}
  write(id,value){const path=this.path(id),temp=join(this.root,'.'+randomUUID()+'.tmp');try{writeFileSync(temp,JSON.stringify(value)+'\n',{flag:'wx',mode:0o600});renameSync(temp,path);}finally{try{unlinkSync(temp);}catch(e){if(e.code!=='ENOENT')throw e;}}return value;}
  ids(){return readdirSync(this.root).filter(name=>/^(?:[a-f0-9]{64}|[a-f0-9-]{36})\.json$/.test(name)).map(name=>name.slice(0,-5));}
}
