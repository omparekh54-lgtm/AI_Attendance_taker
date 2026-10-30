import {predict,train,type Model,type Sample} from './model';
export const IDENTITY_EXTRACTOR='faceapi-1.7.15-landmarks-v1';
/** Version of the matching rules baked into a saved model (limits). A saved model with older rules is rebuilt.
 *  2: limits set from classmates, no clear-lead shortcut. 3: per-student caps; small faces get a longer limit. */
export const IDENTITY_RULES=3;
/** limits: per-student distance limit for a clear face. caps: the most any face may be from this student, set by how
 *  close their classmates come (small faces are allowed past `limits`, never past `caps`). */
export type IdentityModel={extractor:string;rules?:number;templates:Sample[];limits:Record<string,number>;caps?:Record<string,number>;pcaLda:Model;maxRatio:number;minMargin:number;neighbors:number};
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
 const templates=selected.map(i=>({label:samples[i].label,vector:round(samples[i].vector)})),limits:Record<string,number>={},caps:Record<string,number>={};
 const gallery=[...templates,...classroom.map(c=>({label:c.label,vector:round(c.vector)}))];
 // How close do CLASSMATES come to each student? Unregistered students are the same age and background as the
 // registered ones, so the class itself is the best stand-in for strangers. Each training face is scored once
 // against everyone's gallery; for every other student, that distance is an "impostor" distance.
 const impostor=new Map<string,number[]>();
 for(const s of [...samples,...classroom]){
  for(const r of score(s.vector,gallery,-1,2))if(r.label!==s.label){const a=impostor.get(r.label)??[];a.push(r.distance);impostor.set(r.label,a)}
 }
 for(const label of Object.keys(pcaLda.limits)){
  // Own photos: generous enough for the student's normal variation (95th percentile, leave-one-out).
  const positives=samples.flatMap((s,i)=>s.label===label?[score(s.vector,templates,selected.indexOf(i),2).find(r=>r.label===label)!.distance]:[]).sort((a,b)=>a-b);
  const own=positives[Math.floor((positives.length-1)*.95)]*1.2+.025;
  // Other people: stay clearly inside the closest classmates (a low percentile minus a safety gap).
  const others=(impostor.get(label)??[]).sort((a,b)=>a-b);
  const closestOthers=others.length?others[Math.floor((others.length-1)*IMPOSTOR.percentile)]-IMPOSTOR.gap:Infinity;
  caps[label]=Math.max(IMPOSTOR.floor,Math.min(IMPOSTOR.maxCap,closestOthers));
  limits[label]=Math.max(IMPOSTOR.floor,Math.min(IMPOSTOR.ceiling,own,caps[label]));
 }
 return {extractor:IDENTITY_EXTRACTOR,rules:IDENTITY_RULES,templates:gallery,limits,caps,pcaLda,maxRatio:.85,minMargin:.07,neighbors:2};
}
/** Extra distance allowed for a small face (px = face width in the photo). A small face is blurrier, so even the right
 *  student is further away (real faces: typically 0.38 at 32 px, 0.47 at 24 px), while different people stay about
 *  0.50 or more at every size. So the limit grows as the face shrinks, up to the student's classmate cap. */
export function smallFaceAllowance(px:number){
 if(!Number.isFinite(px))return 0;
 return SMALL_FACE.extra*Math.min(1,Math.max(0,(SMALL_FACE.from-px)/(SMALL_FACE.from-SMALL_FACE.to)));
}
/** `strangers`: face features of people the teacher marked "Not a student" on this board. A face that is about as close
 *  to one of them as to the best student is never named, not even as a suggestion.
 *  `facePx`: width of the face in the photo (omit for a clear, close-up face). */
export function predictIdentity(model:IdentityModel,vector:number[],strangers:number[][]=[],facePx=Infinity){
 if(vector.length!==128||vector.some(v=>!Number.isFinite(v)||Math.abs(v)>5))throw Error('Invalid face descriptor.');
 const scores=score(vector,model.templates,-1,model.neighbors??3),best=scores[0],runnerUp=scores[1];if(!best||!runnerUp)throw Error('At least two trained identities are required.');
 const ratio=best.distance/Math.max(runnerUp.distance,1e-9),margin=runnerUp.distance-best.distance;
 const discriminant=predict(model.pcaLda,vector);
 const pcaAgreement=discriminant.label===best.label;
 const strangerDistance=strangers.reduce((m,s)=>Math.min(m,distance(vector,s)),Infinity);
 const stranger=strangerDistance<=best.distance+STRANGER_GAP;
 // Within this student's own limit, clearly ahead of the next student, and PCA/LDA agrees.
 // There is deliberately no "far ahead of everyone" shortcut (the old 0.47 clear-lead rule): a stranger can be far
 // from every other student and still not be this one. In open-set tests it was the main source of strangers named.
 const cap=model.caps?.[best.label]??IMPOSTOR.maxCap;
 const limit=Math.min(cap,model.limits[best.label]+smallFaceAllowance(facePx));
 const accepted=!stranger&&pcaAgreement&&best.distance<=limit&&ratio<=model.maxRatio&&margin>=model.minMargin;
 // Not safe to mark automatically, but close enough to this student to offer the teacher a one-tap confirmation.
 const suggested=!accepted&&!stranger&&best.distance<=Math.min(SUGGEST.distance,limit+SUGGEST.beyondLimit)&&ratio<=SUGGEST.ratio&&margin>=SUGGEST.margin;
 return {...best,ratio,margin,limit,accepted,suggested,stranger,strangerDistance,pcaAgreement,candidates:scores.slice(0,3).map(s=>s.label)};
}
/** Per-student limits. `percentile`/`gap`: stay below the closest 2% of classmate distances by 0.03.
 *  `floor`/`ceiling` keep a clear-face limit sane when a student has very few or very unusual photos. `maxCap`: no face
 *  is ever accepted further than this (different people's faces: only 0.1% come closer than 0.50 on real photos). */
export const IMPOSTOR={percentile:.02,gap:.03,floor:.3,ceiling:.44,maxCap:.49};
/** Small faces: from `from` px down to `to` px the limit grows by up to `extra` (never past the student's cap). */
export const SMALL_FACE={from:48,to:24,extra:.07};
/** A face this close to a remembered stranger (relative to its best student) is left as unknown. */
export const STRANGER_GAP=.03;
/** Suggestions: at most `beyondLimit` past the student's own limit (and never past `distance`). */
export const SUGGEST={distance:.5,beyondLimit:.06,ratio:.9,margin:.04};

/** Six decimals preserve classifier precision and keep shared model writes below 900 KB. */
export function compactModel<T>(value:T):T{return JSON.parse(JSON.stringify(value,(_,v)=>typeof v==='number'?Math.round(v*1e6)/1e6:v))}
