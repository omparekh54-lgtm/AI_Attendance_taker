import {train} from './model';
import {trainIdentity, compactModel} from './identity';
import type {Model, Sample} from './model';
import type {Student} from './store';

type RosterStudent = Pick<Student, 'id' | 'faces' | 'classroom' | 'learned'>;

/** Recognition model for a roster. The identity-feature model is what the board uses; the pixel PCA/LDA
 *  baseline is added when the pixel samples are available (the teacher page), and skipped on the board. */
export function buildModel(students: RosterStudent[], signature: string, classroom: Sample[] = []): Model {
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
