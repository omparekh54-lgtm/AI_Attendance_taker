/** Avoid cropping an already tightly framed, square portrait a second time. */
export function isTightPortrait(width:number,height:number,count:number,box:{originX:number;originY:number;width:number;height:number}){
 const cx=(box.originX+box.width/2)/width,cy=(box.originY+box.height/2)/height;
 return count===1&&Math.min(width,height)>=64&&Math.max(width,height)<=512&&width/height>.9&&width/height<1.1&&box.width/width>=.65&&box.height/height>=.65&&cx>.25&&cx<.75&&cy>.25&&cy<.75;
}

/** Square tiles of `size` px overlapping by a quarter, covering the frame. */
export function tileGrid(w:number,h:number,size:number){
 const starts=(length:number)=>{if(length<=size)return [0];const n=Math.ceil((length-size)/(size*.75))+1;return Array.from({length:n},(_,i)=>Math.round(i*(length-size)/(n-1)))};
 return starts(w).flatMap(x=>starts(h).map(y=>({x,y,w:Math.min(size,w),h:Math.min(size,h)})));
}
/** Tile sizes so a back-row face is still large enough for the detector's 512 px input. */
export function groupTileSizes(w:number,h:number){
 const sizes:number[]=[],short=Math.min(w,h);
 for(const size of [Math.round(short/1.5),Math.round(short/2.5)])if(size>=480&&!sizes.includes(size))sizes.push(size);
 return sizes;
}
