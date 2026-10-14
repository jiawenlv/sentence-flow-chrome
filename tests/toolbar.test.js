import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toggleTab, showState } from '../background/toolbar.js';

const tab = {id:7,url:'https://article.test/read'};
let phase, version, optionsOpened, injections, dispatches, notices, finishStart;
const badges = new Map(), titles = new Map();
function setup(model = 'test-model') {
  phase = 'idle'; version = '1.4.0'; optionsOpened = 0; injections = []; dispatches = []; notices = [];
  globalThis.chrome = {
    runtime:{getManifest:()=>({version:'1.4.0'}),openOptionsPage:async()=>{optionsOpened++;}},
    storage:{local:{get:async()=>({settings:{provider:'ollama',ollama:{model}}})}},
    scripting:{executeScript:async args=>{injections.push(args);}},
    action:{
      setBadgeText:async({tabId,text})=>{badges.set(tabId,text);},
      setBadgeBackgroundColor:async()=>{},
      setTitle:async({tabId,title})=>{titles.set(tabId,title);}
    },
    tabs:{sendMessage:async(id,message)=>{
      if (message.type === 'PAGE_STATUS') return {ok:true,phase,version};
      if (message.type === 'PAGE_NOTICE') { notices.push(message.error); return {ok:true}; }
      dispatches.push(message.type);
      if (phase !== 'idle') { phase = 'idle'; return {ok:true,phase}; }
      phase = 'running';
      return new Promise(resolve=>{finishStart=()=>resolve({ok:true,phase});});
    }}
  };
}
async function dispatched(count) {
  for (let i=0;i<30;i++) { if(dispatches.length===count)return; await new Promise(resolve=>setTimeout(resolve,5)); }
  assert.equal(dispatches.length,count);
}
test('toolbar dispatches a second toggle during async startup; stop works even after model configuration is removed',async()=>{
  setup();
  const first = toggleTab(tab);
  await dispatched(1);
  chrome.storage.local.get = async()=>({settings:{provider:'ollama',ollama:{model:''}}});
  await toggleTab(tab);
  assert.equal(phase,'idle'); assert.equal(optionsOpened,0);
  finishStart(); await first;
  assert.deepEqual(dispatches,['TOGGLE','TOGGLE']);
  assert.deepEqual(injections[0].files,['shared/core.js','content/content.js']);
});
test('missing model opens native options without starting translation; restricted and outdated pages show actionable toolbar errors',async()=>{
  setup(''); await toggleTab(tab);
  assert.equal(optionsOpened,1); assert.deepEqual(dispatches,[]);
  assert.equal(badges.get(tab.id),'!'); assert.match(titles.get(tab.id),/填写模型名称/);
  assert.match(notices[0],/检查配置.*测试连接.*保存/);
  setup(); version='1.3.9'; await toggleTab(tab);
  assert.deepEqual(dispatches,[]); assert.match(titles.get(tab.id),/刷新网页/);
  setup(); await toggleTab({...tab,url:'chrome://extensions/'});
  assert.equal(injections.length,0); assert.match(titles.get(tab.id),/普通 HTTP/);
});
test('invalid saved service addresses open settings and injection failures explain website permissions',async()=>{
  setup();
  chrome.storage.local.get = async()=>({settings:{provider:'ollama',ollama:{model:'test',baseUrl:'broken-url'}}});
  await toggleTab(tab);
  assert.equal(optionsOpened,1); assert.deepEqual(dispatches,[]);
  assert.match(notices[0],/服务地址无效/);
  setup(); chrome.scripting.executeScript = async()=>{throw new Error('Cannot access contents of url');};
  await toggleTab(tab);
  assert.match(titles.get(tab.id),/网站访问权限/);
  assert.match(notices[0],/刷新网页/);
});
test('toolbar completion requires nonempty completed content; badges and errors remain per tab',async()=>{
  setup();
  await showState(7,{phase:'running',translated:1,total:3});
  await showState(8,{phase:'done',translated:4,total:4});
  assert.equal(badges.get(7),'…');assert.equal(badges.get(8),'✓');
  assert.match(titles.get(7),/1 \/ 3/);
  await showState(7,{phase:'done',translated:0,total:0});assert.equal(badges.get(7),'·');
  await showState(7,{phase:'error',error:'模型服务 HTTP 403'});assert.equal(badges.get(7),'!');assert.match(titles.get(7),/HTTP 403/);
  await showState(7,{phase:'idle'});assert.equal(badges.get(7),'');assert.equal(badges.get(8),'✓');
});
