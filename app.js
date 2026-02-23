import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';

const EXTRUSION_DEPTH_MM = 0.4;
const PALETTE = ['#ff5a5a', '#4ecdc4', '#ffe66d', '#9f7aea'];

const els = {
  canvas: document.getElementById('viewport'),
  stlInput: document.getElementById('stlInput'),
  pickFaceBtn: document.getElementById('pickFaceBtn'),
  drawBtn: document.getElementById('drawBtn'),
  textBtn: document.getElementById('textBtn'),
  textInput: document.getElementById('textInput'),
  brushSize: document.getElementById('brushSize'),
  lockRotation: document.getElementById('lockRotation'),
  exportBtn: document.getElementById('exportBtn'),
  undoBtn: document.getElementById('undoBtn'),
  clearMarksBtn: document.getElementById('clearMarksBtn'),
  palette: document.getElementById('palette'),
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
scene.add(new THREE.GridHelper(200, 20, 0x333333, 0x222222));

let activeColor = PALETTE[0];
let mode = 'idle';
let isDrawing = false;
let baseMesh = null;
let baseBoundsCenter = new THREE.Vector3();
let marksGroup = new THREE.Group();
marksGroup.name = 'markMeshes';
scene.add(marksGroup);

const pickPoints = [];
let pickMarkers = [];
let facePlane = null;
let faceNormal = new THREE.Vector3(0, 0, 1);
let insetNormal = new THREE.Vector3(0, 0, -1);
let faceU = new THREE.Vector3(1, 0, 0);
let faceV = new THREE.Vector3(0, 1, 0);
let faceOrigin = new THREE.Vector3();
let faceHelper = null;

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const stlLoader = new STLLoader();
const fontLoader = new FontLoader();
let loadedFont = null;

let ThreeMFExporterCtor = null;
async function getThreeMFExporterCtor() {
  if (ThreeMFExporterCtor) return ThreeMFExporterCtor;

  const candidates = [
    'https://cdn.jsdelivr.net/npm/three@0.181.1/examples/jsm/exporters/3MFExporter.js',
    'https://unpkg.com/three@0.181.1/examples/jsm/exporters/3MFExporter.js'
  ];

  for (const url of candidates) {
    try {
      const mod = await import(url);
      if (mod?.ThreeMFExporter) {
        ThreeMFExporterCtor = mod.ThreeMFExporter;
        debugLog('3mf exporter module loaded', { url });
        return ThreeMFExporterCtor;
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
  if (debugLines.length > 18) debugLines.shift();
  if (els.debug) els.debug.textContent = debugLines.join('\n');
  console.debug('[STL Face Painter]', message, details || '');
}

function setMode(next) {
  mode = next;
  const ready = !!baseMesh && !!facePlane;
  els.drawBtn.disabled = !ready;
  els.textBtn.disabled = !ready;
  if (next === 'pick') setStatus('Click 3 points on the STL surface to define drawing plane.');
  if (next === 'draw') setStatus('Drag on the selected plane to create 0.4mm inset marks.');
  if (next === 'text') setStatus('Click on the selected plane to place text.');
}

function clearFaceSelection() {
  pickPoints.length = 0;
  pickMarkers.forEach((m) => scene.remove(m));
  pickMarkers = [];
  if (faceHelper) scene.remove(faceHelper);
  facePlane = null;
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

function setBaseMesh(geometry) {
  if (baseMesh) {
    scene.remove(baseMesh);
    baseMesh.geometry.dispose();
  }
  geometry.center();
  geometry.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color: 0x9d9d9d, roughness: 0.8, metalness: 0.05, side: THREE.DoubleSide });
  baseMesh = new THREE.Mesh(geometry, mat);
  baseMesh.name = 'baseMesh';
  scene.add(baseMesh);

  const bounds = new THREE.Box3().setFromObject(baseMesh);
  baseBoundsCenter = bounds.getCenter(new THREE.Vector3());
  fitCameraToBounds(bounds);
  const sizeVec = bounds.getSize(new THREE.Vector3());
  debugLog('base mesh loaded', {
    vertices: geometry.attributes.position?.count || 0,
    size: [Number(sizeVec.x.toFixed(3)), Number(sizeVec.y.toFixed(3)), Number(sizeVec.z.toFixed(3))]
  });

  clearFaceSelection();
  marksGroup.clear();
  els.exportBtn.disabled = false;
  els.undoBtn.disabled = true;
  els.clearMarksBtn.disabled = true;
  setMode('pick');
}

function calculateFaceFrame() {
  const [a, b, c] = pickPoints;
  const ab = new THREE.Vector3().subVectors(b, a);
  const ac = new THREE.Vector3().subVectors(c, a);
  faceNormal = new THREE.Vector3().crossVectors(ab, ac).normalize();

  faceU = ab.clone().normalize();
  faceV = new THREE.Vector3().crossVectors(faceNormal, faceU).normalize();
  faceOrigin = a.clone();
  facePlane = new THREE.Plane().setFromNormalAndCoplanarPoint(faceNormal, faceOrigin);
  insetNormal = faceNormal.dot(new THREE.Vector3().subVectors(baseBoundsCenter, faceOrigin)) >= 0
    ? faceNormal.clone()
    : faceNormal.clone().negate();

  const helperGeom = new THREE.PlaneGeometry(80, 80);
  const helperMat = new THREE.MeshBasicMaterial({ color: 0x44aaff, side: THREE.DoubleSide, transparent: true, opacity: 0.16 });
  if (faceHelper) scene.remove(faceHelper);
  faceHelper = new THREE.Mesh(helperGeom, helperMat);
  faceHelper.position.copy(faceOrigin);
  faceHelper.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), faceNormal);
  scene.add(faceHelper);
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
  return raycaster.ray.intersectPlane(facePlane, out) ? out : null;
}

function pushMark(mesh) {
  marksGroup.add(mesh);
  els.undoBtn.disabled = marksGroup.children.length === 0;
  els.clearMarksBtn.disabled = marksGroup.children.length === 0;
}

function createInsetDot(point) {
  const radius = Number(els.brushSize.value);
  const geo = new THREE.CylinderGeometry(radius, radius, EXTRUSION_DEPTH_MM, 20);
  const mat = new THREE.MeshStandardMaterial({ color: activeColor, roughness: 0.55, metalness: 0.05 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), insetNormal);
  const offset = insetNormal.clone().multiplyScalar(EXTRUSION_DEPTH_MM * 0.5);
  mesh.position.copy(point).add(offset);
  pushMark(mesh);
}

function createInsetText(point) {
  if (!loadedFont) {
    setStatus('Font still loading, try again in a moment.');
    return;
  }
  const text = els.textInput.value.trim();
  if (!text) return;

  const geo = new TextGeometry(text, {
    font: loadedFont,
    size: Math.max(1.5, Number(els.brushSize.value) * 2.2),
    depth: EXTRUSION_DEPTH_MM,
    curveSegments: 10,
    bevelEnabled: false
  });
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  const width = bb.max.x - bb.min.x;
  const height = bb.max.y - bb.min.y;
  geo.translate(-width / 2, -height / 2, 0);

  const mat = new THREE.MeshStandardMaterial({ color: activeColor, roughness: 0.55, metalness: 0.05 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), insetNormal);
  mesh.position.copy(point).add(insetNormal.clone().multiplyScalar(EXTRUSION_DEPTH_MM));
  pushMark(mesh);
}

let lastDrawPoint = null;

function drawInterpolatedDots(nextPoint) {
  if (!lastDrawPoint) {
    createInsetDot(nextPoint);
    lastDrawPoint = nextPoint.clone();
    return;
  }

  const delta = new THREE.Vector3().subVectors(nextPoint, lastDrawPoint);
  const distance = delta.length();
  const step = Math.max(0.12, Number(els.brushSize.value) * 0.3);
  if (distance < step * 0.4) return;

  const direction = delta.normalize();
  let traveled = step;
  while (traveled <= distance) {
    const sample = lastDrawPoint.clone().add(direction.clone().multiplyScalar(traveled));
    createInsetDot(sample);
    traveled += step;
  }

  createInsetDot(nextPoint);
  lastDrawPoint = nextPoint.clone();
}

els.stlInput.addEventListener('change', async (ev) => {
  const file = ev.target.files?.[0];
  if (!file) return;
  try {
    debugLog('loading STL', { name: file.name, sizeBytes: file.size });
    const buffer = await file.arrayBuffer();
    const geometry = stlLoader.parse(buffer);
    setBaseMesh(geometry);
    setStatus(`Loaded ${file.name}. Pick 3 points on the model.`);
  } catch (err) {
    console.error(err);
    setStatus('Failed to load STL. See debug panel for details.');
    debugLog('stl parse failure', { error: String(err) });
  }
});

els.pickFaceBtn.addEventListener('click', () => {
  clearFaceSelection();
  setMode('pick');
});
els.drawBtn.addEventListener('click', () => setMode('draw'));
els.textBtn.addEventListener('click', () => setMode('text'));
els.lockRotation?.addEventListener('change', () => {
  controls.enableRotate = !els.lockRotation.checked;
});

els.undoBtn.addEventListener('click', () => {
  const mesh = marksGroup.children.at(-1);
  if (!mesh) return;
  marksGroup.remove(mesh);
  mesh.geometry?.dispose?.();
  mesh.material?.dispose?.();
  els.undoBtn.disabled = marksGroup.children.length === 0;
  els.clearMarksBtn.disabled = marksGroup.children.length === 0;
});

els.clearMarksBtn.addEventListener('click', () => {
  while (marksGroup.children.length) {
    const mesh = marksGroup.children[0];
    marksGroup.remove(mesh);
    mesh.geometry?.dispose?.();
    mesh.material?.dispose?.();
  }
  els.undoBtn.disabled = true;
  els.clearMarksBtn.disabled = true;
});

renderer.domElement.addEventListener('pointerdown', (ev) => {
  if (mode === 'pick') {
    const point = intersectBase(ev);
    if (!point) return;
    pickPoints.push(point.clone());
    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(0.8, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0xffcc00 })
    );
    marker.position.copy(point);
    pickMarkers.push(marker);
    scene.add(marker);

    if (pickPoints.length === 3) {
      calculateFaceFrame();
      setMode('draw');
      setStatus('Face defined. Draw or type on that plane.');
      debugLog('face plane selected', {
        origin: pickPoints[0].toArray().map((v) => Number(v.toFixed(3))),
        normal: faceNormal.toArray().map((v) => Number(v.toFixed(5)))
      });
    }
    return;
  }

  if (mode === 'draw') {
    const point = intersectPlane(ev);
    if (!point) return;
    isDrawing = true;
    lastDrawPoint = point.clone();
    createInsetDot(point);
    return;
  }

  if (mode === 'text') {
    const point = intersectPlane(ev);
    if (!point) return;
    createInsetText(point);
  }
});

