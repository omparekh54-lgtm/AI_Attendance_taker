import {TURNED_FACE_YAW} from './face-geometry';

/** Side views needed in each direction at registration, so the student is recognised when turned in class. */
export const SIDE_SAMPLES_NEEDED = 2;
type Posed = {yaw?: number};

export function poseCounts(faces: Posed[]) {
  let left = 0, right = 0, straight = 0;
  for (const f of faces) {
    const yaw = f.yaw ?? 0;
    if (yaw >= TURNED_FACE_YAW) left++;
    else if (yaw <= -TURNED_FACE_YAW) right++;
    else straight++;
  }
  return {left, right, straight};
}
/** How many more side samples are still required. */
export function poseNeed(faces: Posed[]) {
  const c = poseCounts(faces);
  return Math.max(0, SIDE_SAMPLES_NEEDED - c.left) + Math.max(0, SIDE_SAMPLES_NEEDED - c.right);
}
/** Whether adding this sample brings the registration closer to having side views on both sides. */
export function fillsPoseNeed(faces: Posed[], face: Posed) {
  return poseNeed([...faces, face]) < poseNeed(faces);
}
