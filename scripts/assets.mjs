import {mkdir,cp,access} from 'node:fs/promises';
await mkdir('public/wasm',{recursive:true});
await cp('node_modules/@mediapipe/tasks-vision/wasm','public/wasm',{recursive:true});
try {await access('public/models/face-detector.tflite')} catch { const response=await fetch('https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/latest/blaze_face_short_range.tflite');if(!response.ok)throw Error('Face model download failed');const {writeFile}=await import('node:fs/promises');await mkdir('public/models',{recursive:true});await writeFile('public/models/face-detector.tflite',Buffer.from(await response.arrayBuffer()));}
// Version-pinned recognition weights are shipped in the npm package, not fetched at runtime.
await mkdir('public/models/identity',{recursive:true});
for(const name of ['face_recognition_model','face_landmark_68_tiny_model','face_landmark_68_model'])for(const suffix of ['.bin','-weights_manifest.json'])await cp(`node_modules/@vladmandic/face-api/model/${name}${suffix}`,`public/models/identity/${name}${suffix}`);
// Group-photo face detector, used only for classroom captures.
await mkdir('public/models/detector',{recursive:true});
for(const suffix of ['.bin','-weights_manifest.json'])await cp(`node_modules/@vladmandic/face-api/model/ssd_mobilenetv1_model${suffix}`,`public/models/detector/ssd_mobilenetv1_model${suffix}`);
