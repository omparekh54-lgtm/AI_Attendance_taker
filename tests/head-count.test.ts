import {test} from 'node:test';import assert from 'node:assert/strict';
import {headCount,sameMoment} from '../src/head-count';
import {saveAttendance} from '../src/saved-attendance';
import type {Observation} from '../src/attendance';

const face=(person:number,photo:number)=>Array.from({length:128},(_,i)=>.2*Math.sin(i*.31+person*2)+.004*Math.cos(i*1.3+photo));
let n=0;const obs=(o:Partial<Observation>):Observation=>({id:'o'+(++n),image:'',...o});

test('An unregistered person in two overlapping photos is counted once',()=>{
 const c=headCount([obs({capture:1,embedding:face(7,1)}),obs({capture:2,embedding:face(7,2)})],new Set());
 assert.equal(c.unregistered,1);assert.equal(c.total,1);
});

test('Two people in the same photo are two people, however alike they look',()=>{
 const c=headCount([obs({capture:1,embedding:face(7,1)}),obs({capture:1,embedding:face(7,2)})],new Set());
 assert.equal(c.total,2);
});

test('Video: someone who leaves and comes back is one person; two people on screen together are two',()=>{
 const back=headCount([obs({capture:1,frames:[0,10],embedding:face(7,1)}),obs({capture:1,frames:[20,30],embedding:face(7,2)})],new Set());
 assert.equal(back.total,1);
 const together=headCount([obs({capture:1,frames:[0,10],embedding:face(7,1)}),obs({capture:1,frames:[5,30],embedding:face(7,2)})],new Set());
 assert.equal(together.total,2);
 assert.equal(sameMoment(obs({capture:1}),obs({capture:2})),false);
});

test('Students present are counted once, including a later unrecognised view of them',()=>{
 const c=headCount([obs({capture:1,studentId:'a',embedding:face(1,1)}),obs({capture:2,studentId:'a',embedding:face(1,2)}),obs({capture:3,embedding:face(1,3)})],new Set(['a']));
 assert.deepEqual(c,{total:1,students:1,toConfirm:0,unregistered:0,unclear:0});
});

test('Students marked present by the teacher count even without a face',()=>{
 const c=headCount([obs({capture:1,studentId:'a',embedding:face(1,1)})],new Set(['a','b']));
 assert.equal(c.students,2);assert.equal(c.total,2);
});

test('"Is this X?" counts one person per X across photos, but two faces in one photo are two people',()=>{
 const across=headCount([obs({capture:1,suggestion:'x',embedding:face(3,1)}),obs({capture:2,suggestion:'x',embedding:face(3,2)})],new Set());
 assert.equal(across.toConfirm,1);assert.equal(across.total,1);
 const same=headCount([obs({capture:1,suggestion:'x',embedding:face(3,1)}),obs({capture:1,suggestion:'x',embedding:face(5,1)})],new Set());
 assert.equal(same.total,2);
});

test('A face suggested as a student who is already present in the same photo is someone else',()=>{
 const c=headCount([obs({capture:1,studentId:'a',embedding:face(1,1)}),obs({capture:1,suggestion:'a',embedding:face(6,1)})],new Set(['a']));
 assert.equal(c.total,2);
 const later=headCount([obs({capture:1,studentId:'a',embedding:face(1,1)}),obs({capture:2,suggestion:'a',embedding:face(1,2)})],new Set(['a']));
 assert.equal(later.total,1);
});

test('"Not a student" faces stay in the head count',()=>{
 const c=headCount([obs({capture:1,notStudent:true,embedding:face(8,1)}),obs({capture:2,notStudent:true,embedding:face(8,2)}),obs({capture:2,notStudent:true,embedding:face(9,2)})],new Set());
 assert.equal(c.unregistered,2);
});

test('Unclear faces are not added up across photos: the largest number in one capture counts',()=>{
 const c=headCount([obs({capture:1}),obs({capture:1}),obs({capture:2}),obs({capture:2}),obs({capture:2})],new Set());
 assert.equal(c.unclear,3);assert.equal(c.total,3);
});

test('Saved attendance keeps face features (not images) for recognised and "Not a student" faces',()=>{
 let saved='';const storage={setItem:(_:string,v:string)=>{saved=v}};
 saveAttendance({startedAt:new Date().toISOString(),captures:1,manual:{},observations:[
  obs({image:'data:image/jpeg;base64,AAAA',studentId:'a',embedding:face(1,1)}),
  obs({image:'data:image/jpeg;base64,BBBB',notStudent:true,embedding:face(2,1)}),
  obs({image:'data:image/jpeg;base64,CCCC',embedding:face(3,1)})]},storage);
 const [a,b,c]=JSON.parse(saved).observations;
 assert.equal(a.image,'');assert.equal(b.image,'');assert.match(c.image,/CCCC/);
 for(const o of [a,b,c])assert.equal(o.embedding.length,128);
});
