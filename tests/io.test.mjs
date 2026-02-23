import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { exportTo3MF } from 'three-3mf-exporter';

const STL_FIXTURE = new URL('../v1.9 - Circle Single - front foropenclaw.stl', import.meta.url);

test('imports STL fixture into BufferGeometry with vertices', () => {
  const input = fs.readFileSync(STL_FIXTURE);
  const geometry = new STLLoader().parse(input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength));

  assert.ok(geometry.isBufferGeometry, 'expected parsed STL to be a BufferGeometry');
  assert.ok(geometry.attributes.position.count > 0, 'expected STL to contain vertex positions');
});

test('exports mesh group as a 3MF blob', async () => {
  const input = fs.readFileSync(STL_FIXTURE);
  const geometry = new STLLoader().parse(input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength));
  geometry.center();
  geometry.computeVertexNormals();

  const baseMesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: '#9d9d9d' }));
  baseMesh.name = 'baseMesh';

  const markMesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 0.4),
    new THREE.MeshStandardMaterial({ color: '#ff5a5a' })
  );
  markMesh.name = 'markMesh';
  markMesh.position.set(0, 0, 1);

  const exportGroup = new THREE.Group();
  exportGroup.add(baseMesh, markMesh);

  const blob = await exportTo3MF(exportGroup, { compression: 'none' });
  const bytes = new Uint8Array(await blob.arrayBuffer());

  assert.equal(blob.type, 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml');
  assert.ok(bytes.length > 4, 'expected non-empty 3MF bytes');
  assert.equal(bytes[0], 0x50); // P
  assert.equal(bytes[1], 0x4b); // K
});
