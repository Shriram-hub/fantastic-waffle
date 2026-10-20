import test from 'node:test';
import assert from 'node:assert/strict';
import {workspaceLoader} from '../web/src/shared/workspace-loader.mjs';

test('startup and SSE ready share a bootstrap request; committed edits get one fresh load afterward',async()=>{
  let calls=0,finish;
  const read=workspaceLoader(async()=>{calls++;return new Promise(resolve=>{finish=resolve;});});
  const startup=read(),ready=read();assert.equal(startup,ready);assert.equal(calls,1);
  const edited=read({fresh:true}),task=read({fresh:true});finish('first');
  assert.equal(await startup,'first');await Promise.resolve();assert.equal(calls,2);
  finish('fresh');assert.equal(await edited,'fresh');assert.equal(await task,'fresh');assert.equal(calls,2);
});
test('bootstrap recovers transient server/network failures but never retries authentication or writes',async()=>{
  let calls=0;const pauses=[];
  const read=workspaceLoader(async()=>{calls++;if(calls===1)throw Object.assign(Error('Starting'),{status:503});if(calls===2)throw TypeError('Offline');return {ok:true};},{delay:async ms=>pauses.push(ms)});
  assert.deepEqual(await read(),{ok:true});assert.deepEqual(pauses,[500,1000]);
  let denied=0;const unauthorized=workspaceLoader(async()=>{denied++;throw Object.assign(Error('Sign in'),{status:401});},{delay:async()=>assert.fail('Must not retry')});
  await assert.rejects(unauthorized(),/Sign in/);assert.equal(denied,1);
  let failures=0;const failing=workspaceLoader(async()=>{failures++;throw Object.assign(Error('Unavailable'),{status:500});},{delay:async()=>{}});
  await assert.rejects(failing(),/Unavailable/);assert.equal(failures,3);
});
