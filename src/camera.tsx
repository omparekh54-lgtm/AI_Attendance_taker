import {useEffect,useRef,useState} from 'react';
import {Camera,RefreshCw,Upload} from 'lucide-react';

import type {DetectedFace} from './attendance';
type FacingMode='user'|'environment';
export function CameraCapture({onCapture,disabled=false,phone=false}:{onCapture:(faces:DetectedFace[])=>Promise<void>|void;disabled?:boolean;phone?:boolean}){
 const video=useRef<HTMLVideoElement>(null),stream=useRef<MediaStream|null>(null),opening=useRef(false),mounted=useRef(true);
 const[active,setActive]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[devices,setDevices]=useState<MediaDeviceInfo[]>([]),[device,setDevice]=useState(''),[facing,setFacing]=useState<FacingMode>(phone?'environment':'user');
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;stream.current?.getTracks().forEach(t=>t.stop())}},[]);
 useEffect(()=>{if(active&&video.current){video.current.srcObject=stream.current;video.current.play().catch(()=>setError('Tap the camera preview to start it.'))}},[active,device,facing]);
 function stop(){stream.current?.getTracks().forEach(t=>t.stop());stream.current=null;setActive(false)}
 async function open(id?:string,nextFacing:FacingMode=facing){if(opening.current)return;opening.current=true;setError('');setBusy(true);stop();try{
  if(!navigator.mediaDevices?.getUserMedia)throw Error('Camera unavailable. Open this page with HTTPS and allow camera access.');
  const media=await navigator.mediaDevices.getUserMedia({video:{...(id?{deviceId:{exact:id}}:{facingMode:{ideal:nextFacing}}),width:{ideal:3840},height:{ideal:2160}},audio:false});
  if(!mounted.current){media.getTracks().forEach(t=>t.stop());return;}stream.current=media;
  const available=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='videoinput');
  const track=media.getVideoTracks()[0],settings=track.getSettings();
  setDevices(available);setDevice(settings.deviceId??'');setFacing((settings.facingMode as FacingMode|undefined)??nextFacing);setActive(true);
 }catch(e){setError((e as Error).message+' You can use the phone option or upload a photo.')}finally{opening.current=false;if(mounted.current)setBusy(false)}}
 async function rotateCamera(){const next:facingModePlaceholder='user';}
 async function process(fn:()=>Promise<DetectedFace[]>){if(busy||disabled)return;setBusy(true);setError('');try{const faces=await fn();if(!faces.length)throw Error('No faces detected. Attendance has not changed. Use an original, well-lit photo or capture one closer section of the class.');await onCapture(faces)}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
 return <div className="camera-capture">{error&&<div className="alert error" role="alert">{error}</div>}
 {active?<><div className="board-preview"><video ref={video} muted playsInline autoPlay onClick={()=>video.current?.play()}/><span className="camera-label">{phone?'Phone camera':'Smartboard camera'} · {facing==='environment'?'Back camera':'Front camera'} · Face the camera towards students</span></div><div className="actions camera-actions"><button className="primary" disabled={busy||disabled} onClick={()=>process(async()=>{if(!video.current?.videoWidth)throw Error('Wait for the camera preview.');const {detect}=await import('./vision');return detect(video.current,{group:true})})}><Camera size={20}/>{busy?'Processing…':'Take photo'}</button>{(phone||devices.length>1)&&<button disabled={busy||disabled} onClick={()=>{const next:facingModePlaceholder='user';}}><RefreshCw size={18}/>Rotate camera</button>}<button disabled={busy} onClick={stop}>Close camera</button></div>{devices.length>1&&<label>Choose classroom camera<select aria-label="Choose classroom camera" value={device} disabled={busy} onChange={e=>open(e.target.value)}>{devices.map((d,i)=><option key={d.deviceId} value={d.deviceId}>{d.label||`Camera ${i+1}`}</option>)}</select></label>}</>:<div className="board-camera-empty"><div className="camera-symbol"><Camera size={48}/></div><h2>{phone?'Capture your classroom':'Your classroom. One capture.'}</h2><p>{phone?'Use your rear camera. You can rotate to the front camera whenever needed. Take additional sections if needed.':'Open the smartboard camera, take a clear photo and see who is here.'}</p><button className="primary" disabled={busy} onClick={()=>open(undefined,phone?'environment':facing)}><Camera size={22}/>{busy?'Opening camera…':'Open camera'}</button></div>}
 <label className={`button upload-photo ${busy||disabled?'disabled':''}`}><Upload size={17}/>Upload classroom photo<input type="file" accept="image/*" capture={phone?'environment':undefined} multiple disabled={busy||disabled} onChange={async e=>{const files=Array.from(e.target.files??[]);e.target.value='';for(const f of files)await process(async()=>{const {imageFile}=await import('./vision');return imageFile(f,{group:true})})}}/></label>
 <p className="muted">For faces at the back, take closer photos of each section. Additional captures are combined without counting a student twice.</p></div>
}
