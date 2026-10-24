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

test('SSE reconnect backs off, closes old sockets, resets after ready and stops on authentication expiry',async()=>{
  const {connectWorkspaceEvents}=await import('../web/src/shared/workspace-loader.mjs');const streams=[],scheduled=[],connections=[];
  class Stream{constructor(){this.listeners={};streams.push(this);}addEventListener(name,fn){this.listeners[name]=fn;}close(){this.closed=true;}}
  let expired=false;const close=connectWorkspaceEvents({EventSourceClass:Stream,random:()=>.5,schedule:(fn,ms)=>{scheduled.push({fn,ms});return scheduled.length;},cancel:()=>{},onConnection:v=>connections.push(v),handlers:{'auth-required':()=>{expired=true;}}});
  streams[0].onerror();assert.equal(streams[0].closed,true);assert.equal(scheduled[0].ms,1000);scheduled[0].fn();streams[1].onerror();assert.equal(scheduled[1].ms,2000);scheduled[1].fn();streams[2].listeners.ready({});assert.equal(connections.at(-1),true);streams[2].onerror();assert.equal(scheduled[2].ms,1000);scheduled[2].fn();streams[3].listeners['auth-required']({});assert.equal(expired,true);assert.equal(streams[3].closed,true);const count=streams.length;scheduled[2].fn();assert.equal(streams.length,count);close();
});
