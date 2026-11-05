import type { CityData } from './data';
import { fmt, fmtDate } from './data';
import type { Replay } from './replay';

const PLAY = '<path d="M7 4.5v15l13-7.5z"/>';
const PAUSE = '<path d="M6.5 4.5h4v15h-4zM13.5 4.5h4v15h-4z"/>';

/** Timeline chrome: play button, date, activity histogram scrubber and speed. */
export class TimelineUI {
  /** 0..1 */
  progress = 1;
  playing = false;
  speed = 1;
  onSeek: (progress: number, fromUser: boolean) => void = () => {};
  onPlayToggle: (playing: boolean) => void = () => {};

  private canvas: HTMLCanvasElement;
  private head: HTMLElement;
  private dateEl: HTMLElement;
  private subEl: HTMLElement;
  private icon: SVGElement;
  private abort = new AbortController();
  private bars: Float32Array = new Float32Array(0);
  private years: { at: number; year: number }[] = [];

  constructor(private data: CityData, private replay: Replay) {
    const $ = (id: string) => document.getElementById(id)!;
    this.canvas = $('scrub-canvas') as HTMLCanvasElement;
    this.head = $('scrub-head');
    this.dateEl = $('date');
    this.subEl = $('date-sub');
    this.icon = $('play-icon') as unknown as SVGElement;
    const sig = { signal: this.abort.signal };
    const scrub = $('scrub');

    $('play').addEventListener('click', () => this.toggle(), sig);
    let dragging = false;
    const seekAt = (e: PointerEvent) => {
      const r = scrub.getBoundingClientRect();
      this.setProgress((e.clientX - r.left) / r.width, true);
    };
    scrub.addEventListener('pointerdown', (e) => {
      dragging = true;
      scrub.setPointerCapture(e.pointerId);
      if (this.playing) this.toggle(false);
      seekAt(e);
    }, sig);
    scrub.addEventListener('pointermove', (e) => dragging && seekAt(e), sig);
    scrub.addEventListener('pointerup', () => (dragging = false), sig);
    scrub.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 0.1 : 0.01;
      if (e.key === 'ArrowRight') this.setProgress(this.progress + step, true);
      else if (e.key === 'ArrowLeft') this.setProgress(this.progress - step, true);
      else return;
      e.preventDefault();
    }, sig);
    window.addEventListener('keydown', (e) => {
      if (e.key === ' ' && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault();
        this.toggle();
      }
    }, sig);
    for (const b of $('speed').querySelectorAll<HTMLButtonElement>('button')) {
      b.setAttribute('aria-pressed', String(Number(b.dataset.speed) === this.speed));
      b.addEventListener('click', () => {
        this.speed = Number(b.dataset.speed);
        for (const o of $('speed').querySelectorAll('button')) o.setAttribute('aria-pressed', String(o === b));
      }, sig);
    }
    window.addEventListener('resize', () => this.draw(), sig);
    this.computeBars();
    this.draw();
    this.updateLabel();
  }

  /** Seconds for a full replay at 1x: longer histories get a little more time. */
  get duration(): number {
    return Math.min(36, Math.max(14, 10 + Math.sqrt(this.replay.ticks) * 0.6));
  }

  toggle(force?: boolean) {
    this.playing = force ?? !this.playing;
    if (this.playing && this.progress >= 1) this.setProgress(0, true);
    this.icon.innerHTML = this.playing ? PAUSE : PLAY;
    document.getElementById('play')!.setAttribute('aria-label', this.playing ? 'Pause time-lapse' : 'Play time-lapse');
    this.onPlayToggle(this.playing);
  }

  setProgress(p: number, fromUser = false) {
    this.progress = Math.max(0, Math.min(1, p));
    this.onSeek(this.progress, fromUser);
    this.draw();
    this.updateLabel();
  }

  /** Advance playback; returns false when the end is reached. */
  advance(dt: number): boolean {
    if (!this.playing) return false;
    const next = this.progress + (dt * this.speed) / this.duration;
    if (next >= 1) {
      this.setProgress(1);
      this.toggle(false);
      return false;
    }
    this.setProgress(next);
    return true;
  }

  tickFor(p: number): number {
    return Math.round(p * (this.replay.ticks - 1));
  }

  private updateLabel() {
    const t = Math.max(0, this.replay.tick);
    const total = this.data.stats.commits;
    this.dateEl.textContent = total ? fmtDate(this.data.ticks.t[t]) : 'No history';
    const c = this.replay.tick < 0 ? 0 : this.replay.cumulative[t];
    this.subEl.textContent = total ? `commit ${fmt(c)} of ${fmt(total)}` : '';
  }

  /** Total lines of code at the end of each tick: the city's growth curve. */
  private computeBars() {
    const T = this.replay.ticks;
    const out = new Float32Array(T);
    const cur = new Float64Array(this.data.b.path.length);
    const ev = this.data.ev;
    let total = 0;
    let p = 0;
    for (let t = 0; t < T; t++) {
      while (p < ev.length && ev[p] <= t) {
        const b = ev[p + 1];
        total += ev[p + 2] - cur[b];
        cur[b] = ev[p + 2];
        p += 4;
      }
      out[t] = total;
    }
    this.bars = out;
    // Year boundaries for tick marks.
    this.years = [];
    let last = -1;
    this.data.ticks.t.forEach((ts, i) => {
      const y = new Date(ts * 1000).getUTCFullYear();
      if (y !== last) {
        if (last !== -1) this.years.push({ at: i / Math.max(1, T - 1), year: y });
        last = y;
      }
    });
  }

  draw() {
    const c = this.canvas;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = c.clientWidth, h = c.clientHeight;
    if (!w || !h) return;
    if (c.width !== Math.round(w * dpr)) c.width = Math.round(w * dpr);
    if (c.height !== Math.round(h * dpr)) c.height = Math.round(h * dpr);
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const src = this.bars;
    let max = 0;
    for (const v of src) max = Math.max(max, v);
    const top = 6, base = h - 14;
    const yOf = (v: number) => base - (max ? v / max : 0) * (base - top);
    const path = new Path2D();
    path.moveTo(0, base);
    const n = src.length;
    const steps = Math.min(n, Math.floor(w));
    for (let i = 0; i < steps; i++) {
      const idx = Math.floor((i / Math.max(1, steps - 1)) * (n - 1));
      path.lineTo((i / Math.max(1, steps - 1)) * w, yOf(src[idx]));
    }
    path.lineTo(w, base);
    path.closePath();
    const played = this.progress * w;
    g.fillStyle = 'rgba(244,239,230,0.13)';
    g.fill(path);
    g.save();
    g.beginPath();
    g.rect(0, 0, played, h);
    g.clip();
    g.fillStyle = 'rgba(255,79,139,0.55)';
    g.fill(path);
    g.restore();
    g.fillStyle = 'rgba(244,239,230,0.22)';
    g.fillRect(0, base, w, 1);
    // Year marks: only as many as fit.
    g.font = '11px ui-monospace, Menlo, monospace';
    g.textBaseline = 'top';
    let lastX = -1e9;
    for (const y of this.years) {
      const x = y.at * w;
      if (x - lastX < 46 || x > w - 30) continue;
      lastX = x;
      g.fillStyle = 'rgba(244,239,230,0.3)';
      g.fillRect(x, base - 3, 1, 4);
      g.fillStyle = 'rgba(244,239,230,0.55)';
      g.fillText(String(y.year), x + 3, base + 2);
    }
    this.head.style.left = `${Math.min(played, w - 2)}px`;
  }

  dispose() {
    this.abort.abort();
  }
}
