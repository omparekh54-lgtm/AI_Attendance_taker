import {test} from 'node:test';import assert from 'node:assert/strict';
import {train} from '../src/model';import {recognizeCapture,rosterSignature,type DetectedFace} from '../src/attendance';
const vector=(label:number,j:number)=>Array.from({length:64},(_,i)=>Math.sin(i*.41+label*1.8)+Math.cos(i*.13+label*.8)+.018*Math.sin(i*1.7+j*.5));
const model=train([0,1,2].flatMap(l=>Array.from({length:10},(_,j)=>({label:String(l),vector:vector(l,j)}))));
const face=(label:number,usable=true):DetectedFace=>({face:{image:'data:image/jpeg;base64,eA==',vector:vector(label,11)},usable,box:{x:0,y:0,w:.1,h:.1}});
test('A clear single-photo observation can recognize an enrolled identity',()=>{const r=recognizeCapture(model,[face(0),face(1)]);assert.deepEqual(r.map(x=>x.studentId),['0','1'])});
test('Two faces claiming one identity in the same photo both need review',()=>{const r=recognizeCapture(model,[face(0),face(0)]);assert.ok(r.every(x=>!x.studentId));assert.ok(r.every(x=>x.reason?.includes('Two faces')))});
test('Unusable and unfamiliar faces never mark an enrolled student present',()=>{const unknown=face(0);unknown.face.vector=Array.from({length:64},(_,i)=>5*Math.sin(i*3.8));const r=recognizeCapture(model,[face(0,false),unknown]);assert.ok(r.every(x=>!x.studentId))});
test('Roster signature ignores roster order and changes with sample count',()=>{const a={id:'a',faces:[face(0).face]},b={id:'b',faces:[face(1).face]};assert.equal(rosterSignature([a,b]),rosterSignature([b,a]));assert.notEqual(rosterSignature([a,b]),rosterSignature([{...a,faces:[]},b]))});

test('Tiny face crops report identity uncertainty and request the original photo',()=>{const unknown=face(0);unknown.sourceWidth=unknown.sourceHeight=96;unknown.face.vector=Array.from({length:64},(_,i)=>5*Math.sin(i*3.8));const result=recognizeCapture(model,[unknown]);assert.equal(result[0].studentId,undefined);assert.match(result[0].reason!,/Low-resolution/)});
