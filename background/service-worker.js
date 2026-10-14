import { showState, toggleTab } from './toolbar.js';
import '../shared/core.js';
import { cacheGet, cachePutMany, cacheStats, cacheClear, cacheTrackPage, cacheClearPage } from './cache.js';
import { callModel } from './provider.js';
import { diagnostics, logEvent } from './diagnostics.js';
const C = globalThis.SentenceFlowCore;
const inFlight = new Map(), jobs = new Set(), cancelled = new Set(), documents = new Map();
let active = 0;
const waiters = [];
let cacheEpoch = 0;
const getSettings = async () => C.settings((await chrome.storage.local.get('settings')).settings);
const trusted = sender => sender.id === chrome.runtime.id && sender.url?.startsWith(chrome.runtime.getURL(''));
const loggedStates = new Map();
void logEvent('worker.start',{extensionVersion:chrome.runtime.getManifest?.().version});
async function removeLegacyRegistration() {
  const old = await chrome.scripting.getRegisteredContentScripts({ids:['sentence-flow-floating']});
  if (old.length) await chrome.scripting.unregisterContentScripts({ids:['sentence-flow-floating']});
}
async function lock(signal) {
  if (signal.aborted) throw signal.reason;
  if (active < 2) { active++; return; }
  await new Promise((resolve,reject) => {
    const waiter = { grant:() => { signal.removeEventListener('abort',abort); resolve(); } };
    const abort = () => {
      const index = waiters.indexOf(waiter);
      if (index !== -1) waiters.splice(index,1);
      reject(signal.reason);
    };
    signal.addEventListener('abort',abort,{once:true});
    waiters.push(waiter);
  });
}
function unlock() { const next = waiters.shift(); if (next) next.grant(); else active--; }
// Abort fetch itself, and settle our scheduler independently of a service or
// response parser which takes time to acknowledge the abort.
function abortable(signal, action) {
  return new Promise((resolve,reject) => {
    if (signal.aborted) { reject(signal.reason); return; }
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort',abort,{once:true});
    Promise.resolve().then(() => {
      if (signal.aborted) throw signal.reason;
      return action();
    }).then(resolve,reject).finally(() => signal.removeEventListener('abort',abort));
  });
}
async function hash(value) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2,'0')).join(''); }
function cancelConsumer(consumer) {
  cancelled.add(consumer);
  if (cancelled.size > 300) cancelled.delete(cancelled.values().next().value);
  for (const entry of inFlight.values()) {
    entry.consumers.delete(consumer);
    if (!entry.consumers.size) {
      // Evict synchronously: a restart must never subscribe to an aborted job.
      inFlight.delete(entry.key); entry.abandoned = true;
      entry.reject(new Error('翻译已停止。'));
    }
  }
  for (const job of jobs) if (job.entries.every(entry => !entry.consumers.size)) job.controller.abort(new Error('翻译已停止。'));
}
function cancelTab(tabId) {
  const consumers = new Set([...inFlight.values()].flatMap(entry => [...entry.consumers]).filter(consumer => consumer.startsWith(`${tabId}:`)));
  consumers.forEach(cancelConsumer);
}
function registerDocument(sender) {
  const previous = documents.get(sender.tab.id);
  if (previous && previous !== sender.documentId) cancelTab(sender.tab.id);
  documents.set(sender.tab.id,sender.documentId);
}
function assertCurrent(consumer, sender) {
  if (cancelled.has(consumer) || (documents.has(sender.tab.id) && documents.get(sender.tab.id) !== sender.documentId)) throw new Error('翻译已停止。');
}
async function runJob(config, origin, entries) {
  const controller = new AbortController(), job = { controller, entries };
  const epoch = cacheEpoch;
  jobs.add(job);
  let timer, keepalive, acquired = false;
  try {
    await lock(controller.signal); acquired = true;
    if (controller.signal.aborted) throw controller.signal.reason;
    timer = setTimeout(() => controller.abort(new Error(`模型响应超过 ${config.timeout} 秒，请在设置中增加超时或使用更快的模型。`)), config.timeout * 1000);
    // Keep the worker alive while a local model loads. No page requests run in this interval.
    keepalive = setInterval(() => chrome.runtime.getPlatformInfo().catch(() => {}), 20000);
    const output = await abortable(controller.signal,() => callModel(config, entries.map((entry,id) => ({ id, text:entry.source })), controller.signal));
    if (controller.signal.aborted) throw controller.signal.reason;
    const records = output.flatMap((row,id) => entries[id].cacheable && !entries[id].abandoned ? [{ key:entries[id].cacheKey, origin, text:row.text, kind:entries[id].kind }] : []);
    if (epoch === cacheEpoch && records.length) await cachePutMany(records).catch(() => {});
    output.forEach((row,id) => entries[id].resolve(row.text));
  } catch (error) { void logEvent('translation.error',{error:C.errorMessage(error),count:entries.length}); entries.forEach(entry => entry.reject(error)); }
  finally {
    clearTimeout(timer); clearInterval(keepalive); jobs.delete(job); if (acquired) unlock();
    entries.forEach(entry => { if (inFlight.get(entry.key) === entry) inFlight.delete(entry.key); });
  }
}
async function translate(message, sender) {
  if (!sender.tab || sender.frameId !== 0 || !/^https?:/u.test(sender.url || '')) throw new Error('只能翻译普通网页的主页面。');
  if (typeof message.session !== 'string' || message.session.length > 80 || !Array.isArray(message.items) || !message.items.length || message.items.length > 12) throw new Error('翻译请求格式无效。');
  if (message.ignoreCache !== undefined && typeof message.ignoreCache !== 'boolean') throw new Error('翻译请求格式无效。');
  const ids = new Set(); let chars = 0;
  for (const item of message.items) {
    if (!item || !Number.isInteger(item.id) || ids.has(item.id) || typeof item.text !== 'string' || !item.text.trim() || item.text.length > 6000 || !['fixed','article'].includes(item.kind)) throw new Error('待翻译的句子格式无效。');
    ids.add(item.id); chars += item.text.length;
  }
  if (chars > 6000) throw new Error('单次请求文本过长。');
  const consumer = `${sender.tab.id}:${message.session}`;
  assertCurrent(consumer,sender);
  const config = C.validateSettings(await getSettings());
  if (!await chrome.permissions.contains({ origins:[C.permissionPattern(config)] })) throw new Error('尚未授予模型服务访问权限，请在扩展管理 → 句流 → 网站访问权限中允许服务地址，然后回到设置测试连接。');
  const origin = new URL(sender.url).origin;
  const prepared = await Promise.all(message.items.map(async item => ({ ...item, key:await hash(C.cacheIdentity(config, origin, item.text, item.kind)), cacheable:item.kind !== 'fixed' || config.cacheFixed })));
  await cacheTrackPage(sender.url, prepared.filter(item => item.cacheable).map(item => item.key)).catch(() => {});
  const cached = await Promise.all(prepared.map(item => item.cacheable && !message.ignoreCache ? cacheGet(item.key).catch(() => null) : null));
  assertCurrent(consumer,sender);
  const fresh = [], results = [];
  prepared.forEach((item,index) => {
    if (cached[index] !== null) { results.push(Promise.resolve({ id:item.id, text:cached[index], cached:true })); return; }
    // Force-retranslate must bypass old in-flight results too, while retaining
    // deduplication between batches within this fresh session.
    const requestKey = message.ignoreCache ? `${item.key}:fresh:${consumer}` : item.key;
    let entry = inFlight.get(requestKey);
    if (!entry) {
      let resolve, reject;
      const promise = new Promise((yes,no) => { resolve = yes; reject = no; });
      entry = { key:requestKey, cacheKey:item.key, source:item.text, kind:item.kind, cacheable:item.cacheable, consumers:new Set(), promise, resolve, reject };
      inFlight.set(requestKey, entry); fresh.push(entry);
    }
    entry.consumers.add(consumer);
    results.push(entry.promise.then(text => ({ id:item.id, text, cached:false })));
  });
  if (fresh.length) void runJob(config, origin, fresh);
  const output = await Promise.all(results);
  assertCurrent(consumer,sender);
  return { results:output };
}
async function handle(message, sender) {
  if (sender.id !== chrome.runtime.id || !message || typeof message.type !== 'string') throw new Error('无效请求。');
  if (message.type === 'TRANSLATE') return translate(message, sender);
  if (message.type === 'CANCEL' && sender.tab) { cancelConsumer(`${sender.tab.id}:${message.session}`); return {}; }
  if (message.type === 'PAGE_READY' && sender.tab && sender.frameId === 0) { registerDocument(sender); return {}; }
  if (message.type === 'PAGE_STATE' && sender.tab && sender.frameId === 0) {
    // MV3 can restart without reloading the page. Re-register the first state
    // after a worker restart, while a loading tab waits for PAGE_READY.
    if (!documents.has(sender.tab.id)) registerDocument(sender);
    if (documents.get(sender.tab.id) !== sender.documentId) return {};
    const state = message.state;
    if (!state || !['idle','running','reading','done','paused','error'].includes(state.phase)) throw new Error('页面状态无效。');
    const key = `${state.phase}:${state.error || ''}`;
    if (loggedStates.get(sender.tab.id) !== key) {
      loggedStates.set(sender.tab.id,key);
      void logEvent('page.state',{tabId:sender.tab.id,phase:state.phase,total:state.total,translated:state.translated,error:state.error});
    }
    await showState(sender.tab.id,state); return {};
  }
  if (message.type === 'PAGE_CONFIG' && sender.tab) {
    const s = C.validateSettings(await getSettings());
    return { targetLanguage:s.targetLanguage, readingUnit:s.readingUnit, scope:s.scope, translateFixed:s.translateFixed, lazy:s.lazy, style:s.style, batchSize:/(?:^|\/)hy-mt/i.test(s[s.provider].model) ? 4 : 12 };
  }
  if (message.type === 'OPEN_OPTIONS' && sender.tab && sender.frameId === 0 && /^https?:/u.test(sender.url || '')) {
    await chrome.runtime.openOptionsPage(); return {};
  }
  if (!trusted(sender)) throw new Error('此操作只能在扩展界面进行。');
  switch (message.type) {
    case 'GET_DIAGNOSTICS': return {entries:await diagnostics.read(),version:chrome.runtime.getManifest().version};
    case 'CLEAR_DIAGNOSTICS': await diagnostics.clear(); return {};
    case 'GET_SETTINGS': return { settings:await getSettings() };
    case 'SAVE_SETTINGS': {
      const settings = C.validateSettings(message.settings);
      if (!await chrome.permissions.contains({origins:[C.permissionPattern(settings)]})) throw new Error('请在扩展管理 → 句流 → 网站访问权限中允许服务地址，再保存设置。');
      await chrome.storage.local.set({ settings }); return {};
    }
    case 'TEST_CONNECTION': {
      const config = C.validateSettings(message.settings);
      if (!await chrome.permissions.contains({origins:[C.permissionPattern(config)]})) throw new Error('请在扩展管理 → 句流 → 网站访问权限中允许服务地址，再测试连接。');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(new Error('连接测试超时，请检查服务或先在本地加载模型。')), config.timeout * 1000);
      const keepalive = setInterval(() => chrome.runtime.getPlatformInfo().catch(() => {}), 20000);
      try { return { sample:(await abortable(controller.signal, () => callModel(config, [{ id:0, text:'A little curiosity opens a new world.' }], controller.signal)))[0].text }; }
      finally { clearTimeout(timer); clearInterval(keepalive); }
    }
    case 'CACHE_STATS': return cacheStats();
    case 'CLEAR_CACHE': {
      if (message.origin !== undefined && (!/^https?:/u.test(message.origin) || new URL(message.origin).origin !== message.origin)) throw new Error('网站地址无效。');
      cacheEpoch++; await cacheClear(message.origin); return {};
    }
    default: throw new Error('未知操作。');
  }
}
chrome.runtime.onMessage.addListener((message,sender,respond) => {
  handle(message,sender).then(data => respond({ ok:true, ...data }), error => {
    if (sender.id === chrome.runtime.id) void logEvent('operation.error',{stage:message?.type,tabId:sender.tab?.id,error:C.errorMessage(error)});
    respond({ ok:false, error:C.errorMessage(error) });
  });
  return true;
});
async function protectStorage() { await chrome.storage.local.setAccessLevel({ accessLevel:'TRUSTED_CONTEXTS' }); }
chrome.runtime.onInstalled.addListener(protectStorage);
chrome.runtime.onStartup.addListener(protectStorage);
void protectStorage();
chrome.runtime.onInstalled.addListener(() => { void removeLegacyRegistration().catch(() => {}); });
chrome.runtime.onStartup.addListener(() => { void removeLegacyRegistration().catch(() => {}); });
chrome.tabs.onRemoved.addListener(tabId => {
  cancelTab(tabId); documents.delete(tabId); loggedStates.delete(tabId);
});
chrome.tabs.onUpdated.addListener((tabId,change) => {
  if (change.status === 'loading') {
    cancelTab(tabId); documents.set(tabId,null);
    void showState(tabId,{phase:'idle'}).catch(() => {});
  }
});
chrome.action.onClicked.addListener(tab => { void toggleTab(tab); });
chrome.commands.onCommand.addListener(async command => {
  if (command !== 'toggle-translation') return;
  const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
  await toggleTab(tab);
});

