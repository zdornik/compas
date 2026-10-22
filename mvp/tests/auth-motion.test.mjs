import test from 'node:test';
import assert from 'node:assert/strict';
import {entranceScene,sceneAt,loginWithRoleDiscovery} from '../src/auth-motion.js';
import {ENVIRONMENT} from '../src/contour-placement.js';

test('shared authentication composition keeps the mascot inside the same texture pocket at every travel size',()=>{
 for(const [width,height] of [[360,780],[1280,720],[1920,1080]]){
  const from=entranceScene(width,height),to={...entranceScene(width,height,1),figure:{x:width*.82,y:220,width:147},clip:{left:width>760?238:0,top:0,width:width>760?width-238:width,height:470},radii:[0,0,80,30,0,0,40,20]};
  for(const progress of [0,.1,.25,.5,.8,1]){
   const pose=sceneAt(from,to,progress),scale=pose.image.width/ENVIRONMENT.width;
   assert.ok(Math.abs(pose.image.left+ENVIRONMENT.anchorX*scale-pose.figure.x)<1e-8);
   assert.ok(Math.abs(pose.image.top+ENVIRONMENT.anchorY*scale-pose.figure.y)<1e-8);
   assert.ok(Math.abs(pose.image.width/pose.figure.width-from.image.width/from.figure.width)<1e-8);
  }
  const end=sceneAt(from,to,1);assert.deepEqual(end.figure,to.figure);assert.deepEqual(end.clip,to.clip);
 }
});
test('common login discovers clinician credentials without a role selector and keeps the registered role',async()=>{
 const attempted=[];const result=await loginWithRoleDiscovery({email:'synthetic@example.invalid',password:'test-password'},async input=>{attempted.push(input);return {account:{role:'doctor'}};});
 assert.equal(attempted.length,1);assert.equal(attempted[0].discoverRole,true);assert.equal(result.account.role,'doctor');
});
test('common login does not retry server, network or throttle errors against another role',async()=>{
 for(const status of [undefined,403,429,503]){
  const attempted=[];await assert.rejects(()=>loginWithRoleDiscovery({role:'doctor'},async input=>{attempted.push(input.role);throw Object.assign(new Error('failed'),{status});}));assert.deepEqual(attempted,['doctor']);
 }
 const attempted=[];await assert.rejects(()=>loginWithRoleDiscovery({},async input=>{attempted.push(input.role);throw Object.assign(new Error('credentials'),{status:401});}),{status:401});assert.equal(attempted.length,1);
});
