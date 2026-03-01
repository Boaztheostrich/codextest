import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';
import { computeAlignmentQuaternion, applyAlignmentQuaternion } from './orientation.js';

const EXTRUSION_DEPTH_MM = 0.4;
const MARK_VISUAL_LIFT_MM = 0.06;
const PALETTE = ['#ff5a5a', '#4ecdc4', '#ffe66d', '#9f7aea'];
const AXIS_LOCK_SWITCH_FACTOR_DEFAULT = 1.6;

const els = {
  canvas: document.getElementById('viewport'),
  stlInput: document.getElementById('stlInput'),
  pickFaceBtn: document.getElementById('pickFaceBtn'),
  autoFaceBtn: document.getElementById('autoFaceBtn'),
  pickBottomBtn: document.getElementById('pickBottomBtn'),
  pickFrontBtn: document.getElementById('pickFrontBtn'),
  drawBtn: document.getElementById('drawBtn'),
  textBtn: document.getElementById('textBtn'),
  textInput: document.getElementById('textInput'),
  brushSize: document.getElementById('brushSize'),
  brushSizeNumber: document.getElementById('brushSizeNumber'),
  planeSize: document.getElementById('planeSize'),
  mirrorX: document.getElementById('mirrorX'),
  mirrorY: document.getElementById('mirrorY'),
  showMirrorX: document.getElementById('showMirrorX'),
  showMirrorY: document.getElementById('showMirrorY'),
  centerText: document.getElementById('centerText'),
  lockStrokeAxis: document.getElementById('lockStrokeAxis'),
  axisLockSensitivity: document.getElementById('axisLockSensitivity'),
  lockRotation: document.getElementById('lockRotation'),
  showFacePlane: document.getElementById('showFacePlane'),
  showFrontPlane: document.getElementById('showFrontPlane'),
  showGrid: document.getElementById('showGrid'),
  showDebug: document.getElementById('showDebug'),
  copyLogsBtn: document.getElementById('copyLogsBtn'),
  clearLogsBtn: document.getElementById('clearLogsBtn'),
  exportBtn: document.getElementById('exportBtn'),
  undoBtn: document.getElementById('undoBtn'),
  redoBtn: document.getElementById('redoBtn'),
  clearMarksBtn: document.getElementById('clearMarksBtn'),
  palette: document.getElementById('palette'),
  viewCube: document.getElementById('viewCube'),
  status: document.getElementById('status'),
  debug: document.getElementById('debug')
};

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1a1a);
const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 2000);
camera.position.set(90, 90, 90);

