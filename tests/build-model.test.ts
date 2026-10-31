import {test} from 'node:test';import assert from 'node:assert/strict';
import {buildModel} from '../src/build-model';import {IDENTITY_EXTRACTOR,predictIdentity} from '../src/identity';import {rosterSignature} from '../src/attendance';
const emb=(l:number,j:number)=>Array.from({length:128},(_,i)=>.2*Math.sin(i*.31+l*2)+.003*Math.cos(i+j));
const pix=(l:number,j:number)=>Array.from({length:576},(_,i)=>Math.sin(i*.41+l*1.8)+.02*Math.sin(i+j));
const students=[0,1,2].map(l=>({id:'s'+l,faces:Array.from({length:10},(_,j)=>({image:'',vector:pix(l,j),embedding:emb(l,j)}))}));
test('Rebuilding recognition produces a model the board accepts',()=>{const m=buildModel(students,rosterSignature(students));
 assert.equal(m.identity?.extractor,IDENTITY_EXTRACTOR);assert.equal(m.rosterSignature,rosterSignature(students));assert.equal(predictIdentity(m.identity!,emb(1,40)).label,'s1')});
test('Class-style gallery entries are kept for enrolled students only',()=>{const m=buildModel(students,'x',[{label:'s0',vector:emb(0,99)},{label:'ghost',vector:emb(5,1)}]);
 assert.equal(m.identity!.templates.filter(t=>t.label==='s0').length,9);assert.ok(!m.identity!.templates.some(t=>t.label==='ghost'))});
test('Missing face features are reported instead of building a broken model',()=>{const broken=[{...students[0],faces:[{image:'',vector:pix(0,1)}]},students[1]];assert.throws(()=>buildModel(broken as any,'x'),/missing/)});
test('The board builds recognition from features alone, including class-photo features, with no photos',()=>{
 const roster=[0,1,2].map(l=>({id:'s'+l,classroom:[emb(l,77)],faces:Array.from({length:10},(_,j)=>({image:'',vector:[] as number[],embedding:emb(l,j)}))}));
 const m=buildModel(roster,rosterSignature(roster));assert.equal(m.identity!.templates.filter(t=>t.label==='s2').length,9);assert.equal(m.version,'identity-only');assert.equal(predictIdentity(m.identity!,emb(2,40)).label,'s2')});
test('Faces learned from the teacher join that student’s gallery',()=>{
 const learned=[emb(0,70),emb(0,71)],withLearned=students.map(s=>s.id==='s0'?{...s,learned}:s);
 const m=buildModel(withLearned,rosterSignature(withLearned));
 assert.equal(m.identity!.templates.filter(t=>t.label==='s0').length,8+2);assert.equal(m.rosterSignature,'s0:10+2|s1:10|s2:10');
});
