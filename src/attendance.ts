import {predictIdentity, STRANGER_GAP} from './identity';
import {predictArc, assignStudents, ARC, type ArcModel, type ArcPrediction} from './arc-identity';
import {predict, type Model} from './model';
import type {Face} from './store';
import {AUTO_MARK_MIN_FACE_PX, TURNED_FACE_YAW} from './face-geometry';
/** frames: first and last video frame this person was tracked in (video captures only).
 *  frameEmbeddings: the person's face features from each of their best video frames, recognised one by one. */
export type DetectedFace={sourceWidth?:number;sourceHeight?:number;face:Face;usable:boolean;box?:{x:number;y:number;w:number;h:number};frames?:[number,number];frameEmbeddings?:number[][]};
/** studentId: confidently recognised. suggestion: likely student the teacher can confirm with one tap. candidates: closest students, best first.
 *  guess: closest student when too uncertain to suggest; shown for the teacher to check, never marks anyone.
 *  embedding: face features, so "Not a student" can remember a face and the head count can recognise one person across photos.
 *  notStudent: the teacher said this is not a student; it stays in the head count but leaves the review list. */
export type Observation={id:string;image:string;frames?:[number,number];studentId?:string;suggestion?:string;guess?:string;candidates?:string[];reason?:string;distance?:number;confirmed?:boolean;feedback?:'right'|'wrong';capture?:number;embedding?:number[];notStudent?:boolean};
const SMALL_SOURCE=240, DUPLICATE_GAP=.05;
/** Video: share of a person's frames that must point to the same student before they are marked. Strangers tend to
 *  resemble different students in different frames, while a real student stays the same student. */
export const FRAME_AGREEMENT=2/3;
/** One image can establish a match. Each student is given to at most one face per photo.
 *  strangers: face features of people the teacher marked "Not a student" on this board. */