const renderer = new THREE.WebGLRenderer({ canvas: els.canvas, antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

scene.add(new THREE.HemisphereLight(0xffffff, 0x333344, 0.95));
const dir = new THREE.DirectionalLight(0xffffff, 0.8);
dir.position.set(200, 220, 120);
scene.add(dir);
const gridHelper = new THREE.GridHelper(200, 20, 0x333333, 0x222222);
scene.add(gridHelper);

let activeColor = PALETTE[0];
let mode = 'idle';
let isDrawing = false;
let baseMesh = null;
const baseBoundsCenter = new THREE.Vector3();
let baseMaxDimension = 80;
const marksGroup = new THREE.Group();
marksGroup.name = 'markMeshes';
scene.add(marksGroup);
const dotMarkRecords = [];

const pickPoints = [];
let pickMarkers = [];
let activePickKind = 'face';

let facePlane = null;
let faceNormal = new THREE.Vector3(0, 0, 1);
let insetNormal = new THREE.Vector3(0, 0, -1);
let faceOrigin = new THREE.Vector3();
let faceXAxis = new THREE.Vector3(1, 0, 0);
let faceYAxis = new THREE.Vector3(0, 1, 0);
let faceHelperSize = 0;
let faceHelper = null;
let mirrorXHelper = null;
let mirrorYHelper = null;
let desiredPlaneSize = Number(els.planeSize?.value || 120);

let bottomRef = null;
let frontRef = null;
let bottomHelper = null;
let frontHelper = null;

const undoStack = [];
const redoStack = [];
let currentStroke = null;
let strokeStartPoint = null;
let activeStrokeAxis = null;
let pendingDrawEvent = null;

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const stlLoader = new STLLoader();
const fontLoader = new FontLoader();
let loadedFont = null;

let exportTo3MFFn = null;
async function get3MFExportFn() {
  if (exportTo3MFFn) return exportTo3MFFn;

  const candidates = [
    'https://cdn.jsdelivr.net/npm/three-3mf-exporter@45.0.0/+esm',
    'https://esm.sh/three-3mf-exporter@45.0.0'
  ];

  for (const url of candidates) {
    try {
      const mod = await import(url);
      if (mod?.exportTo3MF) {
        exportTo3MFFn = mod.exportTo3MF;
        debugLog('3mf exporter module loaded', { url });
        return exportTo3MFFn;
      }
    } catch (err) {
      debugLog('3mf exporter candidate failed', { url, error: String(err) });
    }
  }

  throw new Error('3MF export module is unavailable from configured CDNs.');
}

fontLoader.load(
  'https://unpkg.com/three@0.162.0/examples/fonts/helvetiker_regular.typeface.json',
  (font) => {
    loadedFont = font;
    debugLog('font loaded');
  },
  undefined,
  (err) => debugLog('font failed to load', { error: String(err) })
);

PALETTE.forEach((color, i) => {
  const b = document.createElement('button');
  b.className = `swatch ${i === 0 ? 'active' : ''}`;
  b.style.background = color;
  b.title = color;
  b.addEventListener('click', () => {
    activeColor = color;
    [...els.palette.children].forEach((sw) => sw.classList.remove('active'));
    b.classList.add('active');
  });
  els.palette.appendChild(b);
});

function setStatus(msg) {
  els.status.textContent = msg;
  debugLog(`status: ${msg}`);
}

const debugLines = [];
function debugLog(message, details) {
  const stamp = new Date().toISOString().slice(11, 19);
  const suffix = details ? ` | ${JSON.stringify(details)}` : '';
  const line = `[${stamp}] ${message}${suffix}`;
  debugLines.push(line);
  if (debugLines.length > 600) debugLines.shift();
  if (els.debug) els.debug.textContent = debugLines.join('\n');
  console.debug('[STL Face Painter]', message, details || '');
}

function clearDebugLog() {
  debugLines.length = 0;
  if (els.debug) els.debug.textContent = '';
}

function updateActionButtons() {
  const readyToMark = !!baseMesh && !!facePlane;
  const readyToRef = !!baseMesh;
  if (els.autoFaceBtn) els.autoFaceBtn.disabled = !baseMesh;
  els.drawBtn.disabled = !readyToMark;
  els.textBtn.disabled = !readyToMark;
  els.pickBottomBtn.disabled = !readyToRef;
  els.pickFrontBtn.disabled = !readyToRef;
  els.undoBtn.disabled = undoStack.length === 0;
  els.redoBtn.disabled = redoStack.length === 0;
  els.clearMarksBtn.disabled = marksGroup.children.length === 0 && dotMarkRecords.length === 0;
}

function setMode(next) {
  mode = next;
  updateActionButtons();
  if (next === 'pickFace') setStatus('Click 3 points on the STL surface to define drawing plane.');
  if (next === 'pickBottom') setStatus('Click 3 points to define the bottom reference plane.');
  if (next === 'pickFront') setStatus('Click 3 points to define the front reference plane.');
  if (next === 'draw') setStatus('Drag on the selected plane to create 0.4mm inset marks.');
  if (next === 'text') setStatus('Click on the selected plane to place text.');
}

function removeMeshFromScene(mesh) {
  if (!mesh) return;
  mesh.parent?.remove(mesh);
  mesh.geometry?.dispose?.();
  mesh.material?.dispose?.();
}

function detachMeshFromScene(mesh) {
  if (!mesh) return;
  mesh.parent?.remove(mesh);
}

function clearPickMarkers() {
  pickPoints.length = 0;
  pickMarkers.forEach((m) => removeMeshFromScene(m));
  pickMarkers = [];
}

function clearFaceSelection() {
  clearPickMarkers();
  removeMeshFromScene(faceHelper);
  removeMeshFromScene(mirrorXHelper);
  removeMeshFromScene(mirrorYHelper);
  faceHelper = null;
  mirrorXHelper = null;
  mirrorYHelper = null;
  facePlane = null;
  faceHelperSize = 0;
  updateActionButtons();
}

function clearOrientationHelpers() {
  removeMeshFromScene(bottomHelper);
  removeMeshFromScene(frontHelper);
  bottomHelper = null;
  frontHelper = null;
}

function getFaceHelperSize() {
  return THREE.MathUtils.clamp(Math.max(baseMaxDimension * 0.75, desiredPlaneSize), 16, 400);
}

function logMeshTransform(label, mesh) {
  if (!mesh) return;
  const pos = mesh.position.toArray().map((v) => Number(v.toFixed(3)));
  const rot = mesh.rotation.toArray().slice(0, 3).map((v) => Number(v.toFixed(5)));
  const quat = mesh.quaternion.toArray().map((v) => Number(v.toFixed(5)));
  debugLog(`${label} transform`, { position: pos, rotation: rot, quaternion: quat });
}

function resetStrokeState() {
  currentStroke = null;
  strokeStartPoint = null;
  activeStrokeAxis = null;
  undoStack.length = 0;
  redoStack.length = 0;
}

function fitCameraToBounds(bounds) {
  const center = bounds.getCenter(new THREE.Vector3());
  const sizeVec = bounds.getSize(new THREE.Vector3());
  const maxDim = Math.max(sizeVec.x, sizeVec.y, sizeVec.z, 1);

  camera.near = Math.max(maxDim / 2000, 0.01);
  camera.far = Math.max(maxDim * 20, 4000);
  camera.updateProjectionMatrix();

  controls.target.copy(center);
  camera.position.copy(center).add(new THREE.Vector3(maxDim * 1.2, maxDim * 0.95, maxDim * 1.2));
  controls.maxDistance = maxDim * 15;
  controls.update();

  debugLog('camera fitted to mesh bounds', {
    maxDim: Number(maxDim.toFixed(3)),
    near: Number(camera.near.toFixed(4)),
    far: Number(camera.far.toFixed(2))
  });
}

function clearAllMarks() {
  dotMarkRecords.length = 0;
  while (marksGroup.children.length) {
    const mesh = marksGroup.children[0];
    removeMeshFromScene(mesh);
  }
  resetStrokeState();
  updateActionButtons();
}

function setBaseMesh(geometry) {
  if (baseMesh) {
    removeMeshFromScene(baseMesh);
  }

  geometry.center();
  geometry.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color: 0x9d9d9d, roughness: 0.8, metalness: 0.05, side: THREE.DoubleSide });
  baseMesh = new THREE.Mesh(geometry, mat);
  baseMesh.name = 'baseMesh';
  scene.add(baseMesh);

  const bounds = new THREE.Box3().setFromObject(baseMesh);
  bounds.getCenter(baseBoundsCenter);
  const sizeVec = bounds.getSize(new THREE.Vector3());
  baseMaxDimension = Math.max(sizeVec.x, sizeVec.y, sizeVec.z, 1);

  fitCameraToBounds(bounds);
  debugLog('base mesh loaded', {
    vertices: geometry.attributes.position?.count || 0,
    size: [Number(sizeVec.x.toFixed(3)), Number(sizeVec.y.toFixed(3)), Number(sizeVec.z.toFixed(3))]
  });

  clearFaceSelection();
  clearOrientationHelpers();
  bottomRef = null;
  frontRef = null;
  clearAllMarks();

  els.exportBtn.disabled = false;
  setMode('pickFace');
  if (els.autoFaceBtn) els.autoFaceBtn.disabled = false;
  autoSelectLargestFlatSurface();
}

