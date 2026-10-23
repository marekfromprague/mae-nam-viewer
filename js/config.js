// Mae Nam Plot 1 — viewer settings. Everything you might want to tune lives here.
// Coordinates are SITE-LOCAL metres (origin = NW plot corner, +x along the north boundary, +z across to the south, y up),
// i.e. the frame of the GLB node "site" (see reference-notes.md §1). Open the viewer with ?tune to get live sliders.

export const CONFIG = {
  glb: 'assets/site.glb',
  siteNode: 'site',              // node whose local frame = site-local coords (fallback: rotate −21.6° about Y)
  siteRotationDeg: -21.6,

  eye: 1.62,                     // standing eye height above the floor
  stepUp: 0.3,                   // max step the walker climbs
  radius: 0.25,                  // walker body radius (wall distance)
  walkSpeed: 1.5, runSpeed: 3.2, // m/s (Shift = run)
  fov: 60,

  renderer: {
    toneMapping: 'AgX',          // 'AgX' matches the Blender renders (AgX Punchy) better than 'ACES' (more saturated/orange)
    exposure: 1.05,
    maxPixelRatioDesktop: 2,
    maxPixelRatioMobile: 1.5,
    shadowMapSize: 2048, shadowMapSizeMobile: 1024,
    shadowExtent: 42,            // half-size of the sun shadow box (m), centred on the site
    castShadows: true,           // set false if the GLB textures already contain baked shadows and they look doubled
  },

  day: {
    // Koh Samui, 15 March 16:30 ICT: altitude 28.9°, azimuth 262.3° from true north (true north = three.js −Z)
    sunAltDeg: 28.9, sunAzDeg: 262.3,
    sunColor: '#ffe7c4', sunIntensity: 2.4,
    hemiSky: '#dbeefa', hemiGround: '#a3a08a', hemiIntensity: 1.1,
    envIntensity: 0.9,           // sky reflections on PBR materials
    skyTop: '#7fb6e0', skyHorizon: '#e3eef1', fog: '#d6e7ee', fogNear: 90, fogFar: 420,
    exposure: 1.25,              // AgX needs more exposure than ACES
  },
  dusk: {
    hemiSky: '#6a7fb4', hemiGround: '#2c2a33', hemiIntensity: 1.1,
    envIntensity: 0.3,
    skyTop: '#101d3d', skyMid: '#2f4577', skyHorizon: '#b98a7e', fog: '#2c3858', fogNear: 60, fogFar: 340,
    exposure: 1.35,
    lampColor: '#ffb46b',
    lampIntensity: 14,           // candela (physical lights)
    lampDistance: 10, lampDecay: 2,
    // warm lamps at the bungalow living rooms (B+2, 3.0, 7.0) and main-house floors (reference-notes.md)
    lamps: [[9.0, 3.0, 7.0], [17.81, 3.0, 7.0], [26.7, 3.0, 7.0], [41.0, 3.6, 6.0], [41.0, 6.5, 6.0]],
    // More dusk lights. mobile:false sets become glow decals only on phones (each real point light costs GPU time per pixel).
    // glow = soft additive light pool on the ground [radius m, opacity]; fixture = small dark bollard post with a glowing cap.
    lightSets: [
      { name: 'path bollards', color: '#ffb873', intensity: 2.2, distance: 4, decay: 2, mobile: false, glow: [1.5, 0.5], fixture: true,
        points: [[9.75, 0.25, 14.35], [12.60, 0.25, 14.20], [15.45, 0.25, 14.05], [18.30, 0.25, 13.90], [21.15, 0.25, 13.75], [24.00, 0.25, 13.60], [26.85, 0.25, 13.46], [29.70, 0.25, 13.31]] },
      { name: 'pool', color: '#5fdcff', intensity: 7, distance: 5, decay: 2, mobile: true, points: [[33.2, 0.0, 6.7]] },
    ],
    bulbPrefix: 'D_bulb',        // materials whose name starts with this glow at dusk
    bulbEmissive: '#ffcf8a', bulbEmissiveIntensity: 6,
    useGltfLights: false,        // true: also switch on KHR_lights_punctual lights from the GLB at dusk
  },

  // Placeholder clean-up (only matters for the old massing GLB): meshes whose centre falls in these site-local boxes are removed.
  // [x0, z0, x1, z1, maxTop]. The first one is the old spirit house (removed from Concept A).
  // The final web GLB no longer has it, so the list is empty; use [[14.4, 1.5, 15.8, 2.9, 2.2]] with the old massing GLB.
  removeBoxes: [],
  // Meshes left out of walk collision (mesh or material name, regex). Instanced meshes with more triangles than this are skipped too.
  noCollide: /grass_blades|grass_clump|petal|_nocol/i,
  maxInstancedCollisionTris: 300000,
  noCollideNodes: /^(grass_clump|potted_plant|Plant_pot)/i,               // whole subtrees left out of collision
  treeNodes: /^(Palm_|Frangipani_|SRC_coconut|SRC_frangipani)/i,          // replaced by a trunk cylinder in collision
  softFoliage: /^shrub/i,                // shrub-card materials you can brush through…
  solidFoliageNodes: /^Hedges/,          // …except inside the privacy hedges, which block

  // Baked ambient occlusion (2nd UV set): every object named LM_<name> gets aoMaps/<name>_ao.webp
  aoMaps: { dir: 'assets/lightmaps/', groups: ['LM_B1', 'LM_B2', 'LM_B3', 'LM_MainHouse', 'LM_Pool', 'LM_Landscape', 'LM_Ground'], intensity: 1.0 },
  // Real-time transmission renders the whole scene twice. Pool water is drawn as plain transparency instead.
  waterOpacity: 0.82,
  autoInstanceMin: 3,            // meshes sharing geometry + material, at least this many → one InstancedMesh (fewer draw calls)
  // Hide stray export leftovers: root-level nodes matching this AND sitting at the world origin.
  hideAtOrigin: /^(SRC_|grass_clump)/,
};

