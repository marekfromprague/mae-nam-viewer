// Mae Nam Plot 1 — Concept A web viewer (three.js 0.160.0).
// Loads one GLB (assets/site.glb), adds a sun + hemisphere "day" look and a dusk look with warm lamps,
// walk mode (raycast ground-follow + collision) and drone mode (orbit + fly), and the viewpoint presets.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { CONFIG, VIEWS, OVERVIEW, CREDITS, CREDIT_LINKS } from './config.js';
import { CollisionWorld } from './collision.js';

const D2R = Math.PI / 180;
const $ = s => document.querySelector(s);
const isTouch = matchMedia('(pointer:coarse)').matches;
if (isTouch) document.body.classList.add('touch');
const params = new URLSearchParams(location.search);

// ---------- renderer / scene ----------
const stage = $('#stage');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
const maxPR = isTouch ? CONFIG.renderer.maxPixelRatioMobile : CONFIG.renderer.maxPixelRatioDesktop;
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxPR));
renderer.setSize(stage.clientWidth, stage.clientHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = { AgX: THREE.AgXToneMapping, ACES: THREE.ACESFilmicToneMapping, Neutral: THREE.LinearToneMapping }[CONFIG.renderer.toneMapping] ?? THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = CONFIG.renderer.exposure;
renderer.shadowMap.enabled = CONFIG.renderer.castShadows;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;           // static scene + fixed sun: render the shadow map only when something changes
stage.appendChild(renderer.domElement); renderer.domElement.tabIndex = 0;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(CONFIG.fov, stage.clientWidth / stage.clientHeight, 0.08, 3000);
scene.fog = new THREE.Fog(CONFIG.day.fog, CONFIG.day.fogNear, CONFIG.day.fogFar);

// sky: vertical gradient as an equirect texture, also used (pre-filtered) as the environment for PBR reflections
function skyTexture(top, horizon, glow, mid) {
  const c = document.createElement('canvas'); c.width = 16; c.height = 256; const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, top); if (mid) grd.addColorStop(0.36, mid); grd.addColorStop(0.485, horizon); grd.addColorStop(0.5, horizon); grd.addColorStop(1, glow || "#8a8f7a");
  g.fillStyle = grd; g.fillRect(0, 0, 16, 256);
  const t = new THREE.CanvasTexture(c); t.mapping = THREE.EquirectangularReflectionMapping; t.colorSpace = THREE.SRGBColorSpace; return t;
}
const pmrem = new THREE.PMREMGenerator(renderer);
const SKY = {
  day: skyTexture(CONFIG.day.skyTop, CONFIG.day.skyHorizon, '#8e9a74'),
  dusk: skyTexture(CONFIG.dusk.skyTop, CONFIG.dusk.skyHorizon, "#2a2a2e", CONFIG.dusk.skyMid),
};
const ENV = { day: pmrem.fromEquirectangular(SKY.day).texture, dusk: pmrem.fromEquirectangular(SKY.dusk).texture };

