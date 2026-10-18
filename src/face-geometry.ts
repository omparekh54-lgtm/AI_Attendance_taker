/** Avoid cropping an already tightly framed, square portrait a second time. */
export function isTightPortrait(width:number,height:number,count:number,box:{originX:number;originY:number;width:number;height:number}){
 const cx=(box.originX+box.width/2)/width,cy=(box.originY+box.height/2)/height;
 return count===1&&Math.min(width,height)>=64&&Math.max(width,height)<=512&&width/height>.9&&width/height<1.1&&box.width/width>=.65&&box.height/height>=.65&&cx>.25&&cx<.75&&cy>.25&&cy<.75;
}
