// Mae Nam project — web viewer (three.js 0.160.0): Concept A (default) and the existing situation.
// Each model is one GLB with Cycles-baked lighting (lightmaps on uv1); orbit / zoom / pan controls and view presets per model.
// No real-time lights: baked surfaces get their light from the lightmaps; unbaked ones (trees, context) get sky + ambient + a shader-only sun.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { CONFIG, MODELS, CREDITS, CREDIT_LINKS } from './config.js';

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
// Unbaked surfaces get a flat "lightmap" (even ambient light) plus a sun term injected into their shader.
const ambientMap = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1); ambientMap.needsUpdate = true;
const sunWorld = (() => { const a = CONFIG.sun.altDeg * D2R, z = CONFIG.sun.azDeg * D2R;   // true north = −Z, east = +X
  return new THREE.Vector3(Math.sin(z) * Math.cos(a), Math.sin(a), -Math.cos(z) * Math.cos(a)).normalize(); })();
const sunU = { uSunDir: { value: new THREE.Vector3() }, uSunCol: { value: new THREE.Color(CONFIG.sun.color).multiplyScalar(Math.PI * CONFIG.liveSun) } };
function addSun(m) {
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, sunU);
    sh.fragmentShader = 'uniform vec3 uSunDir;\nuniform vec3 uSunCol;\n' + sh.fragmentShader.replace('#include <lights_fragment_end>',
      '#include <lights_fragment_end>\n\treflectedLight.directDiffuse += BRDF_Lambert( diffuseColor.rgb ) * uSunCol * max( dot( normal, uSunDir ), 0.0 );');
  };
  m.customProgramCacheKey = () => 'liveSun';
}

// site frame: site-local → world (spec §1)
const site = new THREE.Group(); site.rotation.y = CONFIG.siteRotationDeg * D2R; scene.add(site); site.updateMatrixWorld(true);
const L2W = (x, y, z) => site.localToWorld(new THREE.Vector3(x, y, z));

// ---------- controls ----------
const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enableDamping = true; orbit.dampingFactor = 0.08;
orbit.maxPolarAngle = Math.PI * 0.495;
orbit.screenSpacePanning = false;
orbit.zoomToCursor = true;

// ---------- models ----------
const loader = new GLTFLoader();
const draco = new DRACOLoader(); draco.setDecoderPath('vendor/three/examples/jsm/libs/draco/gltf/'); loader.setDRACOLoader(draco);
const loadBar = $('#loadBar'), loadText = $('#loadText');
const loaded = {};          // key → { root, lines, stats }
let current = null, warm = false, loadingKey = null;
const instStats = { groups: 0, meshes: 0 };

function loadModel(key) {
  const M = MODELS[key], t0 = performance.now(), stats = {};
  const tl = new THREE.TextureLoader(), maps = {};
  const lm = Promise.all(M.lightmaps.groups.map(name => new Promise(done => tl.load(M.lightmaps.dir + name + '.webp', tex => {
    tex.channel = 1; tex.flipY = false; tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; maps[name] = tex; done();
  }, undefined, () => { console.warn('[viewer] no lightmap for', name); done(); }))));
  const glb = new Promise((res, rej) => loader.load(M.glb, res, e => {
    if (e.total) { const p = e.loaded / e.total; loadBar.style.width = (p * 100).toFixed(1) + '%'; loadText.textContent = `Loading ${M.label}… ${(e.loaded / 1048576).toFixed(1)} / ${(e.total / 1048576).toFixed(1)} MB`; }
  }, rej));
  return Promise.all([glb, lm]).then(async ([gltf]) => {
    stats.loadMs = Math.round(performance.now() - t0);
    loadText.textContent = 'Preparing the view…';
    const root = new THREE.Group(); root.name = 'model_' + key; root.add(gltf.scene); scene.add(root); root.updateMatrixWorld(true);
    const lines = prepareModel(gltf.scene, maps);
    autoInstance(gltf.scene, root);
    const tc = performance.now(); await renderer.compileAsync(scene, camera); stats.compileMs = Math.round(performance.now() - tc);
    stats.readyMs = Math.round(performance.now() - t0);
    console.info('[viewer] loaded', key, JSON.stringify({ load: stats, lightmaps: Object.keys(maps).length, instanced: instStats }));
    return (loaded[key] = { root, lines, stats });
  });
}

