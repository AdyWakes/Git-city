import * as THREE from 'three';
import type { CityData } from './data';
import type { CityView } from './city';
import type { Stage } from './stage';

const MAX_LABELS = 12;

/** Neon-sign style district names floating over each district's skyline. */
export class Labels {
  private els: HTMLElement[] = [];
  private order: number[];
  private anchors: THREE.Vector3[];
  private v = new THREE.Vector3();
  private boxes: { x0: number; y0: number; x1: number; y1: number }[] = [];
  visible = true;
  private active: Uint8Array;

  constructor(
    private root: HTMLElement,
    private data: CityData,
    private city: CityView,
    private stage: Stage,
    onClick: (district: number) => void,
  ) {
    root.innerHTML = '';
    this.active = new Uint8Array(data.districts.length).fill(1);
    const tallest = new Float64Array(data.districts.length);
    data.b.district.forEach((d, i) => {
      if (data.b.died[i] === -1) tallest[d] = Math.max(tallest[d], city.heightOf(data.b.lines[i]));
    });
    this.anchors = data.districts.map((d, i) => new THREE.Vector3(d.x, tallest[i] + 1.2, d.z));
    this.order = data.districts
      .map((_, i) => i)
      .sort((a, b) => data.districts[b].lines - data.districts[a].lines || data.districts[b].files - data.districts[a].files)
      .slice(0, 60);
    for (const di of this.order) {
      const el = document.createElement('div');
      el.className = 'label';
      el.textContent = data.districts[di].name === '(root)' ? data.repo.name.split('/').pop() ?? '/' : data.districts[di].name;
      el.onclick = () => onClick(di);
      el.style.opacity = '0';
      root.append(el);
      this.els[di] = el;
    }
  }

  update(): void {
    const cam = this.stage.camera;
    const { w, h } = this.stage.size;
    this.boxes.length = 0;
    let shown = 0;
    for (const di of this.order) {
      const el = this.els[di];
      const p = this.v.copy(this.anchors[di]);
      const dist = p.distanceTo(cam.position);
      p.project(cam);
      const onScreen = this.visible && this.active[di] === 1 && p.z < 1 && Math.abs(p.x) < 1.1 && Math.abs(p.y) < 1.1;
      if (!onScreen || shown >= MAX_LABELS) {
        el.style.opacity = '0';
        el.style.visibility = 'hidden';
        continue;
      }
      const x = (p.x * 0.5 + 0.5) * w;
      const y = (-p.y * 0.5 + 0.5) * h;
      const lw = el.offsetWidth || 80;
      const box = { x0: x - lw / 2 - 6, y0: y - 24, x1: x + lw / 2 + 6, y1: y };
      // Keep clear of the header and the timeline.
      const inChrome = y < 150 || y > h - 120;
      if (inChrome || this.boxes.some((b) => box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0)) {
        el.style.opacity = '0';
        el.style.visibility = 'hidden';
        continue;
      }
      this.boxes.push(box);
      shown++;
      const fade = Math.max(0, Math.min(1, 1.6 - dist / (this.city.radius * 3.2)));
      el.style.visibility = fade > 0.02 ? 'visible' : 'hidden';
      el.style.opacity = String(fade);
      el.style.transform = `translate(${x - lw / 2}px, ${y - 22}px)`;
    }
  }

  /** Only label districts that have at least one building at the current point in time. */
  setActiveFrom(lines: ArrayLike<number>): void {
    this.active.fill(0);
    const d = this.data.b.district;
    for (let i = 0; i < lines.length; i++) if (lines[i] >= 0) this.active[d[i]] = 1;
  }

  dispose(): void {
    this.root.innerHTML = '';
  }
}
