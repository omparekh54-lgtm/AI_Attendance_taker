import {isTightPortrait,tileGrid,groupTileSizes} from './face-geometry';
import {describeFace} from './embeddings';
import {FaceDetector,FilesetResolver} from '@mediapipe/tasks-vision';import type {Face} from './store';import {config} from './config';
let detector:Promise<FaceDetector>|undefined;
export function ready(){return detector??=FilesetResolver.forVisionTasks(`${import.meta.env.BASE_URL}wasm`).then(files=>FaceDetector.createFromOptions(files,{baseOptions:{modelAssetPath:`${import.meta.env.BASE_URL}models/face-detector.tflite`,delegate:'CPU'},runningMode:'IMAGE',minDetectionConfidence:.6})).catch(e=>{detector=undefined;throw e});}
export type ScanProgress=(fraction:number,stage:string)=>void;
export async function detect(source:HTMLImageElement|HTMLVideoElement,options:{group?:boolean;onProgress?:ScanProgress}={}){const model=await ready();const w=source instanceof HTMLVideoElement?source.videoWidth:source.naturalWidth,h=source instanceof HTMLVideoElement?source.videoHeight:source.naturalHeight;if(!w||!h)throw Error('Image is not ready.');const frame=document.createElement('canvas');frame.width=w;frame.height=h;frame.getContext('2d')!.drawImage(source,0,0);const detections=model.detect(frame).detections.map(d=>({...d,boundingBox:{...d.boundingBox!}}));
// A saved face crop can fill the frame too tightly for the detector. Add context,
// keeping coordinates in original pixels; do not lower the detection threshold.
if(!detections.length&&Math.min(w,h)<500&&w/h>.7&&w/h<1.4){
 const pad=Math.round(Math.max(w,h)*.25),context=document.createElement('canvas');context.width=w+pad*2;context.height=h+pad*2;const cc=context.getContext('2d')!;cc.fillStyle='#999';cc.fillRect(0,0,context.width,context.height);cc.drawImage(frame,pad,pad);
 for(const d of model.detect(context).detections){const b=d.boundingBox!;const cx=b.originX+b.width/2-pad,cy=b.originY+b.height/2-pad;if(cx<0||cx>w||cy<0||cy>h)continue;detections.push({...d,boundingBox:{...b,originX:b.originX-pad,originY:b.originY-pad},keypoints:d.keypoints.map(p=>({...p,x:(p.x*context.width-pad)/w,y:(p.y*context.height-pad)/h}))})}
}
// Classroom photos: the selfie-range BlazeFace model above cannot see small, distant faces.
// Scan the whole frame and overlapping tiles with the SSD group detector, then merge.
if(options.group)detections.push(...await groupDetections(frame,w,h,options.onProgress));
const unique= detections.sort((a,b)=>(b.categories[0]?.score??0)-(a.categories[0]?.score??0)).filter((d,i,all)=>!all.slice(0,i).some(o=>{const a=d.boundingBox,b=o.boundingBox;const intersection=Math.max(0,Math.min(a.originX+a.width,b.originX+b.width)-Math.max(a.originX,b.originX))*Math.max(0,Math.min(a.originY+a.height,b.originY+b.height)-Math.max(a.originY,b.originY));return intersection/Math.min(a.width*a.height,b.width*b.height)>.55}));
let described=0;
return Promise.all(unique.map(async d=>{const box=d.boundingBox!;const points=d.keypoints??[];const eye1=points[0],eye2=points[1];const crop=document.createElement('canvas');crop.width=crop.height=96;const ctx=crop.getContext('2d')!;const cx=box.originX+box.width/2,cy=box.originY+box.height*.48,size=Math.max(box.width,box.height)*1.2;let angle=0;if(eye1&&eye2){let dx=(eye2.x-eye1.x)*w,dy=(eye2.y-eye1.y)*h;if(dx<0){dx=-dx;dy=-dy;}angle=Math.atan2(dy,dx);}if(isTightPortrait(w,h,unique.length,box)){ctx.drawImage(frame,0,0,96,96)}else{ctx.translate(48,48);ctx.rotate(-angle);ctx.scale(96/size,96/size);ctx.drawImage(frame,-cx,-cy);}const small=document.createElement('canvas');small.width=small.height=24;const sc=small.getContext('2d',{willReadFrequently:true})!;sc.drawImage(crop,0,0,24,24);const pixels=sc.getImageData(0,0,24,24).data,gray=Array.from({length:576},(_,i)=>(pixels[i*4]*.299+pixels[i*4+1]*.587+pixels[i*4+2]*.114)/255),mean=gray.reduce((a,v)=>a+v,0)/576,std=Math.sqrt(gray.reduce((a,v)=>a+(v-mean)**2,0)/576);let sharp=0;for(let y=1;y<23;y++)for(let x=1;x<23;x++){const i=y*24+x;sharp+=(4*gray[i]-gray[i-1]-gray[i+1]-gray[i-24]-gray[i+24])**2;}const usable=box.width>=45&&box.height>=45&&std>.045&&sharp/484>.0005;const face:Face={image:crop.toDataURL('image/jpeg',.8),vector:gray.map(v=>(v-mean)/Math.max(std,.05))};if(usable){face.embedding=await describeFace(identityCrop(frame,cx,cy,size,angle,isTightPortrait(w,h,unique.length,box)));options.onProgress?.(.7+.3*++described/unique.length,'Recognising students');}return {sourceWidth:w,sourceHeight:h,face,usable,box:{x:box.originX/w,y:box.originY/h,w:box.width/w,h:box.height/h}};}));}
type RawDetection=ReturnType<FaceDetector['detect']>['detections'][number];
type Detection=Omit<RawDetection,'boundingBox'>&{boundingBox:NonNullable<RawDetection['boundingBox']>};
async function groupDetections(frame:HTMLCanvasElement,w:number,h:number,onProgress?:ScanProgress):Promise<Detection[]>{
 const {detectFaceBoxes}=await import('./embeddings');
 const toDetection=(b:{x:number;y:number;width:number;height:number;score:number}):Detection=>({boundingBox:{originX:b.x,originY:b.y,width:b.width,height:b.height,angle:0},categories:[{score:b.score,index:0,categoryName:'face',displayName:'face'}],keypoints:[]});
 onProgress?.(0,'Finding faces');const out=(await detectFaceBoxes(frame,.5)).map(toDetection);
 const tiles=groupTileSizes(w,h).flatMap(size=>tileGrid(w,h,size));let scanned=0;
 for(const t of tiles){onProgress?.(.7*++scanned/(tiles.length+1),'Finding faces');
  const tile=document.createElement('canvas');tile.width=t.w;tile.height=t.h;tile.getContext('2d')!.drawImage(frame,t.x,t.y,t.w,t.h,0,0,t.w,t.h);
  for(const b of await detectFaceBoxes(tile,.5)){
   // A face cut by a tile edge is found whole in a neighbouring tile or the full frame.
   const edge=3,cut=(b.x<edge&&t.x>0)||(b.y<edge&&t.y>0)||(b.x+b.width>t.w-edge&&t.x+t.w<w)||(b.y+b.height>t.h-edge&&t.y+t.h<h);
   if(!cut)out.push(toDetection({...b,x:b.x+t.x,y:b.y+t.y}));
  }
 }
 return out;
}
/** Sharper crop for identity features: up to 224 px from the original pixels instead of the 96 px thumbnail. */
function identityCrop(frame:HTMLCanvasElement,cx:number,cy:number,size:number,angle:number,tight:boolean){
 const side=Math.max(96,Math.min(224,Math.round(tight?Math.min(frame.width,frame.height):size)));
 const c=document.createElement('canvas');c.width=c.height=side;const ctx=c.getContext('2d')!;ctx.imageSmoothingQuality='high';
 if(tight)ctx.drawImage(frame,0,0,side,side);else{ctx.translate(side/2,side/2);ctx.rotate(-angle);ctx.scale(side/size,side/size);ctx.drawImage(frame,-cx,-cy);}
 return c;
}
export async function imageFile(file:File,options:{group?:boolean;onProgress?:ScanProgress}={}){if(file.size>30*1024*1024)throw Error('Choose an image smaller than 30 MB.');const url=URL.createObjectURL(file);try{const img=new Image();img.src=url;await img.decode();return await detect(img,options);}finally{URL.revokeObjectURL(url);}}
export async function videoFile(file:File,onFrame:(faces:Awaited<ReturnType<typeof detect>>,t:number)=>void){if(file.size>200*1024*1024)throw Error('Choose a video smaller than 200 MB.');const url=URL.createObjectURL(file),v=document.createElement('video');v.muted=true;v.playsInline=true;v.src=url;try{await new Promise<void>((resolve,reject)=>{v.onloadedmetadata=()=>resolve();v.onerror=()=>reject(Error('This video format cannot be read.'))});if(!Number.isFinite(v.duration)){await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Video duration cannot be read. Try uploading an MP4 or use photos.')),7000);v.onseeked=()=>{clearTimeout(timer);resolve()};v.currentTime=1e9;});}if(!Number.isFinite(v.duration)||v.duration<=0)throw Error('Video duration cannot be read.');const duration=Math.min(v.duration,config.maximumVideoSeconds);for(let t=.1;t<duration;t+=.6){await new Promise<void>((resolve,reject)=>{v.onseeked=()=>resolve();v.onerror=()=>reject(Error('Video decode failed.'));v.currentTime=Math.min(t,v.duration-.01)});onFrame(await detect(v),t);}}finally{v.removeAttribute('src');v.load();URL.revokeObjectURL(url);}}
