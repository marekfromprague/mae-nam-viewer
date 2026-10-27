// Mae Nam project — Concept A web viewer (three.js 0.160.0).
// Loads one GLB (assets/site.glb) with Cycles-baked lighting (lightmaps on uv1), orbit / zoom / pan controls and the view presets.
// No real-time lights: baked surfaces get their light from the lightmaps, everything else from the sky.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { CONFIG, VIEWS, CREDITS, CREDIT_LINKS } from './config.js';

const D2R = Math.PI / 180;
const $ = s => document.querySelector(s);
const isTouch = matchMedia('(pointer:coarse)').matches;
if (isTouch) document.body.classList.add('touch');
const params = new URLSearchParams(location.search);

// ---------- renderer / scene ----------
const stage = $('#stage');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
const maxPR = Math.min(window.devicePixelRatio || 1, isTouch ? CONFIG.renderer.maxPixelRatioMobile : CONFIG.renderer.maxPixelRatioDesktop);
let pixelRatio = maxPR;
renderer.setPixelRatio(pixelRatio);
renderer.setSize(stage.clientWidth, stage.clientHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = { AgX: THREE.AgXToneMapping, ACES: THREE.ACESFilmicToneMapping, Neutral: THREE.NeutralToneMapping }[CONFIG.renderer.toneMapping] ?? THREE.AgXToneMapping;
renderer.toneMappingExposure = CONFIG.renderer.exposure;
stage.appendChild(renderer.domElement); renderer.domElement.tabIndex = 0;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(CONFIG.fov, stage.clientWidth / stage.clientHeight, 0.05, 3000);
const S = CONFIG.sky;
scene.fog = new THREE.Fog(S.fog, S.fogNear, S.fogFar);

// sky: vertical gradient as an equirect texture, also used (pre-filtered) as the environment for reflections
function skyTexture() {
  const c = document.createElement('canvas'); c.width = 16; c.height = 256; const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, S.top); grd.addColorStop(0.485, S.horizon); grd.addColorStop(0.5, S.horizon); grd.addColorStop(1, S.ground);
  g.fillStyle = grd; g.fillRect(0, 0, 16, 256);
  const t = new THREE.CanvasTexture(c); t.mapping = THREE.EquirectangularReflectionMapping; t.colorSpace = THREE.SRGBColorSpace; return t;
}
const sky = skyTexture();
scene.background = sky;
const envScene = new THREE.Scene(); envScene.background = sky;
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(envScene, 0, 0.1, 100).texture;
// Unbaked surfaces (trees, context, water) get a flat "lightmap": even ambient light without real-time lights.
const ambientMap = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1); ambientMap.needsUpdate = true;

// site frame: site-local → world (spec §1)
const site = new THREE.Group(); site.rotation.y = CONFIG.siteRotationDeg * D2R; scene.add(site); site.updateMatrixWorld(true);
const L2W = (x, y, z) => site.localToWorld(new THREE.Vector3(x, y, z));

// ---------- controls ----------
const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enableDamping = true; orbit.dampingFactor = 0.08;
orbit.maxPolarAngle = Math.PI * 0.495;
orbit.screenSpacePanning = false;
orbit.zoomToCursor = true;
const lineMeshes = [];

// ---------- loading ----------
const loader = new GLTFLoader();
const draco = new DRACOLoader(); draco.setDecoderPath('vendor/three/examples/jsm/libs/draco/gltf/'); loader.setDRACOLoader(draco);
const loadBar = $('#loadBar'), loadText = $('#loadText');
const loadStats = {}; let warm = false;
const tStart = performance.now();
const lightmapsReady = loadLightmaps();

loader.load(CONFIG.glb, async gltf => {
  loadStats.glbMs = Math.round(performance.now() - tStart);
  loadText.textContent = 'Preparing the view…';
  const root = gltf.scene; scene.add(root); root.updateMatrixWorld(true);
  const maps = await lightmapsReady;
  prepareModel(root, maps);
  autoInstance(root);
  buildViewChips();
  setView(params.get('view') || 'overview', false);
  const tc = performance.now(); await renderer.compileAsync(scene, camera); loadStats.compileMs = Math.round(performance.now() - tc);
  warm = true;
  $('#loader').classList.add('done');
  loadStats.readyMs = Math.round(performance.now() - tStart);
  window.__ready = true;
  console.info('[viewer] loaded', JSON.stringify({ load: loadStats, lightmaps: Object.keys(maps).length, instanced: instStats }));
}, e => {
  if (e.total) { const p = e.loaded / e.total; loadBar.style.width = (p * 100).toFixed(1) + '%'; loadText.textContent = `Loading the model… ${(e.loaded / 1048576).toFixed(1)} / ${(e.total / 1048576).toFixed(1)} MB`; }
}, err => { loadText.textContent = 'Could not load the model. Serve this folder over http (see README).'; console.error(err); });

