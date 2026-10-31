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
import {trainIdentity} from '../src/identity';
const idv=(label:number,sample:number)=>Array.from({length:128},(_,i)=>.2*Math.sin(i*.31+label*2)+.003*Math.cos(i+sample));
const idModel={...train([0,1,2].flatMap(l=>Array.from({length:8},(_,j)=>({label:String(l),vector:idv(l,j)})))),identity:trainIdentity([0,1,2].flatMap(l=>Array.from({length:8},(_,j)=>({label:String(l),vector:idv(l,j)}))))};
const tracked=(frames:[number,number]):DetectedFace=>({face:{image:'',vector:[],embedding:idv(0,19)},usable:true,frames});
test('Video: a student who leaves the view and comes back stays recognised',()=>{const r=recognizeCapture(idModel,[tracked([0,4]),tracked([7,12])]);assert.deepEqual(r.map(x=>x.studentId),['0','0'])});
test('Video: two people on screen together cannot both be the same student',()=>{const r=recognizeCapture(idModel,[tracked([0,6]),tracked([5,12])]);assert.ok(r.every(x=>!x.studentId))});
test('A small back-row face is only suggested, never marked automatically',()=>{const small:DetectedFace={face:{image:'',vector:[],embedding:idv(1,19)},usable:true,box:{x:.5,y:.1,w:26/4000,h:28/3000},sourceWidth:4000,sourceHeight:3000};
 const big:DetectedFace={...small,box:{x:.2,y:.6,w:90/4000,h:95/3000},face:{image:'',vector:[],embedding:idv(2,19)}};
 const [s,b]=recognizeCapture(idModel,[small,big]);assert.equal(s.studentId,undefined);assert.equal(s.suggestion,'1');assert.equal(b.studentId,'2')});
test('A turned or side-view face is only suggested, never marked automatically',()=>{const big={x:.2,y:.6,w:90/4000,h:95/3000};
 const side:DetectedFace={face:{image:'',vector:[],embedding:idv(1,19),yaw:0.7},usable:true,box:big,sourceWidth:4000,sourceHeight:3000};
 const front:DetectedFace={face:{image:'',vector:[],embedding:idv(2,19),yaw:0.05},usable:true,box:{...big,x:.6},sourceWidth:4000,sourceHeight:3000};
 const [s,f]=recognizeCapture(idModel,[side,front]);assert.equal(s.studentId,undefined);assert.equal(s.suggestion,'1');assert.match(s.reason!,/Turned/);assert.equal(f.studentId,'2')});

test('A face too uncertain to suggest still shows its closest student as a best guess, and never marks them',()=>{
 // Move a student-1 face away from student 1 in small steps; somewhere past "suggest" it must become a guess.
 const u=Array.from({length:128},(_,i)=>Math.sin(i*1.9+.4)),n=Math.sqrt(u.reduce((a,b)=>a+b*b,0));
 let guessed:ReturnType<typeof recognizeCapture>[number]|undefined;
 for(let k=0;k<1.5&&!guessed;k+=.01){
  const emb=idv(1,19).map((x,i)=>x+k*u[i]/n);
  const [o]=recognizeCapture(idModel,[{face:{image:'',vector:[],embedding:emb},usable:true}]);
  if(o.guess)guessed=o;
 }
 assert.ok(guessed,'a face on the way out should pass through the best-guess zone');
 assert.equal(guessed!.guess,'1');assert.equal(guessed!.studentId,undefined);assert.equal(guessed!.suggestion,undefined);assert.match(guessed!.reason!,/Best guess/);
});
test('A face far from every student gets no guess',()=>{const [o]=recognizeCapture(idModel,[{face:{image:'',vector:[],embedding:Array(128).fill(2)},usable:true}]);assert.equal(o.guess,undefined);assert.equal(o.studentId,undefined);assert.equal(o.reason,'Not recognised')});

import {feedbackFor,learnableFaces,feedbackSummary,type Observation} from '../src/attendance';
const ob=(o:Partial<Observation>):Observation=>({id:Math.random().toString(),image:'',...o});
test('Feedback says whether the teacher agreed with what the app offered',()=>{
 assert.equal(feedbackFor({suggestion:'1'},'1'),'right');assert.equal(feedbackFor({guess:'1'},'2'),'wrong');assert.equal(feedbackFor({candidates:['1']},'1'),undefined);
 assert.deepEqual(feedbackSummary([ob({feedback:'right'}),ob({feedback:'right'}),ob({feedback:'wrong'}),ob({})]),{right:2,wrong:1});
});
test('Only faces the teacher confirmed are learned from, hardest first, never automatic marks',()=>{
 const faces=learnableFaces([
  ob({studentId:'a',confirmed:true,embedding:[1],distance:.2}),ob({studentId:'a',confirmed:true,embedding:[2],distance:.5}),ob({studentId:'a',confirmed:true,embedding:[3],distance:.3}),ob({studentId:'a',confirmed:true,embedding:[4],distance:.4}),
  ob({studentId:'b',embedding:[9],distance:.9}),ob({studentId:'c',confirmed:true,distance:.9}),ob({confirmed:true,embedding:[7]})],3);
 assert.deepEqual(faces,{a:[[2],[4],[3]]});
});
test('A roster signature is unchanged until a student has learned faces, then changes',()=>{
 const f=face(0).face,plain={id:'a',faces:[f]};
 assert.equal(rosterSignature([plain]),'a:1');assert.notEqual(rosterSignature([plain]),rosterSignature([{...plain,learned:[[1]]}]));
});
