import {useEffect,useRef,useState} from 'react';
import {Camera,RefreshCw,Upload,X} from 'lucide-react';

import type {DetectedFace} from './attendance';
type FacingMode='user'|'environment';

function inferFacing(label:string,fallback:FacingMode):FacingMode{
 const value=label.toLowerCase();
 if(/back|rear|environment|world/.test(value))return 'environment';
 if(/front|user|face/.test(value))return 'user';
 return fallback;
}

export function CameraCapture({onCapture,disabled=false,phone=false}:{onCapture:(faces:DetectedFace[])=>Promise<void>|void;disabled?:boolean;phone?:boolean}){
 const video=useRef<HTMLVideoElement>(null),stream=useRef<MediaStream|null>(null),opening=useRef(false),mounted=useRef(true);
 const[active,setActive]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[devices,setDevices]=useState<MediaDeviceInfo[]>([]),[device,setDevice]=useState(''),[facing,setFacing]=useState<FacingMode>(phone?'environment':'user'),[progress,setProgress]=useState<{fraction:number;stage:string}|null>(null);

 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;releaseStream()}},[]);

 function releaseStream(){
  stream.current?.getTracks().forEach(track=>track.stop());
  stream.current=null;
  if(video.current)video.current.srcObject=null;
 }
 function stop(){releaseStream();setActive(false);setBusy(false)}

 async function startStream(constraints:MediaTrackConstraints){
  return navigator.mediaDevices.getUserMedia({video:constraints,audio:false});
 }

 async function attach(media:MediaStream,nextFacing:FacingMode){
  if(!mounted.current){media.getTracks().forEach(t=>t.stop());return;}
  stream.current=media;
  const track=media.getVideoTracks()[0];
  const settings=track.getSettings();
  const available=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='videoinput');
  const currentId=settings.deviceId??'';
  const currentInfo=available.find(d=>d.deviceId===currentId);
  const actualFacing=(settings.facingMode as FacingMode|undefined)??inferFacing(currentInfo?.label??'',nextFacing);
  setDevices(available);setDevice(currentId);setFacing(actualFacing);setActive(true);
  requestAnimationFrame(async()=>{
   if(!video.current||stream.current!==media)return;
   video.current.srcObject=media;
   try{await video.current.play()}catch{setError('Tap the camera preview once to start it.')}
  });
 }

 async function open(id?:string,nextFacing:FacingMode=facing){
  if(opening.current)return;
  opening.current=true;setError('');setBusy(true);releaseStream();
  try{
   if(!navigator.mediaDevices?.getUserMedia)throw Error('Camera is not available in this browser.');
   let media:MediaStream;
   if(id){
    media=await startStream({deviceId:{exact:id},width:{ideal:1920},height:{ideal:1080}});
   }else{
    try{media=await startStream({facingMode:{exact:nextFacing},width:{ideal:1920},height:{ideal:1080}})}
    catch{media=await startStream({facingMode:{ideal:nextFacing},width:{ideal:1920},height:{ideal:1080}})}
   }
   await attach(media,nextFacing);
  }catch(e){
   setActive(false);
   const name=(e as DOMException).name;
   if(name==='NotAllowedError')setError('Camera permission is blocked. Allow camera access in your browser settings and try again.');
   else if(name==='NotFoundError'||name==='OverconstrainedError')setError('That camera could not be opened. Try the other camera or upload a photo.');
   else setError((e as Error).message||'Could not open the camera. Try again or upload a photo.');
  }finally{opening.current=false;if(mounted.current)setBusy(false)}
 }

 async function rotateCamera(){
  if(opening.current||busy)return;
  const next:FacingMode=facing==='environment'?'user':'environment';
  setBusy(true);setError('');
  try{
   const available=devices.length?devices:(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='videoinput');
   const other=available.find(d=>d.deviceId!==device&&inferFacing(d.label,next)===next)??available.find(d=>d.deviceId!==device);
   releaseStream();
   await new Promise(resolve=>setTimeout(resolve,120));
   if(other?.deviceId)await open(other.deviceId,next);else await open(undefined,next);
  }finally{if(mounted.current)setBusy(false)}
 }

 async function chooseCamera(id:string){
  const info=devices.find(d=>d.deviceId===id);
  await open(id,inferFacing(info?.label??'',facing));
 }

 const onProgress=(fraction:number,stage:string)=>{if(mounted.current)setProgress({fraction,stage})};
async function process(fn:()=>Promise<DetectedFace[]>){if(busy||disabled)return;setBusy(true);setError('');setProgress({fraction:0,stage:'Preparing photo'});try{const faces=await fn();if(!faces.length)throw Error('No faces detected. Attendance has not changed. Try a clearer photo or move closer to the class.');await onCapture(faces)}catch(e){setError((e as Error).message)}finally{setBusy(false);setProgress(null)}}

 return <div className="camera-capture">{error&&<div className="alert error" role="alert">{error}</div>}{progress&&<div className="scan-progress" role="status" aria-live="polite"><div><strong>{progress.stage}…</strong><span>{Math.round(progress.fraction*100)}%</span></div><progress max={1} value={progress.fraction}/><small>Keep this page open. Large class photos take a few seconds.</small></div>}
 {active?<><div className="board-preview camera-live"><video ref={video} muted playsInline autoPlay onClick={()=>video.current?.play()}/>
 {(phone||devices.length>1)&&<button type="button" className="camera-flip" aria-label="Switch front and back camera" title="Switch camera" disabled={busy||disabled} onClick={rotateCamera}><RefreshCw size={24}/></button>}
 <span className="camera-label"><strong>{facing==='environment'?'Back camera':'Front camera'}</strong> · Point the camera towards the students</span></div>
 <div className="actions camera-actions"><button className="primary camera-shutter" disabled={busy||disabled} onClick={()=>process(async()=>{if(!video.current?.videoWidth)throw Error('Camera is still starting. Try again in a moment.');const {detect}=await import('./vision');return detect(video.current,{group:true,onProgress})})}><Camera size={21}/>{progress?'Scanning…':busy?'Working…':'Take attendance photo'}</button><button disabled={busy} onClick={stop}><X size={18}/>Close</button></div>
 {devices.length>1&&<details className="camera-options"><summary>Camera options</summary><label>Choose camera<select aria-label="Choose camera" value={device} disabled={busy} onChange={e=>chooseCamera(e.target.value)}>{devices.map((d,i)=><option key={d.deviceId} value={d.deviceId}>{d.label||`Camera ${i+1}`}</option>)}</select></label></details>}</>:<div className="board-camera-empty"><div className="camera-symbol"><Camera size={48}/></div><h2>{phone?'Take attendance with your phone':'Your classroom. One capture.'}</h2><p>{phone?'The back camera opens first. Tap the rotate icon anytime to switch between back and front cameras.':'Open the camera, take a clear classroom photo and see who is present.'}</p><button className="primary" disabled={busy} onClick={()=>open(undefined,phone?'environment':facing)}><Camera size={22}/>{busy?'Opening camera…':'Open camera'}</button></div>}
 <label className={`button upload-photo ${busy||disabled?'disabled':''}`}><Upload size={17}/>Upload classroom photo<input type="file" accept="image/*" capture={phone?'environment':undefined} multiple disabled={busy||disabled} onChange={async e=>{const files=Array.from(e.target.files??[]);e.target.value='';for(const f of files)await process(async()=>{const {imageFile}=await import('./vision');return imageFile(f,{group:true,onProgress})})}}/></label>
 <p className="muted">Tip: for students far from the camera, take a closer photo of each section. Multiple captures are combined without counting the same student twice.</p></div>
}