// ---------- lights ----------
const hemi = new THREE.HemisphereLight(CONFIG.day.hemiSky, CONFIG.day.hemiGround, CONFIG.day.hemiIntensity); scene.add(hemi);
const sun = new THREE.DirectionalLight(CONFIG.day.sunColor, CONFIG.day.sunIntensity);
sun.castShadow = CONFIG.renderer.castShadows;
const sms = isTouch ? CONFIG.renderer.shadowMapSizeMobile : CONFIG.renderer.shadowMapSize;
sun.shadow.mapSize.set(sms, sms);
const E = CONFIG.renderer.shadowExtent;
Object.assign(sun.shadow.camera, { left: -E, right: E, top: E, bottom: -E, near: 1, far: 400 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);
const lamps = CONFIG.dusk.lamps.map(() => { const l = new THREE.PointLight(CONFIG.dusk.lampColor, 0, CONFIG.dusk.lampDistance, CONFIG.dusk.lampDecay); scene.add(l); return l; });

// ---------- site frame ----------
let site = null;                        // Object3D whose local frame = site-local coordinates
const L2W = (x, y, z) => site.localToWorld(new THREE.Vector3(x, y, z));
const W2L = v => site.worldToLocal(v.clone());

// ---------- controls ----------
const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enableDamping = true; orbit.maxPolarAngle = Math.PI * 0.495; orbit.minDistance = 2; orbit.maxDistance = 260;
orbit.screenSpacePanning = false;
let mode = 'drone';                      // 'walk' | 'drone'
let timeOfDay = 'day';
let world = null;                        // CollisionWorld
const player = { x: 0, z: 0, feet: 0, vy: 0, yaw: 0, pitch: 0, eye: CONFIG.eye };   // x/z/feet in WORLD coords, yaw in world
const bulbs = [];                        // {mat, emissive, intensity}
const lineMeshes = [];
let gltfLights = [];

// ---------- loading ----------
const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
const draco = new DRACOLoader(); draco.setDecoderPath('vendor/three/examples/jsm/libs/draco/gltf/'); loader.setDRACOLoader(draco);
const loadBar = $('#loadBar'), loadText = $('#loadText');

const tStart = performance.now(); let tGlb = 0;
loader.load(CONFIG.glb, async gltf => {
  tGlb = performance.now() - tStart;
  loadText.textContent = 'Preparing the walk-through…';
  const root = gltf.scene; scene.add(root); root.updateMatrixWorld(true);
  site = root.getObjectByName(CONFIG.siteNode);
  if (!site) { site = new THREE.Group(); site.rotation.y = CONFIG.siteRotationDeg * D2R; scene.add(site); site.updateMatrixWorld(true); console.warn('No "site" node; using default frame'); }
  const ao = prepareModel(root);
  world = new CollisionWorld(root, CONFIG);
  autoInstance(root);
  placeLights();
  buildViewChips();
  setTime('day'); setView(params.get('view') || 'overview');
  loadStats.setupMs = Math.round(performance.now() - tStart - tGlb); await ao; loadStats.aoMs = Math.round(performance.now() - tStart - tGlb);
  const tc = performance.now(); setTime('dusk'); await renderer.compileAsync(scene, camera); setTime('day'); await renderer.compileAsync(scene, camera); warm = true; loadStats.compileMs = Math.round(performance.now() - tc);   // warm both shader sets while the loader is up
  setTime(params.get('time') === 'dusk' ? 'dusk' : 'day');
  $('#loader').classList.add('done');
  window.__ready = true;
  loadStats.glbMs = Math.round(tGlb); loadStats.readyMs = Math.round(performance.now() - tStart);
  console.info('[viewer] loaded', JSON.stringify({ load: loadStats, collision: world.stats, instanced: instStats, ao: aoApplied, bulbs: bulbs.length, gltfLights: gltfLights.length }));
}, e => {
  if (e.total) { const p = e.loaded / e.total; loadBar.style.width = (p * 100).toFixed(1) + '%'; loadText.textContent = `Loading the site model… ${(e.loaded / 1048576).toFixed(1)} / ${(e.total / 1048576).toFixed(1)} MB`; }
}, err => { loadText.textContent = 'Could not load the model. Serve this folder over http (see README).'; console.error(err); });

function prepareModel(root) {
  // remove leftovers that are not part of Concept A (old spirit house in the massing GLB)
  const kill = [];
  const box = new THREE.Box3(), c = new THREE.Vector3();
  root.traverse(o => {
    if (!o.isMesh) return;
    box.setFromObject(o); box.getCenter(c); const l = W2L(c);
    for (const [x0, z0, x1, z1, top] of CONFIG.removeBoxes) if (l.x > x0 && l.x < x1 && l.z > z0 && l.z < z1 && box.max.y < top) kill.push(o);
  });
  for (const o of [...root.children]) if (CONFIG.hideAtOrigin.test(o.name) && o.position.lengthSq() < 1e-4) kill.push(o);
  kill.forEach(o => o.removeFromParent());
  if (kill.length) console.info('[viewer] removed leftovers:', kill.map(o => o.name).join(', '));
  const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const seen = new Set();
  root.traverse(o => {
    if (o.isLight) { gltfLights.push(o); o.visible = false; return; }
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const opaque = mats.every(m => !m.transparent && m.opacity >= 1);
    o.castShadow = opaque; o.receiveShadow = true;
    if (o.isInstancedMesh) o.computeBoundingSphere();
    for (const m of mats) {
      if (m.isMeshBasicMaterial && m.color && m.color.r > 0.6 && m.color.g < 0.2 && m.color.b < 0.2) { lineMeshes.push(o); o.visible = false; o.userData.noCollide = true; }
      if (seen.has(m)) continue; seen.add(m);
      for (const k of ['map', 'normalMap', 'roughnessMap', 'aoMap', 'emissiveMap']) if (m[k]) m[k].anisotropy = maxAniso;
      if ((m.name || '').startsWith(CONFIG.dusk.bulbPrefix)) bulbs.push({ mat: m, emissive: m.emissive.clone(), intensity: m.emissiveIntensity });
      if (m.transmission > 0) { m.transmission = 0; m.transparent = true; m.opacity = CONFIG.waterOpacity; m.depthWrite = false; m.needsUpdate = true; }
    }
  });
  if (!lineMeshes.length) $('#optLine').closest('label').hidden = true;
  return applyAO(root);
}

// Baked AO: LM_<name> objects carry a 2nd UV set; their materials are cloned per group so each group gets its own map.
function applyAO(root) {
  const tl = new THREE.TextureLoader(); const A = CONFIG.aoMaps; const jobs = [];
  for (const name of A.groups) {
    const obj = root.getObjectByName(name); if (!obj) continue;
    const meshes = []; obj.traverse(o => { if (o.isMesh && o.geometry.attributes.uv1) meshes.push(o); });
    if (!meshes.length) continue;
    jobs.push(new Promise(done => tl.load(A.dir + name + '_ao.webp', tex => {
      tex.channel = 1; tex.flipY = false; tex.colorSpace = THREE.NoColorSpace; tex.anisotropy = 4;
      const clones = new Map();
      for (const o of meshes) {
        const swap = m => { if (!clones.has(m)) { const c = m.clone(); c.aoMap = tex; c.aoMapIntensity = A.intensity; clones.set(m, c); for (const b of bulbs) if (b.mat === m) bulbs.push({ ...b, mat: c }); } return clones.get(m); };
        o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material);
      }
      aoApplied.push(name); done();
    }, undefined, () => { console.warn("[viewer] no AO map for", name); done(); })));
  }
  return Promise.all(jobs);
}
const aoApplied = [], loadStats = {}; let warm = false;

