// Mae Nam project — viewer settings. Everything you might want to tune lives here.
// Coordinates are SITE-LOCAL metres (origin = NW plot corner, +x along the north boundary, +z across to the south, y up).
// The GLBs are in world coordinates; site-local → world is a rotation of −21.6° about Y (spec §1).

export const CONFIG = {
  siteRotationDeg: -21.6,
  fov: 55,

  renderer: {
    toneMapping: 'AgX',          // matches the Blender renders (AgX)
    exposure: 1.0,
    maxPixelRatioDesktop: 2,
    maxPixelRatioMobile: 1.5,
    minPixelRatio: 0.75,         // the adaptive resolution never goes below this
  },

  // Cycles-baked lighting: every LM_<group> mesh has a 2nd UV set and gets <dir>/LM_<group>.webp.
  // The maps hold diffuse irradiance / π, sRGB-encoded after dividing by `scale` (see web/README.md).
  lightmapScale: 3.0, lightmapIntensity: 1.0,
  bakedEnvIntensity: 0.35,       // sky reflections on baked surfaces (their diffuse light is already in the lightmap)
  // Unbaked meshes (palms, trees, context, water) have no real-time lights: sky reflections + a flat ambient term + a shader-only sun term.
  liveEnvIntensity: 0.8,
  liveAmbient: 0.55,             // same units as the baked maps: irradiance / π
  liveSun: 2.1,                  // sun term on unbaked meshes, same units (a sunlit wall in the bake is ≈2–3)
  sun: { altDeg: 28.9, azDeg: 262.3, color: '#fff1dc' },   // Koh Samui, 15 March 16:30 (as the bake); azimuth clockwise from true north
  waterOpacity: 0.82,
  autoInstanceMin: 3,            // meshes sharing geometry + material, at least this many → one InstancedMesh

  sky: { top: '#7fb6e0', horizon: '#e3eef1', ground: '#8e9a74', fog: '#d6e7ee', fogNear: 120, fogFar: 600 },
  transitionSec: 1.2,
};

// Models. The first one opens by default; the others load when their chip is clicked.
// View presets: eye / target are site-local [x, y, z] (y = height above the plot datum).
// Outdoor views orbit around the target; room views (room: true) have a target close to the eye, so dragging looks around the room.
// min / max = zoom limits (m from the target). portrait = optional eye for narrow (portrait) screens.
export const MODELS = {
  conceptA: {
    label: 'Concept A', sub: 'Concept A · 3 bungalows + main house · Koh Samui',
    glb: 'assets/site.glb',
    lightmaps: { dir: 'assets/lightmaps/', groups: ['LM_B1', 'LM_B2', 'LM_B3', 'LM_MainHouse', 'LM_Pool', 'LM_Landscape', 'LM_Ground'] },
    views: [
      { id: 'overview',  label: 'Overview',                 eye: [0.0, 27.0, 34.0],   target: [24.0, 0.0, 7.0],   min: 6,   max: 160, portrait: [14.0, 52.0, 44.0] },
      { id: 'arrival',   label: 'Arrival',                  eye: [10.8, 1.65, 15.6],  target: [16.6, 1.55, 14.8], min: 0.5, max: 40 },
      { id: 'pool',      label: 'Pool deck',                eye: [30.4, 1.6, 9.6],    target: [33.6, 1.4, 8.0],   min: 0.5, max: 30 },
      { id: 'garden',    label: 'Bungalow garden & porch',  eye: [12.1, 1.6, 12.2],   target: [14.4, 1.7, 8.9],   min: 0.5, max: 30 },
      { id: 'b_living',  label: 'Bungalow living room',     eye: [16.44, 1.85, 5.3],  target: [16.92, 1.6, 6.06],   min: 0.2, max: 1.6, room: true },
      { id: 'b_loft',    label: 'Bungalow loft',            eye: [17.9, 3.95, 4.55],  target: [17.85, 3.85, 3.75], min: 0.2, max: 1.2, room: true },
      { id: 'mh_pool',   label: 'Main house from the pool', eye: [30.0, 2.5, 0.9],    target: [37.0, 3.0, 5.1],   min: 0.5, max: 40 },
      { id: 'mh_living', label: 'Main house living room',   eye: [42.2, 2.6, 8.5],    target: [41.9, 2.5, 7.7],   min: 0.2, max: 2.0, room: true },
    ],
  },
  existing: {
    label: 'Existing', sub: 'Existing situation · as found · Koh Samui',
    glb: 'assets/existing/site.glb',
    lightmaps: { dir: 'assets/existing/lightmaps/', groups: ['LM_House', 'LM_Pool', 'LM_Landscape', 'LM_Ground'] },
    views: [   // the presets of the original model viewer
      { id: 'overview', label: 'Overview',  eye: [0.0, 27.0, 34.0],   target: [24.0, 0.0, 7.0],   min: 6,   max: 160, portrait: [14.0, 52.0, 44.0] },
      { id: 'gate',     label: 'Gate',      eye: [4.2, 1.62, 12.9],   target: [10.0, 1.4, 11.4],  min: 0.5, max: 40 },
      { id: 'pool',     label: 'Pool deck', eye: [30.6, 2.1, 2.6],    target: [33.4, 1.1, 6.6],   min: 0.5, max: 30 },
      { id: 'terrace',  label: 'Terrace',   eye: [37.9, 2.62, 7.1],   target: [37.1, 2.55, 6.9],  min: 0.2, max: 2.0, room: true },
      { id: 'living',   label: 'Living',    eye: [39.0, 2.62, 6.4],   target: [39.8, 2.6, 6.3],   min: 0.2, max: 1.6, room: true },
      { id: 'bed1',     label: 'Bedroom',   eye: [40.8, 2.62, 4.35],  target: [40.25, 2.6, 3.7],  min: 0.2, max: 1.4, room: true },
      { id: 'kitchen',  label: 'Kitchen',   eye: [46.55, 2.62, 5.2],  target: [47.1, 2.6, 5.75], min: 0.2, max: 1.4, room: true },
    ],
  },
};

export const CREDITS = '3D models: “Coconut Palm” by evolveduk and “Realistic HD Frangipani tree (13/50)” by PlantCatalog, licensed CC BY 4.0 (sketchfab.com). Textures: Poly Haven (CC0).';
export const CREDIT_LINKS = [
  ['Coconut Palm — evolveduk (CC BY 4.0)', 'https://sketchfab.com/3d-models/coconut-palm-26e787f2ff2e4c0fb004c3b0210805a3'],
  ['Realistic HD Frangipani tree (13/50) — PlantCatalog (CC BY 4.0)', 'https://sketchfab.com/3d-models/6afe1892d9fb419993cdfe54721110e9'],
  ['Poly Haven (CC0)', 'https://polyhaven.com'],
];
