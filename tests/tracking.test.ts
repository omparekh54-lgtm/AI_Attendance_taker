import {test} from 'node:test';import assert from 'node:assert/strict';
import {linkFrame,beginTracking,stitchTracks,type Track} from '../src/tracking';
import {sampleTimes,meanEmbedding} from '../src/classroom-video';
let seed=7;const rnd=()=>{seed=(seed*16807)%2147483647;return seed/2147483647};
// 60 students in a 4000 px wide room; the camera sees 1920 px and pans `pan` px per frame.
const withNoise=(v:number[])=>{const w=v.map(x=>x+(rnd()-.5)*1.2);const m=w.reduce((a,b)=>a+b)/w.length,sd=Math.sqrt(w.reduce((a,b)=>a+(b-m)**2,0)/w.length);return w.map(x=>(x-m)/sd)};
function simulate(pan:number,frames:number,noise=3){
 const sigOf=()=>{const v=Array.from({length:144},()=>rnd()-.5);const m=v.reduce((a,b)=>a+b)/144,sd=Math.sqrt(v.reduce((a,b)=>a+(b-m)**2,0)/144);return v.map(x=>(x-m)/sd)};
 const people=Array.from({length:60},(_,id)=>({id,sig:sigOf(),x:100+(id%12)*320+rnd()*60,y:150+Math.floor(id/12)*180+rnd()*40,size:35+(4-Math.floor(id/12))*12}));
 const tracks:Track<number>[]=beginTracking<number>([]);
 for(let f=0;f<frames;f++){const left=f*pan;
  const pts=people.filter(p=>p.x>left+20&&p.x<left+1900).map(p=>({cx:p.x-left+(rnd()-.5)*2*noise,cy:p.y+(rnd()-.5)*2*noise,size:p.size*(1+(rnd()-.5)*.1),sig:withNoise(p.sig),sample:p.id}));
  linkFrame(tracks,f,pts);}
 return stitchTracks(tracks);
}
for(const pan of [0,40,120,200,300]) test(`Panning ${pan}px per frame: every track is one person and nobody is split`,()=>{
 const tracks=simulate(pan,12);
 for(const t of tracks)assert.equal(new Set(t.samples).size,1,'a track mixed two people');
 const perPerson=new Map<number,number>();for(const t of tracks)perPerson.set(t.samples[0],(perPerson.get(t.samples[0])??0)+1);
 assert.ok([...perPerson.values()].every(n=>n===1),'a person was split into several tracks');
});
test('A face missing for a frame or two rejoins its track',()=>{const tracks:Track<string>[]=[];
 linkFrame(tracks,0,[{cx:100,cy:100,size:50,sample:'a'},{cx:400,cy:100,size:50,sample:'b'}]);
 linkFrame(tracks,1,[{cx:400,cy:100,size:50,sample:'b'}]);
 linkFrame(tracks,3,[{cx:102,cy:101,size:50,sample:'a'},{cx:401,cy:100,size:50,sample:'b'}]);
 assert.equal(tracks.length,2);assert.deepEqual(tracks.map(t=>t.samples.join('')).sort(),['aa','bbb'])});
test('Video sampling: about one frame per second, capped',()=>{assert.equal(sampleTimes(10).length,10);assert.equal(sampleTimes(300).length,40);assert.ok(sampleTimes(300).every(t=>t<60));assert.equal(sampleTimes(0.4).length,1)});
test('Averaged features keep the typical length',()=>{const m=meanEmbedding([[3,4],[4,3]]);assert.ok(Math.abs(Math.hypot(...m)-5)<1e-9)});
test('A fragment that restarts where the pan predicts is stitched back to its person',()=>{const tracks=beginTracking<string>([]);
 linkFrame(tracks,0,[{cx:900,cy:300,size:50,sample:'a'},{cx:300,cy:300,size:50,sample:'x'},{cx:600,cy:500,size:50,sample:'y'}]);
 linkFrame(tracks,1,[{cx:800,cy:300,size:50,sample:'a'},{cx:200,cy:300,size:50,sample:'x'},{cx:500,cy:500,size:50,sample:'y'}]);
 // 'a' is missed for two frames, then reappears 100 px further left per frame.
 linkFrame(tracks,2,[{cx:100,cy:300,size:50,sample:'x'},{cx:400,cy:500,size:50,sample:'y'}]);
 linkFrame(tracks,3,[{cx:0,cy:300,size:50,sample:'x'},{cx:300,cy:500,size:50,sample:'y'}]);
 linkFrame(tracks,4,[{cx:500,cy:300,size:50,sample:'a'},{cx:200,cy:500,size:50,sample:'y'}]);
 const out=stitchTracks(tracks);const a=out.filter(t=>t.samples.includes('a'));assert.equal(a.length,1);assert.equal(a[0].samples.length,3);assert.ok(out.every(t=>new Set(t.samples).size===1))});