// Draw-call saver: meshes that share geometry + material (palms, dressing copies in B1/B3…) become one InstancedMesh.
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
    im.castShadow = list[0].castShadow; im.receiveShadow = true; im.name = 'auto_' + list[0].name; im.computeBoundingSphere();
    scene.add(im); instStats.groups++; instStats.meshes += list.length;
  }
}

function placeLights() {
  const c = L2W(...OVERVIEW.target);
  const d = CONFIG.day, a = d.sunAltDeg * D2R, z = d.sunAzDeg * D2R;
  // azimuth clockwise from true north; north = −Z, east = +X
  const dir = new THREE.Vector3(Math.sin(z) * Math.cos(a), Math.sin(a), -Math.cos(z) * Math.cos(a));
  sun.position.copy(c).addScaledVector(dir, 150); sun.target.position.copy(c); sun.target.updateMatrixWorld();
  CONFIG.dusk.lamps.forEach((p, i) => lamps[i].position.copy(L2W(...p)));
  buildLightSets();
  renderer.shadowMap.needsUpdate = true;
}

// Extra dusk lights (bollards, pool, porches): point lights + optional ground glow decals and bollard fixtures.
const extraLights = [], glows = [];   // {light, set} / {mesh, set}
let glowTex = null, capMat = null;
function buildLightSets() {
  glowTex ??= (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
    const r = g.createRadialGradient(64, 64, 0, 64, 64, 64); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.35, 'rgba(255,255,255,.45)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, 128, 128); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
  const posts = [];
  for (const set of CONFIG.dusk.lightSets) {
    const real = set.mobile || !isTouch;
    for (const p of set.points) {
      const w = L2W(...p);
      if (real) { const l = new THREE.PointLight(set.color, 0, set.distance, set.decay); l.position.copy(w); scene.add(l); extraLights.push({ light: l, set }); }
      if (set.glow) {
        const fy = world.floor(w.x, w.z, w.y + 0.2) ?? 0;
        const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: glowTex, color: set.color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
        m.rotation.x = -Math.PI / 2; m.scale.setScalar(set.glow[0] * 2); m.position.set(w.x, fy + 0.015, w.z); m.renderOrder = 2; m.visible = false; scene.add(m); glows.push({ mesh: m, set });
      }
      if (set.fixture) posts.push(w);
    }
  }
  if (posts.length) {   // small dark bollards (Ø 0.12 m) with a glowing cap; visible day and night
    const post = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.06, 0.07, 0.3, 10).translate(0, 0.15, 0), new THREE.MeshStandardMaterial({ color: '#2a2b2c', roughness: 0.6, metalness: 0.3 }), posts.length);
    capMat = new THREE.MeshStandardMaterial({ color: '#f4efe6', roughness: 0.4, emissive: '#000000' });
    const cap = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.062, 0.062, 0.05, 10).translate(0, 0.325, 0), capMat, posts.length);
    const m4 = new THREE.Matrix4();
    posts.forEach((w, i) => { const fy = world.floor(w.x, w.z, w.y + 0.2) ?? 0; m4.makeTranslation(w.x, fy, w.z); post.setMatrixAt(i, m4); cap.setMatrixAt(i, m4); });
    post.castShadow = true; post.computeBoundingSphere(); cap.computeBoundingSphere(); scene.add(post, cap);
  }
}