function drawReferenceHelper(origin, normal, color, xAxis, yAxis) {
  const helperSize = getFaceHelperSize();
  const helperGeom = new THREE.PlaneGeometry(helperSize, helperSize);
  const helperMat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.14 });
  const helper = new THREE.Mesh(helperGeom, helperMat);
  helper.position.copy(origin);

  if (xAxis && yAxis) {
    const frame = new THREE.Matrix4().makeBasis(
      xAxis.clone().normalize(),
      yAxis.clone().normalize(),
      normal.clone().normalize()
    );
    helper.quaternion.setFromRotationMatrix(frame);
  } else {
    helper.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
  }

  scene.add(helper);
  return helper;
}

function updateFaceHelperVisibility() {
  if (faceHelper) faceHelper.visible = !!els.showFacePlane?.checked;
}

function updateFrontHelperVisibility() {
  if (frontHelper) frontHelper.visible = !!els.showFrontPlane?.checked;
}

function updateMirrorHelperVisibility() {
  if (mirrorXHelper) mirrorXHelper.visible = !!els.showMirrorX?.checked;
  if (mirrorYHelper) mirrorYHelper.visible = !!els.showMirrorY?.checked;
}

function getMirrorPoints() {
  if (!faceOrigin || !faceXAxis || !faceYAxis || !faceHelperSize) return null;
  const half = faceHelperSize * 0.5;
  return {
    xStart: faceOrigin.clone().add(faceYAxis.clone().multiplyScalar(-half)),
    xEnd: faceOrigin.clone().add(faceYAxis.clone().multiplyScalar(half)),
    yStart: faceOrigin.clone().add(faceXAxis.clone().multiplyScalar(-half)),
    yEnd: faceOrigin.clone().add(faceXAxis.clone().multiplyScalar(half))
  };
}

function buildMirrorHelpers() {
  removeMeshFromScene(mirrorXHelper);
  removeMeshFromScene(mirrorYHelper);
  mirrorXHelper = null;
  mirrorYHelper = null;

  const pts = getMirrorPoints();
  if (!pts) return;

  const xGeom = new THREE.BufferGeometry().setFromPoints([pts.xStart, pts.xEnd]);
  const yGeom = new THREE.BufferGeometry().setFromPoints([pts.yStart, pts.yEnd]);

  mirrorXHelper = new THREE.Line(xGeom, new THREE.LineBasicMaterial({ color: 0xff6666 }));
  mirrorYHelper = new THREE.Line(yGeom, new THREE.LineBasicMaterial({ color: 0x66ff66 }));

  scene.add(mirrorXHelper);
  scene.add(mirrorYHelper);
  updateMirrorHelperVisibility();
}

function computePlaneAxesFromSceneGrid(normal) {
  const planeNormal = normal.clone().normalize();
  const alignQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), planeNormal);

  const xAxis = new THREE.Vector3(1, 0, 0).applyQuaternion(alignQuat).normalize();
  const yAxis = new THREE.Vector3(0, 1, 0).applyQuaternion(alignQuat).normalize();

  return { xAxis, yAxis };
}

function applyFaceSelection(normal, origin) {
  faceNormal = normal.clone().normalize();

  // Keep drawing/mirror axes aligned with scene-grid/front-plane orientation,
  // rather than with the picked triangle edge direction.
  const sceneAxes = computePlaneAxesFromSceneGrid(faceNormal);
  faceXAxis = sceneAxes.xAxis;
  faceYAxis = sceneAxes.yAxis;

  faceOrigin = origin.clone();
  facePlane = new THREE.Plane().setFromNormalAndCoplanarPoint(faceNormal, faceOrigin);
  insetNormal = faceNormal.dot(new THREE.Vector3().subVectors(baseBoundsCenter, faceOrigin)) >= 0
    ? faceNormal.clone()
    : faceNormal.clone().negate();

  removeMeshFromScene(faceHelper);
  faceHelper = drawReferenceHelper(faceOrigin, faceNormal, 0x44aaff, faceXAxis, faceYAxis);
  faceHelperSize = getFaceHelperSize();
  buildMirrorHelpers();
  updateFaceHelperVisibility();
}

function calculateFaceFrame() {
  const [a, b, c] = pickPoints;
  const ab = new THREE.Vector3().subVectors(b, a);
  const ac = new THREE.Vector3().subVectors(c, a);
  const normal = new THREE.Vector3().crossVectors(ab, ac).normalize();
  applyFaceSelection(normal, a);
}