const clearPageMenu = 'sentence-flow-clear-page-cache';
async function registerCacheMenu() {
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({id:clearPageMenu,title:'清除当前页面翻译缓存',contexts:['page','action'],documentUrlPatterns:['http://*/*','https://*/*']});
}
chrome.runtime.onInstalled.addListener(() => { void registerCacheMenu().catch(() => {}); });
chrome.contextMenus?.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== clearPageMenu || !tab?.id || !/^https?:/u.test(tab.url || '')) return;
  void (async () => {
    // Cancel before deleting so an unfinished response cannot repopulate the cache.
    cancelTab(tab.id); cacheEpoch++;
    const page = await chrome.tabs.sendMessage(tab.id,{type:'PAGE_CACHE_ITEMS'}).catch(() => null);
    const config = await getSettings();
    const keys = await Promise.all((page?.items || []).map(item => hash(C.cacheIdentity(config,new URL(tab.url).origin,item.text,item.kind))));
    await chrome.tabs.sendMessage(tab.id,{type:'RESTORE'}).catch(() => {});
    await cacheClearPage(tab.url,keys);
    await showState(tab.id,{phase:'idle'});
    await chrome.action.setTitle({tabId:tab.id,title:'句流 · 当前页面缓存已清除，点击重新翻译'});
  })().catch(async reason => {
    await showState(tab.id,{phase:'error',error:C.errorMessage(reason)});
  });
});