// Lightmaps load in parallel with the GLB.
function loadLightmaps() {
  const tl = new THREE.TextureLoader(); const A = CONFIG.lightmaps; const maps = {};
  return Promise.all(A.groups.map(name => new Promise(done => tl.load(A.dir + name + '.webp', tex => {
    tex.channel = 1; tex.flipY = false; tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    maps[name] = tex; done();
  }, undefined, () => { console.warn('[viewer] no lightmap for', name); done(); })))).then(() => { loadStats.lightmapsMs = Math.round(performance.now() - tStart); return maps; });
}

function prepareModel(root, maps) {
  const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const A = CONFIG.lightmaps;
  const clones = new Map();   // per lightmap group: material → clone carrying that group's map
  root.traverse(o => {
    if (o.isLight) { o.visible = false; return; }
    if (!o.isMesh) return;
    if (/^Boundary/i.test(o.name) || /^Boundary/i.test(o.parent?.name || '')) { lineMeshes.push(o); o.visible = $('#optLine').checked; return; }
    let g = null; for (let p = o; p; p = p.parent) if (maps[p.name]) { g = p.name; break; }
    const swap = m => {
      for (const k of ['map', 'normalMap', 'roughnessMap']) if (m[k]) m[k].anisotropy = maxAniso;
      if (m.transmission > 0) { m.transmission = 0; m.transparent = true; m.opacity = CONFIG.waterOpacity; m.depthWrite = false; }
      const glassy = m.transparent || /glass|water/i.test(m.name);
      if (!g || glassy || !o.geometry.attributes.uv1) {
        m.envMapIntensity = CONFIG.liveEnvIntensity;
        if (!m.lightMap && 'lightMap' in m) { m.lightMap = ambientMap; m.lightMapIntensity = Math.PI * CONFIG.liveAmbient; m.needsUpdate = true; }
        return m;
      }
      const key = g + '|' + m.uuid;
      if (!clones.has(key)) {
        const c = m.clone(); c.lightMap = maps[g]; c.lightMapIntensity = Math.PI * A.scale * A.intensity; c.envMapIntensity = CONFIG.bakedEnvIntensity;
        clones.set(key, c);
      }
      return clones.get(key);
    };
    o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material);
  });
  if (!lineMeshes.length) $('#optLine').closest('label').hidden = true;
}

// Draw-call saver: meshes that share geometry + material (palms, trees, repeated dressing) become one InstancedMesh.
const instStats = { groups: 0, meshes: 0 };
function autoInstance(root) {
  root.updateMatrixWorld(true);
  const buckets = new Map();
  root.traverse(o => {
    if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || Array.isArray(o.material) || o.morphTargetInfluences) return;
    for (let p = o; p; p = p.parent) if (!p.visible) return;
    const k = o.geometry.uuid + '|' + o.material.uuid; (buckets.get(k) || buckets.set(k, []).get(k)).push(o);
  });
  for (const list of buckets.values()) {
    if (list.length < CONFIG.autoInstanceMin) continue;
    const im = new THREE.InstancedMesh(list[0].geometry, list[0].material, list.length);
    list.forEach((o, i) => { im.setMatrixAt(i, o.matrixWorld); o.removeFromParent(); });
    im.name = 'auto_' + list[0].name; im.computeBoundingSphere();
    scene.add(im); instStats.groups++; instStats.meshes += list.length;
  }
}

