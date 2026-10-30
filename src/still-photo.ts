/** Full-resolution still photo from the camera (ImageCapture.takePhoto, Chrome/Android and others), or undefined when
 *  unsupported, slower than 6 s, or not larger than the live video frame. */
export async function fullResolutionStill(stream: MediaStream | null, frameWidth: number, frameHeight: number): Promise<HTMLImageElement | undefined> {
  const track = stream?.getVideoTracks()[0];
  const Capture = (globalThis as {ImageCapture?: new (t: MediaStreamTrack) => {takePhoto: () => Promise<Blob>}}).ImageCapture;
  if (!track || !Capture) return undefined;
  try {
    const blob = await Promise.race([new Capture(track).takePhoto(), new Promise<never>((_, reject) => setTimeout(() => reject(Error('timeout')), 6000))]);
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image(); img.src = url; await img.decode();
      return img.naturalWidth * img.naturalHeight > frameWidth * frameHeight ? img : undefined;
    } finally { URL.revokeObjectURL(url); }
  } catch { return undefined; }
}