// ---------- day / dusk ----------
function setTime(t) {
  timeOfDay = t; const day = t === 'day', S = day ? CONFIG.day : CONFIG.dusk;
  scene.background = SKY[t]; scene.environment = ENV[t];
  scene.fog.color.set(S.fog); scene.fog.near = S.fogNear; scene.fog.far = S.fogFar;
  hemi.color.set(S.hemiSky); hemi.groundColor.set(S.hemiGround); hemi.intensity = S.hemiIntensity;
  sun.visible = day; sun.color.set(CONFIG.day.sunColor); sun.intensity = CONFIG.day.sunIntensity;
  renderer.toneMappingExposure = S.exposure;
  for (const l of lamps) { l.intensity = day ? 0 : CONFIG.dusk.lampIntensity; l.color.set(CONFIG.dusk.lampColor); l.distance = CONFIG.dusk.lampDistance; }
  for (const { light, set } of extraLights) { light.intensity = day ? 0 : set.intensity; light.color.set(set.color); light.distance = set.distance; }
  for (const { mesh, set } of glows) { mesh.visible = !day; mesh.material.opacity = set.glow[1]; mesh.material.color.set(set.color); }
  if (capMat) { capMat.emissive.set(day ? '#000000' : '#ffb873'); capMat.emissiveIntensity = day ? 0 : 4; }
  for (const l of gltfLights) l.visible = !day && CONFIG.dusk.useGltfLights;
  for (const b of bulbs) {
    if (day) { b.mat.emissive.copy(b.emissive); b.mat.emissiveIntensity = b.intensity; }
    else { b.mat.emissive.set(CONFIG.dusk.bulbEmissive); b.mat.emissiveIntensity = CONFIG.dusk.bulbEmissiveIntensity; }
  }
  const seen = new Set();
  scene.traverse(o => { if (!o.isMesh) return; for (const m of [].concat(o.material)) if (!seen.has(m) && 'envMapIntensity' in m) { seen.add(m); m.envMapIntensity = S.envIntensity; } });
  renderer.shadowMap.needsUpdate = true;
  document.querySelectorAll('[data-time]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.time === t)));
}

// ---------- walk physics ----------
const tmpDir = new THREE.Vector3();
function snapFeet(x, z, fromY) { return world.footFloor(x, z, fromY); }
// Preset spots can end up inside dressing (sofa, shrub). Search outward for the nearest free standing spot.
const _fd = new THREE.Vector3();
function freeSpot(x, z, f) {
  for (let r = 0; r <= 1.8; r += 0.15) {
    const n = r ? Math.max(8, Math.round(r * 16)) : 1;
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      const ft = world.floor(px, pz, f + CONFIG.stepUp);
      if (ft === null || ft < f - 0.35) continue;
      if (world.headroom(px, pz, ft) < (f > 2.3 ? 1.2 : 1.7)) continue;
      let ok = true;
      for (let k = 0; k < 8 && ok; k++) { _fd.set(Math.cos(k * Math.PI / 4), 0, Math.sin(k * Math.PI / 4)); if (world.blocked(px, pz, ft, _fd, 0.02, CONFIG.radius, 1.6)) ok = false; }
      if (ok) return { x: px, z: pz, feet: ft };
    }
  }
  return { x, z, feet: world.floor(x, z, f + CONFIG.stepUp) ?? f };
}
function tryMove(dx, dz) {
  const nx = player.x + dx, nz = player.z + dz, dist = Math.hypot(dx, dz); if (!dist) return true;
  const f = snapFeet(nx, nz, player.feet + CONFIG.stepUp + 0.02);
  if (f === null) return false;                                         // water or nothing underneath
  if (f > player.feet + CONFIG.stepUp + 0.01) return false;
  const base = Math.max(f, player.feet);
  const head = world.headroom(nx, nz, base);
  if (head < 1.15) return false;                                        // too low to pass
  tmpDir.set(dx, 0, dz);
  if (world.blocked(player.x, player.z, base, tmpDir, dist, CONFIG.radius, Math.min(1.75, head))) return false;
  player.x = nx; player.z = nz; return true;
}
function updateFeet(dt) {
  const f = snapFeet(player.x, player.z, player.feet + CONFIG.stepUp + 0.02);
  if (f === null) return;
  if (f >= player.feet) { player.feet += (f - player.feet) * Math.min(1, dt * 14); player.vy = 0; }    // smooth step-up
  else { player.vy -= 9.8 * dt; player.feet = Math.max(f, player.feet + player.vy * dt); if (player.feet === f) player.vy = 0; }
  // crouch under low ceilings (lofts)
  const head = world.headroom(player.x, player.z, player.feet, 2.2);
  const targetEye = Math.max(0.9, Math.min(CONFIG.eye, head - 0.3));
  player.eye += (targetEye - player.eye) * Math.min(1, dt * 6);
}

