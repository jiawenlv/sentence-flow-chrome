const DB_NAME = 'sentence-flow-cache';
const MAX_ENTRIES = 4000;
const MAX_BYTES = 12 * 1024 * 1024;
let database;
function requestResult(request) {
  return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
}
async function db() {
  if (!database) database = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('translations')) {
        const store = request.result.createObjectStore('translations', { keyPath:'key' });
        store.createIndex('createdAt', 'createdAt');
      }
      if (!request.result.objectStoreNames.contains('pages')) request.result.createObjectStore('pages', {keyPath:'url'});
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { database = null; reject(request.error); };
  });
  return database;
}
function transactionDone(tx) { return new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error('缓存事务中断')); }); }
export async function cacheGet(key) {
  const tx = (await db()).transaction('translations', 'readonly');
  const record = await requestResult(tx.objectStore('translations').get(key));
  if (!record || !Number.isFinite(record.expiresAt) || record.expiresAt < Date.now() || typeof record.text !== 'string' || !record.text.trim() || record.text.length > 10000) return null;
  return record.text;
}
export async function cachePutMany(records) {
  const tx = (await db()).transaction('translations', 'readwrite');
  const done = transactionDone(tx);
  for (const record of records) tx.objectStore('translations').put({ ...record, createdAt: Date.now(), expiresAt: Date.now() + (record.kind === 'fixed' ? 180 : 30) * 86400000, bytes: JSON.stringify(record).length * 2 });
  await done;
  await prune();
}
async function prune() {
  const tx = (await db()).transaction('translations', 'readwrite');
  const done = transactionDone(tx);
  const store = tx.objectStore('translations');
  const records = await requestResult(store.index('createdAt').getAll());
  let count = records.length, bytes = records.reduce((sum, row) => sum + row.bytes, 0);
  for (const row of records) {
    if (row.expiresAt < Date.now() || count > MAX_ENTRIES || bytes > MAX_BYTES) { store.delete(row.key); count--; bytes -= row.bytes; }
  }
  await done;
}
export async function cacheStats() {
  const tx = (await db()).transaction('translations', 'readonly');
  const records = (await requestResult(tx.objectStore('translations').getAll())).filter(row => row.expiresAt > Date.now());
  return { entries: records.length, fixed: records.filter(row => row.kind === 'fixed').length, bytes: records.reduce((sum, row) => sum + row.bytes, 0), sites: new Set(records.map(row => row.origin)).size };
}
export async function cacheClear(origin) {
  const tx = (await db()).transaction('translations', 'readwrite'); const done = transactionDone(tx);
  const store = tx.objectStore('translations');
  if (!origin) store.clear();
  else {
    const rows = await requestResult(store.getAll());
    rows.filter(row => row.origin === origin).forEach(row => store.delete(row.key));
  }
  await done;
}

export async function cacheTrackPage(url, keys) {
  const tx = (await db()).transaction('pages', 'readwrite'), done = transactionDone(tx);
  const store = tx.objectStore('pages');
  const previous = await requestResult(store.get(url));
  store.put({url, keys:[...new Set([...(previous?.keys || []), ...keys])].slice(-4000)});
  await done;
}
export async function cacheClearPage(url, extraKeys = []) {
  const tx = (await db()).transaction(['pages','translations'], 'readwrite'), done = transactionDone(tx);
  const pages = tx.objectStore('pages');
  const page = await requestResult(pages.get(url));
  for (const key of new Set([...(page?.keys || []), ...extraKeys])) tx.objectStore('translations').delete(key);
  pages.delete(url);
  await done;
}
