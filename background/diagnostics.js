// Local, bounded metadata only. Never pass settings, text, headers or bodies.
const KEY = 'diagnostics', LIMIT = 300;
const FIELDS = new Set(['tabId','phase','total','translated','provider','serviceOrigin','status','durationMs','stage','scriptVersion','extensionVersion','count','error']);
function safeText(value) {
  return String(value).replace(/https?:\/\/[^\s"'<>]+/gu,raw=>{
    try { return new URL(raw).origin; } catch { return '[地址已隐藏]'; }
  }).replace(/Bearer\s+\S+/giu,'Bearer [已隐藏]').replace(/\bsk-[\w-]+/gu,'[密钥已隐藏]').slice(0,500);
}
function clean(details) {
  const result = {};
  for (const [key,value] of Object.entries(details || {})) {
    if (!FIELDS.has(key)) continue;
    if (typeof value === 'number' && Number.isFinite(value)) result[key] = value;
    else if (typeof value === 'string') result[key] = safeText(value);
  }
  return result;
}
export function createDiagnostics(storage, now = () => new Date().toISOString()) {
  let tail = Promise.resolve();
  const serial = action => { const result = tail.then(action); tail = result.catch(()=>{}); return result; };
  const read = async () => {
    const rows = (await storage.get(KEY))[KEY];
    return Array.isArray(rows) ? rows.slice(-LIMIT).filter(row=>row && typeof row.time === 'string' && typeof row.event === 'string').map(row=>({time:row.time,event:safeText(row.event),...clean(row)})) : [];
  };
  return {
    record(event,details = {}) {
      const entry = {time:now(),event:safeText(event),...clean(details)};
      return serial(async()=>{const rows=await read(); rows.push(entry); await storage.set({[KEY]:rows.slice(-LIMIT)});}).catch(()=>{});
    },
    read:() => serial(read),
    clear:() => serial(()=>storage.set({[KEY]:[]}))
  };
}
const local = {get:key=>chrome.storage.local.get(key),set:value=>chrome.storage.local.set(value)};
export const diagnostics = createDiagnostics(local);
export const logEvent = (event,details) => diagnostics.record(event,details);