function findLargestFlatSurfaceSelection() {
  if (!baseMesh) return null;

  const pos = baseMesh.geometry?.attributes?.position;
  if (!pos || pos.count < 3) return null;

  const angleToleranceCos = Math.cos(THREE.MathUtils.degToRad(6));
  const planeTolerance = Math.max(baseMaxDimension * 0.003, 0.25);
  const clusters = [];

  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();

  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);

    ab.subVectors(b, a);
    ac.subVectors(c, a);
    const triNormal = new THREE.Vector3().crossVectors(ab, ac);
    const triArea = triNormal.length() * 0.5;
    if (triArea < 1e-4) continue;
    triNormal.normalize();

    const planeD = triNormal.dot(a);
    const triCentroid = new THREE.Vector3().add(a).add(b).add(c).multiplyScalar(1 / 3);

    let cluster = null;
    for (const candidate of clusters) {
      if (candidate.normal.dot(triNormal) < angleToleranceCos) continue;
      if (Math.abs(candidate.planeD - planeD) > planeTolerance) continue;
      cluster = candidate;
      break;
    }

    if (!cluster) {
      const edgeHint = ab.lengthSq() > ac.lengthSq() ? ab.clone() : ac.clone();
      cluster = {
        area: 0,
        planeD: planeD,
        normal: triNormal.clone(),
        normalSum: new THREE.Vector3(),
        centroidSum: new THREE.Vector3(),
        axisHint: edgeHint
      };
      clusters.push(cluster);
    }

    cluster.area += triArea;
    cluster.normalSum.addScaledVector(triNormal, triArea);
    cluster.centroidSum.addScaledVector(triCentroid, triArea);
    cluster.planeD = (cluster.planeD * (cluster.area - triArea) + planeD * triArea) / cluster.area;
  }

  if (!clusters.length) return null;

  clusters.forEach((cluster) => {
    cluster.normal = cluster.normalSum.clone().normalize();
  });

  clusters.sort((lhs, rhs) => rhs.area - lhs.area);
  const best = clusters[0];
  if (!best || best.area < 1) return null;

  const origin = best.centroidSum.clone().multiplyScalar(1 / best.area);
  return {
    normal: best.normal,
    origin,
    axisHint: best.axisHint,
    area: best.area
  };
}

function autoSelectLargestFlatSurface() {
  const selection = findLargestFlatSurfaceSelection();
  if (!selection) {
    setStatus('Unable to auto-detect a flat face. Pick 3 points manually.');
    return false;
  }

  clearFaceSelection();
  applyFaceSelection(selection.normal, selection.origin);

  removeMeshFromScene(frontHelper);
  frontRef = { normal: faceNormal.clone(), origin: faceOrigin.clone() };
  frontHelper = drawReferenceHelper(faceOrigin, faceNormal, 0xf1c40f);
  updateFrontHelperVisibility();

  debugLog('auto face/front selected', {
    area: Number(selection.area.toFixed(3)),
    origin: faceOrigin.toArray().map((v) => Number(v.toFixed(3))),
    normal: faceNormal.toArray().map((v) => Number(v.toFixed(5)))
  });

  setMode('draw');
  setStatus('Auto-selected largest flat face as drawing + front plane.');
  return true;
}

function computeOutwardNormal(a, b, c) {
  const normal = new THREE.Vector3()
    .crossVectors(new THREE.Vector3().subVectors(b, a), new THREE.Vector3().subVectors(c, a))
    .normalize();
  const toPoint = new THREE.Vector3().subVectors(a, baseBoundsCenter).normalize();
  if (normal.dot(toPoint) < 0) normal.negate();
  return normal;
}

function tryApplyOrientationFromReferences() {
  if (!baseMesh || !bottomRef || !frontRef) return;

  debugLog('applying bottom+front references', {
    bottomNormal: bottomRef.normal.toArray().map((v) => Number(v.toFixed(5))),
    frontNormal: frontRef.normal.toArray().map((v) => Number(v.toFixed(5)))
  });
  logMeshTransform('base mesh before alignment', baseMesh);

  const rotation = computeAlignmentQuaternion(bottomRef.normal, frontRef.normal);
  if (!rotation) {
    setStatus('Front reference is too parallel to bottom. Pick a different front plane.');
    return;
  }

  applyAlignmentQuaternion(baseMesh, marksGroup, rotation);
  logMeshTransform('base mesh after alignment', baseMesh);

  const alignedBounds = new THREE.Box3().setFromObject(baseMesh);
  alignedBounds.getCenter(baseBoundsCenter);
  const alignedSize = alignedBounds.getSize(new THREE.Vector3());
  baseMaxDimension = Math.max(alignedSize.x, alignedSize.y, alignedSize.z, 1);
  debugLog('aligned bounds updated', {
    size: alignedSize.toArray().map((v) => Number(v.toFixed(3))),
    maxDim: Number(baseMaxDimension.toFixed(3))
  });

  clearFaceSelection();
  clearOrientationHelpers();
  bottomRef = null;
  frontRef = null;

  fitCameraToBounds(alignedBounds);
  setMode('pickFace');
  setStatus('Model aligned from Bottom + Front references. Re-pick face and continue.');
}

function finishReferencePick() {
  const [a, b, c] = pickPoints;
  const normal = computeOutwardNormal(a, b, c);
  const origin = a.clone();

  if (activePickKind === 'bottom') {
    removeMeshFromScene(bottomHelper);
    bottomRef = { normal, origin };
    bottomHelper = drawReferenceHelper(origin, normal, 0x2ecc71);
    setStatus('Bottom reference captured. Now set front reference.');
    debugLog('bottom reference captured', {
      origin: origin.toArray().map((v) => Number(v.toFixed(3))),
      normal: normal.toArray().map((v) => Number(v.toFixed(5)))
    });
  } else if (activePickKind === 'front') {
    removeMeshFromScene(frontHelper);
    frontRef = { normal, origin };
    frontHelper = drawReferenceHelper(origin, normal, 0xf1c40f);
    updateFrontHelperVisibility();
    setStatus('Front reference captured.');
    debugLog('front reference captured', {
      origin: origin.toArray().map((v) => Number(v.toFixed(3))),
      normal: normal.toArray().map((v) => Number(v.toFixed(5)))
    });
  }

  clearPickMarkers();
  tryApplyOrientationFromReferences();
}

