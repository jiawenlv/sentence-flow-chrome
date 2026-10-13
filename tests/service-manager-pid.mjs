// Verify PID reuse in an isolated copy; never signal the user's real service.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
if (!process.argv[2]) throw new Error('Usage: node tests/service-manager-pid.mjs /path/to/ollama-server [--verify]');
const source = path.resolve(process.argv[2]);
const temp = await fs.mkdtemp(path.join(os.tmpdir(),'sentence-flow-pid-'));
const pidFile = path.join(temp,'.translate-service/translate-service.pid');
const upstream = http.createServer((req,res)=>res.end('{"version":"test"}'));
const unrelated = spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
const spawned = new Set();
let manager;
async function cli(command) {
  const child = spawn(process.execPath,[manager,command],{cwd:temp,env:{...process.env,HOST:'127.0.0.1',PORT:String(port),OLLAMA_HOST:upstreamUrl},stdio:['ignore','pipe','pipe']});
  let output = '';
  child.stdout.on('data',chunk=>{output+=chunk;}); child.stderr.on('data',chunk=>{output+=chunk;});
  const code = await new Promise(resolve=>child.once('close',resolve));
  return {code,output};
}
const alive = pid=>{try{process.kill(pid,0);return true;}catch{return false;}};
let port, upstreamUrl;
try {
  await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve));
  upstreamUrl = `http://127.0.0.1:${upstream.address().port}`;
  const reservation = http.createServer();
  await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve)); port = reservation.address().port;
  await new Promise(resolve=>reservation.close(resolve));
  await fs.mkdir(path.join(temp,'src')); await fs.mkdir(path.join(temp,'.translate-service'));
  await fs.copyFile(path.join(source,'src/service-manager.js'),path.join(temp,'src/service-manager.js'));
  if (!process.argv.includes('--verify')) {
    const patch = spawnSync('patch',['-p1','-i',path.resolve(import.meta.dirname,'../tools/ollama-service-pid.patch')],{cwd:temp,encoding:'utf8'});
    assert.equal(patch.status,0,patch.stdout+patch.stderr);
  }
  await fs.writeFile(path.join(temp,'package.json'),'{"type":"module"}');
  await fs.writeFile(path.join(temp,'.env'),`HOST=127.0.0.1\nPORT=${port}\nOLLAMA_HOST=${upstreamUrl}\n`);
  await fs.writeFile(path.join(temp,'src/server.js'),`import http from 'node:http';http.createServer((req,res)=>res.end('{"status":"ok"}')).listen(Number(process.env.PORT),'127.0.0.1');`);
  manager = path.join(temp,'cli.js');
  await fs.writeFile(manager,"import {runOllamaService} from './src/service-manager.js';await runOllamaService(['translate',process.argv[2]]);");
  for (const command of ['status','stop']) {
    await fs.writeFile(pidFile,String(unrelated.pid));
    const result = await cli(command);
    assert.equal(result.code,0,result.output); assert.match(result.output,/is not running/);
    assert.equal(alive(unrelated.pid),true,'unrelated process must never be signalled');
    await assert.rejects(fs.access(pidFile));
  }
  await fs.writeFile(pidFile,String(unrelated.pid));
  let result = await cli('start'); assert.equal(result.code,0,result.output); assert.match(result.output,/started/);
  const first = Number(await fs.readFile(pidFile,'utf8')); spawned.add(first);
  assert.notEqual(first,unrelated.pid); assert.equal(alive(unrelated.pid),true);
  result = await cli('status'); assert.match(result.output,new RegExp(`is running. PID: ${first}`));
  assert.equal((await fetch(`http://127.0.0.1:${port}`)).status,200);
  result = await cli('restart'); assert.equal(result.code,0,result.output); assert.match(result.output,/stopped/); assert.match(result.output,/started/);
  const second = Number(await fs.readFile(pidFile,'utf8')); spawned.add(second); assert.notEqual(first,second);
  result = await cli('stop'); assert.equal(result.code,0,result.output); assert.match(result.output,/stopped/);
  await assert.rejects(fs.access(pidFile));
  // A service that ignores SIGTERM must block restart instead of starting twice.
  await fs.appendFile(path.join(temp,'src/server.js'),"process.on('SIGTERM',()=>{});");
  result = await cli('start'); assert.equal(result.code,0,result.output);
  const stuck = Number(await fs.readFile(pidFile,'utf8')); spawned.add(stuck);
  result = await cli('restart'); assert.equal(result.code,1,result.output); assert.doesNotMatch(result.output,/started|already running/);
  assert.equal(Number(await fs.readFile(pidFile,'utf8')),stuck); assert.equal(alive(unrelated.pid),true);
  console.log('PASS stale PID status/start/stop preserve unrelated processes; normal restart works; unresponsive stop blocks restart. No real model or service used.');
} finally {
  for (const pid of spawned) { try { process.kill(pid,'SIGKILL'); } catch {} }
  unrelated.kill('SIGKILL');
  upstream.closeAllConnections(); await new Promise(resolve=>upstream.close(resolve));
  await fs.rm(temp,{recursive:true,force:true});
}