renderer.domElement.addEventListener('pointermove', (ev) => {
  if (!isDrawing || mode !== 'draw') return;
  const point = intersectPlane(ev);
  if (!point) return;
  drawInterpolatedDots(point);
});
window.addEventListener('pointerup', () => {
  isDrawing = false;
  lastDrawPoint = null;
});

els.exportBtn.addEventListener('click', async () => {
  if (!baseMesh) return;

  const exportRoot = new THREE.Group();
  exportRoot.name = 'stl-face-painter-export';
  exportRoot.add(baseMesh.clone());
  marksGroup.children.forEach((mark) => exportRoot.add(mark.clone()));

  debugLog('starting 3mf export', { marks: marksGroup.children.length });
  let ExporterCtor;
  try {
    ExporterCtor = await getThreeMFExporterCtor();
  } catch (err) {
    setStatus('3MF export is currently unavailable. See debug panel for details.');
    debugLog('3mf exporter unavailable', { error: String(err) });
    return;
  }
  const exporter = new ExporterCtor();
  const arrayBuffer = await exporter.parseAsync(exportRoot);
  const blob = new Blob([arrayBuffer], { type: 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml' });
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
debugLog('app initialized');

(function render() {
  requestAnimationFrame(render);
  controls.update();
  renderer.render(scene, camera);
})();