export function recognizeCapture(model:Model, faces:DetectedFace[], strangers:number[][]=[]):Observation[]{
 if(model.arc)return recognizeArc(model.arc,faces,strangers);
 const observations:Observation[]=faces.map(f=>{
  const id=crypto.randomUUID(),image=f.face.image;
  if(!f.usable)return {id,image,reason:'Too small or blurry'};
  if(model.identity&&!f.face.embedding)return {id,image,reason:'Face features missing — retake'};
  const lowRes=f.sourceWidth&&f.sourceHeight&&Math.min(f.sourceWidth,f.sourceHeight)<SMALL_SOURCE;
  if(model.identity){
   // Width of the face in the photo: small faces are blurrier, so they get a longer (capped) limit.
   const facePx=f.box&&f.sourceWidth?Math.min(f.box.w*f.sourceWidth,f.box.h*(f.sourceHeight??f.sourceWidth)):Infinity;
   const p=predictIdentity(model.identity,f.face.embedding!,strangers,facePx);
   const embedding=f.face.embedding;
   if(p.stranger)return {id,image,candidates:p.candidates,distance:p.distance,frames:f.frames,embedding,reason:'Looks like someone marked “Not a student”'};
   // Video: recognise each frame on its own. The averaged face is less noisy than any single photo, so it can sit
   // closer to a look-alike than the limits (set on single photos) allow for; the individual frames must pass too.
   const perFrame=(f.frameEmbeddings?.length??0)>=2?f.frameEmbeddings!.map(e=>predictIdentity(model.identity!,e,strangers,facePx)):[];
   const passing=perFrame.filter(q=>q.label===p.label&&q.accepted).length;
   const leaning=perFrame.filter(q=>q.label===p.label&&(q.accepted||q.suggested)).length;
   const conflict=perFrame.some(q=>q.label!==p.label&&q.accepted)||perFrame.some(q=>q.stranger);
   const framesAgree=!perFrame.length||(passing>=Math.ceil(perFrame.length*FRAME_AGREEMENT)&&!conflict);
   if(!framesAgree){
    // Mostly the same student, but not consistently: let the teacher decide. Otherwise the frames disagree.
    const mostly=!conflict&&leaning>=Math.ceil(perFrame.length*FRAME_AGREEMENT)&&(p.accepted||p.suggested);
    return {id,image,suggestion:mostly?p.label:undefined,candidates:p.candidates,distance:p.distance,frames:f.frames,embedding,reason:mostly?'Please confirm':'Changed between video frames'};
   }
   // Very small faces are never marked on their own: the teacher confirms them with one tap.
   if(p.accepted&&facePx<AUTO_MARK_MIN_FACE_PX)return {id,image,suggestion:p.label,candidates:p.candidates,distance:p.distance,frames:f.frames,embedding,reason:'Small face — please confirm'};
   // Turned and side-view faces are confirmed by the teacher: they are where look-alikes get mixed up.
   if(p.accepted&&Math.abs(f.face.yaw??0)>=TURNED_FACE_YAW)return {id,image,suggestion:p.label,candidates:p.candidates,distance:p.distance,frames:f.frames,embedding,reason:'Turned face — please confirm'};
   if(p.accepted)return {id,image,studentId:p.label,distance:p.distance,candidates:p.candidates,frames:f.frames,embedding};
   return {id,image,suggestion:p.suggested?p.label:undefined,guess:p.guessable?p.label:undefined,candidates:p.candidates,distance:p.distance,frames:f.frames,embedding,reason:lowRes?'Low-resolution photo':p.suggested?'Please confirm':p.guessable?'Best guess — please check':'Not recognised'};
  }
  const p=predict(model,f.face.vector);
  return p.accepted&&p.ratio<.6?{id,image,studentId:p.label}:{id,image,reason:lowRes?'Low-resolution photo':'Not recognised'};
 });
 return resolveDuplicates(observations);
}
/** If two faces in one capture match the same student, keep the clearly closer one; otherwise ask the teacher. */
function resolveDuplicates(observations:Observation[]):Observation[]{
 const byStudent=new Map<string,Observation[]>();
 for(const o of observations)if(o.studentId)byStudent.set(o.studentId,[...(byStudent.get(o.studentId)??[]),o]);
 const demote=new Map<string,Observation>();
 for(const [student,group] of byStudent){
  if(group.length<2)continue;
  // Video: the same student tracked twice but never on screen at the same time left the view and came back.
  if(group.every(a=>a.frames)&&group.every((a,i)=>group.every((b,j)=>i===j||a.frames![1]<b.frames![0]||b.frames![1]<a.frames![0])))continue;
  group.sort((a,b)=>(a.distance??1)-(b.distance??1));
  const keepFirst=(group[1].distance??1)-(group[0].distance??1)>=DUPLICATE_GAP;
  for(const o of keepFirst?group.slice(1):group)demote.set(o.id,{...o,studentId:undefined,suggestion:keepFirst?undefined:student,reason:'Two faces matched the same student'});
 }
 return observations.map(o=>demote.get(o.id)??o);
}
const facePxOf=(f:DetectedFace)=>f.box&&f.sourceWidth?Math.min(f.box.w*f.sourceWidth,f.box.h*(f.sourceHeight??f.sourceWidth)):Infinity;
/** ArcFace engine. Photos: each student goes to at most one face, chosen jointly (Hungarian algorithm) so the face
 *  that fits a student best keeps them and a look-alike next to them is not given the same name.
 *  Video: every tracked person's best frames are recognised one by one and must agree, as with the older engine. */