// ---------- views ----------
const hintText = $('#hintText'), where = $('#where'), pad = $('#pad');
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
function setView(id) {
  const v = VIEWS.find(v => v.id === id) || VIEWS[0];
  markView(v.id);
  if (v.drone) {
    const t = L2W(...OVERVIEW.target); orbit.target.copy(t); camera.position.copy(t).add(new THREE.Vector3(...OVERVIEW.offsetWorld));
    setMode('drone', false); orbit.update(); return;
  }
  const pW = L2W(v.p[0], v.f, v.p[1]), lW = L2W(v.look[0], v.f, v.look[1]);
  const spot = freeSpot(pW.x, pW.z, v.f); player.x = spot.x; player.z = spot.z; player.vy = 0;
  player.feet = spot.feet;
  player.yaw = Math.atan2(lW.z - spot.z, lW.x - spot.x); player.pitch = v.pitch ?? -0.06;
  player.eye = Math.max(0.9, Math.min(CONFIG.eye, world.headroom(player.x, player.z, player.feet) - 0.3));
  setMode('walk', false);
}
function setMode(m, fromToggle = true) {
  if (fromToggle && m === mode) return;
  if (fromToggle && m === 'walk') {                       // drop down at the point the drone looks at
    const t = orbit.target; const f = snapFeet(t.x, t.z, 60);
    player.x = t.x; player.z = t.z; player.feet = f ?? 0; player.vy = 0;
    const d = new THREE.Vector3().subVectors(t, camera.position); player.yaw = Math.atan2(d.z, d.x); player.pitch = -0.06; player.eye = CONFIG.eye;
    markView(null);
  }
  if (fromToggle && m === 'drone') {                      // lift off behind and above the walker
    const fwd = new THREE.Vector3(Math.cos(player.yaw), 0, Math.sin(player.yaw));
    orbit.target.set(player.x, player.feet, player.z).addScaledVector(fwd, 6);
    camera.position.set(player.x, player.feet + 14, player.z).addScaledVector(fwd, -12);
    markView(null);
  }
  mode = m; orbit.enabled = m === 'drone';
  pad.hidden = !isTouch;
  pad.querySelectorAll('.k-rise,.k-sink').forEach(b => b.hidden = m !== 'drone');
  if (m === 'walk') hintText.innerHTML = isTouch ? 'Drag to look around · arrows to walk' : 'Drag to look · <b>W A S D</b> / arrows to walk · <b>Shift</b> to run';
  else hintText.innerHTML = isTouch ? 'Drag to orbit · pinch to zoom · two fingers to pan · arrows to fly' : 'Drag to orbit · right-drag to pan · scroll to zoom · <b>W A S D</b> to fly · <b>E</b>/<b>Q</b> up/down';
  if (m === 'drone') where.textContent = '';
}
document.querySelectorAll('[data-time]').forEach(b => b.addEventListener('click', () => setTime(b.dataset.time)));

