import * as THREE from 'https://unpkg.com/three@0.162.0/build/three.module.js';
import { OrbitControls } from 'https://unpkg.com/three@0.162.0/examples/jsm/controls/OrbitControls.js';
import { STLLoader } from 'https://unpkg.com/three@0.162.0/examples/jsm/loaders/STLLoader.js';
import { FontLoader } from 'https://unpkg.com/three@0.162.0/examples/jsm/loaders/FontLoader.js';
import { TextGeometry } from 'https://unpkg.com/three@0.162.0/examples/jsm/geometries/TextGeometry.js';
import { ThreeMFExporter } from 'https://unpkg.com/three@0.162.0/examples/jsm/exporters/3MFExporter.js';

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
  exportBtn: document.getElementById('exportBtn'),
  undoBtn: document.getElementById('undoBtn'),
  clearMarksBtn: document.getElementById('clearMarksBtn'),
  palette: document.getElementById('palette'),
  status: document.getElementById('status')
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
let marksGroup = new THREE.Group();
marksGroup.name = 'markMeshes';
scene.add(marksGroup);

const pickPoints = [];
let pickMarkers = [];
let facePlane = null;
let faceNormal = new THREE.Vector3(0, 0, 1);
let faceU = new THREE.Vector3(1, 0, 0);
let faceV = new THREE.Vector3(0, 1, 0);
let faceOrigin = new THREE.Vector3();
let faceHelper = null;

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const stlLoader = new STLLoader();
const fontLoader = new FontLoader();
let loadedFont = null;

fontLoader.load('https://unpkg.com/three@0.162.0/examples/fonts/helvetiker_regular.typeface.json', (font) => {
  loadedFont = font;
});

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

function setBaseMesh(geometry) {
  if (baseMesh) {
    scene.remove(baseMesh);
    baseMesh.geometry.dispose();
  }
  geometry.center();
  geometry.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({
    color: 0x9d9d9d,
    roughness: 0.8,
    metalness: 0.05,
    side: THREE.DoubleSide
  });
  baseMesh = new THREE.Mesh(geometry, mat);
  baseMesh.name = 'baseMesh';
  scene.add(baseMesh);

  fitCameraToObject(baseMesh);

  clearFaceSelection();
  marksGroup.clear();
  els.exportBtn.disabled = false;
  els.undoBtn.disabled = true;
  els.clearMarksBtn.disabled = true;
  setMode('pick');
}

function fitCameraToObject(object) {
  const bounds = new THREE.Box3().setFromObject(object);
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z, 1);
  const fov = THREE.MathUtils.degToRad(camera.fov);
  const cameraDistance = (maxDim * 0.75) / Math.tan(fov / 2);

  controls.target.copy(center);
  camera.position.copy(center).add(new THREE.Vector3(cameraDistance, cameraDistance * 0.8, cameraDistance));

  camera.near = Math.max(0.01, maxDim / 1000);
  camera.far = Math.max(5000, maxDim * 20);
  camera.updateProjectionMatrix();
  controls.update();
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
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), faceNormal.clone().negate());
  const offset = faceNormal.clone().multiplyScalar(-EXTRUSION_DEPTH_MM * 0.5);
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
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), faceNormal.clone().negate());
  mesh.position.copy(point);
  pushMark(mesh);
}

els.stlInput.addEventListener('change', async (ev) => {
  const file = ev.target.files?.[0];
  if (!file) return;
  const buffer = await file.arrayBuffer();
  const geometry = stlLoader.parse(buffer);
  setBaseMesh(geometry);
  setStatus(`Loaded ${file.name}. Pick 3 points on the model.`);
});

els.pickFaceBtn.addEventListener('click', () => {
  clearFaceSelection();
  setMode('pick');
});
els.drawBtn.addEventListener('click', () => setMode('draw'));
els.textBtn.addEventListener('click', () => setMode('text'));

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
    }
    return;
  }

  if (mode === 'draw') {
    const point = intersectPlane(ev);
    if (!point) return;
    isDrawing = true;
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
  createInsetDot(point);
});
window.addEventListener('pointerup', () => { isDrawing = false; });

els.exportBtn.addEventListener('click', async () => {
  if (!baseMesh) return;

  const exportRoot = new THREE.Group();
  exportRoot.name = 'stl-face-painter-export';
  exportRoot.add(baseMesh.clone());
  marksGroup.children.forEach((mark) => exportRoot.add(mark.clone()));

  const exporter = new ThreeMFExporter();
  const arrayBuffer = await exporter.parseAsync(exportRoot);
  const blob = new Blob([arrayBuffer], { type: 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'painted-model.3mf';
  a.click();
  URL.revokeObjectURL(url);
});

function resize() {
  const main = renderer.domElement.parentElement;
  const w = Math.max(1, main.clientWidth);
  const h = Math.max(1, main.clientHeight);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
}
window.addEventListener('resize', resize);
resize();

(function render() {
  requestAnimationFrame(render);
  controls.update();
  renderer.render(scene, camera);
})();
