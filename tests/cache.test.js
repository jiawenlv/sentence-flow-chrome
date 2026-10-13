import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cacheGet } from '../background/cache.js';

const rows = new Map();
function request(result) {
  const value = {result};
  queueMicrotask(()=>value.onsuccess());
  return value;
}
globalThis.indexedDB = {open:()=>request({transaction:()=>({objectStore:()=>({get:key=>request(rows.get(key))})})})};

test('invalid or incomplete persisted translations are cache misses, never empty successful results', async () => {
  const valid = {expiresAt:Date.now()+60000,text:'有效译文。'};
  rows.set('valid',valid);
  assert.equal(await cacheGet('valid'),'有效译文。');
  assert.equal(await cacheGet('missing'),null);
  const invalid = [
    {...valid,expiresAt:0}, {...valid,expiresAt:undefined}, {...valid,expiresAt:NaN},
    {...valid,text:undefined}, {...valid,text:null}, {...valid,text:{}},
    {...valid,text:''}, {...valid,text:'   '}, {...valid,text:'x'.repeat(10001)}
  ];
  for (const [index,row] of invalid.entries()) {
    rows.set(`invalid-${index}`,row);
    assert.equal(await cacheGet(`invalid-${index}`),null);
  }
});
