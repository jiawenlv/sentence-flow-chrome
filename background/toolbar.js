import '../shared/core.js';
import { logEvent } from './diagnostics.js';
const C = globalThis.SentenceFlowCore;
const getSettings = async () => C.settings((await chrome.storage.local.get('settings')).settings);
export function showState(tabId, state) {
  let text = '', color = '#536951', title = '句流 · 点击翻译当前页面';
  if (state.phase !== 'idle') {
    const count = `${state.translated || 0} / ${state.total || 0} ${state.readingUnit === 'paragraph' ? '段' : '句'}`;
    if (state.error || state.phase === 'error') {
      text = '!'; color = '#b55332'; title = `句流 · ${state.error || '翻译失败，请右键图标 →「选项」检查配置并测试连接。'}`;
    } else if (state.paused) { text = 'Ⅱ'; title = `句流 · 已暂停（${count}），点击恢复原文`; }
    else if (state.phase === 'running') { text = '…'; title = `句流 · 正在翻译（${count}），点击停止并恢复原文`; }
    else if (state.phase === 'reading') { text = '…'; title = `句流 · 等待滚动继续翻译（${count}），点击恢复原文`; }
    else if (state.total > 0 && state.translated === state.total) { text = '✓'; title = `句流 · 翻译完成（${count}），点击恢复原文`; }
    else { text = '·'; title = '句流 · 未找到可翻译文字，等待新内容；可在选项中检查目标语言和翻译范围，点击关闭'; }
  }
  // Each call is dispatched synchronously, preserving document/status order.
  return Promise.all([
    chrome.action.setBadgeText({tabId,text}),
    chrome.action.setBadgeBackgroundColor({tabId,color}),
    chrome.action.setTitle({tabId,title})
  ]);
}
const toggles = new Map();
export async function toggleTab(tab) {
  if (!tab?.id) return;
  void logEvent('toolbar.click',{tabId:tab.id});
  // Serialize injection and dispatch, but not async startup. A second click can
  // cancel the session while configuration from the first click is still loading.
  const dispatch = (toggles.get(tab.id) || Promise.resolve()).catch(() => {}).then(async () => {
    if (!/^https?:/u.test(tab.url || '')) throw new Error('请在普通 HTTP(S) 网页中使用，浏览器内置页和 PDF 暂不支持。');
    void logEvent('page.inject.start',{tabId:tab.id});
    try { await chrome.scripting.executeScript({target:{tabId:tab.id},files:['shared/core.js','content/content.js']}); }
    catch (reason) { void logEvent('page.inject.error',{tabId:tab.id,error:C.errorMessage(reason)}); throw new Error('无法访问此页面。请刷新网页，并在扩展管理中检查句流的网站访问权限；浏览器内置页、商店和 PDF 暂不支持。'); }
    const ready = await chrome.tabs.sendMessage(tab.id,{type:'PAGE_STATUS'});
    void logEvent('page.ready',{tabId:tab.id,phase:ready?.phase,scriptVersion:ready?.version,extensionVersion:chrome.runtime.getManifest().version});
    if (!ready?.ok || ready.version !== chrome.runtime.getManifest().version) throw new Error('此网页仍在使用旧版翻译脚本，请刷新网页后再翻译。');
    if (ready.phase === 'idle' || ready.active === false) {
      try { C.validateSettings(await getSettings()); }
      catch (reason) {
        await chrome.runtime.openOptionsPage().catch(() => {});
        throw new Error(`${C.errorMessage(reason)} 请在选项中检查配置、测试连接并保存，再重试翻译。`);
      }
    }
    return {response:chrome.tabs.sendMessage(tab.id,{type:'TOGGLE'})};
  });
  toggles.set(tab.id,dispatch);
  try {
    const {response} = await dispatch;
    const result = await response;
    if (!result?.ok) throw new Error(result?.error || '页面通信失败，请刷新网页后重试。');
    void logEvent('toolbar.toggle.complete',{tabId:tab.id,phase:result.phase,total:result.total,translated:result.translated});
  } catch (reason) {
    const error = C.errorMessage(reason,'该页面不允许扩展运行，请换一个普通网页重试。');
    void logEvent('toolbar.error',{tabId:tab.id,error});
    await showState(tab.id,{phase:'error',error}).catch(() => {});
    await chrome.tabs.sendMessage(tab.id,{type:'PAGE_NOTICE',error}).catch(() => {});
  } finally { if (toggles.get(tab.id) === dispatch) toggles.delete(tab.id); }
}
