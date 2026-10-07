export type RuntimeConfig={framework:string;storage:string;recognition:string;minimumSamples:number;recommendedSamples:number;maximumSamples:number;minimumObservations:number;maximumVideoSeconds:number};
const defaults:RuntimeConfig={framework:'Development',storage:'browser-indexeddb',recognition:'browser-pca-lda',minimumSamples:5,recommendedSamples:20,maximumSamples:30,minimumObservations:2,maximumVideoSeconds:60};
function read(){const el=document.getElementById('eigenroll-config');if(!el)return defaults;try{return {...defaults,...JSON.parse(el.textContent??'{}')} as RuntimeConfig;}catch{return defaults;}}
export const config=read();
