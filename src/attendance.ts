import {predictIdentity, STRANGER_GAP} from './identity';
import {predict, type Model} from './model';
import type {Face} from './store';
import {AUTO_MARK_MIN_FACE_PX, TURNED_FACE_YAW} from './face-geometry';
/** frames: first and last video frame this person was tracked in (video captures only).
 *  frameEmbeddings: the person's face features from each of their best video frames, recognised one by one. */
export type DetectedFace={sourceWidth?:number;sourceHeight?:number;face:Face;usable:boolean;box?:{x:number;y:number;w:number;h:number};frames?:[number,number];frameEmbeddings?:number[][]};
/** studentId: confidently recognised. suggestion: likely student the teacher can confirm with one tap. candidates: closest students, best first.
 *  embedding: face features, so "Not a student" can remember a face and the head count can recognise one person across photos.
 *  notStudent: the teacher said this is not a student; it stays in the head count but leaves the review list. */
export type Observation={id:string;image:string;frames?:[number,number];studentId?:string;suggestion?:string;candidates?:string[];reason?:string;distance?:number;confirmed?:boolean;capture?:number;embedding?:number[];notStudent?:boolean};
const SMALL_SOURCE=240, DUPLICATE_GAP=.05;
/** Video: share of a person's frames that must point to the same student before they are marked. Strangers tend to
 *  resemble different students in different frames, while a real student stays the same student. */
export const FRAME_AGREEMENT=2/3;
/** One image can establish a match. Each student is given to at most one face per photo.
 *  strangers: face features of people the teacher marked "Not a student" on this board. */
export function recognizeCapture(model:Model, faces:DetectedFace[], strangers:number[][]=[]):Observation[]{
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
   return {id,image,suggestion:p.suggested?p.label:undefined,candidates:p.candidates,distance:p.distance,frames:f.frames,embedding,reason:lowRes?'Low-resolution photo':p.suggested?'Please confirm':'Not recognised'};
  }
  const p=predict(model,f.face.vector);
  return p.accepted&&p.ratio<.6?{id,image,studentId:p.label}:{id,image,reason:lowRes?'Low-resolution photo':'Not recognised'};
 });
 // If two faces in one photo match the same student, keep the clearly closer one; otherwise ask the teacher.
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
/** After the teacher marks a face "Not a student": un-mark automatic matches (not ones the teacher confirmed) that
 *  are about as close to that stranger as to their student. They go back to review instead. */
export function recheckAgainstStranger(observations:Observation[], stranger:number[]):Observation[]{
 const d=(a:number[],b:number[])=>Math.sqrt(a.reduce((n,v,i)=>n+(v-b[i])**2,0));
 return observations.map(o=>o.studentId&&!o.confirmed&&o.embedding&&o.distance!==undefined&&d(o.embedding,stranger)<=o.distance+STRANGER_GAP
  ?{...o,studentId:undefined,suggestion:undefined,reason:'Looks like someone marked “Not a student”'}:o);
}
export function rosterSignature(students:{id:string;faces:Face[]}[]){return students.map(s=>s.id+':'+s.faces.length).sort().join('|');}
