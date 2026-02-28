import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { computeAlignmentQuaternion, applyAlignmentQuaternion } from '../orientation.js';

test('computeAlignmentQuaternion maps bottom to -Y and front to +Z', () => {
  const bottom = new THREE.Vector3(0, 0, -1);
  const front = new THREE.Vector3(1, 1, 0).normalize();

  const rotation = computeAlignmentQuaternion(bottom, front);
  assert.ok(rotation, 'expected non-null rotation for non-parallel normals');

  const alignedBottom = bottom.clone().applyQuaternion(rotation);
  const alignedFront = front.clone().applyQuaternion(rotation);

  assert.ok(alignedBottom.distanceTo(new THREE.Vector3(0, -1, 0)) < 1e-6);
  assert.ok(alignedFront.distanceTo(new THREE.Vector3(0, 0, 1)) < 1e-6);
});

test('computeAlignmentQuaternion returns null for parallel bottom/front', () => {
  const bottom = new THREE.Vector3(0, -1, 0);
  const front = new THREE.Vector3(0, -1, 0);
  const rotation = computeAlignmentQuaternion(bottom, front);
  assert.equal(rotation, null);
});

test('applyAlignmentQuaternion updates world matrices immediately', () => {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshBasicMaterial();
  const baseMesh = new THREE.Mesh(geometry, material);
  const marksGroup = new THREE.Group();

  const mark = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), material);
  mark.position.set(1, 0, 0);
  marksGroup.add(mark);

  const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
  applyAlignmentQuaternion(baseMesh, marksGroup, rotation);

  const worldDirection = new THREE.Vector3(1, 0, 0).applyQuaternion(baseMesh.quaternion);
  assert.ok(worldDirection.distanceTo(new THREE.Vector3(0, 0, -1)) < 1e-6);

  const markWorld = mark.getWorldPosition(new THREE.Vector3());
  assert.ok(markWorld.distanceTo(new THREE.Vector3(0, 0, -1)) < 1e-6);
});
