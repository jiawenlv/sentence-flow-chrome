import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../shared/core.js';
import { callModel } from '../background/provider.js';
const C = globalThis.SentenceFlowCore;
const config = () => C.validateSettings({...C.settings(), ollama:{baseUrl:'http://localhost:11434',model:'test-model',apiKey:''}});
test('sentence offsets preserve inline DOM text and punctuation', () => {
  const text = '  Hello world. This is the next sentence! “Really?” Yes.  ';
  const sentences = C.segmentText(text,'en');
  assert.deepEqual(sentences.map(s => s.text),['Hello world.','This is the next sentence!','“Really?”','Yes.']);
  for (const s of sentences) assert.equal(text.slice(s.start,s.end),s.text);
});
test('decimal points, time, abbreviations and Chinese sentence boundaries', () => {
  const result = C.segmentText('At 8.30 a.m., Dr. Morgan paid $0.50. She smiled.','en').map(s=>s.text);
  assert.deepEqual(result,['At 8.30 a.m., Dr. Morgan paid $0.50.','She smiled.']);
  assert.deepEqual(C.segmentText('你好！世界真大。继续探索？','zh').map(s=>s.text),['你好！','世界真大。','继续探索？']);
});
test('long sentences are bounded without losing characters or splitting surrogate pairs', () => {
  const text = 'word '.repeat(1000) + '世界😀'.repeat(200) + '.';
  const result = C.segmentText(text,'en');
  assert.ok(result.length > 1);
  assert.ok(result.every(s=>s.text.length <= 1800 && !/[\uD800-\uDBFF]$/u.test(s.text)));
  assert.equal(result.map(s=>s.text).join('').replace(/\s/gu,''),text.replace(/\s/gu,''));
});
test('skips Chinese for a Chinese target, numbers and URLs, preserves menu labels', () => {
  assert.equal(C.needsTranslation('这是一段中文。','zh-CN'),false);
  assert.equal(C.needsTranslation('123.45!','zh-CN'),false);
  assert.equal(C.needsTranslation('https://example.com','zh-CN'),false);
  assert.equal(C.needsTranslation('Home','zh-CN'),true);
  assert.equal(C.needsTranslation('这是中文 API。','zh-CN'),false);
});
test('cache isolates origin, model, target, provider and content class', () => {
  const s = config();
  const key = C.cacheIdentity(s,'https://example.com',' Hello\n world ','fixed');
  assert.equal(key,C.cacheIdentity(s,'https://example.com','Hello world','fixed'));
  assert.notEqual(key,C.cacheIdentity(s,'https://other.com','Hello world','fixed'));
  assert.notEqual(key,C.cacheIdentity({...s,targetLanguage:'en'},'https://example.com','Hello world','fixed'));
  assert.notEqual(key,C.cacheIdentity({...s,ollama:{...s.ollama,model:'another'}},'https://example.com','Hello world','fixed'));
  assert.notEqual(key,C.cacheIdentity(s,'https://example.com','Hello world','article'));
  assert.equal(key,C.cacheIdentity({...s,ollama:{...s.ollama,apiKey:'changed'}},'https://example.com','Hello world','fixed'));
});
test('endpoint completion supports root, prefix and full routes without duplicate suffixes', () => {
  assert.equal(C.endpoint(config()),'http://localhost:11434/api/chat');
  for (const baseUrl of ['http://localhost:11434/api','http://localhost:11434/api/chat/']) assert.equal(C.endpoint({...config(),ollama:{baseUrl}}),'http://localhost:11434/api/chat');
  for (const baseUrl of ['https://example.com','https://example.com/v1/','https://example.com/v1/chat/completions']) assert.equal(C.endpoint({...config(),provider:'online',online:{baseUrl}}),'https://example.com/v1/chat/completions');
  for (const baseUrl of ['file:///etc/passwd','https://user:pass@example.com','https://example.com/?api_key=secret']) assert.throws(()=>C.endpoint({...config(),ollama:{baseUrl}}));
});
test('model output must contain every requested ID exactly once; never accept malformed batches', () => {
  const items = [{id:4},{id:9}];
  assert.deepEqual(C.parseTranslations('```json\n{"translations":[{"id":9,"text":"乙"},{"id":4,"text":"甲"}]}\n```',items),[{id:4,text:'甲'},{id:9,text:'乙'}]);
  for (const content of ['hello','{"translations":[{"id":4,"text":"甲"}]}','{"translations":[{"id":4,"text":"甲"},{"id":4,"text":"乙"}]}','{"translations":[{"id":4,"text":""},{"id":9,"text":"乙"}]}']) assert.throws(()=>C.parseTranslations(content,items));
});
test('batch packing respects both sentence count and character budget', () => {
  const packs = C.packItems(Array.from({length:31},(_,id)=>({id,text:'a'.repeat(850)})));
  assert.equal(packs.flat().length,31);
  assert.ok(packs.every(p=>p.length<=12 && p.reduce((n,r)=>n+r.text.length,0)<=6000));
});
test('Ollama request is non-streaming JSON with no credentials attached to the URL', async () => {
  let request;
  const result = await callModel(config(),[{id:3,text:'Hello.'}],new AbortController().signal,async(url,init)=>{
    request = {url,...init}; return new Response(JSON.stringify({message:{content:'{"translations":[{"id":3,"text":"你好。"}]}'}}));
  });
  assert.equal(request.url,'http://localhost:11434/api/chat');
  assert.equal(request.credentials,'omit'); assert.equal(request.redirect,'error');
  assert.equal(JSON.parse(request.body).format,'json');
  assert.equal(JSON.parse(request.body).stream,false);
  assert.deepEqual(result,[{id:3,text:'你好。'}]);
});
test('OpenAI-compatible request and readable authentication errors', async () => {
  const s = {...config(),provider:'online',online:{baseUrl:'https://api.test/v1',model:'chat',apiKey:'test-secret'}};
  await assert.rejects(callModel(s,[{id:0,text:'Hello.'}],new AbortController().signal,async(url,init)=>{
    assert.equal(url,'https://api.test/v1/chat/completions'); assert.equal(init.headers.Authorization,'Bearer test-secret');
    assert.equal(JSON.parse(init.body).model,'chat'); return new Response('{}',{status:401});
  }),/API Key/u);
});
test('aborted provider calls do not retry or hide the cancellation reason', async () => {
  const controller = new AbortController(); controller.abort(new Error('stopped'));
  await assert.rejects(callModel(config(),[{id:0,text:'Hello.'}],controller.signal,async()=>{ throw new Error('fetch aborted'); }),/stopped/u);
});
test('provider failures explain recovery and distinguish online permissions from Ollama origins',async()=>{
  for (const [status,expected] of [[400,/接口兼容性/],[401,/更新密钥/],[402,/余额/],[404,/地址和模型名称/],[408,/超时/],[429,/额度/],[503,/稍后重试/]]) {
    await assert.rejects(callModel(config(),[{id:0,text:'Hello.'}],undefined,async()=>new Response('{}',{status,headers:{'retry-after':'1'}})),expected);
  }
  const online = {...config(),provider:'online',online:{baseUrl:'https://example.test/v1',model:'test',apiKey:''}};
  await assert.rejects(callModel(online,[{id:0,text:'Hello.'}],undefined,async()=>new Response('{}',{status:403})),error=>/模型使用权限/.test(error.message) && !/OLLAMA/.test(error.message));
  await assert.rejects(callModel(config(),[{id:0,text:'Hello.'}],undefined,async()=>{throw new TypeError('Failed to fetch');}),/设置.*测试连接/);
});
test('empty service JSON and null model output remain actionable; body cancellation preserves timeout',async()=>{
  for (const body of ['null','{}','not-json']) await assert.rejects(callModel(config(),[{id:0,text:'Hello.'}],undefined,async()=>new Response(body)),/设置|模型/);
  assert.throws(()=>C.parseTranslations('null',[{id:0}]),/支持 JSON 输出/);
  const controller = new AbortController();
  await assert.rejects(callModel(config(),[{id:0,text:'Hello.'}],controller.signal,async()=>({ok:true,json:async()=>{controller.abort(new Error('测试超时'));throw new Error('AbortError');}})),/测试超时/);
  assert.match(C.errorMessage(new Error('Extension context invalidated.')),/刷新网页/);
});
test('online non-JSON output receives one constrained retry with unchanged IDs; valid output needs no repair',async()=>{
  const online={...config(),provider:'online',online:{baseUrl:'http://127.0.0.1:11435/v1',model:'test',apiKey:''}};
  let calls=0;
  const rows=[{id:7,text:'你好。'}];
  const result=await callModel(online,[{id:7,text:'Hello.'}],undefined,async(url,init)=>{
    calls++; const body=JSON.parse(init.body);
    assert.equal(JSON.parse(body.messages[1].content).texts[0].id,7);
    if(calls===1){assert.equal(body.response_format,undefined);return new Response(JSON.stringify({choices:[{message:{content:'你好。'}}]}));}
    assert.deepEqual(body.response_format,{type:'json_object'});assert.equal(body.temperature,0.1);
    return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({translations:rows})}}]}));
  });
  assert.deepEqual(result,rows);assert.equal(calls,2);
});
test('JSON repair is bounded and reports unsupported constraints; incomplete batches are never repaired or accepted',async()=>{
  const online={...config(),provider:'online',online:{baseUrl:'http://127.0.0.1:11435/v1',model:'test',apiKey:''}};
  for(const unsupported of [false,true]){
    let calls=0;
    await assert.rejects(callModel(online,[{id:0,text:'Hello.'}],undefined,async()=>{
      calls++;
      if(unsupported && calls===2)return new Response('{}',{status:400});
      return new Response(JSON.stringify({choices:[{message:{content:'plain text'}}]}));
    }),unsupported ? /不接受 JSON 约束/ : /未返回有效 JSON/);
    assert.equal(calls,2);
  }
  let calls=0;
  await assert.rejects(callModel(online,[{id:0,text:'Hello.'}],undefined,async()=>{calls++;return new Response(JSON.stringify({choices:[{message:{content:'{"translations":[]}'}}]}));}),/数量或编号不匹配/);
  assert.equal(calls,1);
});
