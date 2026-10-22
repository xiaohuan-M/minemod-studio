import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {JsonDirectory} from './json-directory.mjs';
import {validateTexture,validateModel,importBlockbench} from '../core/assets.mjs';
import {sha256} from '../core/archive.mjs';
import {AppError} from '../core/errors.mjs';
export class AssetStore {
  constructor(dataDir){this.records=new JsonDirectory(join(dataDir,'assets'));}
  create(input){
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['name','kind','data','source','license','format'].includes(k)))throw new AppError(400,'INVALID_ASSET','资源字段不正确。');
    for(const [field,max] of [['name',80],['source',200],['license',200]])if(typeof input[field]!=='string'||!input[field].trim()||input[field].length>max)throw new AppError(422,'INVALID_ASSET','请填写资源名称、来源和许可说明。');
    if(!['texture','model'].includes(input.kind))throw new AppError(422,'INVALID_ASSET','请选择贴图或模型。');
    if(this.records.ids().length>=500)throw new AppError(409,'ASSET_LIMIT','资源库达到 500 项，请备份并整理资源。');
    const data=input.kind==='texture'?validateTexture(input.data):input.format==='bbmodel'?importBlockbench(input.data):validateModel(input.data);
    const record={id:randomUUID(),name:input.name.trim(),kind:input.kind,data,source:input.source.trim(),license:input.license.trim(),createdAt:new Date().toISOString(),sha256:sha256(JSON.stringify(data))};
    return this.records.write(record.id,record);
  }
  get(id){const record=this.records.read(id);if(record.id!==id||sha256(JSON.stringify(record.data))!==record.sha256)throw new AppError(500,'ASSET_CORRUPT','资源校验失败。');record.data=record.kind==='texture'?validateTexture(record.data):validateModel(record.data);return record;}
  list(){return this.records.ids().map(id=>{const {data,...metadata}=this.get(id);return {...metadata,...(metadata.kind==='texture'?{width:data.width,height:data.height}:{cubes:data.elements.length})};}).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));}
}
