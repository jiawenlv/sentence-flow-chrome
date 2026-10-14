import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cacheTrackPage,cacheClearPage} from '../background/cache.js';
const stores = {pages:new Map(),translations:new Map()};
function request(result) { const req={result}; queueMicrotask(()=>req.onsuccess?.()); return req; }
globalThis.indexedDB={open:()=>request({transaction:()=>{
  const tx={objectStore:name=>({get:key=>request(stores[name].get(key)),put:row=>stores[name].set(row.url,row),delete:key=>stores[name].delete(key)})};
  setTimeout(()=>tx.oncomplete?.(),0); return tx;
}})};
test('clearing one page removes its accumulated cache keys and legacy visible keys, preserving unrelated entries',async()=>{
  stores.translations.set('a',{});stores.translations.set('b',{});stores.translations.set('other',{});stores.translations.set('legacy',{});
  await cacheTrackPage('https://example.com/a',['a']);
  await cacheTrackPage('https://example.com/a',['a','b']);
  await cacheTrackPage('https://example.com/other',['other']);
  await cacheClearPage('https://example.com/a',['legacy']);
  assert.deepEqual([...stores.translations.keys()],['other']);
  assert.equal(stores.pages.has('https://example.com/a'),false);
  assert.equal(stores.pages.has('https://example.com/other'),true);
});