function prepareModel(root, maps) {
  const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const k = Math.PI * CONFIG.lightmapScale * CONFIG.lightmapIntensity;
  const clones = new Map(), lines = [];   // per lightmap group: material → clone carrying that group's map
  root.traverse(o => {
    if (o.isLight) { o.visible = false; return; }
    if (!o.isMesh) return;
    if (/^Boundary/i.test(o.name) || /^Boundary/i.test(o.parent?.name || '')) { lines.push(o); o.visible = $('#optLine').checked; return; }
    let g = null; for (let p = o; p; p = p.parent) if (maps[p.name]) { g = p.name; break; }
    const swap = m => {
      for (const t of ['map', 'normalMap', 'roughnessMap']) if (m[t]) m[t].anisotropy = maxAniso;
      if (m.transmission > 0) { m.transmission = 0; m.transparent = true; m.opacity = CONFIG.waterOpacity; m.depthWrite = false; }
      const glassy = m.transparent || /glass|water/i.test(m.name);
      if (!g || glassy || !o.geometry.attributes.uv1) {
        if (!m.userData.live) {
          m.userData.live = true; m.envMapIntensity = CONFIG.liveEnvIntensity;
          if (!m.lightMap && 'lightMap' in m) { m.lightMap = ambientMap; m.lightMapIntensity = Math.PI * CONFIG.liveAmbient; }
          if (!glassy) addSun(m);
          m.needsUpdate = true;
        }
        return m;
      }
      const key = g + '|' + m.uuid;
      if (!clones.has(key)) { const c = m.clone(); c.lightMap = maps[g]; c.lightMapIntensity = k; c.envMapIntensity = CONFIG.bakedEnvIntensity; clones.set(key, c); }
      return clones.get(key);
    };
    o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material);
  });
  return lines;
}

// Draw-call saver: meshes that share geometry + material (palms, trees, repeated dressing) become one InstancedMesh.
function autoInstance(root, parent) {
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
    parent.add(im); instStats.groups++; instStats.meshes += list.length;
  }
}

// ---------- modes ----------
function buildModeChips() {
  const row = $('#modeStrip');
  for (const [key, M] of Object.entries(MODELS)) {
    const b = document.createElement('button'); b.className = 'chip'; b.dataset.mode = key; b.textContent = M.label; b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => setMode(key)); row.appendChild(b);
  }
}
async function setMode(key, viewId) {
  if (!MODELS[key] || key === current || loadingKey) return;
  if (!loaded[key]) {
    loadingKey = key; $('#loader').classList.remove('done'); loadBar.style.width = '0%';
    try { await loadModel(key); } catch (e) { loadText.textContent = 'Could not load the model. Serve this folder over http (see README).'; console.error(e); loadingKey = null; return; }
    loadingKey = null;
  }
  for (const [k, L] of Object.entries(loaded)) L.root.visible = k === key;
  current = key; const M = MODELS[key];
  document.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === key)));
  $('#subT').textContent = M.sub;
  $('#lineBtn').hidden = !loaded[key].lines.length;
  buildViewChips(M.views);
  setView(viewId && M.views.some(v => v.id === viewId) ? viewId : M.views[0].id, false);
  $('#loader').classList.add('done');
}

// ---------- views ----------
function buildViewChips(views) {
  const strip = $('#viewStrip'); strip.textContent = '';
  for (const v of views) {
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
  const views = MODELS[current].views; const v = views.find(v => v.id === id) || views[0];
  markView(v.id);
  const portrait = camera.aspect < 1;
  const eye = L2W(...(portrait && v.portrait ? v.portrait : v.eye)), tgt = L2W(...v.target);
  orbit.minDistance = Math.min(v.min, eye.distanceTo(tgt)); orbit.maxDistance = Math.max(v.max, eye.distanceTo(tgt));
  orbit.rotateSpeed = v.room ? 0.6 : 1; orbit.enablePan = !v.room;
  $('#hintText').innerHTML = hint(v.room);
  if (!animate) { tween = null; camera.position.copy(eye); orbit.target.copy(tgt); orbit.update(); return; }
  tween = { t: 0, p0: camera.position.clone(), t0: orbit.target.clone(), p1: eye, t1: tgt };
}
function hint(room) {
  if (room) return isTouch ? 'Drag to look around · pinch to zoom' : 'Drag to look around · scroll to zoom';
  return isTouch ? 'Drag to orbit · pinch to zoom · two fingers to pan' : 'Drag to orbit · right-drag to pan · scroll to zoom';
}
orbit.addEventListener('start', () => { tween = null; markView(null); });

// ---------- about / boundary ----------
$('#creditLine').textContent = CREDITS;
$('#creditLinks').innerHTML = CREDIT_LINKS.map(([t, u]) => `<li><a href="${u}" target="_blank" rel="noopener">${t}</a></li>`).join('');
$('#aboutBtn').addEventListener('click', () => $('#about').showModal());
$('#optLine').addEventListener('change', e => { for (const L of Object.values(loaded)) L.lines.forEach(m => m.visible = e.target.checked); $('#lineBtn').setAttribute('aria-pressed', String(e.target.checked)); });
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
  sunU.uSunDir.value.copy(sunWorld).transformDirection(camera.matrixWorldInverse);
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
buildModeChips();
frame();

// start: Concept A unless ?mode=existing
const tStart = performance.now();
setMode(MODELS[params.get('mode')] ? params.get('mode') : Object.keys(MODELS)[0], params.get('view')).then(() => {
  warm = true; window.__ready = true;
  console.info('[viewer] ready', Math.round(performance.now() - tStart), 'ms');
});

// ---------- test hooks ----------
window.__THREE = THREE;
window.__viewer = { setView, setMode, scene, camera, CONFIG, get mode() { return current; }, get loading() { return !!loadingKey; }, get fps() { return fps.value; }, get info() { return { stats: current && loaded[current].stats, pixelRatio, inst: instStats, calls: renderer.info.render.calls, tris: renderer.info.render.triangles }; } };
