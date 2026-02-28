import * as THREE from 'three';

export function computeAlignmentQuaternion(bottomNormal, frontNormal) {
  const down = bottomNormal.clone().normalize();
  const up = down.clone().negate();

  const frontProjected = frontNormal.clone().sub(down.clone().multiplyScalar(frontNormal.dot(down)));
  if (frontProjected.lengthSq() < 1e-8) return null;

  const front = frontProjected.normalize();
  const right = new THREE.Vector3().crossVectors(up, front).normalize();
  const sourceBasis = new THREE.Matrix4().makeBasis(right, up, front);
  return new THREE.Quaternion().setFromRotationMatrix(sourceBasis).invert();
}

export function applyAlignmentQuaternion(baseMesh, marksGroup, rotation) {
  baseMesh.applyQuaternion(rotation);
  marksGroup.applyQuaternion(rotation);

  // Ensure raycasting / picking always sees current transforms immediately.
  baseMesh.updateMatrixWorld(true);
  marksGroup.updateMatrixWorld(true);
}
