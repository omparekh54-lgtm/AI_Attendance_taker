import {test} from 'node:test';import assert from 'node:assert/strict';
import {trainIdentity,predictIdentity} from '../src/identity';
import {train} from '../src/model';
import {recognizeCapture,recheckAgainstStranger,type DetectedFace,type Observation} from '../src/attendance';
import {loadNotStudents,rememberNotStudents,MAX_NOT_STUDENTS} from '../src/not-students';

const idv=(label:number,sample:number)=>Array.from({length:128},(_,i)=>.2*Math.sin(i*.31+label*2)+.003*Math.cos(i+sample));
const samples=[0,1,2].flatMap(l=>Array.from({length:8},(_,j)=>({label:String(l),vector:idv(l,j)})));
const model={...train(samples),identity:trainIdentity(samples)};
const nudge=(v:number[],k:number,phase=1)=>v.map((x,i)=>x+k*Math.sin(i*phase));
const at=(embedding:number[],extra:Partial<DetectedFace>={}):DetectedFace=>({face:{image:'',vector:[],embedding},usable:true,...extra});

test('A face closer to someone marked "Not a student" is neither marked nor suggested',()=>{
 const face=idv(0,19);
 assert.equal(recognizeCapture(model,[at(face)])[0].studentId,'0');
 const [r]=recognizeCapture(model,[at(face)],[nudge(face,.001)]);
 assert.equal(r.studentId,undefined);assert.equal(r.suggestion,undefined);assert.match(r.reason!,/Not a student/);
 // An unrelated remembered stranger changes nothing.
 assert.equal(recognizeCapture(model,[at(face)],[idv(7,0)])[0].studentId,'0');
});

test('A face beyond the student\'s own limit is never marked just for being far ahead of everyone else',()=>{
 const id=model.identity,center=idv(1,19);
 // Walk away from student 1 until the strict limit is passed; the old 0.47 clear-lead rule would still have marked it.
 let k=0,p=predictIdentity(id,center);
 while(p.distance<=p.limit+.01&&k<1){k+=.002;p=predictIdentity(id,nudge(center,k,2.7))}
 assert.equal(p.label,'1');assert.ok(p.distance>p.limit);assert.equal(p.accepted,false);
});

test('Video: frames that keep pointing at the same student are marked',()=>{
 const frames=[0,1,2,3].map(j=>idv(2,20+j));
 const [r]=recognizeCapture(model,[at(idv(2,19),{frameEmbeddings:frames,frames:[0,9]})]);
 assert.equal(r.studentId,'2');
});

test('Video: frames that change between students are not marked',()=>{
 const frames=[idv(2,20),idv(1,21),idv(2,22),idv(0,23)];
 const [r]=recognizeCapture(model,[at(idv(2,19),{frameEmbeddings:frames,frames:[0,9]})]);
 assert.equal(r.studentId,undefined);assert.equal(r.suggestion,undefined);assert.match(r.reason!,/Changed between video frames/);
});

test('Video: a frame that looks like a remembered stranger stops the match',()=>{
 const frames=[0,1,2,3].map(j=>idv(2,20+j)),stranger=nudge(frames[3],.0005);
 const [r]=recognizeCapture(model,[at(idv(2,19),{frameEmbeddings:frames,frames:[0,9]})],[stranger]);
 assert.equal(r.studentId,undefined);
});

test('Marking a face "Not a student" sends look-alike automatic matches back to review, but keeps teacher-confirmed ones',()=>{
 const face=idv(0,19);
 const auto:Observation={id:'a',image:'',studentId:'0',distance:.05,embedding:face};
 const confirmed:Observation={...auto,id:'b',confirmed:true};
 const other:Observation={id:'c',image:'',studentId:'1',distance:.05,embedding:idv(1,19)};
 const [a,b,c]=recheckAgainstStranger([auto,confirmed,other],nudge(face,.001));
 assert.equal(a.studentId,undefined);assert.match(a.reason!,/Not a student/);
 assert.equal(b.studentId,'0');assert.equal(c.studentId,'1');
});

test('Unresolved faces keep their face features so they can be remembered as strangers',()=>{
 const far=idv(9,0).map(x=>x*1.5);
 const [r]=recognizeCapture(model,[at(far)]);
 assert.equal(r.studentId,undefined);assert.ok(r.embedding&&r.embedding.length===128);
});

test('Per-student limits tighten when a classmate looks very similar',()=>{
 const twin=(j:number)=>nudge(idv(0,j),.02,.9);
 const withTwin=trainIdentity([...samples,...Array.from({length:8},(_,j)=>({label:'twin',vector:twin(j)}))]);
 const alone=trainIdentity(samples);
 assert.ok(withTwin.limits['0']<=alone.limits['0']);
 for(const limit of Object.values(withTwin.limits))assert.ok(limit>=.3&&limit<=.42);
});

test('"Not a student" memory keeps only valid face features and forgets the oldest past the cap',()=>{
 const store=new Map<string,string>(),storage={getItem:(k:string)=>store.get(k)??null,setItem:(k:string,v:string)=>void store.set(k,v)};
 let list=rememberNotStudents([],[idv(1,1)],storage);
 assert.equal(loadNotStudents(storage).length,1);
 list=rememberNotStudents(list,Array.from({length:MAX_NOT_STUDENTS+5},(_,i)=>idv(3,i)),storage);
 assert.equal(list.length,MAX_NOT_STUDENTS);assert.equal(loadNotStudents(storage).length,MAX_NOT_STUDENTS);
 store.set('eigenroll-not-students-v1',JSON.stringify([[1,2,3],idv(1,1),'x']));
 assert.equal(loadNotStudents(storage).length,1);
 store.set('eigenroll-not-students-v1','not json');
 assert.deepEqual(loadNotStudents(storage),[]);
});

test('Saved models record the matching rules they were built with, so older ones are rebuilt',async()=>{
 const {IDENTITY_RULES}=await import('../src/identity');
 assert.equal(trainIdentity(samples).rules,IDENTITY_RULES);
});
