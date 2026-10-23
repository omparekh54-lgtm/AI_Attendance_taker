import test from 'node:test';
import assert from 'node:assert/strict';
import {poseCounts, poseNeed, fillsPoseNeed} from '../src/pose';

test('registration counts side views on both sides', () => {
  const faces = [{yaw: 0}, {yaw: 0.1}, {yaw: 0.45}, {yaw: -0.5}, {}];
  assert.deepEqual(poseCounts(faces), {left: 1, right: 1, straight: 3});
  assert.equal(poseNeed(faces), 2);
  assert.equal(fillsPoseNeed(faces, {yaw: 0.6}), true);
  assert.equal(fillsPoseNeed(faces, {yaw: 0.05}), false);
  assert.equal(poseNeed([...faces, {yaw: 0.4}, {yaw: -0.4}]), 0);
});