function updatePointer(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
}

function intersectBase(event) {
  if (!baseMesh) return null;
  updatePointer(event);
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObject(baseMesh, true)[0];
  return hit?.point || null;
}

function intersectPlane(event) {
  if (!facePlane) return null;
  updatePointer(event);
  raycaster.setFromCamera(pointer, camera);
  const out = new THREE.Vector3();
  if (!raycaster.ray.intersectPlane(facePlane, out)) return null;

  if (faceHelperSize > 0) {
    const rel = new THREE.Vector3().subVectors(out, faceOrigin);
    const half = faceHelperSize * 0.5;
    const localX = rel.dot(faceXAxis);
    const localY = rel.dot(faceYAxis);
    if (Math.abs(localX) > half || Math.abs(localY) > half) return null;
  }

  return out;
}

function raycastFromPoint(origin, direction) {
  if (!baseMesh) return null;

  raycaster.set(origin, direction.clone().normalize());
  const hit = raycaster.intersectObject(baseMesh, true)[0];
  if (!hit) return null;

  const worldNormal = hit.face?.normal
    ? hit.face.normal.clone().transformDirection(baseMesh.matrixWorld).normalize()
    : null;

  return {
    point: hit.point.clone(),
    normal: worldNormal,
    distance: hit.point.distanceTo(origin)
  };
}

function projectPlanePointToSurface(planePoint) {
  if (!baseMesh) return null;

  const probeDistance = Math.max(baseMaxDimension * 2.2, 20);
  const alongInset = insetNormal.clone().normalize();
  const reverseInset = alongInset.clone().negate();

  const forwardOrigin = planePoint.clone().add(reverseInset.clone().multiplyScalar(probeDistance));
  const backwardOrigin = planePoint.clone().add(alongInset.clone().multiplyScalar(probeDistance));

  const hits = [
    raycastFromPoint(forwardOrigin, alongInset),
    raycastFromPoint(backwardOrigin, reverseInset)
  ].filter(Boolean);

  if (!hits.length) return null;

  hits.sort((a, b) => a.point.distanceTo(planePoint) - b.point.distanceTo(planePoint));
  const bestHit = hits[0];

  let inwardNormal = insetNormal.clone();
  if (bestHit.normal) {
    inwardNormal = bestHit.normal.clone();
    const towardCenter = new THREE.Vector3().subVectors(baseBoundsCenter, bestHit.point);
    if (inwardNormal.dot(towardCenter) < 0) inwardNormal.negate();
  }

  return {
    point: bestHit.point,
    inwardNormal: inwardNormal.normalize()
  };
}

function beginStroke() {
  currentStroke = { dots: [], dotMeshes: [], textMeshes: [] };
  strokeStartPoint = null;
  activeStrokeAxis = null;
  pendingDrawEvent = null;
  redoStack.length = 0;
  updateActionButtons();
}

function commitStroke() {
  if (currentStroke && (currentStroke.dots.length || currentStroke.textMeshes.length)) undoStack.push(currentStroke);
  currentStroke = null;
  strokeStartPoint = null;
  activeStrokeAxis = null;
  pendingDrawEvent = null;
  updateActionButtons();
}

function getAxisLockSwitchFactor() {
  return THREE.MathUtils.clamp(
    Number(els.axisLockSensitivity?.value || AXIS_LOCK_SWITCH_FACTOR_DEFAULT),
    1,
    12
  );
}

function normalizeBrushRadius(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return Number(els.brushSize?.value || 0.8);
  return THREE.MathUtils.clamp(numeric, 0.2, 3);
}

function setBrushRadius(value) {
  const radius = normalizeBrushRadius(value);
  const formatted = radius.toFixed(1);
  if (els.brushSize) els.brushSize.value = formatted;
  if (els.brushSizeNumber) els.brushSizeNumber.value = formatted;
}

function isTypingTarget(target) {
  if (!target) return false;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLElement && target.isContentEditable) return true;
  return false;
}

function pointToFaceLocal(point) {
  const rel = new THREE.Vector3().subVectors(point, faceOrigin);
  return {
    x: rel.dot(faceXAxis),
    y: rel.dot(faceYAxis)
  };
}

function faceLocalToPoint(x, y) {
  return faceOrigin.clone()
    .add(faceXAxis.clone().multiplyScalar(x))
    .add(faceYAxis.clone().multiplyScalar(y));
}

function mirroredFacePoints(point) {
  const local = pointToFaceLocal(point);
  const variants = [
    { x: local.x, y: local.y },
    ...(els.mirrorX?.checked ? [{ x: local.x, y: -local.y }] : []),
    ...(els.mirrorY?.checked ? [{ x: -local.x, y: local.y }] : []),
    ...(els.mirrorX?.checked && els.mirrorY?.checked ? [{ x: -local.x, y: -local.y }] : [])
  ];

  const unique = new Map();
  for (const variant of variants) {
    const key = `${variant.x.toFixed(4)}:${variant.y.toFixed(4)}`;
    if (!unique.has(key)) unique.set(key, variant);
  }

  return [...unique.values()].map((v) => faceLocalToPoint(v.x, v.y));
}

