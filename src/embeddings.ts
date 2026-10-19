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
export async function describeFaceDataUrl(url:string){const image=new Image();image.src=url;await image.decode();return describeFace(image)}
