import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';

// Exercise the actual background message handler. This model intentionally
// ignores abort, as a slow local bridge can do while finishing inference.
let receive, tabUpdated, actionClicked, keyboardCommand;
const badgeValues = new Map();
const calls = [];
const sender = (tab = 1, documentId = 'first') => ({id:'test-extension',tab:{id:tab},frameId:0,documentId,url:'https://article.test/read'});
const send = (message, from = sender()) => new Promise(resolve => receive(message,from,resolve));
const translate = (session, text = 'A sentence.', from = sender()) => send({type:'TRANSLATE',session,items:[{id:0,text,kind:'article'}]},from);
const cancel = (session, from = sender()) => send({type:'CANCEL',session},from);
async function until(predicate) {
  for (let i = 0; i < 100; i++) { if (predicate()) return; await sleep(10); }
  assert.fail('Background task did not progress within one second');
}
function complete(call, text = '新的译文。') {
  call.resolve(new Response(JSON.stringify({message:{content:JSON.stringify({translations:call.items.map(item=>({id:item.id,text}))})}})));
}
before(async () => {
  const event = () => ({addListener(){}});
  globalThis.chrome = {
    runtime:{id:'test-extension',getURL:path=>`chrome-extension://test-extension/${path}`,getPlatformInfo:async()=>({}),onMessage:{addListener:listener=>{receive=listener;}},onInstalled:event(),onStartup:event()},
    storage:{local:{get:async()=>({settings:{provider:'ollama',ollama:{baseUrl:'http://localhost:11434',model:'test-model'},timeout:15}}),setAccessLevel:async()=>{}}},
    permissions:{contains:async()=>true},tabs:{sendMessage:async()=>({ok:true}),onRemoved:event(),onUpdated:{addListener:fn=>{tabUpdated=fn;}},query:async()=>[{id:42,url:'chrome://extensions/'}]},action:{onClicked:{addListener:fn=>{actionClicked=fn;}},setBadgeText:async({tabId,text})=>{badgeValues.set(tabId,text);},setBadgeBackgroundColor:async()=>{},setTitle:async()=>{}},commands:{onCommand:{addListener:fn=>{keyboardCommand=fn;}}}
  };
  globalThis.fetch = (url, options) => new Promise(resolve => calls.push({resolve,signal:options.signal,items:JSON.parse(JSON.parse(options.body).messages[1].content).texts}));
  await import('../background/service-worker.js');
});

test('stop and immediate restart detach aborted entries and release capacity even if the model ignores abort', async () => {
  await send({type:'PAGE_READY'});
  const offset = calls.length;
  const old = translate('old');
  await until(()=>calls.length===offset+1);
  await cancel('old');
  const fresh = translate('fresh');
  await until(()=>calls.length===offset+2);
  assert.equal(calls[offset].signal.aborted,true);
  // A late old response must neither resolve nor delete the replacement entry.
  complete(calls[offset],'过期译文。');
  assert.equal((await old).ok,false);
  const anotherTab = translate('shared','A sentence.',sender(2));
  await sleep(30);
  assert.equal(calls.length,offset+2,'replacement entry must remain available for deduplication');
  complete(calls[offset+1]);
  for (const response of await Promise.all([fresh,anotherTab])) {
    assert.equal(response.ok,true,response.error);
    assert.equal(response.results[0].text,'新的译文。');
  }
});

test('cancelled queued batches never call the model and cannot exhaust both concurrency slots', async () => {
  const offset = calls.length;
  const first = translate('slot-one','First pending sentence.');
  const second = translate('slot-two','Second pending sentence.');
  await until(()=>calls.length===offset+2);
  const queued = translate('queued','This batch should never run.');
  await sleep(30);
  await cancel('queued'); await cancel('slot-one'); await cancel('slot-two');
  const next = translate('after-queue','This batch must run immediately.');
  await until(()=>calls.length===offset+3);
  assert.equal(calls[offset+2].items[0].text,'This batch must run immediately.');
  complete(calls[offset+2]);
  assert.equal((await next).ok,true);
  for (const response of await Promise.all([first,second,queued])) assert.equal(response.ok,false);
  complete(calls[offset]); complete(calls[offset+1]);
});