function createInsetDotAtPoint(point) {
  const projected = projectPlanePointToSurface(point);
  if (!projected) return;

  const radius = normalizeBrushRadius(els.brushSize.value);
  const record = {
    point: projected.point.clone(),
    inwardNormal: projected.inwardNormal.clone(),
    radius,
    color: activeColor
  };
  dotMarkRecords.push(record);
  if (currentStroke) currentStroke.dots.push(record);

  const circleSegments = THREE.MathUtils.clamp(Math.round(radius * 16), 16, 56);
  const previewGeo = new THREE.CircleGeometry(radius, circleSegments);
  const previewMat = new THREE.MeshBasicMaterial({ color: activeColor, side: THREE.DoubleSide });
  const previewMesh = new THREE.Mesh(previewGeo, previewMat);
  previewMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), projected.inwardNormal);
  previewMesh.position.copy(projected.point).add(projected.inwardNormal.clone().multiplyScalar(-MARK_VISUAL_LIFT_MM));
  previewMesh.userData.kind = 'dot';
  marksGroup.add(previewMesh);
  if (currentStroke) currentStroke.dotMeshes.push(previewMesh);
}

function createInsetDot(point) {
  mirroredFacePoints(point).forEach((variantPoint) => createInsetDotAtPoint(variantPoint));
}

function createInsetText(point) {
  const sourcePoint = els.centerText?.checked ? faceOrigin.clone() : point;

  if (!loadedFont) {
    setStatus('Font still loading, try again in a moment.');
    return;
  }
  const text = els.textInput.value.trim();
  if (!text) return;

  const templateGeo = new TextGeometry(text, {
    font: loadedFont,
    size: Math.max(1.5, Number(els.brushSize.value) * 2.2),
    depth: EXTRUSION_DEPTH_MM,
    curveSegments: 10,
    bevelEnabled: false
  });
  templateGeo.computeBoundingBox();
  const bb = templateGeo.boundingBox;
  const width = bb.max.x - bb.min.x;
  const height = bb.max.y - bb.min.y;
  templateGeo.translate(-width / 2, -height / 2, 0);

  const textPoints = mirroredFacePoints(sourcePoint);
  textPoints.forEach((variantPoint, idx) => {
    const projected = projectPlanePointToSurface(variantPoint);
    if (!projected) return;

    const mat = new THREE.MeshStandardMaterial({ color: activeColor, roughness: 0.55, metalness: 0.05 });
    const geo = idx === 0 ? templateGeo : templateGeo.clone();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), projected.inwardNormal);
    const insetOffset = projected.inwardNormal.clone().multiplyScalar(EXTRUSION_DEPTH_MM);
    const visualLiftOffset = projected.inwardNormal.clone().multiplyScalar(-MARK_VISUAL_LIFT_MM);
    mesh.position.copy(projected.point).add(insetOffset).add(visualLiftOffset);
    mesh.userData.kind = 'text';
    mesh.userData.inwardNormal = projected.inwardNormal.toArray();
    mesh.userData.visualLiftMm = MARK_VISUAL_LIFT_MM;
    marksGroup.add(mesh);
    if (currentStroke) currentStroke.textMeshes.push(mesh);
    updateActionButtons();
  });
}


let lastDrawPoint = null;

function constrainStrokePoint(point) {
  if (!els.lockStrokeAxis?.checked || !lastDrawPoint) return point;

  const local = pointToFaceLocal(point);
  const lastLocal = pointToFaceLocal(lastDrawPoint);
  const dx = Math.abs(local.x - lastLocal.x);
  const dy = Math.abs(local.y - lastLocal.y);
  if (Math.max(dx, dy) < 0.1) return point;

  const switchFactor = Math.max(1, getAxisLockSwitchFactor());
  if (!activeStrokeAxis) {
    activeStrokeAxis = dx >= dy ? 'x' : 'y';
  } else if (activeStrokeAxis === 'x') {
    if (dy > dx * switchFactor) activeStrokeAxis = 'y';
  } else if (dx > dy * switchFactor) {
    activeStrokeAxis = 'x';
  }

  if (activeStrokeAxis === 'x') return faceLocalToPoint(local.x, lastLocal.y);
  return faceLocalToPoint(lastLocal.x, local.y);
}

function drawInterpolatedDots(nextPoint) {
  const constrainedPoint = constrainStrokePoint(nextPoint);

  if (!lastDrawPoint) {
    createInsetDot(constrainedPoint);
    lastDrawPoint = constrainedPoint.clone();
    return;
  }

  const delta = new THREE.Vector3().subVectors(constrainedPoint, lastDrawPoint);
  const distance = delta.length();
  const brushRadius = normalizeBrushRadius(els.brushSize.value);
  const step = THREE.MathUtils.clamp(brushRadius * 0.18, 0.06, 0.35);
  if (distance < step * 0.4) return;

  const direction = delta.normalize();
  let traveled = step;
  while (traveled <= distance) {
    const sample = lastDrawPoint.clone().add(direction.clone().multiplyScalar(traveled));
    createInsetDot(sample);
    traveled += step;
  }

  createInsetDot(constrainedPoint);
  lastDrawPoint = constrainedPoint.clone();
}

function strokeUndo() {
  const stroke = undoStack.pop();
  if (!stroke) return;

  if (stroke.dots.length) {
    dotMarkRecords.splice(dotMarkRecords.length - stroke.dots.length, stroke.dots.length);
  }
  for (const mesh of stroke.dotMeshes) detachMeshFromScene(mesh);
  for (const mesh of stroke.textMeshes) detachMeshFromScene(mesh);
  redoStack.push(stroke);
  updateActionButtons();
}

