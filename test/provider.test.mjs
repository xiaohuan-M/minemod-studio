import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createOpenAIProvider} from '../src/providers/openai-compatible.mjs';
import {createProject} from '../src/core/project.mjs';
import {makeServer} from '../src/server.mjs';
import spec from '../examples/project-spec.json' with {type:'json'};

const project = createProject({name:'测试项目',prompt:'普通物品与合成'});
const envelope = content => ({choices:[{message:{content:typeof content === 'string' ? content : JSON.stringify(content)}}],usage:{prompt_tokens:100,completion_tokens:200}});
const send = (response, value, status = 200, headers = {}) => { response.writeHead(status, {'Content-Type':'application/json',...headers}); response.end(JSON.stringify(value)); };
async function listen(t,server) {
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)); });
  return 'http://127.0.0.1:' + server.address().port;
}
async function modelFixture(t,handler,extra = {}) {
  const calls=[];
  const base = await listen(t,createServer(async (request,response) => {
    const chunks=[]; for await (const chunk of request) chunks.push(chunk);
    const call={path:request.url,headers:request.headers,body:JSON.parse(Buffer.concat(chunks).toString())};
    calls.push(call); handler(response,call);
  }));
  const env={MINEMOD_LLM_BASE_URL:base+'/v1',MINEMOD_LLM_MODEL:'fixture-model',MINEMOD_LLM_API_KEY:'fixture-key-never-real',...extra};
  return {provider:createOpenAIProvider(env),calls,env};
}
async function appFixture(t,provider) {
  const dir=mkdtempSync(join(tmpdir(),'minemod-provider-'));
  const base=await listen(t,makeServer({dataDir:dir,llmProvider:provider}));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  return {base,dir};
}
const post = (base,path,body) => fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});

test('provider configuration rejects unsafe endpoints and invalid settings without exposing values', () => {
  const valid={MINEMOD_LLM_BASE_URL:'https://models.example/v1',MINEMOD_LLM_MODEL:'my-model',MINEMOD_LLM_API_KEY:'fixture-secret'};
  for (const change of [
    {MINEMOD_LLM_BASE_URL:'http://models.example/v1'},
    {MINEMOD_LLM_BASE_URL:'https://user:fixture-secret@models.example/v1'},
    {MINEMOD_LLM_BASE_URL:'https://models.example/v1?key=fixture-secret'},
    {MINEMOD_LLM_BASE_URL:'file:///tmp/private'}, {MINEMOD_LLM_API_KEY:''},
    {MINEMOD_LLM_MODEL:''},{MINEMOD_LLM_TIMEOUT_MS:'999'},{MINEMOD_LLM_MAX_TOKENS:'99999'},
    {MINEMOD_LLM_JSON_MODE:'sometimes'},
  ]) {
    const provider=createOpenAIProvider({...valid,...change});
    assert.equal(provider.info.configured,false);
    assert.ok(!JSON.stringify(provider.info).includes('fixture-secret'));
  }
  assert.equal(createOpenAIProvider({...valid,MINEMOD_LLM_BASE_URL:'http://localhost:11434/v1',MINEMOD_LLM_API_KEY:''}).info.configured,true);
});

test('compatible adapter sends bounded selected context and validates schema before returning', async t => {
  const {provider,calls}=await modelFixture(t,response=>send(response,envelope(spec)));
  assert.equal(calls.length,0);
  const result=await provider.planSpec({...project,privateData:'must-not-send'});
  assert.deepEqual(result.spec,spec);
  assert.equal(result.source.demo,false);
  assert.deepEqual(result.source.usage,{inputTokens:100,outputTokens:200});
  assert.equal(calls[0].path,'/v1/chat/completions');
  assert.equal(calls[0].headers.authorization,'Bearer fixture-key-never-real');
  assert.deepEqual(JSON.parse(calls[0].body.messages[1].content),{name:project.name,prompt:project.prompt,target:project.target});
  assert.equal(calls[0].body.stream,false);
  assert.equal(calls[0].body.response_format.type,'json_object');
  assert.ok(!JSON.stringify(provider.info).includes('fixture-key'));
});