test('cancelling one tab preserves the same in-flight translation for another tab', async () => {
  const offset = calls.length;
  const first = translate('one-tab','A shared sentence.');
  await until(()=>calls.length===offset+1);
  const second = translate('other-tab','A shared sentence.',sender(2));
  await sleep(30);
  await cancel('one-tab');
  assert.equal(calls[offset].signal.aborted,false);
  complete(calls[offset]);
  assert.equal((await second).ok,true);
  await first;
  assert.equal(calls.length,offset+1);
});

test('a new document retires old subscriptions, rejects stale messages and starts without waiting', async () => {
  const offset = calls.length;
  const old = translate('before-refresh','A refreshed sentence.');
  await until(()=>calls.length===offset+1);
  const newDocument = sender(1,'after-refresh');
  await send({type:'PAGE_READY'},newDocument);
  const fresh = translate('after-refresh','A refreshed sentence.',newDocument);
  await until(()=>calls.length===offset+2);
  assert.equal(calls[offset].signal.aborted,true);
  const stale = await translate('late-old-message','A refreshed sentence.');
  assert.equal(stale.ok,false);
  complete(calls[offset+1]);
  assert.equal((await fresh).ok,true);
  assert.equal((await old).ok,false);
  complete(calls[offset]);
});

test('force-retranslate creates independent work instead of joining an older in-flight result', async () => {
  const offset = calls.length;
  const old = translate('old-shared','A sentence needing a fresh translation.',sender(10));
  await until(()=>calls.length===offset+1);
  const fresh = send({type:'TRANSLATE',session:'force',ignoreCache:true,items:[{id:0,text:'A sentence needing a fresh translation.',kind:'article'}]},sender(11));
  await until(()=>calls.length===offset+2);
  complete(calls[offset+1],'重新请求得到的译文。');
  const result = await fresh;
  assert.equal(result.ok,true,result.error);
  assert.equal(result.results[0].text,'重新请求得到的译文。');
  assert.equal(result.results[0].cached,false);
  assert.equal(calls[offset].signal.aborted,false,'fresh translation must not cancel another tab');
  complete(calls[offset],'旧请求的译文。');
  assert.equal((await old).results[0].text,'旧请求的译文。');
});


test('toolbar state survives worker registration loss and rejects messages from a retired document',async()=>{
  const doc = sender(42,'initial');
  const state = {phase:'done',total:2,translated:2};
  assert.equal((await send({type:'PAGE_STATE',state},doc)).ok,true);
  assert.equal(badgeValues.get(42),'✓');
  tabUpdated(42,{status:'loading'});
  assert.equal(badgeValues.get(42),'');
  await send({type:'PAGE_STATE',state},doc);
  assert.equal(badgeValues.get(42),'','late old-document state must not restore completion badge');
  const next = sender(42,'next');
  await send({type:'PAGE_READY'},next);
  await send({type:'PAGE_STATE',state},next);
  assert.equal(badgeValues.get(42),'✓');
  await send({type:'PAGE_STATE',state:{phase:'idle'}},doc);
  assert.equal(badgeValues.get(42),'✓','retired documents cannot change the current badge');
});

test('Chrome action clicks and keyboard shortcut both reach the production toolbar handler',async()=>{
  actionClicked({id:43,url:'chrome://extensions/'});
  await until(()=>badgeValues.get(43)==='!');
  await keyboardCommand('toggle-translation');
  assert.equal(badgeValues.get(42),'!');
});
test('webpage content cannot read or clear trusted diagnostic logs',async()=>{
  for (const type of ['GET_DIAGNOSTICS','CLEAR_DIAGNOSTICS']) {
    const response = await send({type},sender(42,'next'));
    assert.equal(response.ok,false); assert.match(response.error,/扩展界面/);
  }
});
