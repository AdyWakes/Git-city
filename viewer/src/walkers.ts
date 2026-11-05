import * as THREE from 'three';
import { createGlowMaterial } from './shaders';
import type { CityView } from './city';

const SLOTS = 72;
const TRAIL = 7;

interface Slot {
  author: number;
  pos: THREE.Vector3;
  target: THREE.Vector3;
  active: number; // last activity, seconds
  trail: THREE.Vector3[];
  alpha: number;
}

/** Contributors as small glowing lights that fly to the buildings they change. */
export class Walkers {
  readonly points: THREE.Points;
  private slots: Slot[] = [];
  private byAuthor = new Map<number, Slot>();
  private posAttr: THREE.BufferAttribute;
  private alphaAttr: THREE.BufferAttribute;
  private sizeAttr: THREE.BufferAttribute;
  private now = 0;
  private trailClock = 0;
  private tmp = new THREE.Vector3();

  constructor(private city: CityView) {
    const n = SLOTS * (TRAIL + 1);
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(new Float32Array(n * 3), 3);
    this.alphaAttr = new THREE.BufferAttribute(new Float32Array(n), 1);
    this.sizeAttr = new THREE.BufferAttribute(new Float32Array(n), 1);
    const color = new Float32Array(n * 3);
    const head = new THREE.Color('#d8f1ff');
    const tail = new THREE.Color('#7fb8ff');
    for (let s = 0; s < SLOTS; s++)
      for (let t = 0; t <= TRAIL; t++) {
        const i = s * (TRAIL + 1) + t;
        const c = t === 0 ? head : tail;
        color.set([c.r * 1.6, c.g * 1.6, c.b * 1.6], i * 3);
        this.sizeAttr.setX(i, t === 0 ? 1 : 0.75 - (t / TRAIL) * 0.5);
      }
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('color', new THREE.BufferAttribute(color, 3));
    geo.setAttribute('aAlpha', this.alphaAttr);
    geo.setAttribute('aSize', this.sizeAttr);
    this.points = new THREE.Points(geo, createGlowMaterial({ size: 900 }));
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
    for (let i = 0; i < SLOTS; i++) {
      this.slots.push({ author: -1, pos: new THREE.Vector3(), target: new THREE.Vector3(), active: -1e9, trail: Array.from({ length: TRAIL }, () => new THREE.Vector3()), alpha: 0 });
    }
  }

  /** A contributor touched a building. */
  visit(author: number, building: number): void {
    let slot = this.byAuthor.get(author);
    if (!slot) {
      // Reuse the slot that has been idle the longest.
      slot = this.slots.reduce((a, b) => (b.active < a.active ? b : a));
      if (slot.author >= 0) this.byAuthor.delete(slot.author);
      slot.author = author;
      this.byAuthor.set(author, slot);
      // Fly in from the sky above the city's edge, at an angle unique to the author.
      const ang = ((author * 2654435761) % 4096) / 4096 * Math.PI * 2;
      const r = this.city.radius * 1.15;
      slot.pos.set(Math.cos(ang) * r, this.city.radius * 0.5, Math.sin(ang) * r);
      for (const t of slot.trail) t.copy(slot.pos);
      slot.alpha = 0;
    }
    this.city.topOf(building, slot.target);
    slot.target.y += 0.9;
    slot.active = this.now;
  }

  clear(): void {
    for (const s of this.slots) {
      s.active = -1e9;
      s.alpha = 0;
      s.author = -1;
    }
    this.byAuthor.clear();
    this.write();
  }

  update(dt: number): void {
    this.now += dt;
    const k = 1 - Math.exp(-dt * 3.2);
    this.trailClock += dt;
    const shiftTrail = this.trailClock > 1 / 40;
    if (shiftTrail) this.trailClock = 0;
    for (const s of this.slots) {
      const idle = this.now - s.active;
      const want = s.author < 0 ? 0 : idle < 2.5 ? 1 : Math.max(0, 1 - (idle - 2.5) / 1.5);
      s.alpha += (want - s.alpha) * Math.min(1, dt * 6);
      if (s.alpha < 0.002) continue;
      if (shiftTrail) {
        for (let t = TRAIL - 1; t > 0; t--) s.trail[t].copy(s.trail[t - 1]);
        s.trail[0].copy(s.pos);
      }
      // Ease towards the target with a small hover bob.
      this.tmp.copy(s.target);
      this.tmp.y += Math.sin(this.now * 3 + s.author) * 0.15;
      s.pos.lerp(this.tmp, k);
    }
    this.write();
  }

  private write() {
    const p = this.posAttr.array as Float32Array;
    const a = this.alphaAttr.array as Float32Array;
    this.slots.forEach((s, si) => {
      const base = si * (TRAIL + 1);
      p.set([s.pos.x, s.pos.y, s.pos.z], base * 3);
      a[base] = s.alpha;
      for (let t = 0; t < TRAIL; t++) {
        p.set([s.trail[t].x, s.trail[t].y, s.trail[t].z], (base + 1 + t) * 3);
        a[base + 1 + t] = s.alpha * 0.55 * (1 - t / TRAIL);
      }
    });
    this.posAttr.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
  }

  setViewport(h: number) {
    (this.points.material as THREE.ShaderMaterial).uniforms.uScale.value = h / 1000;
  }
}
