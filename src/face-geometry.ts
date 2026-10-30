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
/** Tile sizes so a back-row face is still large enough for the detector's 512 px input.
 *  `lowRes`: a low-resolution class photo (a WhatsApp copy, a screenshot, a 1–2 MP camera). Its faces are often only
 *  16–30 px, so it also gets half- and third-height tiles that the detector enlarges 1.6–2×. Video frames keep the usual scan (speed). */
export function groupTileSizes(w:number,h:number,lowRes=false){
 const sizes:number[]=[],short=Math.min(w,h);
 // A third, finer scale for phone photos (12 MP+), so 35–45 px back-row faces are big enough for the detector.
 for(const size of [Math.round(short/1.5),Math.round(short/2.5),...(short>=2400?[Math.round(short/4)]:[])])if(size>=480&&!sizes.includes(size))sizes.push(size);
 if(lowRes&&short<LOW_RES_SHORT_SIDE)for(const size of [Math.round(short/2),Math.round(short/3)])if(size>=MIN_LOW_RES_TILE&&!sizes.includes(size))sizes.push(size);
 return sizes;
}
/** Photos whose shorter side is below this get the extra small tiles; smallest such tile (px). */
export const LOW_RES_SHORT_SIDE=1600, MIN_LOW_RES_TILE=240;

/** Face-box sizes (px, as drawn by the detector) for classroom scans. Measured on the 26 real students' unseen photos:
 *  recognition stays 89–97% down to ~22 px boxes with no wrong students, but 1 of 416 unregistered look-alike tests
 *  below 32 px was matched to someone. So small faces are recognised but only ever suggested for the teacher to confirm. */
export const MIN_RECOGNISABLE_FACE_PX = 22;
export const AUTO_MARK_MIN_FACE_PX = 32;
type Box = {originX: number; originY: number; width: number; height: number};
/** Keep one box per face: drop a lower-scoring box that mostly overlaps a kept one or has its centre inside it. */
export function dedupeBoxes<T extends {score: number; box: Box}>(items: T[]): T[] {
  const kept: T[] = [];
  for (const item of [...items].sort((a, b) => b.score - a.score)) {
    const a = item.box;
    const duplicate = kept.some(({box: b}) => {
      const ix = Math.max(0, Math.min(a.originX + a.width, b.originX + b.width) - Math.max(a.originX, b.originX)),
        iy = Math.max(0, Math.min(a.originY + a.height, b.originY + b.height) - Math.max(a.originY, b.originY));
      const overlap = ix * iy / Math.min(a.width * a.height, b.width * b.height);
      const inside = (p: Box, q: Box) => { const cx = p.originX + p.width / 2, cy = p.originY + p.height / 2; return cx > q.originX && cx < q.originX + q.width && cy > q.originY && cy < q.originY + q.height; };
      return overlap > 0.4 || inside(a, b) || inside(b, a);
    });
    if (!duplicate) kept.push(item);
  }
  return kept;
}

/** Head turn from 68 face landmarks: nose tip offset from the eye midpoint, in eye-distance units.
 *  About 0 facing the camera, ±0.3 clearly turned, ±0.6 or more a side view. Sign = direction in the image. */
export function yawFromLandmarks(points: {x: number; y: number}[]) {
  if (points.length < 68) return 0;
  const mean = (from: number, to: number) => {
    const p = points.slice(from, to);
    return {x: p.reduce((n, q) => n + q.x, 0) / p.length, y: p.reduce((n, q) => n + q.y, 0) / p.length};
  };
  const left = mean(36, 42), right = mean(42, 48), eyes = Math.hypot(right.x - left.x, right.y - left.y);
  if (!eyes) return 0;
  return (points[30].x - (left.x + right.x) / 2) / eyes;
}
/** Faces turned at least this much are only suggested for the teacher to confirm, never marked automatically.
 *  On the 26 students' photos this removed every wrong mark in the look-alike test (2/131 → 0/131). */
export const TURNED_FACE_YAW = 0.3;
