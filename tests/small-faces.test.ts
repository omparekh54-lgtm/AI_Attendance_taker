import {test} from 'node:test';import assert from 'node:assert/strict';
import {trainIdentity,predictIdentity,smallFaceAllowance,SMALL_FACE,IMPOSTOR} from '../src/identity';
import {fullResolutionStill} from '../src/still-photo';

const idv=(label:number,sample:number)=>Array.from({length:128},(_,i)=>.2*Math.sin(i*.31+label*2)+.003*Math.cos(i+sample));
const samples=[0,1,2,3].flatMap(l=>Array.from({length:8},(_,j)=>({label:String(l),vector:idv(l,j)})));
const model=trainIdentity(samples);
const nudge=(v:number[],k:number)=>v.map((x,i)=>x+k*Math.sin(i*2.7));

test('Small faces get a longer limit, growing as the face shrinks; clear faces get none',()=>{
 assert.equal(smallFaceAllowance(Infinity),0);
 assert.equal(smallFaceAllowance(SMALL_FACE.from),0);
 assert.ok(smallFaceAllowance(36)>0&&smallFaceAllowance(36)<smallFaceAllowance(28));
 assert.equal(smallFaceAllowance(SMALL_FACE.to),SMALL_FACE.extra);
 assert.equal(smallFaceAllowance(10),SMALL_FACE.extra);
});

test('A blurry match just past the clear-face limit is accepted when the face is small, not when it is large',()=>{
 const center=idv(1,19);let k=0,p=predictIdentity(model,center);
 while(p.distance<=model.limits['1']+.01&&k<1){k+=.001;p=predictIdentity(model,nudge(center,k))}
 const v=nudge(center,k);
 assert.equal(predictIdentity(model,v).accepted,false);
 const small=predictIdentity(model,v,[],24);
 assert.ok(small.limit>model.limits['1']);
 assert.equal(small.label,'1');assert.equal(small.accepted,true);
});

test('No face is ever accepted past the student’s classmate cap, however small',()=>{
 for(const label of ['0','1','2','3']){
  assert.ok(model.caps![label]<=IMPOSTOR.maxCap);
  const p=predictIdentity(model,idv(Number(label),19),[],12);
  assert.ok(p.limit<=model.caps![label]+1e-9);
 }
});

test('Without camera support for still photos, the live video frame is used',async()=>{
 assert.equal(await fullResolutionStill(null,1920,1080),undefined);
});

import {agreeAcrossCaptures,SMALL_FACE_REASON} from '../src/attendance';
const one=(x:number)=>Array.from({length:128},(_,i)=>i===0?x:0);
const smallFace=(id:string,capture:number,e:number[],px=28)=>({id,image:'',capture,embedding:e,facePx:px,suggestion:'ana',reason:SMALL_FACE_REASON,distance:.4});
test('a small face that passed every check in two separate photos is marked',()=>{
 const out=agreeAcrossCaptures([smallFace('a',1,one(0)),smallFace('b',2,one(.1))]);
 assert.equal(out.filter(o=>o.studentId==='ana').length,1);
 assert.equal(out.find(o=>o.studentId)?.agreed,true);
});
test('not marked from one photo, from two faces in one photo, or from two different people',()=>{
 assert.ok(!agreeAcrossCaptures([smallFace('a',1,one(0))]).some(o=>o.studentId));
 assert.ok(!agreeAcrossCaptures([smallFace('a',1,one(0)),smallFace('b',1,one(.1))]).some(o=>o.studentId));
 assert.ok(!agreeAcrossCaptures([smallFace('a',1,one(0)),smallFace('b',2,one(.9))]).some(o=>o.studentId));
});
test('tiny faces, plain suggestions and faces marked "Not a student" are never marked by agreement',()=>{
 assert.ok(!agreeAcrossCaptures([smallFace('a',1,one(0),20),smallFace('b',2,one(.1),20)]).some(o=>o.studentId));
 assert.ok(!agreeAcrossCaptures([{...smallFace('a',1,one(0)),reason:'Please confirm'},{...smallFace('b',2,one(.1)),reason:'Please confirm'}]).some(o=>o.studentId));
 assert.ok(!agreeAcrossCaptures([{...smallFace('a',1,one(0)),notStudent:true},smallFace('b',2,one(.1))]).some(o=>o.studentId));
});
test('back-row zoom steps follow what the camera supports',async()=>{
 const {zoomSteps}=await import('../src/camera-zoom');
 assert.deepEqual(zoomSteps(undefined),[]);
 assert.deepEqual(zoomSteps({min:1,max:1}),[]);
 assert.deepEqual(zoomSteps({min:1,max:10}),[1,2,3]);
 assert.deepEqual(zoomSteps({min:1,max:2.5}),[1,2,2.5]);
});

test('24 px class-photo references can mark small faces but only suggest for bigger ones', async () => {
  const {trainIdentity, predictIdentity} = await import('../src/identity');
  const rnd = (seed: number) => () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - .5; };
  const r = rnd(7), base = (k: number) => Array.from({length: 128}, (_, d) => Math.sin(d * (k + 1) * 1.7) * .3);
  const jitter = (v: number[], s: number) => v.map(x => x + r() * s);
  const samples = [0, 1, 2, 3].flatMap(k => Array.from({length: 10}, () => ({label: 's' + k, vector: jitter(base(k), .04)})));
  // A "blurry" version of student 0 only exists as a 24 px class-photo reference.
  const blurry = base(9).map((x, d) => (x + base(0)[d]) / 2);
  const model = trainIdentity(samples, Array.from({length: 4}, () => ({label: 's0', vector: jitter(blurry, .01), px: 24})));
  const face = jitter(blurry, .01);
  const small = predictIdentity(model, face, [], 26), big = predictIdentity(model, face, [], 46);
  assert.equal(small.label, 's0'); assert.equal(small.accepted, true);
  assert.equal(big.accepted, false); assert.equal(big.suggested, true); assert.equal(big.label, 's0');
});