test('JSON mode and token field are configurable; fenced JSON and absent usage are handled honestly', async t => {
  const {provider,calls}=await modelFixture(t,response=>send(response,{choices:[{message:{content:'```json\n'+JSON.stringify(spec)+'\n```'}}]}),{MINEMOD_LLM_JSON_MODE:'false',MINEMOD_LLM_TOKEN_FIELD:'max_completion_tokens'});
  const result=await provider.planSpec(project);
  assert.deepEqual(result.spec,spec);
  assert.deepEqual(result.source.usage,{inputTokens:null,outputTokens:null});
  assert.equal('response_format' in calls[0].body,false);
  assert.equal(calls[0].body.max_completion_tokens,4096);
  assert.equal('max_tokens' in calls[0].body,false);
});

test('provider failures are redacted, bounded and never retried or redirected', async t => {
  let mode;
  const {provider,calls}=await modelFixture(t,response=>{
    if (typeof mode === 'number') return send(response,{error:{message:'fixture-key-never-real'}},mode,mode===302?{Location:'/leaked'}:{'Retry-After':'12'});
    if (mode==='oversize') return response.end('x'.repeat(128*1024+1));
    if (mode==='bad-json') return response.end('fixture-key-never-real');
    if (mode==='echo') return send(response,envelope({...spec,displayName:'fixture-key-never-real'}));
    return send(response,envelope({...spec,command:'run'}));
  });
  for (const [value,code] of [[401,'PROVIDER_AUTH'],[403,'PROVIDER_AUTH'],[429,'PROVIDER_RATE_LIMIT'],[302,'PROVIDER_REDIRECT'],[500,'PROVIDER_HTTP'],['bad-json','PROVIDER_INVALID_RESPONSE'],['oversize','PROVIDER_RESPONSE_TOO_LARGE'],['invalid-spec','PROVIDER_INVALID_SPEC'],['echo','PROVIDER_INVALID_SPEC']]) {
    mode=value; const before=calls.length;
    await assert.rejects(provider.planSpec(project),error=>{
      assert.equal(error.code,code); assert.ok(!error.message.includes('fixture-key')); return true;
    });
    assert.equal(calls.length,before+1);
  }
});

test('timeout includes a stalled response body and cancellation stops in-flight work', async t => {
  let received;
  let started=new Promise(resolve=>{received=resolve;});
  const {provider}=await modelFixture(t,response=>{response.writeHead(200,{'Content-Type':'application/json'});response.write('{"choices":');received();},{MINEMOD_LLM_TIMEOUT_MS:'1000'});
  await assert.rejects(provider.planSpec(project),{code:'PROVIDER_TIMEOUT'});
  started=new Promise(resolve=>{received=resolve;});
  const controller=new AbortController();
  const pending=provider.planSpec(project,{signal:controller.signal});
  await started; controller.abort();
  await assert.rejects(pending,{code:'PROVIDER_CANCELLED'});
});

test('HTTP requires current consent, never accepts endpoint overrides and persists no key', async t => {
  const {provider,calls}=await modelFixture(t,response=>send(response,envelope(spec)));
  const {base,dir}=await appFixture(t,provider);
  const config=await (await fetch(base+'/api/providers')).json();
  assert.ok(!JSON.stringify(config).includes('fixture-key'));
  let saved=await (await post(base,'/api/projects',{name:'项目',prompt:'一个普通物品'})).json();
  const path='/api/projects/'+saved.id+'/spec/generate';
  const input={provider:'openai-compatible',revision:saved.revision};
  assert.equal((await post(base,path,input)).status,400);
  assert.equal((await post(base,path,{...input,consent:'stale'})).status,400);
  assert.equal((await post(base,path,{...input,consent:provider.info.configurationId,baseUrl:'https://attacker.example'})).status,400);
  assert.equal(calls.length,0);
  const response=await post(base,path,{...input,consent:provider.info.configurationId});
  assert.equal(response.status,200); saved=await response.json();
  assert.equal(saved.specSource.demo,false); assert.equal(saved.specSource.provider,'openai-compatible');
  assert.equal(saved.confirmedSpecHash,null); assert.deepEqual(saved.artifacts,[]);
  assert.ok(!readFileSync(join(dir,'projects',saved.id+'.json'),'utf8').includes('fixture-key'));
  const check=await post(base,'/api/providers/openai-compatible/test',{consent:provider.info.configurationId});
  assert.equal(check.status,200); assert.equal((await check.json()).validatedSpec,true);
});

