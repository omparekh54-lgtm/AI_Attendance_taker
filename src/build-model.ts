import {train} from './model';
import {trainIdentity, compactModel} from './identity';
import type {Sample} from './model';
import type {Model} from './model';
import type {Student} from './store';

/** Full recognition model for a roster: pixel PCA/LDA baseline plus the identity-feature model the board requires.
 *  `classroom` adds class-style gallery entries (students as they look small and far away). */
export function buildModel(students: Pick<Student, 'id' | 'faces'>[], signature: string, classroom: Sample[] = []): Model {
  const missing = students.filter(s => s.faces.some(f => !f.embedding)).map(s => s.id);
  if (missing.length) throw Error(`Face features are missing for ${missing.length} student${missing.length === 1 ? '' : 's'}. Rebuild from Manage batch.`);
  const samples = students.flatMap(s => s.faces.map(f => ({label: s.id, vector: f.vector})));
  const identitySamples = students.flatMap(s => s.faces.map(f => ({label: s.id, vector: f.embedding!})));
  return compactModel({...train(samples), identity: trainIdentity(identitySamples, classroom), rosterSignature: signature});
}
