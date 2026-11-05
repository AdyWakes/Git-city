import * as THREE from 'three';
import { heightFor, type CityData } from './data';
import { createBuildingMaterial, createGlowMaterial, createGroundMaterial, createPlateMaterial } from './shaders';

const HIDDEN = -1;

/**
 * All static city geometry: one InstancedMesh for every building and lot (a single draw call),
 * one for district plates, street lights as points, a ground plane and a search beacon.
 */
export class CityView {
  readonly group = new THREE.Group();
  readonly n: number;
  readonly radius: number;
  readonly hScale: number;
  readonly buildingMaterial = createBuildingMaterial();
  readonly plateMaterial = createPlateMaterial();
  readonly streetLights: THREE.Points;
  readonly bounds: THREE.Box3;

  private mesh: THREE.InstancedMesh;
  private plates: THREE.InstancedMesh;
  private heightAttr: THREE.InstancedBufferAttribute;
  private infoAttr: THREE.InstancedBufferAttribute;
  private hoverAttr: THREE.InstancedBufferAttribute;
  /** Height we animate towards; HIDDEN = not built yet. */
  private target: Float32Array;
  /** Currently displayed height. */
  readonly shown: Float32Array;
  private lot: Uint8Array;
  private cur: Float64Array;
  private highlighted = new Set<number>();
  private beacon: THREE.Mesh;
  private beaconFor = -1;
  private dirty = true;

  constructor(readonly data: CityData) {
    const b = data.b;
    const n = (this.n = b.path.length);

    let minX = 0, maxX = 0, minZ = 0, maxZ = 0;
    for (const d of data.districts) {
      minX = Math.min(minX, d.x - d.w / 2);
      maxX = Math.max(maxX, d.x + d.w / 2);
      minZ = Math.min(minZ, d.z - d.d / 2);
      maxZ = Math.max(maxZ, d.z + d.d / 2);
    }
    this.radius = Math.max(12, Math.hypot(maxX - minX, maxZ - minZ) / 2);
    // Bigger cities get slightly taller towers so the skyline keeps its drama.
    this.hScale = 0.15 * Math.min(2.2, Math.max(1, Math.sqrt(this.radius / 45)));

    // Buildings ----------------------------------------------------------------------------
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0.5, 0);
    this.heightAttr = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
    this.heightAttr.setUsage(THREE.DynamicDrawUsage);
    this.infoAttr = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
    const colorAttr = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    geo.setAttribute('aHeight', this.heightAttr);
    geo.setAttribute('aInfo', this.infoAttr);
    geo.setAttribute('aColor', colorAttr);