// ---------- views ----------
function buildViewChips() {
  const strip = $('#viewStrip');
  for (const v of VIEWS) {
    const b = document.createElement('button'); b.className = 'chip'; b.dataset.view = v.id; b.textContent = v.label; b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => { setView(v.id); renderer.domElement.focus({ preventScroll: true }); });
    strip.appendChild(b);
  }
}
function markView(id) {
  document.querySelectorAll('[data-view]').forEach(b => {
    const on = b.dataset.view === id; b.setAttribute('aria-pressed', String(on));
    if (on) b.scrollIntoView({ block: 'nearest', inline: 'center' });
  });
}
let tween = null;
function setView(id, animate = true) {
  const v = VIEWS.find(v => v.id === id) || VIEWS[0];
  markView(v.id);
  const eye = L2W(...v.eye), tgt = L2W(...v.target);
  if (!v.room && camera.aspect < 1) eye.sub(tgt).multiplyScalar(Math.min(1.8, Math.pow(1 / camera.aspect, 0.6))).add(tgt);   // portrait screens: step back
  orbit.minDistance = Math.min(v.min, eye.distanceTo(tgt)); orbit.maxDistance = Math.max(v.max, eye.distanceTo(tgt));
  orbit.panSpeed = v.room ? 0.3 : 1; orbit.rotateSpeed = v.room ? 0.6 : 1;
  orbit.enablePan = !v.room;
  $('#hintText').innerHTML = hint(v.room);
  if (!animate) { camera.position.copy(eye); orbit.target.copy(tgt); orbit.update(); return; }
  tween = { t: 0, p0: camera.position.clone(), t0: orbit.target.clone(), p1: eye, t1: tgt };
}
function hint(room) {
  if (room) return isTouch ? 'Drag to look around · pinch to zoom' : 'Drag to look around · scroll to zoom';
  return isTouch ? 'Drag to orbit · pinch to zoom · two fingers to pan' : 'Drag to orbit · right-drag to pan · scroll to zoom';
}
orbit.addEventListener('start', () => { tween = null; markView(null); });

// ---------- about ----------
$('#creditLine').textContent = CREDITS;
$('#creditLinks').innerHTML = CREDIT_LINKS.map(([t, u]) => `<li><a href="${u}" target="_blank" rel="noopener">${t}</a></li>`).join('');
$('#aboutBtn').addEventListener('click', () => $('#about').showModal());
$('#optLine').addEventListener('change', e => { lineMeshes.forEach(m => m.visible = e.target.checked); $('#lineBtn').setAttribute('aria-pressed', String(e.target.checked)); });
$('#lineBtn').addEventListener('click', () => { const c = $('#optLine'); c.checked = !c.checked; c.dispatchEvent(new Event('change')); });

// ---------- loop ----------
const clock = new THREE.Clock();
const ease = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
function frame() {
  const dt = Math.min(clock.getDelta(), 0.1);
  if (tween) {
    tween.t = Math.min(1, tween.t + dt / CONFIG.transitionSec); const k = ease(tween.t);
    camera.position.lerpVectors(tween.p0, tween.p1, k); orbit.target.lerpVectors(tween.t0, tween.t1, k);
    if (tween.t >= 1) tween = null;
  }
  orbit.update();
  if (camera.position.y < 0.3) camera.position.y = 0.3;
  if (warm) { renderer.render(scene, camera); adapt(dt); }
  fps.tick();
  requestAnimationFrame(frame);
}
const fps = { n: 0, t: performance.now(), value: 0, tick() { this.n++; const t = performance.now(); if (t - this.t > 1000) { this.value = this.n * 1000 / (t - this.t); this.n = 0; this.t = t; } } };
// Adaptive resolution: lower the pixel ratio when frames are slow (phones), raise it again when there is headroom.
let slow = 0, fast = 0;
function adapt(dt) {
  if (dt > 1 / 28) { slow++; fast = 0; } else if (dt < 1 / 55) { fast++; slow = 0; }
  if (slow > 40 && pixelRatio > CONFIG.renderer.minPixelRatio) { pixelRatio = Math.max(CONFIG.renderer.minPixelRatio, pixelRatio - 0.25); renderer.setPixelRatio(pixelRatio); slow = 0; }
  if (fast > 240 && pixelRatio < maxPR) { pixelRatio = Math.min(maxPR, pixelRatio + 0.25); renderer.setPixelRatio(pixelRatio); fast = 0; }
}
function resize() { const w = stage.clientWidth, h = stage.clientHeight; renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); }
addEventListener('resize', resize);
$('#hintText').innerHTML = hint(false);
frame();

// ---------- test hooks ----------
window.__THREE = THREE;
window.__viewer = { setView, scene, camera, CONFIG, get fps() { return fps.value; }, get info() { return { load: loadStats, pixelRatio, inst: instStats, calls: renderer.info.render.calls, tris: renderer.info.render.triangles }; } };
