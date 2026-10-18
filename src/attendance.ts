import {predict, type Model} from './model';
import type {Face} from './store';
export type DetectedFace={sourceWidth?:number;sourceHeight?:number;face:Face;usable:boolean;box:{x:number;y:number;w:number;h:number}};
export type Observation={id:string;image:string;studentId?:string;reason?:string};
/** One image can establish a match. Ambiguous and duplicate identities stay unresolved. */
export function recognizeCapture(model:Model, faces:DetectedFace[]):Observation[]{
 const observations=faces.map(f=>{
  if(!f.usable)return {id:crypto.randomUUID(),image:f.face.image,reason:'Face too small, blurred or poorly lit'};
  const p=predict(model,f.face.vector);
  return {id:crypto.randomUUID(),image:f.face.image,studentId:p.accepted&&p.ratio<.6?p.label:undefined,reason:f.sourceWidth&&f.sourceHeight&&Math.min(f.sourceWidth,f.sourceHeight)<240?`Face detected, identity unconfirmed. This image is only ${f.sourceWidth} × ${f.sourceHeight} pixels. Upload the original photo or take a new close, well-lit photo.`:'Face detected, but no confident registered-student match. Take another photo or check the student manually.'};
 });
 const counts=new Map<string,number>();for(const o of observations)if(o.studentId)counts.set(o.studentId,(counts.get(o.studentId)??0)+1);
 return observations.map(o=>o.studentId&&(counts.get(o.studentId)??0)>1?{...o,studentId:undefined,reason:'Two faces matched the same student — check manually'}:o);
}
export function rosterSignature(students:{id:string;faces:Face[]}[]){return students.map(s=>s.id+':'+s.faces.length).sort().join('|');}
