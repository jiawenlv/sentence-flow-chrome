import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch {
  if (!process.env.PLAYWRIGHT_MODULE) throw new Error('Playwright is required: npm install --no-save playwright; or set PLAYWRIGHT_MODULE to its installed module path.');
  playwright = await import(process.env.PLAYWRIGHT_MODULE);
}
const root = path.resolve(import.meta.dirname,'..');
const temp = await fs.mkdtemp(path.join(os.tmpdir(),'sentence-flow-e2e-'));
const extension = path.join(temp,'extension');
const calls = []; let mode = 'ok', delay = 0, nextDelays = [], partialSuccessLimit = 0;
const dictionary = {
  'The world is full of small wonders.':'世界充满了微小的奇迹。', 'We just need to slow down enough to see them.':'我们只需放慢脚步，便能看见它们。',
  'You do not need to travel far to find something extraordinary.':'不必远行，也能发现非凡之处。',
  'Sometimes, a familiar path offers a completely new perspective.':'有时，一条熟悉的道路会带来全新的视角。',
  'Stories':'故事', 'Explore':'探索', 'About':'关于', 'fieldnotes.':'田野笔记。',
  'The art of noticing':'发现的艺术', 'ON EVERYDAY CURIOSITY · NO. 008':'日常好奇心 · 第 008 期',
  'A five-minute pause, by the Fieldnotes team':'停下来五分钟 · 田野笔记团队',
  'A patch of sunlight on the kitchen floor can be the beginning of an adventure.':'厨房地板上的一片阳光，也可以成为冒险的起点。',
  'Curiosity turns an ordinary walk into a journey.':'好奇心让平常的散步成为一段旅程。',
  'Attention is a form of generosity.':'专注是一种慷慨。', 'What we notice becomes part of who we are.':'我们留意的事物，会成为我们自身的一部分。',
  'Start with one small thing':'从一件小事开始', 'Dr. Morgan keeps a notebook by the window.':'摩根博士在窗边放着一本笔记本。',
  'At 8.30 a.m., she writes down three things she has never noticed before.':'每天早上八点半，她会记下三件从未留意过的事。',
  'The experiment costs $0.50 and takes just five minutes.':'这个实验只需花费五十美分，耗时不过五分钟。',
  'Ask a question.':'提出一个问题。', 'Listen carefully!':'仔细倾听！', 'What surprised you today?':'今天有什么让你感到惊喜？',
  'You may find that the answers are closer than you think.':'你或许会发现，答案比想象中更近。',
  'Keep looking':'继续发现', 'Every sentence opens a little door.':'每一句话都打开一扇小小的门。',
  'Every question makes the world a little bigger.':'每一个问题，都让世界变得更加辽阔。',
  'Keep exploring, and let the next discovery find you.':'继续探索，让下一次发现与你相遇。',
  '© Fieldnotes Studio':'© 田野笔记工作室', 'More stories':'更多故事',
  'A little curiosity opens a new world.':'一点好奇心，就能开启一个新世界。',
  'From the desk of Mrs. Daniels':'丹尼尔斯女士的手记',
  'Trick or Treat – The Official Music Video – Teaser Trailer':'不给糖就捣蛋 — 官方音乐视频预告片',
  'October 11, 2026':'2026 年 10 月 11 日', 'A quiet read.':'安静地阅读。',
  'A little room to breathe.':'留一点呼吸的空间。',
  'NEXT KNOCK IN':'下次敲门倒计时',
  'Pay 30 credits to see your rewards.':'支付 30 积分以查看你的奖励。'
};
const server = http.createServer(async(req,res)=>{
  if (req.method === 'POST') {
    let raw = ''; for await (const data of req) raw += data;
    const body = JSON.parse(raw), texts = JSON.parse(body.messages[1].content).texts;
    const call = {path:req.url,texts,model:body.model,jsonMode:body.response_format?.type === 'json_object',aborted:false,finished:false};
    calls.push(call);
    const partialFailure = mode === 'partial-failure' && calls.filter(item=>item.model===body.model).length > partialSuccessLimit;
    res.on('close',()=>{ if (!res.writableEnded) call.aborted = true; });
    const responseDelay = nextDelays.length ? nextDelays.shift() : delay;
    if (responseDelay) await new Promise(resolve=>setTimeout(resolve,responseDelay));
    if (res.destroyed) return;
    if (mode === 'unauthorized' || partialFailure) { res.writeHead(401,{'content-type':'application/json'}); res.end('{}'); return; }
    const translations = texts.map(row=>({id:row.id,text:dictionary[row.text] || `译文：${row.text}`}));
    const content = mode === 'malformed' ? '{"translations":[]}' : mode === 'plain' && !call.jsonMode ? 'Plain translation without the requested JSON envelope.' : JSON.stringify({translations});
    res.writeHead(200,{'content-type':'application/json'});
    res.end(JSON.stringify(req.url.endsWith('/api/chat') ? {message:{content}} : {choices:[{message:{content}}]})); call.finished = true; return;
  }
  try {
    const file = path.join(root,'demo',req.url.startsWith('/units') ? 'units.html' : req.url.startsWith('/countdown') ? 'countdown.html' : req.url.startsWith('/catalog') ? 'catalog.html' : req.url.startsWith('/scroll') ? 'scroll.html' : req.url.startsWith('/dynamic') ? 'dynamic.html' : req.url.startsWith('/styled') ? 'styled.html' : req.url.startsWith('/second') ? 'second.html' : 'article.html');
    res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end(await fs.readFile(file));
  } catch { res.writeHead(404);res.end(); }
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let context;
try {
  await fs.cp(root,extension,{recursive:true,filter:source=>!['dist','node_modules','.git','artifacts'].includes(path.basename(source))});
  // Load the production manifest unchanged: automatic injection must work
  // without test-only host grants or any manual executeScript call.
  context = await playwright.chromium.launchPersistentContext(path.join(temp,'profile'),{
    headless:true,
    ...(process.env.CHROME_EXECUTABLE ? {executablePath:process.env.CHROME_EXECUTABLE} : {}),
    args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`],
    viewport:{width:1280,height:900}
  });
  let worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker',{timeout:15000});
  worker.on('console', message => { if (message.type() === 'error') console.error('WORKER:',message.text()); });
  const id = new URL(worker.url()).host;
  const settings = { provider:'ollama', ollama:{baseUrl:origin,model:'test-model',apiKey:''}, targetLanguage:'zh-CN',scope:'article',translateFixed:true,cacheFixed:true,lazy:false,style:'soft',timeout:15 };
  await worker.evaluate(s=>chrome.storage.local.set({settings:s,floatingEnabled:false}),settings);
  const page = await context.newPage();
  const errors = []; page.on('pageerror',e=>errors.push(e.message));
  const adminPage = await context.newPage();
  await adminPage.goto(`chrome-extension://${id}/options/options.html`);
  const admin = async message => {
    const response = await adminPage.evaluate(async msg=>chrome.runtime.sendMessage(msg),message);
    assert.equal(response.ok,true,response.error); return response;
  };
  const command = (type,options={}) => adminPage.evaluate(async({type,options,tabId})=>chrome.tabs.sendMessage(tabId,{type,...options}),{type,options,tabId:pageTab});
  let pageTab;
  async function ready(target = page, tabId = pageTab) {
    await target.waitForFunction(() => document.readyState !== 'loading');
    await adminPage.evaluate(async tabId => {
      for (let i=0;i<100;i++) {
        try { if ((await chrome.tabs.sendMessage(tabId,{type:'PAGE_STATUS'})).ok) return; } catch {}
        await new Promise(resolve=>setTimeout(resolve,50));
      }
      throw new Error('Content script did not become ready');
    },tabId);
    assert.equal(await target.locator('[data-sentence-flow="dock"]').count(),0,'no floating UI may be inserted');
  }
  const badge = () => adminPage.evaluate(tabId=>chrome.action.getBadgeText({tabId}),pageTab);
  async function waitBadge(text) {
    for (let i=0;i<100;i++) { if (await badge() === text) return; await page.waitForTimeout(30); }
    assert.equal(await badge(),text);
  }
  async function clickAction() {
    // Headless Chrome does not expose toolbar hit targets. Invoke the same
    // production handler registered with action.onClicked; no messaging bypass.
    await adminPage.evaluate(async tabId => {
      const {toggleTab} = await import(chrome.runtime.getURL('background/toolbar.js'));
      await toggleTab(await chrome.tabs.get(tabId));
    },pageTab);
  }

  async function start(url = `${origin}/article.html`, prepare) {
    await page.goto(url);
    pageTab = await worker.evaluate(async url=>(await chrome.tabs.query({})).find(tab=>tab.url===url).id,url);
    const idleCalls = calls.length;
    await ready();
    assert.equal((await command('PAGE_STATUS')).phase,'idle');
    await prepare?.();
    assert.equal(calls.length,idleCalls,'opening a page must not request translation');
    await clickAction();
  }
  async function done() {
    try { await waitStatus('done'); }
    catch(error) { console.error('DEBUG STATUS:',await command('PAGE_STATUS'),'CALLS:',calls.length,'ERRORS:',errors); throw error; }
    const s = await command('PAGE_STATUS'); assert.equal(s.error,''); assert.equal(s.total,s.translated); return s;
  }
  async function waitStatus(phase) {
    await adminPage.evaluate(async({tabId,phase})=>{
      const end = Date.now()+20000;
      while(Date.now()<end){const status=await chrome.tabs.sendMessage(tabId,{type:'PAGE_STATUS'});if(status.phase===phase)return;await new Promise(resolve=>setTimeout(resolve,100));}
      throw new Error(`Timed out waiting for phase ${phase}`);
    },{tabId:pageTab,phase});
  }
  await start();
  const first = await done();
  assert.ok(first.translated>20); assert.equal(first.cacheHits,0);
  const sequence = await page.locator('#intro').evaluate(el=>[...el.childNodes].map(n=>n.textContent).filter(t=>t.trim()));
  assert.equal(sequence[0],'The world is full of small wonders.');
  assert.equal(sequence[1].trim(),'世界充满了微小的奇迹。');
  assert.equal(sequence[2].trim(),'We just need to slow down enough to see them.');
  assert.equal(sequence[3].trim(),'我们只需放慢脚步，便能看见它们。');
  assert.equal(await page.locator('#inline strong').textContent(),'something extraordinary');
  assert.equal(await page.locator('#inline a').textContent(),'familiar path');
  assert.equal(await page.locator('pre [data-sentence-flow]').count(),0);
  assert.equal(await page.locator('[contenteditable] [data-sentence-flow]').count(),0);
  assert.ok(!calls.flatMap(call=>call.texts).some(row=>row.text.includes('editable note')||row.text.includes('const curiosity')));
  console.log('PASS sentence interleaving across inline elements; preserves code, editable fields and links');
  const articleText = await page.locator('#intro').evaluate(el=>[...el.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join(''));
  await command('RESTORE');
  assert.equal(await page.locator('[data-sentence-flow="translation"]').count(),0);
  assert.equal(await page.locator('[data-sentence-flow="dock"]').count(),0);
  await waitBadge('');
  assert.equal(await page.locator('#intro').textContent(),articleText);
  let before = calls.length;
  await command('START'); const second = await done();
  assert.equal(calls.length,before); assert.equal(second.cacheHits,second.total);
  console.log('PASS restore original text; restarting sends zero model requests');
  // A dynamic paragraph is translated without translating existing paragraphs again.
  await page.evaluate(()=>{const p=document.createElement('p');p.id='dynamic';p.textContent='A fresh sentence arrived. Another thought followed.';document.querySelector('article').append(p);});
  await page.waitForFunction(()=>document.querySelectorAll('#dynamic [data-sentence-flow="translation"]').length===2);
  assert.equal(calls.length,before+1);
  await page.locator('#dynamic').evaluate(p=>{p.textContent='The article has changed. This is a different sentence.';});
  await page.waitForFunction(()=>document.querySelectorAll('#dynamic [data-sentence-flow="translation"]').length===2);
  assert.equal(calls.length,before+2);
  console.log('PASS dynamic additions and text replacement without re-requesting unchanged sentences');
  before = calls.length;
  await start(`${origin}/second.html`); const other = await done();
  const sent = calls.slice(before).flatMap(call=>call.texts.map(row=>row.text));
  for (const text of ['Stories','Explore','About','fieldnotes.']) assert.ok(!sent.includes(text),`fixed label requested twice: ${text}`);
  assert.ok(other.cacheHits>=4);
  console.log(`PASS cross-page fixed copy cache (${other.cacheHits} hits)`);
  // Worker termination simulates MV3 suspension: persisted IndexedDB must survive.
  const cdp = await context.newCDPSession(adminPage);
  await cdp.send('ServiceWorker.enable');
  await cdp.send('ServiceWorker.stopAllWorkers');
  before = calls.length;
  await command('RESTORE'); await command('START'); await done();
  assert.equal(calls.length,before);
  worker = context.serviceWorkers().find(w=>w.url().includes(id)) || await context.waitForEvent('serviceworker');
  await waitBadge('✓');
  console.log('PASS cache and toolbar state survive service-worker restart');
  await command('RESTORE');
  await admin({type:'SAVE_SETTINGS',settings:{...settings,lazy:true}});
  await start(); await page.waitForTimeout(400);
  assert.equal(await page.locator('#below-fold [data-sentence-flow]').count(),0);

  await waitBadge('…');
  await command('PAUSE');
  await waitBadge('Ⅱ');
  await command('PAUSE');
  await page.locator('#below-fold').scrollIntoViewIfNeeded();
  await page.waitForFunction(()=>document.querySelectorAll('#below-fold [data-sentence-flow="translation"]').length===3);
  await command('ALL'); await done();
  assert.equal(await page.locator('#below-fold [data-sentence-flow="translation"]').count(),3);
  console.log('PASS viewport translation defers below-fold content until scrolling');
  await command('RESTORE');
  const online = {...settings,provider:'online',online:{baseUrl:`${origin}/v1`,model:'online-model',apiKey:'test-key'}};
  await admin({type:'SAVE_SETTINGS',settings:online});
  before = calls.length; await command('START'); await done();
  assert.ok(calls.length>before);assert.ok(calls.slice(before).every(call=>call.path==='/v1/chat/completions'));
  console.log('PASS online Chat Completions provider and model-specific cache separation');
  await command('RESTORE');
  await admin({type:'CLEAR_CACHE'});
  mode = 'malformed'; await command('START');
  await waitStatus('error');
  await waitBadge('!');
  const failureNotice = page.locator('[data-sentence-flow="notice"]');
  await failureNotice.getByRole('alert').waitFor();
  assert.match(await failureNotice.locator('p').textContent(),/设置.*测试连接/);
  assert.equal(await failureNotice.getByRole('button',{name:'查看配置'}).count(),1);
  assert.equal(await page.locator('[data-sentence-flow="translation"]').count(),0);
  assert.equal((await admin({type:'CACHE_STATS'})).entries,0);
  await page.screenshot({path:path.join(root,'artifacts/translation-error.png')});
  mode = 'ok'; await failureNotice.getByRole('button',{name:'重试翻译'}).click(); await done();
  assert.equal(await failureNotice.count(),0,'successful retry removes the failure notice');
  assert.ok(calls.every(call=>call.texts.every(item=>!item.text.includes('句流 ·') && !item.text.includes('查看配置'))),'notice text must never be sent to the model');
  console.log('PASS malformed outputs never enter cache; retry completes');
  await command('RESTORE'); await admin({type:'CLEAR_CACHE'});
  partialSuccessLimit = calls.filter(item=>item.model==='online-model').length + 1;
  mode = 'partial-failure'; nextDelays = [0,300];
  await command('START'); await waitStatus('error');
  const completedSpans = await page.locator('[data-sentence-flow="translation"]').elementHandles();
  assert.ok(completedSpans.length > 0,'first batch must finish before the next fails');
  const retryCompletedSources = calls.findLast(call=>call.finished && call.model==='online-model').texts.map(item=>item.text);
  before = calls.length; mode = 'ok';
  await failureNotice.getByRole('button',{name:'重试翻译'}).click(); await done();
  for (const span of completedSpans) assert.equal(await span.evaluate(node=>node.isConnected),true,'retry preserves completed translation nodes');
  assert.ok(calls.slice(before).every(call=>call.texts.every(item=>!retryCompletedSources.includes(item.text))),'retry must not request completed sentences again');
  console.log('PASS retry preserves completed translations and resumes unfinished batches');
  await command('RESTORE'); await admin({type:'CLEAR_CACHE'});
  mode = 'plain'; before = calls.length; await command('START'); await done();
  assert.ok(calls.slice(before).some(call=>!call.jsonMode));
  assert.ok(calls.slice(before).some(call=>call.jsonMode),'plain model output triggers constrained recovery');
  assert.equal(await failureNotice.count(),0);
  console.log('PASS online non-JSON output recovers with a constrained retry and validated translations');
  await command('RESTORE'); await admin({type:'CLEAR_CACHE'});
  mode = 'unauthorized'; await command('START'); await waitStatus('error');
  assert.match(await failureNotice.locator('p').textContent(),/API Key.*设置/);
  await failureNotice.getByRole('button',{name:'查看配置'}).click();
  assert.match(await failureNotice.locator('p').textContent(),/API Key/);
  await failureNotice.getByRole('button',{name:'关闭提示'}).click();
  await page.waitForTimeout(300); assert.equal(await failureNotice.count(),0,'dismissed failure must not reappear');
  await waitBadge('!'); mode = 'ok'; await command('PAUSE'); await done();
  console.log('PASS authentication error is visible, opens settings, can be dismissed and still supports retry');
  await command('RESTORE'); await admin({type:'CLEAR_CACHE'});
  delay = 1000;
  before = calls.length; await command('START');
  await page.waitForTimeout(150); await command('RESTORE');
  await page.waitForTimeout(1300);
  assert.equal(await page.locator('[data-sentence-flow="translation"]').count(),0);
  assert.equal(await page.locator('[data-sentence-flow="dock"]').count(),0);
  await waitBadge('');
  assert.ok(calls.length<=before+2);
  delay = 0;
  console.log('PASS restoring during an in-flight request prevents late insertion and additional queued requests');
  // Exercise the toolbar handler while some sentences are cached and others are
  // still loading, including rapid restarts before old responses have settled.
  await admin({type:'SAVE_SETTINGS',settings});
  await admin({type:'CLEAR_CACHE'});
  delay = 1800; nextDelays = [0,1800]; before = calls.length;
  await clickAction();
  await page.waitForFunction(()=>document.querySelectorAll('[data-sentence-flow="translation"]').length>0);
  const completedBeforeStop = await page.locator('[data-sentence-flow="translation"]').count();
  const completedSources = calls.slice(before).filter(call=>call.finished).flatMap(call=>call.texts.map(row=>row.text));
  const stoppedCalls = calls.slice(before).filter(call=>!call.finished);
  assert.ok(stoppedCalls.length>0);
  await clickAction();
  assert.equal((await command('PAGE_STATUS')).phase,'idle');
  assert.equal(await page.locator('[data-sentence-flow="translation"]').count(),0);
  delay = 0; before = calls.length;
  await clickAction();
  const resumed = await done();
  assert.ok(resumed.cacheHits>=completedBeforeStop);
  for (const text of completedSources) assert.ok(!calls.slice(before).some(call=>call.texts.some(row=>row.text===text)),'completed sentences must come from cache');
  await page.waitForTimeout(200);
  assert.ok(stoppedCalls.every(call=>call.aborted),'stop must disconnect active model HTTP requests');
  await page.waitForTimeout(1900);
  assert.equal(await page.locator('[data-sentence-flow="translation"]').count(),resumed.total,'late old responses must not duplicate translations');
  await clickAction();
  await admin({type:'CLEAR_CACHE'});
  delay = 900;
  for (let round = 0; round < 3; round++) {
    const offset = calls.length;
    await clickAction();
    for (let i=0;i<100 && (await command('PAGE_STATUS')).requests<2;i++) await page.waitForTimeout(10);
    for (let i=0;i<100 && calls.length<offset+2;i++) await page.waitForTimeout(10);
    assert.equal(calls.length,offset+2);
    await clickAction();
    assert.equal((await command('PAGE_STATUS')).phase,'idle');
  }
  delay = 0; await clickAction(); await done();
  await clickAction(); await admin({type:'CLEAR_CACHE'});
  delay = 1800; before = calls.length; await clickAction();
  for (let i=0;i<100 && calls.length<before+2;i++) await page.waitForTimeout(10);
  const beforeRefresh = calls.slice(before);
  assert.equal(beforeRefresh.length,2);
  await page.reload(); await ready();
  assert.equal((await command('PAGE_STATUS')).phase,'idle');
  delay = 0; await clickAction(); await done();
  assert.ok(beforeRefresh.every(call=>call.aborted),'refresh must disconnect subscriptions belonging to the old document');
  await clickAction();
  console.log('PASS toolbar stop sends HTTP cancellation; partial-cache resume, repeated immediate restart, stale-response isolation and refresh during inference');

  // Stop while async configuration is still loading: startup must not revive
  // itself after RESTORE, nor leave two observers or two sessions behind.
  await worker.evaluate(()=>{
    const original = chrome.storage.local.get.bind(chrome.storage.local);
    chrome.storage.local.get = async(...args)=>{
      const value = await original(...args);
      if (args[0]==='settings') {
        chrome.storage.local.get = original;
        await new Promise(resolve=>{globalThis.__releaseStartup=resolve;});
      }
      return value;
    };
  });
  before = calls.length;
  const starting = command('START');
  for (let i=0;i<100 && !await worker.evaluate(()=>!!globalThis.__releaseStartup);i++) await page.waitForTimeout(10);
  assert.equal(await worker.evaluate(()=>!!globalThis.__releaseStartup),true);
  await command('RESTORE');
  await worker.evaluate(()=>{globalThis.__releaseStartup();delete globalThis.__releaseStartup;});
  await starting;
  assert.equal((await command('PAGE_STATUS')).phase,'idle');
  assert.equal(calls.length,before);
  await command('START'); await done(); await command('RESTORE');
  console.log('PASS cancelling asynchronous startup cannot revive the stopped session');
  await page.goto(`${origin}/second.html`);
  await ready();
  await page.goBack(); await ready();
  assert.equal((await command('PAGE_STATUS')).phase,'idle');
  await clickAction(); await done(); await clickAction();
  console.log('PASS history navigation restores an idle entry that can start a new session');
  // Both tabs subscribe to the same translations. Restoring one must not cancel
  // the model request still needed by the other tab.
  await admin({type:'SAVE_SETTINGS',settings});
  await admin({type:'CLEAR_CACHE'});
  const extra = await context.newPage();
  await extra.goto(`${origin}/article.html`);
  // Query IDs by URL can return either copy; identify the new tab by its maximum ID.
  await extra.waitForFunction(()=>document.readyState === 'complete');
  const extraId = await worker.evaluate(async url=>Math.max(...(await chrome.tabs.query({})).filter(tab=>tab.url===url).map(tab=>tab.id)),`${origin}/article.html`);
  assert.notEqual(extraId,pageTab);
  delay = 300; before = calls.length;
  await Promise.all([command('START'),adminPage.evaluate(async tabId=>chrome.tabs.sendMessage(tabId,{type:'START'}),extraId)]);
  await page.waitForTimeout(120);await command('RESTORE');
  await adminPage.evaluate(async tabId=>{
    for(let count=0;count<100;count++){const s=await chrome.tabs.sendMessage(tabId,{type:'PAGE_STATUS'});if(s.phase==='done')return;if(s.error)throw new Error(s.error);await new Promise(resolve=>setTimeout(resolve,100));}throw new Error('shared request timed out');
  },extraId);
  const sources = calls.slice(before).flatMap(call=>call.texts.map(row=>row.text));
  assert.equal(new Set(sources).size,sources.length,'cross-tab requests were not deduplicated');
  assert.equal(await page.locator('[data-sentence-flow="translation"]').count(),0);
  assert.equal(await page.locator('[data-sentence-flow="dock"]').count(),0);
  await waitBadge('');
  await extra.close();delay = 0;
  console.log('PASS cross-tab request deduplication and cancellation preserves the other subscriber');
  // Logged-in app behavior can be reproduced without accessing a user's page:
  // visible views, button-driven updates, portals and native dialogs.
  delay = 600;
  await start(`${origin}/dynamic.html`);
  await waitBadge('…');
  await done(); delay = 0;
  await waitBadge('✓');
  assert.equal(await page.locator('#base [data-sentence-flow="translation"]').count(),1,'use the visible main, not an obsolete hidden main');
  assert.equal(await page.locator('#stable [data-sentence-flow="translation"]').count(),0,'article preference must still exclude unrelated static regions');
  before = calls.length;
  await page.evaluate(()=>{window.__ticker=setInterval(()=>document.querySelector('#ticker').dataset.state=String(Date.now()),50);});
  delay = 500;
  await page.locator('#append').click();
  await waitBadge('…');
  await page.waitForFunction(()=>document.querySelectorAll('#added [data-sentence-flow="translation"]').length===2,{},{timeout:3000});
  await page.evaluate(()=>clearInterval(window.__ticker));
  await done(); delay = 0;
  assert.equal(calls.length,before+1,'continuous unrelated DOM changes must neither starve scanning nor retranslate existing copy');
  await page.locator('#portal').click();
  await page.waitForFunction(()=>document.querySelectorAll('#portal-content [data-sentence-flow="translation"]').length===1);
  await done();
  await page.locator('#panel').click();
  await page.waitForFunction(()=>document.querySelector('#outside-panel [data-sentence-flow="translation"]'));
  await done();
  await page.locator('#inline').click();
  await page.waitForFunction(()=>document.querySelector('#inline-extra').nextElementSibling?.getAttribute('data-sentence-flow')==='translation');
  await done();
  await page.locator('#expand').click();
  await page.waitForFunction(()=>document.querySelectorAll('#existing [data-sentence-flow="translation"]').length===1);
  await done();
  before = calls.length;
  await page.locator('#existing').evaluate(el=>{el.hidden=true;});
  await page.waitForFunction(()=>!document.querySelector('#existing [data-sentence-flow="translation"]'));
  await page.locator('#expand').click();
  await page.waitForFunction(()=>document.querySelector('#existing [data-sentence-flow="translation"]'));
  await done();
  assert.equal(calls.length,before,'reopening unchanged details must reuse cache');
  await page.locator('#modal').click();
  await page.waitForFunction(()=>document.querySelector('#native [data-sentence-flow="translation"]'));
  await done();
  await page.locator('#native').evaluate(el=>el.close());
  await page.waitForFunction(()=>!document.querySelector('#native [data-sentence-flow="translation"]'));
  await command('RESTORE'); before = calls.length;
  await page.locator('#portal-content').evaluate(el=>{el.innerHTML='<p>Changed while translation is off.</p>';});
  await page.waitForTimeout(500);
  assert.equal(calls.length,before); assert.equal(await page.locator('[data-sentence-flow="translation"]').count(),0);
  await command('START'); await done();
  assert.equal(await page.locator('#portal-content [data-sentence-flow="translation"]').count(),1);
  assert.equal(await page.locator('#stable [data-sentence-flow="translation"]').count(),0);
  console.log('PASS distinct working/completed states; hidden-view filtering; bounded mutation scanning; button-loaded content, portals, hidden details and native dialogs; cached reopening and stop/resume');
  before = calls.length;
  await start(`${origin}/dynamic.html?empty`); const empty = await done();
  assert.equal(empty.total,0); assert.equal(calls.length,before);
  await waitBadge('·');
  await page.locator('#append').click();
  await page.waitForFunction(()=>document.querySelectorAll('#added [data-sentence-flow="translation"]').length===2);
  await done();
  await waitBadge('✓');
  console.log('PASS empty pages never display completion checkmarks and translate content arriving later');
  // Cards often each use <article> without a shared <main>. Content already
  // present at START must receive the same scope as content appended afterward.
  for (const variant of ['', '?multiple-main']) {
    await start(`${origin}/catalog.html${variant}`,async()=>{
      await adminPage.evaluate(tabId=>chrome.scripting.executeScript({target:{tabId},func:()=>{
        globalThis.__startupScanRoots = [];
        const walk = document.createTreeWalker.bind(document);
        document.createTreeWalker = (root,...args) => { globalThis.__startupScanRoots.push(root === document.body ? 'body' : root.tagName); return walk(root,...args); };
      }}),pageTab);
      await page.waitForFunction(()=>document.querySelector('#available'));
      assert.equal((await command('PAGE_STATUS')).total,0,'no text extraction before clicking translate');
      assert.equal(await page.locator('[data-sentence-flow="translation"]').count(),0);
      const walks = await adminPage.evaluate(async tabId=>(await chrome.scripting.executeScript({target:{tabId},func:()=>globalThis.__startupScanRoots}))[0].result,pageTab);
      assert.equal(walks.length,0,'content that arrives before START must not trigger text extraction');
    });
    await done();
    const walks = await adminPage.evaluate(async tabId=>(await chrome.scripting.executeScript({target:{tabId},func:()=>globalThis.__startupScanRoots}))[0].result,pageTab);
    assert.ok(walks.includes('body'),'the first click must freshly scan the current whole body');
    for (const card of ['tile-1','tile-2','tile-3']) assert.equal(await page.locator(`#${card} [data-sentence-flow="translation"]`).count(),2,`${variant}: all existing cards must be translated on the first click`);
    for (const region of ['earned','completed','available','help']) assert.equal(await page.locator(`#${region} [data-sentence-flow="translation"]`).count(),1,`${variant}: delayed content loaded before clicking translate must be included`);
    assert.equal(await page.locator('#unrelated [data-sentence-flow="translation"]').count(),0,'preserve the article preference for unrelated static sidebars');
    before = calls.length;
    await page.locator('#load').click();
    await page.waitForFunction(()=>document.querySelectorAll('#tile-4 [data-sentence-flow="translation"]').length===2);
    await done();
    assert.ok(!calls.slice(before).flatMap(call=>call.texts).some(item=>item.text==='The second collection is ready.'),'initial cards must not be translated again when loading another card');
  }
  console.log('PASS all initial article cards, multiple main regions and delayed panels loaded before START; incremental loading preserves existing translations');
  // Keep ticking faster than model latency, including both textContent
  // replacement and characterData changes, before and after the label renders.
  before = calls.length; delay = 1200;
  await start(`${origin}/countdown.html`); const countdownStatus = await done(); delay = 0;
  assert.equal(countdownStatus.total,5,'only four labels and the prose sentence require translation');
  for (const label of ['stack-label','flex-label']) assert.equal(await page.locator(`#${label} [data-sentence-flow="translation"]`).textContent(),'下次敲门倒计时');
  for (const label of ['line-label','semantic-label']) assert.equal(await page.locator(`#${label}`).evaluate(el=>el.nextElementSibling?.textContent),'下次敲门倒计时','translation must follow the label, before its clock');
  assert.equal(await page.locator('[data-clock] [data-sentence-flow="translation"]').count(),0);
  assert.equal(await page.locator('#prose [data-sentence-flow="translation"]').textContent(),'支付 30 积分以查看你的奖励。','numbers within an ordinary sentence stay in context');
  assert.equal(await page.locator('#prose strong').textContent(),'30');
  assert.equal(await page.locator('#prose a').textContent(),'see your rewards');
  const countdownInputs = calls.slice(before).flatMap(call=>call.texts.map(item=>item.text));
  assert.ok(countdownInputs.includes('NEXT KNOCK IN'));
  assert.ok(countdownInputs.every(text=>! /\d{2}:\d{2}:\d{2}/u.test(text)),'never send changing timer digits with their label');
  const timerCalls = calls.length, timerRequests = countdownStatus.requests;
  await page.evaluate(()=>{window.originalTranslations=[...document.querySelectorAll('[data-sentence-flow="translation"]')];window.beforeTicks=window.tickCount;});
  await page.waitForFunction(()=>window.tickCount>=window.beforeTicks+15);
  assert.equal(calls.length,timerCalls,'continuous clock updates must produce zero further model calls');
  assert.equal((await command('PAGE_STATUS')).requests,timerRequests,'clock updates must not requeue even cached label requests');
  assert.ok(await page.evaluate(()=>window.originalTranslations.every(span=>span.isConnected)),'timer updates must keep existing translation nodes in place');
  await page.screenshot({path:path.join(root,'artifacts','countdown.png'),fullPage:true});
  await command('RESTORE');
  assert.equal(await page.locator('[data-sentence-flow="translation"]').count(),0);
  await page.evaluate(()=>{window.offTicks=window.tickCount;});
  await page.waitForFunction(()=>window.tickCount>window.offTicks);
  assert.equal(calls.length,timerCalls);
  console.log('PASS CSS-stacked/flex labels, BR-separated lines and semantic timers stay separate; numeric ticks never invalidate in-flight or completed labels; inline sentence numbers are preserved');
  before = calls.length;
  await start(`${origin}/units.html`); await done();
  const unitInputs = calls.slice(before).flatMap(call=>call.texts.map(item=>item.text));
  const expectedUnits = [
    'Available offers','Buy now','Recently viewed','See details','Popular collections',
    'Before the panel','Inside the panel','After the panel','Below the divider',
    'First name','Last name','Browse collections','Contact the team','New arrivals','Customer favorites',
    'Overview','Activity','Ready to continue','Your next step',
    'Collection name','Availability','Forest edition','Available today','Delivery','Within three days',
    'Pay 30 credits to read the complete guide for new readers.',
    'Before the code','After the code','Keep reading.',
    'Before action Special action After action','Read the guide.'
  ];
  assert.deepEqual([...unitInputs].sort(),[...expectedUnits].sort(),'send exactly the independent units, preserving inline sentence context and never gluing around a skipped child');
  for (const id of ['buy','details','first-label','last-label','browse','contact','new-chip','favorite-chip','overview','activity','status']) assert.equal(await page.locator(`#${id} [data-sentence-flow="translation"]`).count(),1,`${id}: translation belongs inside its own unit`);
  assert.equal(await page.locator('#counter [data-sentence-flow="translation"]').count(),0);
  assert.equal(await page.locator('#prose [data-sentence-flow="translation"]').count(),1,'soft wrapping and inline formatting must not split a sentence');
  assert.equal(await page.locator('#prose a').textContent(),'read the complete guide');
  assert.equal(await page.locator('#prose strong').textContent(),'30');
  assert.equal(await page.locator('#prose em').textContent(),'new readers');
  const around = await page.locator('#actions').evaluate(el=>[...el.childNodes].filter(node=>node.nodeType===1).map(node=>node.id||node.textContent));
  assert.deepEqual(around,['译文：Available offers','buy','译文：Recently viewed','details','译文：Popular collections'],'place each translation beside its source without crossing a control');
  await page.locator('#buy').click();
  assert.equal(await page.evaluate(()=>window.buyClicks),1,'original button handlers survive translation');
  before = calls.length;
  await page.locator('#new-role').evaluate(el=>el.setAttribute('role','button'));
  await page.waitForFunction(()=>document.querySelector('#new-role [data-sentence-flow="translation"]'));
  await done();
  assert.deepEqual(calls.slice(before).flatMap(call=>call.texts.map(item=>item.text)).sort(),['Before action','Special action','After action'].sort(),'reassess the surrounding source when an inline fragment becomes an independent control');
  assert.equal(await page.locator('#role-change [data-sentence-flow="translation"]').count(),3);
  await page.locator('#link-flow').evaluate(el=>{el.firstChild.data=' ';});
  await page.waitForFunction(()=>document.querySelector('#guide-link [data-sentence-flow="translation"]'));
  await done();
  assert.equal(await page.locator('#link-flow [data-sentence-flow="translation"]').count(),1,'changing a sentence link into a standalone action must retire the old sentence');
  await command('RESTORE');
  assert.equal(await page.locator('[data-sentence-flow="translation"]').count(),0);
  assert.equal(await page.locator('#buy').textContent(),'Buy now');
  assert.equal(await page.locator('#prose').textContent(),'Pay 30 credits to read the complete guide for new readers.');
  console.log('PASS semantic controls, form labels, standalone links, atomic badges, table cells, definitions and visible boundaries remain separate; prose links/numbers/emphasis and handlers survive; dynamic unit boundaries are reassessed');
  await admin({type:'SAVE_SETTINGS',settings:{...settings,lazy:true}});
  await start(`${origin}/scroll.html`); await done();
  assert.equal(await page.locator('#feed article').count(),2);
  // Record scan roots to ensure an appended batch doesn't walk the whole body.
  // Instrument the extension's isolated world; page-world DOM wrappers have
  // separate JS methods and would give a vacuous empty measurement here.
  await adminPage.evaluate(tabId=>chrome.scripting.executeScript({target:{tabId},func:()=>{
    globalThis.__scanRoots = [];
    const walk = document.createTreeWalker.bind(document);
    document.createTreeWalker = (root,...args) => { globalThis.__scanRoots.push(root === document.body ? 'body' : root.id || root.tagName); return walk(root,...args); };
  }}),pageTab);
  before = calls.length;
  for (const count of [4,6]) {
    await page.locator('#sentinel').scrollIntoViewIfNeeded();
    await page.waitForFunction(count=>document.querySelectorAll('#feed article').length===count,count);
    await page.waitForFunction(count=>document.querySelectorAll('#feed [data-sentence-flow="translation"]').length===count*2,count);
    await done();
  }
  assert.equal(await page.locator('#entry-1 [data-sentence-flow="translation"]').count(),2);
  const scanRoots = await adminPage.evaluate(async tabId=>(await chrome.scripting.executeScript({target:{tabId},func:()=>globalThis.__scanRoots}))[0].result,pageTab);
  assert.ok(scanRoots.length > 0,'scan instrumentation must capture the actual content script');
  assert.ok(!scanRoots.includes('body'),'scroll batches must scan changed subtrees, not the full document');
  const newFeedTexts = calls.slice(before).flatMap(call=>call.texts.map(item=>item.text));
  assert.ok(!newFeedTexts.includes('Scrolling entry 1 arrives.'),'existing feed items must not be re-requested');
  assert.ok(!newFeedTexts.includes('Its details are ready.'),'repeated sentences reuse cache');
  await command('RESTORE'); before = calls.length;
  await page.locator('#sentinel').scrollIntoViewIfNeeded();
  await page.waitForFunction(()=>document.querySelectorAll('#feed article').length===8);
  await page.waitForTimeout(400);
  assert.equal(calls.length,before,'scrolling while translation is off must not call the model');
  await command('START');
  await page.waitForFunction(()=>document.querySelectorAll('#entry-8 [data-sentence-flow="translation"]').length===2);
  assert.ok(!calls.slice(before).flatMap(call=>call.texts).some(item=>item.text==='Scrolling entry 6 arrives.'),'restart must reuse completed feed translations');
  console.log('PASS real scroll-triggered multi-batch loading, incremental subtree scans, sentence cache reuse and off/on recovery');
  await start(`${origin}/scroll.html?virtual`);
  await page.waitForFunction(()=>document.querySelector('#recycled [data-sentence-flow="translation"]'));
  assert.equal(await page.locator('#nested-next [data-sentence-flow="translation"]').count(),0,'defer content outside a nested scrolling window');
  await page.locator('#pane').evaluate(el=>{el.scrollTop=1400;});
  await page.waitForFunction(()=>document.querySelector('#nested-next [data-sentence-flow="translation"]'));
  await done();
  await page.locator('#pane').evaluate(el=>{el.scrollTop=0;});
  before = calls.length;
  await page.locator('#recycled').evaluate(el=>{el.textContent='The first virtual row is ready.';});
  await page.waitForFunction(()=>document.querySelector('#recycled [data-sentence-flow="translation"]'));
  await done();
  assert.equal(calls.length,before,'re-rendering identical source text must restore translation without another model request');
  await page.locator('#recycled [data-sentence-flow="translation"]').evaluate(el=>el.remove());
  await page.waitForFunction(()=>document.querySelector('#recycled [data-sentence-flow="translation"]'));
  await done();
  assert.equal(calls.length,before,'a translation removed by page rendering must be restored locally');
  await page.locator('#recycled').evaluate(el=>el.append(' More details arrive in the same row.'));
  await page.waitForFunction(()=>document.querySelectorAll('#recycled [data-sentence-flow="translation"]').length===2);
  await done();
  assert.ok(!calls.slice(before).flatMap(call=>call.texts).some(item=>item.text==='The first virtual row is ready.'),'appending a sentence must preserve the completed sentence without requesting it again');
  // Replacing identical source nodes while inference is running must invalidate
  // the old live ranges without producing duplicate or misplaced translations.
  delay = 800;
  before = calls.length;
  await page.locator('#recycled').evaluate(el=>{el.textContent='A same-text row is still loading.';});
  await waitBadge('…');
  await page.locator('#recycled').evaluate(el=>{el.innerHTML='<em>A same-text row is still loading.</em>';});
  await page.waitForFunction(()=>document.querySelector('#recycled [data-sentence-flow="translation"]'));
  await done(); delay = 0;
  assert.equal(await page.locator('#recycled [data-sentence-flow="translation"]').count(),1);
  assert.equal(await page.locator('#recycled em').textContent(),'A same-text row is still loading.');
  assert.equal(calls.length,before+1,'same-text replacement in flight should share the original model result');
  delay = 800;
  await page.locator('#recycled').evaluate(el=>{el.textContent='A virtual row starts a slow request.';});
  await waitBadge('…');
  await page.locator('#recycled').evaluate(el=>{el.textContent='The recycled row now belongs to another entry.';});
  delay = 0;
  await page.waitForFunction(()=>document.querySelector('#recycled [data-sentence-flow="translation"]')?.textContent.includes('another entry'));
  await done();
  await page.waitForTimeout(900);
  assert.equal(await page.locator('#recycled [data-sentence-flow="translation"]').count(),1);
  assert.ok(!(await page.locator('#recycled').textContent()).includes('slow request'),'late results must not enter a recycled row');
  await command('RESTORE');
  assert.equal(await page.locator('[data-sentence-flow="translation"]').count(),0);
  await admin({type:'SAVE_SETTINGS',settings});
  console.log('PASS nested scrolling, virtual-row reuse, identical-text re-render recovery and stale-response isolation');
  await fs.mkdir(path.join(root,'artifacts'),{recursive:true});
  await start(`${origin}/styled.html`); await done();
  const presentation = await page.evaluate(()=>{
    const title = document.querySelector('h1'), titleTranslation = title.querySelector('[data-sentence-flow]');
    const p = document.querySelector('#spacing'), translation = p.querySelector('[data-sentence-flow]');
    const before = document.createRange(); before.selectNodeContents(p.firstChild);
    const after = document.createRange();
    after.setStart(translation.nextSibling,translation.nextSibling.data.length - translation.nextSibling.data.trimStart().length);
    after.setEnd(translation.nextSibling,translation.nextSibling.length);
    const style = getComputedStyle(translation), heading = getComputedStyle(titleTranslation);
    return {
      background:style.backgroundColor, color:style.color, sourceColor:getComputedStyle(p).color,
      fontSize:parseFloat(style.fontSize), sourceFont:parseFloat(getComputedStyle(p).fontSize),
      leftGap:translation.getBoundingClientRect().left-before.getBoundingClientRect().right,
      rightGap:after.getBoundingClientRect().left-translation.getBoundingClientRect().right,
      titleFont:parseFloat(getComputedStyle(title).fontSize), translationFont:parseFloat(heading.fontSize),
      titleDisplay:heading.display, titleHeight:titleTranslation.getBoundingClientRect().height,
      titleBackground:heading.backgroundColor, titlePadding:heading.paddingTop,
      titleGap:parseFloat(heading.marginTop), titleOpacity:parseFloat(heading.opacity)
    };
  });
  assert.equal(presentation.background,'rgba(0, 0, 0, 0)');
  assert.equal(presentation.color,presentation.sourceColor);
  assert.ok(presentation.fontSize<presentation.sourceFont && presentation.fontSize>presentation.sourceFont*.9);
  assert.ok(presentation.leftGap>=6 && presentation.leftGap<20,`left gap: ${presentation.leftGap}`);
  assert.ok(presentation.rightGap>=6 && presentation.rightGap<20,`right gap: ${presentation.rightGap}`);
  assert.equal(presentation.titleFont,64);assert.ok(presentation.translationFont<=24);
  assert.equal(presentation.titleDisplay,'block');assert.ok(presentation.titleHeight<50);
  assert.equal(presentation.titleBackground,'rgba(0, 0, 0, 0)');assert.equal(presentation.titlePadding,'0px');
  assert.ok(presentation.titleGap>=8);assert.ok(presentation.titleOpacity>=.85);
  await page.screenshot({path:path.join(root,'artifacts/subtle-dark.png'),fullPage:true});
  const darkColor = presentation.color;
  before = calls.length;
  await page.evaluate(()=>document.documentElement.classList.add('light'));
  const light = await page.locator('#spacing [data-sentence-flow]').first().evaluate(span=>({color:getComputedStyle(span).color,sourceColor:getComputedStyle(span.parentElement).color,background:getComputedStyle(span).backgroundColor}));
  assert.equal(light.color,light.sourceColor);assert.notEqual(light.color,darkColor);
  assert.equal(light.background,'rgba(0, 0, 0, 0)');
  await page.screenshot({path:path.join(root,'artifacts/subtle-light.png'),fullPage:true});
  assert.equal(calls.length,before,'changing page theme should not request translations again');
  await command('RESTORE');
  console.log('PASS native light/dark colors, transparent background, compact titles, and measured gaps on both sides of each translation');
  const options = await context.newPage();
  await options.goto(`chrome-extension://${id}/options/options.html`);
  await options.locator('[data-provider="ollama"]').click();
  await options.locator('#baseUrl').fill(origin); await options.locator('#modelName').fill('test-model');
  await options.locator('#save').click();
  await options.waitForFunction(()=>document.querySelector('#save-status').textContent.includes('已保存'));
  await options.locator('#test').click();
  await options.waitForFunction(()=>document.querySelector('#connection-message').textContent.includes('连接成功'));
  await options.locator('#modelName').fill('changed-test-model');
  assert.equal(await options.locator('#connection-message').textContent(),'','changing input invalidates old connection feedback');
  delay = 350;
  await options.locator('#test').click();
  await options.waitForFunction(()=>document.querySelector('#modelName').disabled);
  await options.waitForFunction(()=>document.querySelector('#connection-message').textContent.includes('连接成功'));
  assert.match(await options.locator('#connection-message').textContent(),/尚未保存/);
  assert.equal((await admin({type:'GET_SETTINGS'})).settings.ollama.model,'test-model','testing must not save changes');
  delay = 0;
  await options.locator('#modelName').fill(''); before = calls.length;
  await options.locator('#test').click(); await options.waitForTimeout(150);
  assert.equal(calls.length,before,'invalid form must not call service');
  await options.locator('#modelName').fill('test-model');
  const failedOptions = await context.newPage();
  await failedOptions.addInitScript(()=>{
    const original = chrome.runtime.sendMessage.bind(chrome.runtime);
    let failSettings = true, failStats = true;
    chrome.runtime.sendMessage = async msg=>{
      if (msg.type === 'GET_SETTINGS' && failSettings) { failSettings = false; throw new Error('Temporary storage error'); }
      if (msg.type === 'CACHE_STATS' && failStats) { failStats = false; return {ok:false,error:'Temporary cache error'}; }
      return original(msg);
    };
  });
  await failedOptions.goto(`chrome-extension://${id}/options/options.html`);
  await failedOptions.locator('#reload-settings').waitFor();
  assert.equal(await failedOptions.locator('#save').isDisabled(),true);
  assert.equal(await failedOptions.locator('#test').isDisabled(),true);
  await failedOptions.waitForFunction(()=>document.querySelector('#cache-message').textContent.includes('统计读取失败'));
  assert.match(await failedOptions.locator('#connection-message').textContent(),/设置读取失败/);
  await failedOptions.locator('#reload-settings').click();
  await failedOptions.waitForFunction(()=>!document.querySelector('#save').disabled);
  await failedOptions.waitForFunction(()=>document.querySelector('#cache-message').textContent==='');
  assert.equal(await failedOptions.locator('#modelName').inputValue(),'test-model');
  assert.equal(await failedOptions.locator('#connection-message').textContent(),'');
  await failedOptions.close();
  console.log('PASS invalid settings, stale connection results, unsaved test changes and recoverable settings loading failure');
  const saved = (await admin({type:'GET_SETTINGS'})).settings;
  assert.equal(saved.provider,'ollama');assert.equal(saved.ollama.model,'test-model');
  await options.locator('#preview-theme').click();
  await options.locator('#style').selectOption('underline');
  assert.ok(await options.locator('.preview').evaluate(el=>el.classList.contains('dark')));
  await options.locator('#style').selectOption('soft');await options.locator('#preview-theme').click();
  await fs.mkdir(path.join(root,'artifacts'),{recursive:true});
  await options.screenshot({path:path.join(root,'artifacts/settings.png'),fullPage:true});
  await page.goto(`${origin}/article.html`);
  await command('START'); await command('ALL'); await done();
  await page.screenshot({path:path.join(root,'artifacts/article.png'),fullPage:true});
  // Toolbar-only entry: no popup and no page controls, including legacy users.
  await command('RESTORE');
  await start(`${origin}/styled.html?toolbar`); await done(); await waitBadge('✓');
  const manifest = await worker.evaluate(()=>chrome.runtime.getManifest());
  assert.equal(manifest.action.default_popup,undefined);
  assert.equal(manifest.options_page,'options/options.html');
  assert.ok(!manifest.content_scripts[0].js.includes('content/dock.js'));
  assert.equal(await page.locator('[data-sentence-flow="dock"]').count(),0);
  await clickAction(); await waitBadge('');
  assert.equal(await page.locator('[data-sentence-flow="translation"]').count(),0);
  before = calls.length;
  await clickAction(); await done(); await waitBadge('✓');
  assert.equal(calls.length,before,'toolbar restart must reuse successful cache');
  // Badge is per-tab, and a new document clears any previous completion state.
  await page.reload(); await ready(); await waitBadge('');
  assert.equal((await command('PAGE_STATUS')).phase,'idle');
  assert.equal(calls.length,before);
  // Fresh translation and normal cached restart still work without popup UI.
  await command('START',{ignoreCache:true});
  const forced = await done(); assert.equal(forced.cacheHits,0);
  assert.ok(calls.length>before);
  before = calls.length;
  await clickAction(); await clickAction(); const cached = await done();
  assert.equal(cached.cacheHits,cached.total); assert.equal(calls.length,before);
  await clickAction();
  console.log('PASS toolbar-only toggle, completion badge, per-document reset, cached restart and fresh session; no floating controls or action popup');
  await page.evaluate(()=>{document.body.innerHTML='<main><p>这是一段中文。</p></main>';});
  await command('START'); await done(); await waitBadge('·');
  const emptyNotice = page.locator('[data-sentence-flow="notice"]');
  await emptyNotice.getByRole('status').waitFor();
  assert.match(await emptyNotice.locator('p').textContent(),/目标语言.*翻译范围/);
  await page.evaluate(()=>{const p=document.createElement('p');p.textContent='New content after an empty start.';document.querySelector('main').append(p);});
  await page.waitForFunction(()=>document.querySelectorAll('[data-sentence-flow="translation"]').length===1);
  assert.equal(await emptyNotice.count(),0,'new translatable content removes empty-page guidance');
  await command('RESTORE');
  console.log('PASS empty-page guidance and automatic recovery when new content arrives');
  await worker.evaluate(s=>chrome.storage.local.set({settings:{...s,ollama:{...s.ollama,model:''}}}),settings);
  const missingConfig = await command('START');
  assert.equal(missingConfig.ok,false);
  await emptyNotice.getByRole('alert').waitFor();
  assert.match(await emptyNotice.locator('p').textContent(),/模型名称/);
  await admin({type:'SAVE_SETTINGS',settings});
  await emptyNotice.getByRole('button',{name:'重试翻译'}).click(); await done();
  assert.equal(await emptyNotice.count(),0); await command('RESTORE');
  console.log('PASS startup configuration failure is visible and retry reads newly saved settings');
  await options.locator('#refresh-logs').click();
  await options.waitForFunction(()=>document.querySelector('#logs-message').textContent.includes('条日志'));
  const logText = await options.locator('#logs-output').textContent();
  assert.match(logText,/toolbar.click/); assert.match(logText,/model.response/); assert.match(logText,/translation.error/);
  assert.ok(!logText.includes('test-key')); assert.ok(!logText.includes('A little curiosity opens a new world.'));
  const [download] = await Promise.all([options.waitForEvent('download'),options.locator('#export-logs').click()]);
  const exported = JSON.parse(await fs.readFile(await download.path(),'utf8'));
  assert.equal(exported.version,'1.4.3'); assert.ok(exported.entries.length>0 && exported.entries.length<=300);
  assert.ok(exported.entries.some(row=>row.event==='toolbar.click'));
  await options.locator('#clear-logs').click();
  await options.waitForFunction(()=>document.querySelector('#logs-message').textContent.includes('0 条日志'));
  assert.equal(await options.locator('#logs-output').textContent(),'');
  console.log('PASS persisted diagnostic stages, metadata privacy, log export and clear');
  // Chrome's native Options entry is wired by options_page. Exercise the real
  // openOptionsPage API and verify the resulting settings UI can be used.
  await worker.evaluate(()=>chrome.runtime.openOptionsPage());
  const optionsTab = context.pages().find(p=>p.url()===`chrome-extension://${id}/options/options.html`);
  assert.ok(optionsTab); await optionsTab.locator('#settings-form').waitFor();
  await optionsTab.screenshot({path:path.join(root,'artifacts/options.png'),fullPage:true});
  await optionsTab.getByRole('link',{name:'关于 · 版权与许可'}).click();
  await optionsTab.waitForFunction(()=>document.querySelector('#license-text')?.textContent.startsWith('MIT License'));
  assert.equal(await optionsTab.locator('#license-text').textContent(),await fs.readFile(path.join(root,'LICENSE'),'utf8'));
  assert.match(await optionsTab.locator('#version').textContent(),/1\.4\.3/);
  await optionsTab.waitForFunction(()=>document.querySelector('#privacy-list')?.textContent.includes('API Key'));
  assert.equal(await optionsTab.locator('.reference-list a').count(),6);
  await optionsTab.screenshot({path:path.join(root,'artifacts/about.png'),fullPage:true});
  await optionsTab.setViewportSize({width:390,height:844});
  assert.equal(await optionsTab.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'copyright page fits mobile viewport');
  await optionsTab.screenshot({path:path.join(root,'artifacts/about-mobile.png'),fullPage:true});
  console.log('PASS copyright page, exact packaged MIT text, privacy and reference links, responsive layout');
  assert.deepEqual(errors,[]);
  console.log('PASS settings save, connection test, native Options entry; no page JavaScript errors');
  console.log(`All E2E checks passed. Mock model received ${calls.length} total requests. No real API keys or remote model services used.`);
} finally {
  await context?.close(); await new Promise(resolve=>server.close(resolve));
  await fs.rm(temp,{recursive:true,force:true});
}
