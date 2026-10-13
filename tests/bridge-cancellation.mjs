// Optional integration check against a local ollama-openai-bridge checkout.
// Copies source to a temporary directory; never starts the real model/service.
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
if (!process.argv[2]) throw new Error('Usage: node tests/bridge-cancellation.mjs /path/to/ollama-server [--verify]');
const bridgeRoot = path.resolve(process.argv[2]);
const patch = path.resolve(import.meta.dirname,'../tools/ollama-server-cancellation.patch');
async function until(predicate, message) {
  for (let i=0;i<150;i++) { if (predicate()) return; await sleep(10); }
  assert.fail(message);
}
async function check(patched) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(),'sentence-flow-bridge-'));
  const calls = new Map();
  const upstream = http.createServer(async(req,res)=>{
    if (req.url==='/api/version') { res.end('{"version":"test"}'); return; }
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw), key = body.messages.at(-1).content;
    const call = {aborted:false,finish:()=>{
      const result = {model:'test-model',message:{role:'assistant',content:'translated'},done:true};
      res.end(JSON.stringify(result)+(body.stream?'\n':''));
    }};
    calls.set(key,call);
    res.once('close',()=>{if(!res.writableEnded)call.aborted=true;});
    if (key==='stream-after-headers') {
      res.writeHead(200,{'content-type':'application/x-ndjson'});
      res.write(JSON.stringify({model:'test-model',message:{role:'assistant',content:'first'},done:false})+'\n');
    }
  });
  let child;
  try {
    await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve));
    const upstreamUrl = `http://127.0.0.1:${upstream.address().port}`;
    const reservation = http.createServer();
    await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));
    const port = reservation.address().port;
    await new Promise(resolve=>reservation.close(resolve));
    await fs.mkdir(path.join(temp,'src'));
    await fs.copyFile(path.join(bridgeRoot,'src/server.js'),path.join(temp,'src/server.js'));
    await fs.writeFile(path.join(temp,'package.json'),'{"type":"module"}');
    await fs.symlink(path.join(bridgeRoot,'node_modules'),path.join(temp,'node_modules'));
    if (patched) {
      const result = spawnSync('patch',['-p1','-i',patch],{cwd:temp,encoding:'utf8'});
      assert.equal(result.status,0,result.stdout+result.stderr);
    }
    child = spawn(process.execPath,[path.join(temp,'src/server.js')],{
      cwd:temp,env:{...process.env,HOST:'127.0.0.1',PORT:String(port),OLLAMA_HOST:upstreamUrl,OLLAMA_MODEL:'test-model',API_KEY:'',ALLOW_MODEL_OVERRIDE:'false'},stdio:['ignore','pipe','pipe']
    });
    let output = '', errors = '';
    child.stdout.on('data',chunk=>{output+=chunk;});
    child.stderr.on('data',chunk=>{errors+=chunk;});
    await until(()=>output.includes('bridge listening'),`isolated bridge did not start: ${errors}`);
    const base = `http://127.0.0.1:${port}`;
    const request = (key,controller,stream=false,completion=false) => fetch(base+(completion?'/v1/completions':'/v1/chat/completions'),{
      method:'POST',headers:{'content-type':'application/json'},signal:controller.signal,
      body:JSON.stringify(completion?{prompt:key,stream:false}:{messages:[{role:'user',content:key}],stream})
    }).catch(error=>({error}));

    const normal = request('normal',new AbortController());
    await until(()=>calls.has('normal'),'normal request did not reach upstream');
    await sleep(100);
    assert.equal(calls.get('normal').aborted,false,'receiving the request body must not cancel normal inference');
    calls.get('normal').finish();
    assert.equal((await (await normal).json()).choices[0].message.content,'translated');

    const outcomes = {};
    for (const [key,stream,completion] of [['non-streaming',false,false],['stream-before-headers',true,false],['stream-after-headers',true,false],['completions',false,true]]) {
      const controller = new AbortController();
      const pending = request(key,controller,stream,completion);
      await until(()=>calls.has(key),`${key} did not reach upstream`);
      await sleep(100);
      controller.abort(); await pending;
      await sleep(250);
      outcomes[key] = calls.get(key).aborted;
    }
    // Cancellation must be per HTTP request, even when both use one model.
    const one = new AbortController(), two = new AbortController();
    const first = request('independent-one',one), second = request('independent-two',two);
    await until(()=>calls.has('independent-one')&&calls.has('independent-two'),'parallel requests did not reach upstream');
    one.abort(); await first; await sleep(250);
    assert.equal(calls.get('independent-two').aborted,false,'one cancellation must preserve the other request');
    calls.get('independent-two').finish();
    assert.equal((await (await second).json()).choices[0].message.content,'translated');
    outcomes['independent-request'] = calls.get('independent-one').aborted;
    assert.equal(errors,'','cancelled responses must not crash or write errors to closed sockets');
    console.log(`${patched?'PATCHED':'CURRENT'} ${JSON.stringify(outcomes)}`);
    return outcomes;
  } finally {
    if (child && child.exitCode===null) { child.kill('SIGKILL'); await new Promise(resolve=>child.once('close',resolve)); }
    upstream.closeAllConnections();
    await new Promise(resolve=>upstream.close(resolve));
    await fs.rm(temp,{recursive:true,force:true});
  }
}
const current = await check(false);
if (process.argv.includes('--verify')) {
  assert.ok(Object.values(current).every(Boolean),'installed bridge must propagate every tested disconnect');
  console.log('PASS installed bridge cancellation, normal responses and independent requests. No real models or running services used.');
  process.exit(0);
}
assert.equal(current['non-streaming'],false,'baseline changed: re-evaluate the patch before applying');
const fixed = await check(true);
assert.ok(Object.values(fixed).every(Boolean),'patched bridge must propagate every tested disconnect');
console.log('PASS bridge cancellation regression: non-streaming, both streaming phases, completions, normal responses and independent requests. No real models or running services used.');
