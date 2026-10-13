import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDiagnostics } from '../background/diagnostics.js';
function setup() {
  let stored = {};
  return createDiagnostics({get:async()=>structuredClone(stored),set:async value=>{stored=structuredClone(value);}},()=> '2026-10-13T00:00:00.000Z');
}
test('diagnostics serialize concurrent records, persist the latest 300 and support clear',async()=>{
  const logs=setup();
  await Promise.all(Array.from({length:305},(_,count)=>logs.record('model.response',{count,status:200})));
  const rows=await logs.read(); assert.equal(rows.length,300); assert.equal(rows[0].count,5); assert.equal(rows.at(-1).count,304);
  await logs.clear(); assert.deepEqual(await logs.read(),[]);
});
test('diagnostics keep only safe metadata and strip credentials, URL paths and query strings',async()=>{
  const logs=setup();
  await logs.record('model.error',{provider:'online',apiKey:'private',text:'private source',body:{messages:'private'},error:'fetch https://user:password@localhost:11435/private?key=secret Bearer confidential sk-abc-123',serviceOrigin:'http://127.0.0.1:11435/v1?key=secret'});
  const text=JSON.stringify(await logs.read());
  for (const secret of ['private','password','confidential','secret','sk-abc-123','apiKey','messages']) assert.ok(!text.includes(secret),secret);
  assert.match(text,/127.0.0.1:11435/); assert.match(text,/已隐藏/);
});
test('diagnostic storage failure cannot break translation and later records can recover',async()=>{
  let broken=true, stored={};
  const logs=createDiagnostics({get:async()=>{if(broken)throw new Error('storage unavailable');return stored;},set:async value=>{stored=value;}});
  await assert.doesNotReject(logs.record('toolbar.click'));
  broken=false; await logs.record('toolbar.click',{tabId:7});
  assert.equal((await logs.read()).length,1);
});