    this.mesh = new THREE.InstancedMesh(geo, this.buildingMaterial, Math.max(1, n));
    this.mesh.count = n;
    this.mesh.frustumCulled = false; // heights animate; bounds are handled by the LOD in the shader
    const m = new THREE.Matrix4();
    const langColors = data.langs.map((l) => new THREE.Color(l.color));
    const neonCut = this.neonThreshold();
    for (let i = 0; i < n; i++) {
      const s = b.size[i];
      m.makeScale(s, 1, s).setPosition(b.x[i], 0, b.z[i]);
      this.mesh.setMatrixAt(i, m);
      const c = langColors[b.lang[i]] ?? new THREE.Color('#6b7286');
      colorAttr.setXYZ(i, c.r, c.g, c.b);
      const seed = ((hashStr(b.path[i]) % 9973) / 9973) * 100;
      this.infoAttr.setXYZW(i, seed, b.lines[i] >= neonCut && b.died[i] === -1 ? 1 : 0, 0, 0);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.target = new Float32Array(n);
    this.shown = new Float32Array(n);
    this.lot = new Uint8Array(n);
    this.cur = new Float64Array(n);

    // District plates ----------------------------------------------------------------------
    const plateGeo = new THREE.BoxGeometry(1, 1, 1);
    plateGeo.translate(0, -0.5, 0);
    const nd = data.districts.length;
    this.hoverAttr = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, nd)), 1);
    plateGeo.setAttribute('aHover', this.hoverAttr);
    this.plates = new THREE.InstancedMesh(plateGeo, this.plateMaterial, Math.max(1, nd));
    this.plates.count = nd;
    data.districts.forEach((d, i) => {
      m.makeScale(d.w + 1, 0.08, d.d + 1).setPosition(d.x, 0.02, d.z);
      this.plates.setMatrixAt(i, m);
    });
    this.plates.frustumCulled = false;

    // Ground ------------------------------------------------------------------------------
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), createGroundMaterial(this.radius * 1.4));
    ground.rotation.x = -Math.PI / 2;
    ground.scale.setScalar(this.radius * 40);
    ground.position.y = -0.07;

    // Street lights along district edges ---------------------------------------------------
    const pts: number[] = [];
    const cols: number[] = [];
    const alpha: number[] = [];
    const size: number[] = [];
    const warm = new THREE.Color('#ffb36b');
    data.districts.forEach((d, di) => {
      const x0 = d.x - d.w / 2 - 1.1, x1 = d.x + d.w / 2 + 1.1;
      const z0 = d.z - d.d / 2 - 1.1, z1 = d.z + d.d / 2 + 1.1;
      const step = 2.4;
      const push = (x: number, z: number, k: number) => {
        pts.push(x, 0.35, z);
        const flicker = 0.55 + 0.45 * ((hashStr(`${di}:${k}`) % 100) / 100);
        cols.push(warm.r, warm.g, warm.b);
        alpha.push(flicker);
        size.push(1);
      };
      let k = 0;
      for (let x = x0; x <= x1; x += step) push(x, z0, k++), push(x, z1, k++);
      for (let z = z0 + step; z < z1; z += step) push(x0, z, k++), push(x1, z, k++);
    });
    const slGeo = new THREE.BufferGeometry();
    slGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    slGeo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    slGeo.setAttribute('aAlpha', new THREE.Float32BufferAttribute(alpha, 1));
    slGeo.setAttribute('aSize', new THREE.Float32BufferAttribute(size, 1));
    this.streetLights = new THREE.Points(slGeo, createGlowMaterial({ size: 420, opacity: 0.75 }));
    this.streetLights.frustumCulled = false;

    // Beacon for search results -------------------------------------------------------------
    const beaconGeo = new THREE.CylinderGeometry(0.12, 0.12, 1, 12, 1, true);
    beaconGeo.translate(0, 0.5, 0);
    this.beacon = new THREE.Mesh(
      beaconGeo,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uColor: { value: new THREE.Color('#ff4f8b') } },
        vertexShader: `varying float vY; void main(){ vY = position.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `uniform vec3 uColor; varying float vY; void main(){ float a = (1.0 - vY) * 0.9; gl_FragColor = vec4(uColor * a, a); }`,
      }),
    );
    this.beacon.visible = false;

    this.bounds = new THREE.Box3(new THREE.Vector3(minX, 0, minZ), new THREE.Vector3(maxX, 1, maxZ));
    this.group.add(ground, this.plates, this.mesh, this.streetLights, this.beacon);
  }

  /** Lines threshold above which towers get a neon crown: the top ~2.5% (3..40 buildings). */
  private neonThreshold(): number {
    const lines = this.data.b.lines.filter((_, i) => this.data.b.died[i] === -1).sort((a, b) => b - a);
    if (!lines.length) return Infinity;
    const k = Math.min(40, Math.max(3, Math.round(lines.length * 0.025)));
    return lines[Math.min(lines.length - 1, k - 1)] || Infinity;
  }

  heightOf(lines: number): number {
    return heightFor(lines, this.hScale);
  }

  /**
   * Sets the city state. `lines[i] < 0` means the building does not exist yet.
   * `isLot[i]` marks files deleted at this point in time.
   */
  setState(lines: ArrayLike<number>, isLot: ArrayLike<number>, instant = false): void {
    for (let i = 0; i < this.n; i++) {
      const l = lines[i];
      const lot = isLot[i] ? 1 : 0;
      this.cur[i] = l;
      this.target[i] = l < 0 && !lot ? HIDDEN : this.heightOf(Math.max(0, l));
      if (lot !== this.lot[i]) {
        this.lot[i] = lot;
        this.infoAttr.setZ(i, lot);
        this.infoAttr.needsUpdate = true;
      }
      if (instant) this.shown[i] = this.target[i];
    }
    this.dirty = true;
  }

  currentLines(i: number): number {
    return Math.max(0, this.cur[i]);
  }

  isLot(i: number): boolean {
    return this.lot[i] === 1;
  }

  /** Final (HEAD) state. */
  setFinal(instant = true): void {
    const b = this.data.b;
    const lines = new Float64Array(this.n);
    const lots = new Uint8Array(this.n);
    for (let i = 0; i < this.n; i++) {
      if (b.died[i] === -1) lines[i] = b.lines[i];
      else lots[i] = 1;
    }
    this.setState(lines, lots, instant);
  }

  /** Animate displayed heights towards targets. */
  update(dt: number, time: number): void {
    this.buildingMaterial.uniforms.uTime.value = time;
    if (this.dirty) {
      const k = 1 - Math.exp(-dt * 7);
      let moving = false;
      const h = this.heightAttr.array as Float32Array;
      for (let i = 0; i < this.n; i++) {
        const t = this.target[i];
        let s = this.shown[i];
        if (t === HIDDEN) s = HIDDEN;
        else if (s < 0) {
          s = 0.02;
          moving = true;
        }
        else if (Math.abs(t - s) > 0.005) {
          s += (t - s) * k;
          moving = true;
        } else s = t;
        this.shown[i] = s;
        h[i] = s;
      }
      this.heightAttr.needsUpdate = true;
      this.dirty = moving;
      if (this.beaconFor >= 0) this.placeBeacon(this.beaconFor);
    }
  }

  setHighlight(indices: number[]): void {
    for (const i of this.highlighted) this.infoAttr.setW(i, 0);
    this.highlighted = new Set(indices);
    for (const i of this.highlighted) this.infoAttr.setW(i, 1);
    this.infoAttr.needsUpdate = true;
  }

  setHoverDistrict(index: number): void {
    const a = this.hoverAttr.array as Float32Array;
    a.fill(0);
    if (index >= 0) a[index] = 1;
    this.hoverAttr.needsUpdate = true;
  }

  showBeacon(i: number): void {
    this.beaconFor = i;
    this.beacon.visible = i >= 0;
    if (i >= 0) this.placeBeacon(i);
  }

  private placeBeacon(i: number) {
    const top = Math.max(0.1, this.shown[i]);
    this.beacon.position.set(this.data.b.x[i], top, this.data.b.z[i]);
    this.beacon.scale.set(1, this.radius * 0.6, 1);
  }

  /** Top center of a building in world space. */
  topOf(i: number, out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(this.data.b.x[i], Math.max(0.1, this.shown[i]), this.data.b.z[i]);
  }

  /** Ray vs every visible building box (brute force; ~0.2ms for 20k). Returns the nearest index. */
  pick(ray: THREE.Ray): number {
    const b = this.data.b;
    const ox = ray.origin.x, oy = ray.origin.y, oz = ray.origin.z;
    const ix = 1 / ray.direction.x, iy = 1 / ray.direction.y, iz = 1 / ray.direction.z;
    let best = -1;
    let bestT = Infinity;
    for (let i = 0; i < this.n; i++) {
      const h = this.lot[i] ? 0.06 : this.shown[i];
      if (h < 0) continue;
      const hs = b.size[i] / 2;
      let t1 = (b.x[i] - hs - ox) * ix, t2 = (b.x[i] + hs - ox) * ix;
      let tmin = Math.min(t1, t2), tmax = Math.max(t1, t2);
      t1 = (0 - oy) * iy;
      t2 = (h - oy) * iy;
      tmin = Math.max(tmin, Math.min(t1, t2));
      tmax = Math.min(tmax, Math.max(t1, t2));
      t1 = (b.z[i] - hs - oz) * iz;
      t2 = (b.z[i] + hs - oz) * iz;
      tmin = Math.max(tmin, Math.min(t1, t2));
      tmax = Math.min(tmax, Math.max(t1, t2));
      if (tmax >= Math.max(tmin, 0) && tmin < bestT) {
        bestT = tmin;
        best = i;
      }
    }
    return best;
  }

  districtAt(x: number, z: number): number {
    const ds = this.data.districts;
    for (let i = 0; i < ds.length; i++) {
      const d = ds[i];
      if (Math.abs(x - d.x) <= d.w / 2 + 0.5 && Math.abs(z - d.z) <= d.d / 2 + 0.5) return i;
    }
    return -1;
  }

  setViewport(w: number, h: number): void {
    this.buildingMaterial.uniforms.uViewport.value.set(w, h);
    const s = (this.streetLights.material as THREE.ShaderMaterial).uniforms;
    s.uScale.value = h / 1000;
  }
}

export function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