// View presets — same names as the current viewer's Concept A row. p = position (x, z), f = floor height, look = (x, z).
// Eye = f + 1.62 (in the loft the walker crouches automatically under the low roof).
export const VIEWS = [
  { id: 'overview',  label: 'Overview', drone: true },
  { id: 'b_path',    label: 'Guest path',        p: [12.0, 14.6],  f: 0,    look: [29, 13.6] },
  { id: 'b1_gate',   label: 'B1 gate',           p: [10.65, 13.8], f: 0,    look: [10.65, 9.0] },
  { id: 'b1_porch',  label: 'B1 porch',          p: [5.7, 9.3],    f: 0.35, look: [6.6, 4.5] },
  { id: 'b2_garden', label: 'B2 garden',         p: [12.3, 12.9],  f: 0,    look: [15.61, 5.2] },
  { id: 'b2_in',     label: 'B2 living',         p: [16.51, 9.1],  f: 0.45, look: [18.81, 4.7] },
  { id: 'b3_porch',  label: 'B3 porch',          p: [23.4, 9.3],   f: 0.35, look: [24.3, 4.5] },
  { id: 'b1_loft',   label: 'B1 loft',           p: [9.0, 4.0],    f: 2.5,  look: [9.0, 1.0] },
  { id: 'c_pool',    label: 'Guest pool deck',   p: [30.15, 13.6], f: 0.35, look: [40.2, 5.4] },
  { id: 'c_lounge',  label: 'Ground apt living', p: [43.3, 9.2],   f: 1.0,  look: [33.2, 4.9] },
  { id: 'c_bed',     label: 'Upper apt living',  p: [43.3, 9.2],   f: 4.2,  look: [33.2, 4.9] },
  { id: 'c_balc',    label: 'Upper balcony',     p: [37.8, 9.5],   f: 4.2,  look: [28.2, 5.4] },
  { id: 'h_bed',     label: 'Apt bedroom',       p: [44.9, 6.1],   f: 1.0,  look: [48.5, 2.9] },
  { id: 'h_stair',   label: 'Outside stair',     p: [37.1, 13.1],  f: 0,    look: [44.7, 10.3] },
];
// Overview (drone): target = site-local (41.2, 0, 4.9); camera offset in WORLD axes as in the current viewer.
export const OVERVIEW = { target: [41.2, 0, 4.9], offsetWorld: [-30, 27, -24] };

export const CREDITS = '3D models: “Coconut Palm” by evolveduk and “Realistic HD Frangipani tree (13/50)” by PlantCatalog, licensed CC BY 4.0 (sketchfab.com). Textures and HDRIs: Poly Haven (CC0).';
export const CREDIT_LINKS = [
  ['Coconut Palm — evolveduk (CC BY 4.0)', 'https://sketchfab.com/3d-models/coconut-palm-26e787f2ff2e4c0fb004c3b0210805a3'],
  ['Realistic HD Frangipani tree (13/50) — PlantCatalog (CC BY 4.0)', 'https://sketchfab.com/3d-models/6afe1892d9fb419993cdfe54721110e9'],
  ['Poly Haven (CC0)', 'https://polyhaven.com'],
];