test('cancel preserves prior spec, duplicate requests are rejected, and late results cannot overwrite edits', async t => {
  let release,started;
  let arrival=new Promise(resolve=>{started=resolve;});
  const {provider}=await modelFixture(t,response=>{release=()=>send(response,envelope(spec));started();});
  const {base}=await appFixture(t,provider);
  const project=await (await post(base,'/api/projects',{name:'x',prompt:'y'})).json();
  const root='/api/projects/'+project.id;
  const before=await (await post(base,root+'/spec/generate',{provider:'mock',revision:0})).json();
  const input={provider:'openai-compatible',revision:before.revision,consent:provider.info.configurationId};
  const pending=post(base,root+'/spec/generate',input);
  await arrival;
  assert.equal((await post(base,root+'/spec/generate',input)).status,409);
  assert.equal((await post(base,root+'/spec/cancel',{})).status,200);
  assert.equal((await pending).status,499);
  assert.deepEqual(await (await fetch(base+root)).json(),before);
  arrival=new Promise(resolve=>{started=resolve;});
  const late=post(base,root+'/spec/generate',input);
  await arrival;
  const changed={...before.spec,displayName:'并发人工修改'};
  const edit=await fetch(base+root+'/spec',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({spec:changed,revision:before.revision})});
  assert.equal(edit.status,200);
  release();
  assert.equal((await late).status,409);
  assert.equal((await (await fetch(base+root)).json()).spec.displayName,'并发人工修改');
});

test('iterative planning sends current spec and selected diagnostics, without unrelated local fields',async t=>{
  const {provider,calls}=await modelFixture(t,response=>send(response,envelope(spec)));
  await provider.planSpec({...project,spec,instruction:'增加一个物品',buildFailure:'compileJava failed',privatePath:'do not send'});
  const context=JSON.parse(calls[0].body.messages[1].content);assert.deepEqual(context.currentSpec,spec);assert.equal(context.instruction,'增加一个物品');assert.equal(context.buildFailure,'compileJava failed');assert.equal(context.privatePath,undefined);
});

test('structured texture and cube generation validates outputs and requires fresh service consent',async t=>{
  let output={width:16,height:16,pixels:Array(256).fill('#aa77ccff')};const {provider,calls}=await modelFixture(t,response=>send(response,envelope(output)));
  const {base}=await appFixture(t,provider);const path='/api/providers/openai-compatible/asset';
  assert.equal((await post(base,path,{kind:'texture',prompt:'水晶'})).status,400);assert.equal(calls.length,0);
  let result=await post(base,path,{consent:provider.info.configurationId,kind:'texture',prompt:'水晶'});assert.equal(result.status,200);assert.deepEqual((await result.json()).data,output);
  assert.deepEqual(JSON.parse(calls[0].body.messages[1].content),{prompt:'水晶'});
  output={elements:[{from:[4,0,4],to:[12,16,12]}]};result=await post(base,path,{consent:provider.info.configurationId,kind:'model',prompt:'柱子'});assert.equal(result.status,200);assert.equal((await result.json()).data.elements.length,1);
  output={elements:[{from:[4,0,4],to:[0,0,0]}]};result=await post(base,path,{consent:provider.info.configurationId,kind:'model',prompt:'非法'});assert.equal(result.status,422);assert.equal((await result.json()).error.code,'PROVIDER_INVALID_ASSET');
  output={width:16,height:16,pixels:['fixture-key-never-real']};result=await post(base,path,{consent:provider.info.configurationId,kind:'texture',prompt:'非法'});assert.equal(result.status,422);assert.ok(!(await result.text()).includes('fixture-key'));
});
