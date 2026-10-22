import {predictIdentity} from './identity';
import {predict, type Model} from './model';
import type {Face} from './store';
/** frames: first and last video frame this person was tracked in (video captures only). */
export type DetectedFace={sourceWidth?:number;sourceHeight?:number;face:Face;usable:boolean;box?:{x:number;y:number;w:number;h:number};frames?:[number,number]};
/** studentId: confidently recognised. suggestion: likely student the teacher can confirm with one tap. candidates: closest students, best first. */
export type Observation={id:string;image:string;frames?:[number,number];studentId?:string;suggestion?:string;candidates?:string[];reason?:string;distance?:number;confirmed?:boolean;capture?:number};
const SMALL_SOURCE=240, DUPLICATE_GAP=.05;
/** One image can establish a match. Each student is given to at most one face per photo. */
export function recognizeCapture(model:Model, faces:DetectedFace[]):Observation[]{
 const observations:Observation[]=faces.map(f=>{
  const id=crypto.randomUUID(),image=f.face.image;
  if(!f.usable)return {id,image,reason:'Too small or blurry'};
  if(model.identity&&!f.face.embedding)return {id,image,reason:'Face features missing — retake'};
  const lowRes=f.sourceWidth&&f.sourceHeight&&Math.min(f.sourceWidth,f.sourceHeight)<SMALL_SOURCE;
  if(model.identity){
   const p=predictIdentity(model.identity,f.face.embedding!);
   if(p.accepted)return {id,image,studentId:p.label,distance:p.distance,candidates:p.candidates,frames:f.frames};
   return {id,image,suggestion:p.suggested?p.label:undefined,candidates:p.candidates,distance:p.distance,reason:lowRes?'Low-resolution photo':p.suggested?'Please confirm':'Not recognised'};
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
export function rosterSignature(students:{id:string;faces:Face[]}[]){return students.map(s=>s.id+':'+s.faces.length).sort().join('|');}
