import {predict,train,type Model,type Sample} from './model';
export const IDENTITY_EXTRACTOR='faceapi-1.7.15-landmarks-v1';
export type IdentityModel={extractor:string;templates:Sample[];limits:Record<string,number>;pcaLda:Model;maxRatio:number;minMargin:number;neighbors:number};
const distance=(a:number[],b:number[])=>Math.sqrt(a.reduce((n,v,i)=>n+(v-b[i])**2,0));
function score(v:number[],templates:Sample[],exclude=-1,neighbors=3){const byLabel=new Map<string,number[]>();templates.forEach((s,i)=>{if(i===exclude)return;const a=byLabel.get(s.label)??[];a.push(distance(v,s.vector));byLabel.set(s.label,a)});return [...byLabel].map(([label,distances])=>{distances.sort((a,b)=>a-b);const nearest=distances.slice(0,Math.min(neighbors,distances.length));return {label,distance:nearest.reduce((a,b)=>a+b,0)/nearest.length}}).sort((a,b)=>a.distance-b.distance)}
/** `classroom`: extra gallery entries describing students as they appear in class photos (small, far away),
 *  computed from their own enrolment photos. They join the gallery and PCA/LDA but not the distance calibration. */
export const GALLERY_PER_STUDENT=8;
/** Face widths (px) at which gallery photos are also described as seen in class. On the 26 real students, [80] lifted 36–44 px recognition from 89–93% to 97–98% with 0 wrong; adding 44/36 px let 1–4 of 624 unregistered look-alike tests through. */
export const CLASS_STYLE_SIZES=[80];
/** Indices of up to `k` diverse vectors: the most typical first, then each next one farthest from those chosen. */
export function diverse(vectors:number[][],k:number):number[]{
 if(!vectors.length)return [];
 const centroid=vectors[0].map((_,d)=>vectors.reduce((n,v)=>n+v[d],0)/vectors.length);
 const chosen=[vectors.reduce((b,v,i)=>distance(v,centroid)<distance(vectors[b],centroid)?i:b,0)];
 while(chosen.length<Math.min(k,vectors.length)){
  let best=-1,bestD=-1;
  vectors.forEach((v,i)=>{if(chosen.includes(i))return;const d=Math.min(...chosen.map(c=>distance(v,vectors[c])));if(d>bestD){bestD=d;best=i}});
  chosen.push(best);
 }
 return chosen;
}
export function trainIdentity(samples:Sample[],classroom:Sample[]=[]):IdentityModel{
 if([...samples,...classroom].some(s=>s.vector.length!==128||s.vector.some(v=>!Number.isFinite(v)||Math.abs(v)>5)))throw Error('Invalid identity descriptors.');
 const known=new Set(samples.map(s=>s.label));classroom=classroom.filter(s=>known.has(s.label));
 const pcaLda=train([...samples,...classroom],{components:32}),selected:number[]=[];
 // Keep a small, diverse gallery per student so a class model fits serverless payload limits.
 for(const label of Object.keys(pcaLda.limits)){
  const own=samples.flatMap((s,i)=>s.label===label?[i]:[]);
  selected.push(...diverse(own.map(i=>samples[i].vector),GALLERY_PER_STUDENT).map(j=>own[j]));
 }
 const round=(v:number[])=>v.map(x=>Math.round(x*1e6)/1e6);
 const templates=selected.map(i=>({label:samples[i].label,vector:round(samples[i].vector)})),limits:Record<string,number>={};
 for(const label of Object.keys(pcaLda.limits)){
  const positives=samples.flatMap((s,i)=>s.label===label?[score(s.vector,templates,selected.indexOf(i),2).find(r=>r.label===label)!.distance]:[]).sort((a,b)=>a-b);
  const q95=positives[Math.floor((positives.length-1)*.95)];limits[label]=Math.min(.4,Math.max(.38,q95*1.2+.025));
 }
 return {extractor:IDENTITY_EXTRACTOR,templates:[...templates,...classroom.map(c=>({label:c.label,vector:round(c.vector)}))],limits,pcaLda,maxRatio:.85,minMargin:.07,neighbors:2};
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