function strokeRedo() {
  const stroke = redoStack.pop();
  if (!stroke) return;

  if (stroke.dots.length) dotMarkRecords.push(...stroke.dots);
  for (const mesh of stroke.dotMeshes) marksGroup.add(mesh);
  for (const mesh of stroke.textMeshes) marksGroup.add(mesh);
  undoStack.push(stroke);
  updateActionButtons();
}

async function loadSTLFromArrayBuffer(arrayBuffer, sourceName = 'STL') {
  const geometry = stlLoader.parse(arrayBuffer);
  setBaseMesh(geometry);
  snapView('front');
  setStatus(facePlane ? `Loaded ${sourceName}. Auto-selected largest flat face.` : `Loaded ${sourceName}. Pick 3 points on the model.`);
}

function snapView(viewName) {
  if (!baseMesh) return;
  const bounds = new THREE.Box3().setFromObject(baseMesh);
  const center = bounds.getCenter(new THREE.Vector3());
  const size = Math.max(...bounds.getSize(new THREE.Vector3()).toArray(), 1);
  const distance = size * 1.8;

  const offsets = {
    front: new THREE.Vector3(0, 0, distance),
    back: new THREE.Vector3(0, 0, -distance),
    right: new THREE.Vector3(distance, 0, 0),
    left: new THREE.Vector3(-distance, 0, 0),
    top: new THREE.Vector3(0, distance, 0),
    bottom: new THREE.Vector3(0, -distance, 0),
    iso: new THREE.Vector3(distance, distance, distance)
  };

  const upByView = {
    top: new THREE.Vector3(0, 0, 1),
    bottom: new THREE.Vector3(0, 0, -1)
  };

  const offset = offsets[viewName] || offsets.iso;
  camera.position.copy(center).add(offset);
  controls.target.copy(center);
  camera.up.copy(upByView[viewName] || new THREE.Vector3(0, 1, 0));
  controls.update();
}

els.stlInput.addEventListener('change', async (ev) => {
  const file = ev.target.files?.[0];
  if (!file) return;
  try {
    debugLog('loading STL', { name: file.name, sizeBytes: file.size });
    const buffer = await file.arrayBuffer();
    await loadSTLFromArrayBuffer(buffer, file.name);
  } catch (err) {
    console.error(err);
    setStatus('Failed to load STL. See debug panel for details.');
    debugLog('stl parse failure', { error: String(err) });
  }
});

els.pickFaceBtn.addEventListener('click', () => {
  clearFaceSelection();
  activePickKind = 'face';
  setMode('pickFace');
});
els.autoFaceBtn?.addEventListener('click', () => {
  autoSelectLargestFlatSurface();
});
els.pickBottomBtn.addEventListener('click', () => {
  clearPickMarkers();
  activePickKind = 'bottom';
  setMode('pickBottom');
});
els.pickFrontBtn.addEventListener('click', () => {
  clearPickMarkers();
  activePickKind = 'front';
  setMode('pickFront');
});
els.drawBtn.addEventListener('click', () => setMode('draw'));
els.textBtn.addEventListener('click', () => setMode('text'));
els.lockRotation?.addEventListener('change', () => {
  controls.enableRotate = !els.lockRotation.checked;
});
els.showFacePlane?.addEventListener('change', updateFaceHelperVisibility);
els.showFrontPlane?.addEventListener('change', updateFrontHelperVisibility);
els.showMirrorX?.addEventListener('change', updateMirrorHelperVisibility);
els.showMirrorY?.addEventListener('change', updateMirrorHelperVisibility);
els.showGrid?.addEventListener('change', () => {
  gridHelper.visible = !!els.showGrid.checked;
});
els.showDebug?.addEventListener('change', () => {
  els.debug?.classList.toggle('hidden', !els.showDebug.checked);
});
els.planeSize?.addEventListener('input', () => {
  desiredPlaneSize = Number(els.planeSize.value);
  if (facePlane) applyFaceSelection(faceNormal, faceOrigin);
  debugLog('drawing plane size changed', { sizeMm: desiredPlaneSize });
});
els.brushSize?.addEventListener('input', () => {
  setBrushRadius(els.brushSize.value);
});
els.brushSizeNumber?.addEventListener('input', () => {
  setBrushRadius(els.brushSizeNumber.value);
});
els.brushSizeNumber?.addEventListener('blur', () => {
  setBrushRadius(els.brushSizeNumber.value);
});
els.copyLogsBtn?.addEventListener('click', async () => {
  const text = debugLines.join('\n');
  if (!text) {
    setStatus('No logs yet.');
    return;
  }

  try {
    await navigator.clipboard.writeText(text);
    setStatus('Debug logs copied to clipboard.');
  } catch (err) {
    debugLog('clipboard write failed', { error: String(err) });
    setStatus('Unable to copy logs automatically. Open devtools console to copy logs.');
  }
});
els.clearLogsBtn?.addEventListener('click', () => {
  clearDebugLog();
  setStatus('Debug logs cleared.');
});

els.undoBtn.addEventListener('click', strokeUndo);
els.redoBtn.addEventListener('click', strokeRedo);
els.clearMarksBtn.addEventListener('click', clearAllMarks);

els.viewCube?.addEventListener('click', (ev) => {
  const button = ev.target.closest('button[data-view]');
  if (!button) return;
  snapView(button.dataset.view);
});

window.addEventListener('keydown', (ev) => {
  if (isTypingTarget(ev.target)) return;

  const mod = ev.ctrlKey || ev.metaKey;
  if (!mod) return;

  const key = ev.key.toLowerCase();
  if (key === 'z' && !ev.shiftKey) {
    ev.preventDefault();
    strokeUndo();
  }
  if (key === 'z' && ev.shiftKey) {
    ev.preventDefault();
    strokeRedo();
  }
  if (key === 'y') {
    ev.preventDefault();
    strokeRedo();
  }
});

