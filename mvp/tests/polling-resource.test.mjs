import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPollingResources} from '../src/polling-resource.js';

const settle=()=>new Promise(resolve=>setImmediate(resolve));
function clock(){
  let time=0,serial=0,visible=true;const timers=new Map();
  const resources=createPollingResources({now:()=>time,visible:()=>visible,schedule:(fn,delay)=>{const id=++serial;timers.set(id,{fn,at:time+delay});return id;},cancel:id=>timers.delete(id)});
  return {resources,hide:()=>{visible=false;},show:()=>{visible=true;},async advance(ms){time+=ms;for(const [id,timer] of [...timers])if(timer.at<=time){timers.delete(id);timer.fn();}await settle();}};
}
test('two readers share one request and one timer; an in-flight read is not overlapped',async()=>{
  const c=clock();let calls=0,finish;const first=[],second=[];
  const load=()=>{calls++;return new Promise(resolve=>{finish=resolve;});};
  const a=c.resources.subscribe('doctor:alice:alerts',load,value=>first.push(value),5000);
  const b=c.resources.subscribe('doctor:alice:alerts',load,value=>second.push(value),5000);
  await settle();assert.equal(calls,1);finish({unread:1});await settle();
  assert.equal(first.at(-1).data.unread,1);assert.equal(second.at(-1).data.unread,1);
  await c.advance(5000);assert.equal(calls,2);
  await c.advance(5000);assert.equal(calls,2);finish({unread:0});await settle();
  a();await c.advance(5000);assert.equal(calls,3);b();finish({unread:9});await settle();
  assert.equal(second.at(-1).data.unread,0,'A response arriving after unmount is discarded');
});
test('account changes abort pending work and cannot carry data into another owner or role',async()=>{
  const c=clock();let finish,signal;const old=[],next=[],patient=[];
  const off=c.resources.subscribe('doctor:alice:notes',s=>{signal=s;return new Promise(resolve=>{finish=resolve;});},v=>old.push(v));
  await settle();c.resources.clearRole('doctor');assert.equal(signal.aborted,true);
  const fresh=c.resources.subscribe('doctor:bob:notes',async()=>({owner:'bob'}),v=>next.push(v));
  const p=c.resources.subscribe('patient:alice:notes',async()=>({owner:'patient'}),v=>patient.push(v));
  finish({owner:'alice'});await settle();
  assert.equal(old.at(-1).data,null);assert.equal(next.at(-1).data.owner,'bob');assert.equal(patient.at(-1).data.owner,'patient');
  off();fresh();p();
});
test('background polling pauses when hidden and retries honor backoff and Retry-After',async()=>{
  const c=clock();let calls=0;const states=[];
  const off=c.resources.subscribe('patient:alice:care',async()=>{calls++;if(calls===1)throw Object.assign(Error('wait'),{status:429,retryAfterMs:60000});return {ok:true};},v=>states.push(v),5000);
  await settle();await c.advance(10000);await c.resources.reload('patient:alice:care');assert.equal(calls,1);
  c.hide();await c.advance(50000);assert.equal(calls,1);
  c.show();c.resources.refreshAll();await settle();assert.equal(calls,2);assert.equal(states.at(-1).data.ok,true);
  off();
});
test('revoked access clears old contents and last unsubscribe discards cached health data',async()=>{
  const c=clock();let allowed=true,calls=0;const states=[];
  const load=async()=>{calls++;if(!allowed)throw Object.assign(Error('revoked'),{status:403});return {private:'synthetic'};};
  const off=c.resources.subscribe('doctor:alice:notes',load,v=>states.push(v),5000);
  await settle();allowed=false;await c.resources.reload('doctor:alice:notes');assert.equal(states.at(-1).data,null);
  allowed=true;c.resources.refreshAll();await settle();assert.equal(states.at(-1).data.private,'synthetic','A new consent can be read without waiting out an old permission failure');off();
  allowed=true;const other=[];const cleanup=c.resources.subscribe('doctor:alice:notes',load,v=>other.push(v));
  assert.equal(other[0].data,null);await settle();assert.equal(calls,4);cleanup();
});
