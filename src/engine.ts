/** Classroom scans use the ArcFace engine (SCRFD detector + ArcFace features) when the board's model is an ArcFace
 *  model; registration selfies always use the face-api path (the server checks those features). */
let arcEngine = false;
export function useArcEngine(on: boolean) { arcEngine = on; }
export const usingArcEngine = () => arcEngine;
