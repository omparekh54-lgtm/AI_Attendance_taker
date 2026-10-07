import {mkdir,cp,access} from 'node:fs/promises';
await mkdir('public/wasm',{recursive:true});
await cp('node_modules/@mediapipe/tasks-vision/wasm','public/wasm',{recursive:true});
try {await access('public/models/face-detector.tflite')} catch { const response=await fetch('https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/latest/blaze_face_short_range.tflite');if(!response.ok)throw Error('Face model download failed');const {writeFile}=await import('node:fs/promises');await mkdir('public/models',{recursive:true});await writeFile('public/models/face-detector.tflite',Buffer.from(await response.arrayBuffer()));}
