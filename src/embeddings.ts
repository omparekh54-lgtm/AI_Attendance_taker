/** Local face descriptors. Only the recognition and landmark models are loaded. */
let engine:Promise<typeof import('@vladmandic/face-api')>|undefined;
let queue:Promise<unknown>=Promise.resolve();
export const EMBEDDING_VERSION='faceapi-1.7.15-landmarks-v1';
export function embeddingReady(){return engine??= (async()=>{
 const api=await import('@vladmandic/face-api');
 const tf=api.tf as unknown as {setBackend:(backend:string)=>Promise<boolean>;ready:()=>Promise<void>};
 try{if(!await tf.setBackend('webgl'))throw Error('WebGL unavailable');await tf.ready()}catch{await tf.setBackend('cpu');await tf.ready()}
 const path=`${import.meta.env.BASE_URL}models/identity`;
 await Promise.all([api.nets.faceRecognitionNet.loadFromUri(path),api.nets.faceLandmark68TinyNet.loadFromUri(path)]);
 return api;
})().catch(e=>{engine=undefined;throw Error('Recognition model could not load. Check your connection and retry. '+(e as Error).message)})}
/** Group-photo face detector (SSD MobileNet v1). Loaded only when a class photo is taken. */
let groupEngine:Promise<typeof import('@vladmandic/face-api')>|undefined;
export function groupDetectorReady(){return groupEngine??= (async()=>{
 const api=await embeddingReady();
 await api.nets.ssdMobilenetv1.loadFromUri(`${import.meta.env.BASE_URL}models/detector`);
 return api;
})().catch(e=>{groupEngine=undefined;throw Error('Group face detector could not load. Check your connection and retry. '+(e as Error).message)})}
export type FaceBox={x:number;y:number;width:number;height:number;score:number};
/** Face boxes in the canvas's own pixel coordinates. */
export async function detectFaceBoxes(source:HTMLCanvasElement,minConfidence:number):Promise<FaceBox[]>{
 const work=queue.then(async()=>{
  const api=await groupDetectorReady();
  const found=await api.detectAllFaces(source,new api.SsdMobilenetv1Options({minConfidence,maxResults:200}));
  return found.map(d=>({x:d.box.x,y:d.box.y,width:d.box.width,height:d.box.height,score:d.score}));
 });queue=work.catch(()=>{});return work;
}
export async function describeFace(source:HTMLCanvasElement|HTMLImageElement){
 const work=queue.then(async()=>{
  const api=await embeddingReady();const landmarks=await api.detectFaceLandmarksTiny(source);
  if(Array.isArray(landmarks))throw Error('Expected one aligned face crop.');
  const aligned=await api.extractFaces(source,[landmarks.align()]);
  if(!aligned[0])throw Error('The face could not be aligned. Take a clearer, front-facing photo.');
  const result=await api.computeFaceDescriptor(aligned[0]);
  const vector=Array.from(result as Float32Array);
  if(vector.length!==128||vector.some(v=>!Number.isFinite(v)))throw Error('Could not extract valid face features.');
  return vector;
 });queue=work.catch(()=>{});return work;
}
/** Full 68-point landmark model: better alignment for small, angled classroom faces. Loaded on first classroom scan. */
let fullLandmarks:Promise<typeof import('@vladmandic/face-api')>|undefined;
function classroomReady(){return fullLandmarks??=(async()=>{const api=await embeddingReady();await api.nets.faceLandmark68Net.loadFromUri(`${import.meta.env.BASE_URL}models/identity`);return api})().catch(e=>{fullLandmarks=undefined;throw Error('Recognition model could not load. Check your connection and retry. '+(e as Error).message)})}
function mirrored(source:HTMLCanvasElement){const c=document.createElement('canvas');c.width=source.width;c.height=source.height;const x=c.getContext('2d')!;x.translate(c.width,0);x.scale(-1,1);x.drawImage(source,0,0);return c}
/** Classroom-photo descriptor: full-landmark alignment, averaged with the mirror image.
 *  Compatible with enrolment descriptors (same recognition network); on labelled group photos it doubled
 *  automatic matches (5 to 10 of 22) with no wrong students and no strangers accepted. */
export async function describeClassroomFace(source:HTMLCanvasElement){
 const work=queue.then(async()=>{
  const api=await classroomReady();
  const one=async(c:HTMLCanvasElement)=>{const landmarks=await api.detectFaceLandmarks(c);if(Array.isArray(landmarks))throw Error('Expected one aligned face crop.');
   const aligned=await api.extractFaces(c,[landmarks.align()]);if(!aligned[0])throw Error('The face could not be aligned.');return Array.from(await api.computeFaceDescriptor(aligned[0]) as Float32Array)};
  const a=await one(source),b=await one(mirrored(source));
  const sum=a.map((v,i)=>v+b[i]),scale=Math.hypot(...a)/Math.max(Math.hypot(...sum),1e-9);
  const vector=sum.map(v=>v*scale);
  if(vector.length!==128||vector.some(v=>!Number.isFinite(v)))throw Error('Could not extract valid face features.');
  return vector;
 });
 queue=work.catch(()=>{});return work;
}
export async function describeFaceDataUrl(url:string){const image=new Image();image.src=url;await image.decode();return describeFace(image)}
