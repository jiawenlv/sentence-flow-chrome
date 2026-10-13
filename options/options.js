import '../shared/core.js';
const C = globalThis.SentenceFlowCore, $ = id => document.getElementById(id);
let config = C.settings(), provider = 'ollama', pending = false, loaded = false, dirty = false;
const send = async message => {
  try {
    const result = await chrome.runtime.sendMessage(message);
    if (!result?.ok) throw new Error(result?.error || '扩展连接失败，请重新加载设置页。');
    return result;
  } catch (reason) { throw new Error(C.errorMessage(reason)); }
};
function message(id,text,error = false) { $(id).textContent = text; $(id).classList.toggle('error',error); }
function stashProfile() { config[provider] = {baseUrl:$('baseUrl').value, model:$('modelName').value, apiKey:$('apiKey').value}; }
function showProfile(next) {
  provider = next; config.provider = next;
  const local = next === 'ollama';
  for (const button of document.querySelectorAll('[data-provider]')) { const active = button.dataset.provider === next; button.classList.toggle('active',active); button.setAttribute('aria-pressed',String(active)); }
  $('baseUrl').value = config[next].baseUrl; $('modelName').value = config[next].model; $('apiKey').value = config[next].apiKey;
  $('provider-title').textContent = local ? '连接你的 Ollama' : '连接在线大模型';
  $('provider-badge').textContent = local ? 'LOCAL FIRST' : 'OPENAI COMPATIBLE';
  $('baseUrl').placeholder = local ? 'http://localhost:11434' : 'https://api.example.com/v1';
  $('endpoint-hint').textContent = local ? '填写服务根地址，自动补全 /api/chat。' : '填写 Base URL，也支持完整的 /chat/completions 地址。';
  $('modelName').placeholder = local ? '填写已安装的模型名称' : '填写服务支持的模型 ID';
  $('model-hint').textContent = local ? '运行 ollama list 查看本机已安装模型。' : '支持 OpenAI、DeepSeek 等兼容 Chat Completions 的服务。';
  $('apiKey').placeholder = local ? '本地服务通常无需填写' : '填入服务商提供的 API Key';
  $('key-note').textContent = local ? '可选' : '按服务商要求填写';
  $('ollama-help').hidden = !local;
  $('connection-hint').textContent = local ? '用一句短句，确认本地模型已准备好。' : '测试会向该服务发送一句短句，可能产生少量费用。';
  message('connection-message','');
}
function readForm() {
  stashProfile();
  return C.validateSettings({...config, provider, targetLanguage:$('targetLanguage').value, scope:$('scope').value, style:$('style').value, timeout:Number($('timeout').value), translateFixed:$('translateFixed').checked, cacheFixed:$('cacheFixed').checked, lazy:$('lazy').checked});
}
function hasPermission(settings) { return chrome.permissions.contains({origins:[C.permissionPattern(settings)]}); }
function busy(value) {
  pending = value;
  for (const control of document.querySelectorAll('#settings-form input, #settings-form select, [data-provider], #show-key, #test, #save')) control.disabled = value || !loaded;
}
function changed() { dirty = true; message('save-status','有未保存的更改，请保存后再回到网页重试翻译。'); message('connection-message',''); }
for (const button of document.querySelectorAll('[data-provider]')) button.addEventListener('click', () => { if (pending || !loaded || provider === button.dataset.provider) return; stashProfile(); showProfile(button.dataset.provider); changed(); });
$('show-key').addEventListener('click', () => { const hidden = $('apiKey').type === 'password'; $('apiKey').type = hidden ? 'text' : 'password'; $('show-key').textContent = hidden ? '隐藏' : '显示'; $('show-key').setAttribute('aria-label',hidden ? '隐藏 API Key' : '显示 API Key'); });
$('settings-form').addEventListener('submit', async event => {
  event.preventDefault(); if (pending || !loaded) return;
  try {
    const settings = readForm();
    // The permanent entry declares webpage access; verify Chrome still grants it.
    const permission = hasPermission(settings); busy(true);
    message('save-status','正在保存设置…');
    if (!await permission) throw new Error('设置尚未保存。请在扩展管理 → 句流 → 网站访问权限中允许服务地址，再保存。');
    await send({type:'SAVE_SETTINGS',settings}); config = settings;
    dirty = false;
    message('save-status','✓ 已保存。已开启的页面请先关闭再开启翻译，失败的页面可点击“重试翻译”。');
  } catch(error) { message('save-status',C.errorMessage(error),true); }
  finally { busy(false); }
});
$('test').addEventListener('click', async () => {
  if (pending || !loaded || !$('settings-form').reportValidity()) return;
  try {
    const settings = readForm(); const permission = hasPermission(settings); busy(true);
    if (!await permission) throw new Error('请在扩展管理 → 句流 → 网站访问权限中允许服务地址，再测试连接。');
    message('connection-message','正在连接并翻译测试句，首次加载本地模型可能较慢…');
    const result = await send({type:'TEST_CONNECTION',settings});
    message('connection-message',`✓ 连接成功 · ${result.sample}${dirty ? ' · 当前更改尚未保存，请点击“保存设置”。' : ''}`);
  } catch(error) { message('connection-message',C.errorMessage(error),true); }
  finally { busy(false); }
});
async function updateStats() {
  try {
    const stats = await send({type:'CACHE_STATS'});
    $('stats-entries').textContent = stats.entries.toLocaleString(); $('stats-fixed').textContent = stats.fixed.toLocaleString(); $('stats-sites').textContent = String(stats.sites);
    $('stats-size').textContent = stats.bytes < 1024 * 1024 ? `${Math.round(stats.bytes/1024)} KB` : `${(stats.bytes/1024/1024).toFixed(1)} MB`;
    message('cache-message','');
    return true;
  } catch (error) {
    for (const id of ['stats-entries','stats-fixed','stats-sites','stats-size']) $(id).textContent = '—';
    message('cache-message',`缓存统计读取失败，请重新加载设置页。${C.errorMessage(error)}`,true);
    return false;
  }
}
$('clear-cache').addEventListener('click', () => { $('clear-confirm').hidden = false; });
$('cancel-clear').addEventListener('click', () => { $('clear-confirm').hidden = true; });
$('confirm-clear').addEventListener('click', async () => {
  $('confirm-clear').disabled = true;
  try {
    await send({type:'CLEAR_CACHE'}); $('clear-confirm').hidden = true;
    if (await updateStats()) message('cache-message','缓存已清空。已显示的译文会保留，关闭再开启翻译可重新请求。');
    else message('cache-message','缓存已清空，但统计暂时无法读取，请重新加载设置页。',true);
  }
  catch(error) { message('cache-message',`缓存清空失败，请重试。${C.errorMessage(error)}`,true); }
  finally { $('confirm-clear').disabled = false; }
});
function updatePreview() {
  const preview = document.querySelector('.preview');
  for (const style of ['soft','underline','plain']) preview.classList.toggle(style,$('style').value === style);
}
async function refreshLogs() {
  const data = await send({type:'GET_DIAGNOSTICS'});
  $('logs-output').textContent = data.entries.map(row=>`${row.time} ${row.event} ${JSON.stringify(Object.fromEntries(Object.entries(row).filter(([key])=>!['time','event'].includes(key))))}`).join('\n');
  message('logs-message',`当前扩展版本 ${data.version} · ${data.entries.length} 条日志。${data.entries.length ? '' : '请回到网页点击翻译，然后刷新日志。'}`);
  return data;
}
for (const id of ['refresh-logs','export-logs','clear-logs']) $(id).addEventListener('click',async()=>{
  for (const button of document.querySelectorAll('.diagnostics-actions button')) button.disabled = true;
  try {
    if (id === 'clear-logs') await send({type:'CLEAR_DIAGNOSTICS'});
    const data = await refreshLogs();
    if (id === 'export-logs') {
      const blob = new Blob([JSON.stringify({version:data.version,exportedAt:new Date().toISOString(),entries:data.entries},null,2)],{type:'application/json'});
      const url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = `sentence-flow-diagnostics-${Date.now()}.json`;
      document.body.append(link); link.click(); link.remove();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
    }
  } catch (error) { message('logs-message',`日志操作失败。${C.errorMessage(error)}`,true); }
  finally { for (const button of document.querySelectorAll('.diagnostics-actions button')) button.disabled = false; }
});
$('style').addEventListener('change',updatePreview);
$('preview-theme').addEventListener('click', () => {
  const dark = document.querySelector('.preview').classList.toggle('dark');
  $('preview-theme').textContent = dark ? '浅色预览' : '深色预览';
  $('preview-theme').setAttribute('aria-pressed',String(dark));
});
$('settings-form').addEventListener('input',changed);
$('settings-form').addEventListener('change',changed);
$('reload-settings').addEventListener('click',() => { void init(); });
for (const link of document.querySelectorAll('.sidebar nav a')) link.addEventListener('click', () => { document.querySelectorAll('.sidebar nav a').forEach(item => item.classList.toggle('selected',item === link)); });
async function init() {
  loaded = false; busy(true); $('reload-settings').hidden = true;
  message('save-status','正在读取已保存的设置…');
  try {
    config = (await send({type:'GET_SETTINGS'})).settings;
    showProfile(config.provider);
    for (const key of ['targetLanguage','scope','style','timeout']) $(key).value = config[key];
    for (const key of ['translateFixed','cacheFixed','lazy']) $(key).checked = config[key];
    updatePreview();
    $('origins-command').textContent = `launchctl setenv OLLAMA_ORIGINS "chrome-extension://${chrome.runtime.id}"`;
    loaded = true; dirty = false;
    message('save-status','保存后，已开启的页面请先关闭再开启翻译。');
  } catch(error) {
    message('connection-message',`设置读取失败，请点击“重新加载设置”。${C.errorMessage(error)}`,true);
    message('save-status','设置尚未加载，暂时无法保存。',true); $('reload-settings').hidden = false;
  } finally { busy(false); }
  await updateStats();
  await refreshLogs().catch(error=>message('logs-message',`日志读取失败。${C.errorMessage(error)}`,true));
}
void init();