// ---------- input ----------
let drag = null;
renderer.domElement.addEventListener('pointerdown', e => { if (mode !== 'walk') return; drag = { x: e.clientX, y: e.clientY, id: e.pointerId }; renderer.domElement.setPointerCapture(e.pointerId); });
renderer.domElement.addEventListener('pointermove', e => {
  if (!drag || e.pointerId !== drag.id) return; const k = isTouch ? 0.005 : 0.0035;
  player.yaw += (e.clientX - drag.x) * k; player.pitch = Math.max(-1.2, Math.min(1.1, player.pitch - (e.clientY - drag.y) * k)); drag.x = e.clientX; drag.y = e.clientY;
});
const endDrag = e => { if (drag && e.pointerId === drag.id) drag = null; };
renderer.domElement.addEventListener('pointerup', endDrag); renderer.domElement.addEventListener('pointercancel', endDrag);
const keys = new Set();
const KEYS = ['w', 'a', 's', 'd', 'q', 'e', ' ', 'c', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift'];
addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || $('#about').open) return; const k = e.key.toLowerCase();
  if (KEYS.includes(k)) { keys.add(k); e.preventDefault(); }
});
addEventListener('keyup', e => keys.delete(e.key.toLowerCase())); addEventListener('blur', () => keys.clear());
const padKeys = new Set();
pad.querySelectorAll('button').forEach(b => {
  const k = b.dataset.k; const on = e => { e.preventDefault(); padKeys.add(k); b.classList.add('on'); }; const off = () => { padKeys.delete(k); b.classList.remove('on'); };
  b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointerleave', off); b.addEventListener('pointercancel', off);
  b.addEventListener('contextmenu', e => e.preventDefault());
});

// ---------- about ----------
$('#creditLine').textContent = CREDITS;
$('#creditLinks').innerHTML = CREDIT_LINKS.map(([t, u]) => `<li><a href="${u}" target="_blank" rel="noopener">${t}</a></li>`).join('');
$('#aboutBtn').addEventListener('click', () => $('#about').showModal());
$('#optLine').addEventListener('change', e => lineMeshes.forEach(m => m.visible = e.target.checked));

