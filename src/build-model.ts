import {train} from './model';
import {trainIdentity, compactModel} from './identity';
import {trainArc} from './arc-identity';
import {unpackFeature} from './arcface';
import type {Model, Sample} from './model';
import type {Student} from './store';

type RosterStudent = Pick<Student, 'id' | 'faces' | 'classroom' | 'learned' | 'arc' | 'arcLearned'>;

/** A student whose ArcFace gallery is ready (built at registration, or on the board/teacher page afterwards). */
export const hasArc = (s: Pick<Student, 'arc'>) => (s.arc?.length ?? 0) >= 5;
/** Every student has ArcFace features. */
export const allHaveArc = (students: Pick<Student, 'arc'>[]) => students.length >= 2 && students.every(hasArc);
/** The ArcFace engine is used as soon as two students have ArcFace features. A student without them (a registration
 *  whose phone could not prepare them) is left out until the board prepares them, instead of switching the whole
 *  class back to the older, much weaker engine. */
export const useArcEngineFor = (students: Pick<Student, 'arc'>[]) => students.filter(hasArc).length >= 2;

/** Recognition model for a roster. With ArcFace features for everyone, the ArcFace engine (with PCA/LDA on top);
 *  otherwise the older face-api identity model. The pixel PCA/LDA baseline is added when the pixel samples are
 *  available (the teacher page), and skipped on the board. */
export function buildModel(students: RosterStudent[], signature: string, classroom: Sample[] = []): Model {
  if (useArcEngineFor(students)) {
    const arc = trainArc(students.filter(hasArc).map(s => ({id: s.id, arc: s.arc!.map(unpackFeature), learned: (s.arcLearned ?? []).map(unpackFeature)})));
    return compactModel({mean: [], pca: [], lda: [], templates: [], limits: {}, version: 'arcface', dimensions: 512, trainedAt: new Date().toISOString(), arc, rosterSignature: signature});
  }
  const missing = students.filter(s => !s.faces.length || s.faces.some(f => !f.embedding)).map(s => s.id);
  if (missing.length) throw Error(`Face features are missing for ${missing.length} student${missing.length === 1 ? '' : 's'}. Ask them to register again.`);
  const identitySamples = students.flatMap(s => s.faces.map(f => ({label: s.id, vector: f.embedding!})));
  const classStyle = [...classroom, ...students.flatMap(s => [...(s.classroom ?? []), ...(s.learned ?? [])].map(vector => ({label: s.id, vector})))];
  const identity = trainIdentity(identitySamples, classStyle);
  const pixels = students.every(s => s.faces.every(f => f.vector.length === 576));
  const base: Omit<Model, 'identity' | 'rosterSignature'> = pixels
    ? train(students.flatMap(s => s.faces.map(f => ({label: s.id, vector: f.vector}))))
    : {mean: [], pca: [], lda: [], templates: [], limits: {}, version: 'identity-only', dimensions: 128, trainedAt: new Date().toISOString()};
  return compactModel({...base, identity, rosterSignature: signature});
}
