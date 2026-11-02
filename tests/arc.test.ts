import {test} from 'node:test';
import assert from 'node:assert/strict';
import {hungarian, assignStudents, trainArc, predictArc, ARC, ARC_SAME_PERSON} from '../src/arc-identity';
import {packFeature, unpackFeature, isPackedFeature, similarity, ARC_TEMPLATE, nms} from '../src/arcface';
import {recognizeCapture} from '../src/attendance';
import {buildModel} from '../src/build-model';
import {headCount} from '../src/head-count';

// Synthetic ArcFace-like features: each person has a direction; samples are that direction plus noise, unit length.
function rng(seed: number) { return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32 - 0.5; }; }
const unit = (v: number[]) => { const n = Math.hypot(...v); return v.map(x => x / n); };
const person = (p: number) => { const r = rng(1000 + p); return unit(Array.from({length: 512}, r)); };
const sample = (p: number, s: number, noise = 0.9) => { const r = rng(p * 97 + s * 13 + 7), base = person(p); return unit(base.map(x => x + noise * r() / Math.sqrt(512 / 12))); };
const students = [0, 1, 2, 3].map(p => ({id: 'S' + p, arc: Array.from({length: 12}, (_, s) => sample(p, s))}));
const cos = (a: number[], b: number[]) => a.reduce((n, v, i) => n + v * b[i], 0);

test('Synthetic features behave like the real ones (same person ~0.6, different ~0)', () => {
  assert.ok(cos(sample(0, 1), sample(0, 2)) > 0.4);
  assert.ok(Math.abs(cos(sample(0, 1), sample(1, 1))) < 0.15);
});

test('Hungarian assignment finds the cheapest one-to-one matching', () => {
  assert.deepEqual(hungarian([[4, 1, 3], [2, 0, 5], [3, 2, 2]]), [1, 0, 2]);
  assert.deepEqual(hungarian([[1, 2], [1, 3], [5, 0]]).filter(j => j >= 0).length, 2);
  assert.deepEqual(hungarian([[0.1], [0.2]]), [0, -1]);
});

test('Registered students are marked; a stranger is not given a name', () => {
  const m = trainArc(students);
  for (const p of [0, 1, 2, 3]) { const r = predictArc(m, sample(p, 50)); assert.equal(r.label, 'S' + p); assert.equal(r.accepted, true); }
  const stranger = predictArc(m, sample(9, 1));
  assert.equal(stranger.accepted, false); assert.equal(stranger.suggested, false); assert.equal(stranger.guessable, false);
});

test('Each student bar stays within the floor and ceiling', () => {
  const m = trainArc(students);
  for (const v of Object.values(m.accept)) assert.ok(v >= ARC.floor && v <= ARC.ceiling);
});

test('Tiny faces are offered for one-tap confirmation, never marked on their own', () => {
  const m = trainArc(students), r = predictArc(m, sample(1, 50), [], ARC.autoMarkMinPx - 1);
  assert.equal(r.accepted, false); assert.equal(r.suggested, true);
});

test('A face like someone marked "Not a student" is left unknown', () => {
  const m = trainArc(students), face = sample(2, 50);
  assert.equal(predictArc(m, face, [face]).stranger, true);
});

test('Two faces claiming one student: only the better one keeps them', () => {
  const m = trainArc(students), good = predictArc(m, sample(0, 51)), weaker = predictArc(m, unit(sample(0, 52).map((v, i) => v + 0.9 * sample(3, 1)[i])));
  const [a, b] = assignStudents([weaker, good]);
  assert.equal(b, 'S0'); assert.notEqual(a, 'S0');
});

test('recognizeCapture uses the ArcFace engine and never gives one student two faces in a photo', () => {
  const roster = students.map(s => ({...s, faces: [], arc: s.arc.map(packFeature)}));
  const model = buildModel(roster, 'sig');
  assert.ok(model.arc);
  const face = (e: number[]) => ({face: {image: '', vector: [], embedding: e}, usable: true, box: {x: 0, y: 0, w: 0.1, h: 0.1}, sourceWidth: 1000, sourceHeight: 1000});
  const out = recognizeCapture(model, [face(sample(0, 60)), face(sample(0, 61)), face(sample(2, 60)), face(sample(8, 1))]);
  assert.equal(out.filter(o => o.studentId === 'S0').length, 1);
  assert.equal(out[2].studentId, 'S2');
  assert.equal(out[3].studentId, undefined); assert.equal(out[3].suggestion, undefined);
});

test('Head count joins the same person across photos with ArcFace features', () => {
  const o = (e: number[], capture: number) => ({id: String(Math.random()), image: '', embedding: e, capture});
  const c = headCount([o(sample(7, 1), 1), o(sample(7, 2), 2), o(sample(8, 1), 2)], new Set());
  assert.equal(c.total, 2);
  assert.ok(ARC_SAME_PERSON > 0.2 && ARC_SAME_PERSON < 0.5);
});

test('Packed features round-trip and validate', () => {
  const v = sample(3, 3), p = packFeature(v);
  assert.ok(isPackedFeature(p)); assert.ok(p.length < 700);
  assert.ok(cos(v, unpackFeature(p)) > 0.9999);
  assert.equal(isPackedFeature('1:abc'), false);
});

test('Alignment maps the template onto itself and handles rotation', () => {
  const [a, b, tx, ty] = similarity(ARC_TEMPLATE, ARC_TEMPLATE);
  assert.ok(Math.abs(a - 1) < 1e-9 && Math.abs(b) < 1e-9 && Math.abs(tx) < 1e-6 && Math.abs(ty) < 1e-6);
  const rotated = ARC_TEMPLATE.map(([x, y]) => [-y * 2 + 10, x * 2 + 5] as [number, number]), [a2, b2] = similarity(rotated, ARC_TEMPLATE);
  assert.ok(Math.abs(Math.hypot(a2, b2) - 0.5) < 1e-6);
});

test('Overlapping detections are merged', () => {
  const box = (x: number, score: number) => ({x, y: 0, w: 10, h: 10, score, kps: []});
  assert.equal(nms([box(0, 0.9), box(1, 0.8), box(30, 0.7)], 0.4).length, 2);
});