// ---------- loop ----------
const clock = new THREE.Clock(); const look = new THREE.Vector3();
const has = (...k) => k.some(x => keys.has(x) || padKeys.has(x));
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (world && mode === 'walk') {
    const fwd = (has('w', 'arrowup', 'f') ? 1 : 0) - (has('s', 'arrowdown', 'b') ? 1 : 0);
    const str = (has('d', 'r') ? 1 : 0) - (has('a', 'l') ? 1 : 0);
    if (keys.has('arrowleft')) player.yaw -= 1.8 * dt; if (keys.has('arrowright')) player.yaw += 1.8 * dt;
    if (fwd || str) {
      const sp = (keys.has('shift') ? CONFIG.runSpeed : CONFIG.walkSpeed) * dt / (fwd && str ? Math.SQRT2 : 1);
      const cx = Math.cos(player.yaw), cz = Math.sin(player.yaw);
      const mx = (cx * fwd - cz * str) * sp, mz = (cz * fwd + cx * str) * sp;
      if (!tryMove(mx, mz)) { tryMove(mx, 0) || tryMove(0, mz); }
    }
    updateFeet(dt);
    const ey = player.feet + player.eye;
    camera.position.set(player.x, ey, player.z);
    look.set(player.x + Math.cos(player.yaw) * Math.cos(player.pitch), ey + Math.sin(player.pitch), player.z + Math.sin(player.yaw) * Math.cos(player.pitch));
    camera.lookAt(look);
    const ft = W2L(camera.position).y - player.eye;
    where.textContent = ft > 3.9 ? 'Upper floor +4.2 m' : ft > 2.2 ? 'Sleeping loft +2.5 m' : ft > 0.9 ? 'Main house +1.0 m' : ft > 0.55 ? 'Pool edge' : ft > 0.3 ? 'Deck / bungalow floor' : '';
  } else if (mode === 'drone') {
    const fwd = (has('w', 'arrowup', 'f') ? 1 : 0) - (has('s', 'arrowdown', 'b') ? 1 : 0);
    const str = (has('d', 'arrowright', 'r') ? 1 : 0) - (has('a', 'arrowleft', 'l') ? 1 : 0);
    const up = (has('e', ' ', 'u') ? 1 : 0) - (has('q', 'c', 'dn') ? 1 : 0);
    if (fwd || str || up) {
      const dist = camera.position.distanceTo(orbit.target); const sp = THREE.MathUtils.clamp(dist * 0.8, 4, 45) * dt * (keys.has('shift') ? 2.5 : 1);
      const f = new THREE.Vector3(); camera.getWorldDirection(f); f.y = 0; f.normalize(); const r = new THREE.Vector3(-f.z, 0, f.x);
      const m = f.multiplyScalar(fwd * sp).addScaledVector(r, str * sp); m.y = up * sp;
      if (orbit.target.y + m.y < 0) m.y = -orbit.target.y;
      orbit.target.add(m); camera.position.add(m);
    }
    orbit.update();
    if (camera.position.y < 0.6) camera.position.y = 0.6;
  }
  if (warm) renderer.render(scene, camera);   // no frames until shaders are compiled (async) behind the loader
  fps.tick();
  requestAnimationFrame(frame);
}
const fps = { n: 0, t: performance.now(), value: 0, tick() { this.n++; const t = performance.now(); if (t - this.t > 1000) { this.value = this.n * 1000 / (t - this.t); this.n = 0; this.t = t; } } };
function resize() { const w = stage.clientWidth, h = stage.clientHeight; renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); }
addEventListener('resize', resize);
setMode('drone', false);
frame();

// ---------- test / tuning hooks ----------
// test hook: put the walker at site-local (x, z) on floor f, facing site-local direction (dx, dz)
function teleport(x, z, f, dx, dz) {
  const p = L2W(x, f, z), l = L2W(x + dx, f, z + dz);
  player.x = p.x; player.z = p.z; player.feet = world.floor(p.x, p.z, f + 0.3) ?? f; player.vy = 0;
  player.yaw = Math.atan2(l.z - p.z, l.x - p.x); player.pitch = -0.06; setMode('walk', false); markView(null);
  return W2L(new THREE.Vector3(player.x, player.feet, player.z));
}
const localPos = () => W2L(new THREE.Vector3(player.x, player.feet, player.z));
window.__THREE = THREE;
window.__viewer = { setView, setTime, setMode, player, teleport, localPos, get world() { return world; }, get site() { return site; }, get fps() { return fps.value; }, get info() { return { load: loadStats, mode, timeOfDay, ao: aoApplied.length, inst: instStats, calls: renderer.info.render.calls, tris: renderer.info.render.triangles }; }, scene, camera, CONFIG };
if (params.has('tune')) import('./tune.js').then(m => m.tune({ CONFIG, renderer, sun, hemi, lamps, setTime, get time() { return timeOfDay; } }));