renderer.domElement.addEventListener('pointerdown', (ev) => {
  if (mode === 'pickFace' || mode === 'pickBottom' || mode === 'pickFront') {
    const point = intersectBase(ev);
    if (!point) return;

    debugLog('surface point picked', {
      mode,
      point: point.toArray().map((v) => Number(v.toFixed(3))),
      pickedCount: pickPoints.length + 1
    });

    pickPoints.push(point.clone());
    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(0.8, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0xffcc00 })
    );
    marker.position.copy(point);
    pickMarkers.push(marker);
    scene.add(marker);

    if (pickPoints.length === 3) {
      if (mode === 'pickFace') {
        calculateFaceFrame();
        clearPickMarkers();
        setMode('draw');
        setStatus('Face defined. Draw or type on that plane.');
        debugLog('face plane selected', {
          origin: faceOrigin.toArray().map((v) => Number(v.toFixed(3))),
          normal: faceNormal.toArray().map((v) => Number(v.toFixed(5)))
        });
      } else {
        finishReferencePick();
      }
    }
    return;
  }

  if (mode === 'draw') {
    const point = intersectPlane(ev);
    if (!point) return;
    isDrawing = true;
    beginStroke();
    strokeStartPoint = point.clone();
    const constrainedStart = constrainStrokePoint(point);
    lastDrawPoint = constrainedStart.clone();
    createInsetDot(constrainedStart);
    return;
  }

  if (mode === 'text') {
    const point = intersectPlane(ev);
    if (!point) return;
    beginStroke();
    createInsetText(point);
    commitStroke();
  }
});

renderer.domElement.addEventListener('pointermove', (ev) => {
  if (!isDrawing || mode !== 'draw') return;
  pendingDrawEvent = {
    clientX: ev.clientX,
    clientY: ev.clientY
  };
});
window.addEventListener('pointerup', () => {
  if (isDrawing) commitStroke();
  isDrawing = false;
  lastDrawPoint = null;
  pendingDrawEvent = null;
});

els.exportBtn.addEventListener('click', async () => {
  if (!baseMesh) return;

  const exportRoot = new THREE.Group();
  exportRoot.name = 'stl-face-painter-export';
  exportRoot.add(baseMesh.clone());
  dotMarkRecords.forEach((mark) => {
    const geo = new THREE.CylinderGeometry(mark.radius, mark.radius, EXTRUSION_DEPTH_MM, 20);
    const mat = new THREE.MeshStandardMaterial({ color: mark.color, roughness: 0.55, metalness: 0.05 });
    const exportMark = new THREE.Mesh(geo, mat);
    exportMark.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), mark.inwardNormal);
    const insetOffset = mark.inwardNormal.clone().multiplyScalar(EXTRUSION_DEPTH_MM * 0.5);
    exportMark.position.copy(mark.point).add(insetOffset);
    exportRoot.add(exportMark);
  });
  marksGroup.children.forEach((mark) => {
    if (mark.userData?.kind !== 'text') return;
    const exportMark = mark.clone();
    const inwardNormal = Array.isArray(mark.userData?.inwardNormal)
      ? new THREE.Vector3().fromArray(mark.userData.inwardNormal)
      : null;
    const visualLiftMm = Number(mark.userData?.visualLiftMm || 0);
    if (inwardNormal && visualLiftMm > 0) {
      exportMark.position.add(inwardNormal.multiplyScalar(visualLiftMm));
    }
    exportRoot.add(exportMark);
  });

  debugLog('starting 3mf export', { marks: dotMarkRecords.length + marksGroup.children.length });
  let exportTo3MF;
  try {
    exportTo3MF = await get3MFExportFn();
  } catch (err) {
    setStatus('3MF export is currently unavailable. See debug panel for details.');
    debugLog('3mf exporter unavailable', { error: String(err) });
    return;
  }
  const blob = await exportTo3MF(exportRoot, { compression: 'standard' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'painted-model.3mf';
  a.click();
  URL.revokeObjectURL(url);
  debugLog('3mf export complete');
});

function resize() {
  const w = window.innerWidth - 340;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
}
window.addEventListener('resize', resize);
resize();
if (els.showGrid) gridHelper.visible = !!els.showGrid.checked;
if (els.showDebug) els.debug?.classList.toggle('hidden', !els.showDebug.checked);
if (els.lockRotation) controls.enableRotate = !els.lockRotation.checked;
setBrushRadius(els.brushSize?.value || 0.8);
updateFrontHelperVisibility();
updateMirrorHelperVisibility();
if (els.autoFaceBtn) els.autoFaceBtn.disabled = true;
updateActionButtons();
debugLog('app initialized');

(async function loadDefaultSTL() {
  try {
    debugLog('loading default STL', { name: 'blank_face_v0.stl' });
    const res = await fetch('./blank_face_v0.stl');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buffer = await res.arrayBuffer();
    await loadSTLFromArrayBuffer(buffer, 'blank_face_v0.stl');
  } catch (err) {
    debugLog('default stl load failure', { error: String(err) });
    setStatus('Load an STL to begin.');
  }
})();

(function render() {
  requestAnimationFrame(render);
  if (isDrawing && mode === 'draw' && pendingDrawEvent) {
    const point = intersectPlane(pendingDrawEvent);
    pendingDrawEvent = null;
    if (point) drawInterpolatedDots(point);
  }
  controls.update();
  renderer.render(scene, camera);
})();
