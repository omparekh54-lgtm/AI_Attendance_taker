import {predict,train,type Model,type Sample} from './model';
export const IDENTITY_EXTRACTOR='faceapi-1.7.15-landmarks-v1';
export type IdentityModel={extractor:string;templates:Sample[];limits:Record<string,number>;pcaLda:Model;maxRatio:number;minMargin:number;neighbors:number};
const distance=(a:number[],b:number[])=>Math.sqrt(a.reduce((n,v,i)=>n+(v-b[i])**2,0));
function score(v:number[],templates:Sample[],exclude=-1,neighbors=3){const byLabel=new Map<string,number[]>();templates.forEach((s,i)=>{if(i===exclude)return;const a=byLabel.get(s.label)??[];a.push(distance(v,s.vector));byLabel.set(s.label,a)});return [...byLabel].map(([label,distances])=>{distances.sort((a,b)=>a-b);const nearest=distances.slice(0,Math.min(neighbors,distances.length));return {label,distance:nearest.reduce((a,b)=>a+b,0)/nearest.length}}).sort((a,b)=>a.distance-b.distance)}
export function trainIdentity(samples:Sample[]):IdentityModel{
 if(samples.some(s=>s.vector.length!==128||s.vector.some(v=>!Number.isFinite(v)||Math.abs(v)>5)))throw Error('Invalid identity descriptors.');
 const pcaLda=train(samples,{components:32}),selected:number[]=[];
 // Keep a small, diverse gallery per student so a class model fits serverless payload limits.
 for(const label of Object.keys(pcaLda.limits)){
  const own=samples.map((s,i)=>({s,i})).filter(x=>x.s.label===label);
  const centroid=Array.from({length:128},(_,i)=>own.reduce((n,x)=>n+x.s.vector[i],0)/own.length);
  const chosen=[own.reduce((a,b)=>distance(a.s.vector,centroid)<distance(b.s.vector,centroid)?a:b)];
  while(chosen.length<Math.min(8,own.length)){
   const remaining=own.filter(x=>!chosen.some(c=>c.i===x.i));
   chosen.push(remaining.reduce((a,b)=>Math.min(...chosen.map(c=>distance(a.s.vector,c.s.vector)))>Math.min(...chosen.map(c=>distance(b.s.vector,c.s.vector)))?a:b));
  }
  selected.push(...chosen.map(x=>x.i));
 }
 const templates=selected.map(i=>({label:samples[i].label,vector:samples[i].vector.map(v=>Math.round(v*1e6)/1e6)})),limits:Record<string,number>={};
 for(const label of Object.keys(pcaLda.limits)){
  const positives=samples.flatMap((s,i)=>s.label===label?[score(s.vector,templates,selected.indexOf(i),2).find(r=>r.label===label)!.distance]:[]).sort((a,b)=>a-b);
  const q95=positives[Math.floor((positives.length-1)*.95)];limits[label]=Math.min(.4,Math.max(.38,q95*1.2+.025));
 }
 return {extractor:IDENTITY_EXTRACTOR,templates,limits,pcaLda,maxRatio:.85,minMargin:.07,neighbors:2};
}
export function predictIdentity(model:IdentityModel,vector:number[]){
 if(vector.length!==128||vector.some(v=>!Number.isFinite(v)||Math.abs(v)>5))throw Error('Invalid face descriptor.');
 const scores=score(vector,model.templates,-1,model.neighbors??3),best=scores[0],runnerUp=scores[1];if(!best||!runnerUp)throw Error('At least two trained identities are required.');
 const ratio=best.distance/Math.max(runnerUp.distance,1e-9),margin=runnerUp.distance-best.distance;
 const discriminant=predict(model.pcaLda,vector);
 const pcaAgreement=discriminant.label===best.label;
 // Strict per-student limit, or a slightly longer distance when one student is clearly ahead of every other.
 const strict=best.distance<=model.limits[best.label]&&ratio<=model.maxRatio&&margin>=model.minMargin;
 const clearLead=best.distance<=CLEAR_LEAD.distance&&ratio<=CLEAR_LEAD.ratio&&margin>=CLEAR_LEAD.margin;
 const accepted=pcaAgreement&&(strict||clearLead);
 // Not safe to mark automatically, but likely enough to offer the teacher a one-tap confirmation.
 const suggested=!accepted&&best.distance<=SUGGEST.distance&&ratio<=SUGGEST.ratio&&margin>=SUGGEST.margin;
 return {...best,ratio,margin,accepted,suggested,pcaAgreement,candidates:scores.slice(0,3).map(s=>s.label)};
}
/** Tuned on the class's 208 enrolment templates (leave-one-out and leave-one-student-out) and stranger group photos:
 *  clear-lead accepts gave 0 wrong students and 0 unregistered faces; suggestions were never offered for strangers. */
export const CLEAR_LEAD={distance:.47,ratio:.75,margin:.12};
export const SUGGEST={distance:.56,ratio:.92,margin:.035};

/** Six decimals preserve classifier precision and keep shared model writes below 900 KB. */
export function compactModel<T>(value:T):T{return JSON.parse(JSON.stringify(value,(_,v)=>typeof v==='number'?Math.round(v*1e6)/1e6:v))}