function recognizeArc(model:ArcModel, faces:DetectedFace[], strangers:number[][]):Observation[]{
 const arcStrangers=strangers.filter(v=>v.length===512);
 const predictions=faces.map(f=>f.usable&&f.face.embedding?.length===512?predictArc(model,f.face.embedding,arcStrangers,facePxOf(f)):undefined);
 // Photos only: in a video, one student can be tracked twice (left the view and came back); handled further down.
 const assigned=faces.some(f=>f.frames)?predictions.map(p=>p?.label):assignStudents(predictions);
 const observations:Observation[]=faces.map((f,i)=>{
  const id=crypto.randomUUID(),image=f.face.image,p=predictions[i];
  if(!f.usable)return {id,image,reason:'Too small or blurry'};
  if(!p)return {id,image,reason:'Face features missing — retake'};
  const embedding=f.face.embedding,base={id,image,candidates:p.candidates,distance:1-p.score,frames:f.frames,embedding};
  if(p.stranger)return {...base,reason:'Looks like someone marked “Not a student”'};
  const mine=assigned[i];
  if(mine!==p.label){
   // Another face in this photo fits this student better. Offer the next student if this face could be them.
   const other=mine?p.scores.find(s=>s.label===mine):undefined,bar=mine?model.accept[mine]??ARC.ceiling:1;
   const offer=other&&other.score>=Math.max(ARC.suggestFloor,bar-ARC.suggestBelow);
   return {...base,distance:other?1-other.score:base.distance,suggestion:offer?mine:undefined,reason:'Another face matched '+(p.accepted||p.suggested?'that student better':'the closest student')};
  }
  const perFrame:ArcPrediction[]=(f.frameEmbeddings?.length??0)>=2?f.frameEmbeddings!.filter(e=>e.length===512).map(e=>predictArc(model,e,arcStrangers,facePxOf(f))):[];
  if(perFrame.length){
   const passing=perFrame.filter(q=>q.label===p.label&&q.accepted).length,leaning=perFrame.filter(q=>q.label===p.label&&(q.accepted||q.suggested)).length;
   const conflict=perFrame.some(q=>q.label!==p.label&&q.accepted)||perFrame.some(q=>q.stranger);
   if(!(passing>=Math.ceil(perFrame.length*FRAME_AGREEMENT)&&!conflict)){
    const mostly=!conflict&&leaning>=Math.ceil(perFrame.length*FRAME_AGREEMENT)&&(p.accepted||p.suggested);
    return {...base,suggestion:mostly?p.label:undefined,reason:mostly?'Please confirm':'Changed between video frames'};
   }
  }
  if(p.accepted)return {...base,studentId:p.label};
  const small=p.score>=p.bar&&p.margin>=ARC.margin&&facePxOf(f)<ARC.autoMarkMinPx;
  return {...base,suggestion:p.suggested?p.label:undefined,guess:p.guessable?p.label:undefined,
   reason:p.suggested?(small?'Small face — please confirm':'Please confirm'):p.guessable?'Best guess — please check':'Not registered'};
 });
 return resolveDuplicates(observations);
}
/** After the teacher marks a face "Not a student": un-mark automatic matches (not ones the teacher confirmed) that
 *  are about as close to that stranger as to their student. They go back to review instead. */
export function recheckAgainstStranger(observations:Observation[], stranger:number[]):Observation[]{
 const d=(a:number[],b:number[])=>Math.sqrt(a.reduce((n,v,i)=>n+(v-b[i])**2,0));
 // ArcFace: distance is 1 − similarity, so "about as close" compares similarities.
 const near=(o:Observation)=>o.embedding!.length===512?(o.embedding!.length===stranger.length&&1-o.embedding!.reduce((n,v,i)=>n+v*stranger[i],0)<=o.distance!+ARC.strangerGap):o.embedding!.length===stranger.length&&d(o.embedding!,stranger)<=o.distance!+STRANGER_GAP;
 return observations.map(o=>o.studentId&&!o.confirmed&&o.embedding&&o.distance!==undefined&&near(o)
  ?{...o,studentId:undefined,suggestion:undefined,reason:'Looks like someone marked “Not a student”'}:o);
}
export function rosterSignature(students:{id:string;faces:Face[];learned?:number[][];arc?:string[];arcLearned?:string[]}[]){return students.map(s=>s.id+':'+s.faces.length+(s.learned?.length?'+'+s.learned.length:'')+(s.arc?.length?'a'+s.arc.length+'.'+(s.arcLearned?.length??0):'')).sort().join('|');}
/** What the teacher's taps say about the model's own guess: 'right' when they confirmed what it offered (its suggestion,
 *  best guess or closest student), 'wrong' when they named someone else. Faces it offered nothing for are left out. */
export function feedbackFor(o:Pick<Observation,'suggestion'|'guess'|'candidates'>,studentId:string):'right'|'wrong'|undefined{
 const offered=o.suggestion??o.guess;if(!offered)return undefined;return offered===studentId?'right':'wrong';
}
/** Faces to learn from: only ones the teacher confirmed by hand (never the app's own automatic marks, which would
 *  just reinforce what it already believes). At most `perStudent` per student, the hardest ones first: faces the model
 *  was least sure about teach it the most. */
export function learnableFaces(observations:Observation[],perStudent=3):Record<string,number[][]>{
 const by=new Map<string,Observation[]>();
 for(const o of observations)if(o.studentId&&o.confirmed&&o.embedding)by.set(o.studentId,[...(by.get(o.studentId)??[]),o]);
 const out:Record<string,number[][]>={};
 for(const [id,list] of by)out[id]=list.sort((a,b)=>(b.distance??0)-(a.distance??0)).slice(0,perStudent).map(o=>o.embedding!);
 return out;
}
/** How the model's offers fared today, from the teacher's taps. */
export function feedbackSummary(observations:Observation[]){
 const n=(f:'right'|'wrong')=>observations.filter(o=>o.feedback===f).length;return {right:n('right'),wrong:n('wrong')};
}
