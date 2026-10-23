// Walk collision: all solid meshes are merged once into a single world-space triangle soup with a BVH (three-mesh-bvh),
// so ground-follow (down ray), head-room (up ray) and wall checks (horizontal rays) stay fast even on big GLBs.
// Water surfaces go into their own BVH so the walker can't step onto the pool.
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';

const _v = new THREE.Vector3(), _m = new THREE.Matrix4(), _mi = new THREE.Matrix4();

function isWater(mat) {
  if (!mat) return false;
  if (/water/i.test(mat.name || '')) return true;
  if (!mat.transparent || !mat.color) return false;
  const c = mat.color; return c.b > 0.35 && c.g > 0.25 && c.r < 0.25 && mat.opacity > 0.5;   // #3fb6cf-ish, translucent
}

function triCount(geo) { return (geo.index ? geo.index.count : geo.attributes.position.count) / 3; }

function appendMesh(out, geo, matrix) {
  const pos = geo.attributes.position; const base = out.nVerts;
  for (let i = 0; i < pos.count; i++) { _v.fromBufferAttribute(pos, i).applyMatrix4(matrix); out.pos.push(_v.x, _v.y, _v.z); }
  if (geo.index) { const ix = geo.index; for (let i = 0; i < ix.count; i++) out.idx.push(base + ix.getX(i)); }
  else for (let i = 0; i < pos.count; i++) out.idx.push(base + i);
  out.nVerts += pos.count;
}

function build(out) {
  if (!out.idx.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(out.pos), 3));
  g.setIndex(new THREE.BufferAttribute(out.nVerts > 65535 ? new Uint32Array(out.idx) : new Uint16Array(out.idx), 1));
  return new MeshBVH(g, { maxDepth: 64 });
}

export class CollisionWorld {
  constructor(root, cfg) {
    root.updateMatrixWorld(true);
    const solid = { pos: [], idx: [], nVerts: 0 }, water = { pos: [], idx: [], nVerts: 0 };
    this.stats = { meshes: 0, skipped: 0, tris: 0 };
    const trees = [];
    root.traverse(o => {
      if (cfg.treeNodes && cfg.treeNodes.test(o.name) && !(o.parent && cfg.treeNodes.test(o.parent.name))) trees.push(o);
      if (!o.isMesh || o.isSkinnedMesh) return;
      let vis = true, ancestorSkip = false, solidFoliage = false;
      for (let p = o; p; p = p.parent) { if (!p.visible) vis = false; if (cfg.treeNodes?.test(p.name) || cfg.noCollideNodes?.test(p.name)) ancestorSkip = true; if (cfg.solidFoliageNodes?.test(p.name)) solidFoliage = true; }
      const mat = Array.isArray(o.material) ? o.material[0] : o.material;
      if (cfg.softFoliage?.test(mat?.name || '') && !solidFoliage) ancestorSkip = true;   // low shrubs: walk through
      if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
      const tiny = !o.isInstancedMesh && o.geometry.boundingSphere.radius * o.matrixWorld.getMaxScaleOnAxis() < 0.12;   // books, fruit…
      if (!vis || ancestorSkip || tiny || cfg.noCollide.test(o.name) || cfg.noCollide.test(mat?.name || '') || o.userData.noCollide) { this.stats.skipped++; return; }
      const target = isWater(mat) ? water : solid;
      const tris = triCount(o.geometry);
      if (o.isInstancedMesh) {
        if (tris * o.count > cfg.maxInstancedCollisionTris) { this.stats.skipped++; return; }
        for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, _mi); _m.multiplyMatrices(o.matrixWorld, _mi); appendMesh(target, o.geometry, _m); }
        this.stats.tris += tris * o.count;
      } else { appendMesh(target, o.geometry, o.matrixWorld); this.stats.tris += tris; }
      this.stats.meshes++;
    });
    // trees: a simple trunk cylinder (r 0.18 m, 2.4 m tall) at each tree's origin instead of the full foliage mesh
    const trunk = new THREE.CylinderGeometry(0.18, 0.18, 2.4, 8, 1, true); trunk.translate(0, 1.2, 0);
    for (const t of trees) { t.getWorldPosition(_v); if (_v.lengthSq() < 1e-6) continue; _m.makeTranslation(_v.x, _v.y, _v.z); appendMesh(solid, trunk, _m); }
    this.stats.trees = trees.length;
    const t0 = performance.now(); this.solid = build(solid); this.water = build(water); this.stats.bvhMs = Math.round(performance.now() - t0);
    this.ray = new THREE.Ray();
  }
  _first(bvh, origin, dir, far) {
    if (!bvh) return null; this.ray.origin.copy(origin); this.ray.direction.copy(dir);
    const h = bvh.raycastFirst(this.ray, THREE.DoubleSide, 0, far); return h && h.distance <= far ? h : null;
  }
  // Height of the walkable surface under world point (x,z), searching down from yTop. Returns null for water / nothing.
  floor(x, z, yTop, depth = 30) {
    const o = _v.set(x, yTop, z), d = new THREE.Vector3(0, -1, 0);
    const s = this._first(this.solid, o, d, depth); const w = this._first(this.water, o.set(x, yTop, z), d, depth);
    if (w && (!s || w.distance < s.distance + 0.05)) return null;
    return s ? yTop - s.distance : null;
  }
  // Floor under a body of radius r: the highest support among the centre and 4 points around it, so the walker
  // steps over small gaps (e.g. between a deck and the pool coping). Water under the centre still stops it.
  footFloor(x, z, yTop, r = 0.18) {
    const c = this.floor(x, z, yTop);
    if (c === null && this._first(this.water, _v.set(x, yTop, z), new THREE.Vector3(0, -1, 0), 30)) return null;
    let best = c;
    for (const [dx, dz] of [[r, 0], [-r, 0], [0, r], [0, -r]]) { const f = this.floor(x + dx, z + dz, yTop); if (f !== null && (best === null || f > best)) best = f; }
    return best;
  }
  // Free space above feet (m), up to max.
  headroom(x, z, feet, max = 2.2) {
    const h = this._first(this.solid, _v.set(x, feet + 0.05, z), new THREE.Vector3(0, 1, 0), max);
    return h ? h.distance + 0.05 : max;
  }
  // Is a horizontal move from (x,z) along dir (unit, world XZ) by dist blocked between knee and head?
  blocked(x, z, feet, dir, dist, radius, top) {
    const d = new THREE.Vector3(dir.x, 0, dir.z).normalize(); const side = new THREE.Vector3(-d.z, 0, d.x);
    for (const hgt of [0.42, 0.95, Math.min(1.55, top - 0.1)]) for (const s of [0, -0.6, 0.6]) {
      const o = new THREE.Vector3(x + side.x * radius * s, feet + hgt, z + side.z * radius * s);
      if (this._first(this.solid, o, d, dist + radius)) return true;
    }
    return false;
  }
}
