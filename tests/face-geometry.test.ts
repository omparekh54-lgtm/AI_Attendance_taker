import {test} from 'node:test';import assert from 'node:assert/strict';import {isTightPortrait} from '../src/face-geometry';
const box={originX:6,originY:3,width:83,height:83};
test('Already cropped 96px portraits preserve their original framing',()=>assert.equal(isTightPortrait(96,96,1,box),true));
test('Classroom frames, multi-face captures and off-center faces always use individual crops',()=>{assert.equal(isTightPortrait(1920,1080,1,{originX:700,originY:200,width:500,height:500}),false);assert.equal(isTightPortrait(96,96,2,box),false);assert.equal(isTightPortrait(96,96,1,{originX:-60,originY:0,width:83,height:83}),false)});
test('Small distant faces and undersized input cannot bypass cropping checks',()=>{assert.equal(isTightPortrait(512,512,1,{originX:230,originY:230,width:50,height:50}),false);assert.equal(isTightPortrait(32,32,1,{originX:0,originY:0,width:32,height:32}),false)});

import {tileGrid,groupTileSizes} from '../src/face-geometry';
test('Group tiles cover a 4K frame with overlap',()=>{
 const sizes=groupTileSizes(3840,2160);assert.deepEqual(sizes,[1440,864]);
 for(const size of sizes){const tiles=tileGrid(3840,2160,size);
  assert.equal(Math.max(...tiles.map(t=>t.x+t.w)),3840);assert.equal(Math.max(...tiles.map(t=>t.y+t.h)),2160);assert.equal(Math.min(...tiles.map(t=>t.x)),0);
  const xs=[...new Set(tiles.map(t=>t.x))].sort((a,b)=>a-b);for(let i=1;i<xs.length;i++)assert.ok(xs[i]-xs[i-1]<size,'tiles overlap');}
});
test('Small photos are scanned whole only',()=>{assert.deepEqual(groupTileSizes(640,480),[]);assert.deepEqual(tileGrid(400,300,500),[{x:0,y:0,w:400,h:300}]);});
