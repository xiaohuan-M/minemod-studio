import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import spec from '../examples/full-workshop.json' with {type:'json'};
import {generateWorkspace,workspaceFiles,diffWorkspaces,TEMPLATE} from '../src/engineering/generator.mjs';
import {zipFiles,readZipEntry,sha256} from '../src/core/archive.mjs';
import {validateTexture,pngTexture,placeholderTexture,validateModel,importBlockbench,exportBlockbench} from '../src/core/assets.mjs';
import {validateModSpec} from '../src/core/mod-spec.mjs';
import {AssetStore} from '../src/storage/asset-store.mjs';
import {WorkspaceStore} from '../src/storage/workspace-store.mjs';
import {ProjectStore} from '../src/storage/project-store.mjs';
function fixture(t){const dir=mkdtempSync(join(tmpdir(),'minemod-engineering-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));return dir;}
test('pinned generator emits repeatable complete Fabric files with Minecraft 1.21 resources',()=>{
  const one=generateWorkspace(spec),two=generateWorkspace(structuredClone(spec));assert.deepEqual(one,two);
  const files=workspaceFiles(one);assert.equal(sha256(files['gradle/wrapper/gradle-wrapper.jar']),TEMPLATE.wrapperSha256);
  const recipe=JSON.parse(files['src/main/resources/data/full_workshop/recipe/glow_block.json']);assert.equal(recipe.result.id,'full_workshop:glow_block');assert.equal(recipe.result.item,undefined);
  assert.equal(JSON.parse(files['src/main/resources/fabric.mod.json']).depends.minecraft,'1.21.1');
  assert.ok(Object.keys(files).some(p=>p.endsWith('/LightningWand.java')));
  const changed=structuredClone(spec);changed.items[0].displayName.zh_cn='新名字';
  const diff=diffWorkspaces(one,generateWorkspace(changed));assert.ok(diff.some(d=>d.path.endsWith('zh_cn.json')));assert.ok(!diff.some(d=>d.path==='build.gradle'));
  const zip=zipFiles(files);assert.deepEqual(readZipEntry(zip,'MODSPEC.json'),files['MODSPEC.json']);
});
test('ZIP rejects unsafe paths, corruption and oversized entries',()=>{
  for(const path of ['../x','/x','a/../x','a\\b','a//b'])assert.throws(()=>zipFiles({[path]:'x'}));
  const zip=zipFiles({'hello.txt':'text'});assert.equal(readZipEntry(zip,'hello.txt').toString(),'text');
  assert.throws(()=>readZipEntry(zip,'missing'));assert.throws(()=>readZipEntry(zip,'hello.txt',2));zip[40]^=255;assert.throws(()=>readZipEntry(zip,'hello.txt'));
});
test('content rules reject invalid food/tools, duplicate block IDs and unknown asset references',()=>{
  let bad=structuredClone(spec);delete bad.items.find(i=>i.kind==='food').food;assert.throws(()=>validateModSpec(bad));
  bad=structuredClone(spec);bad.items.find(i=>i.kind==='sword').maxStackSize=64;assert.throws(()=>validateModSpec(bad));
  bad=structuredClone(spec);bad.blocks[0].id=bad.items[0].id;assert.throws(()=>validateModSpec(bad));
  bad=structuredClone(spec);bad.items[0].textureAsset='00000000-0000-4000-8000-000000000000';assert.throws(()=>generateWorkspace(bad));
});
test('texture PNG is RGBA and model Blockbench roundtrip preserves cube geometry',()=>{
  const texture=placeholderTexture('#ff8800');const png=pngTexture(texture);assert.equal(png.readUInt32BE(16),16);assert.equal(png[25],6);
  assert.throws(()=>validateTexture({...texture,pixels:['#ffffff']}));
  const model=validateModel({elements:[{from:[1,2,3],to:[5,8,10],rotation:{origin:[8,8,8],axis:'z',angle:22.5}}]});
  assert.deepEqual(importBlockbench(exportBlockbench(model,'模型',texture)),model);
  assert.throws(()=>importBlockbench({elements:[{type:'mesh'}]}));assert.throws(()=>importBlockbench({elements:[{from:[0,0,0],to:[1,1,1]}],outliner:[{children:[],rotation:[0,0,0]}]}));assert.throws(()=>importBlockbench({elements:[{from:[0,0,0],to:[1,1,1]}],textures:[{},{}]}));assert.throws(()=>validateModel({elements:[{from:[0,0,0],to:[0,4,4]}]}));
});
test('asset library persists attribution and immutable snapshots require confirmation and detect tampering',t=>{
  const dir=fixture(t),assets=new AssetStore(dir),workspaces=new WorkspaceStore(dir,assets),projects=new ProjectStore(dir);
  const asset=assets.create({name:'测试贴图',kind:'texture',data:placeholderTexture(),source:'原创',license:'CC0'});
  let p=projects.create({name:'测试工程',prompt:'工具'});const input=structuredClone(spec);input.items[0].textureAsset=asset.id;
  p=projects.setSpec(p.id,input,p.revision);assert.throws(()=>workspaces.generate(p));p=projects.confirmSpec(p.id,p.revision);
  const snapshot=workspaces.generate(p);p=projects.attachWorkspace(p.id,snapshot,p.revision);p=projects.approveWorkspace(p.id,snapshot.hash,p.revision);
  assert.equal(p.approvedWorkspaceHash,snapshot.hash);assert.equal(workspaces.get(p.id,snapshot.hash).assetIds[0],asset.id);
  p=projects.setSpec(p.id,input,p.revision);assert.equal(p.workspaceHash,null);assert.equal(p.approvedWorkspaceHash,null);assert.equal(p.lastWorkspaceHash,snapshot.hash);
  const corrupt=structuredClone(snapshot);corrupt.files[0].content='evil';writeFileSync(join(dir,'workspaces',p.id,snapshot.hash+'.json'),JSON.stringify(corrupt));assert.throws(()=>workspaces.get(p.id,snapshot.hash));
});
