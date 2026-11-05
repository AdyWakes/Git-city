import * as THREE from 'three';
import type { App } from './main';
import { compact, fmt, fmtMonth } from './data';

const ACCENT = '#ff4f8b';
const INK = '#f4efe6';
const SANS = "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
const MONO = "ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, Consolas, monospace";

export interface ExportHooks {
  /** Pause/resume the interactive render loop while exporting. */
  setExporting(on: boolean): void;
  seekTo(progress: number, follow: boolean): void;
}

function slug(s: string): string {
  return s.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'city';
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function overlay(text: string): { el: HTMLElement; set(t: string): void } {
  const el = document.createElement('div');
  el.className = 'recording';
  el.innerHTML = `<p></p>`;
  const p = el.querySelector('p')!;
  p.textContent = text;
  document.body.append(el);
  return { el, set: (t) => (p.textContent = t) };
}

/** Repo title, stats and the watermark, scaled to the output size. */
function drawChrome(g: CanvasRenderingContext2D, app: App, w: number, h: number, dateUnix: number | null) {
  const s = Math.min(w, h) / 1080;
  const pad = 64 * s;
  const data = app.data;
  g.save();
  g.textBaseline = 'alphabetic';
  g.shadowColor = 'rgba(0,0,0,0.85)';
  g.shadowBlur = 24 * s;

  // Title block.
  g.fillStyle = INK;
  g.font = `650 ${58 * s}px ${SANS}`;
  const title = data.repo.name;
  let ty = pad + 52 * s;
  g.fillText(title, pad, ty, w - pad * 2);
  ty += 44 * s;
  g.font = `400 ${28 * s}px ${SANS}`;
  g.fillStyle = 'rgba(244,239,230,0.78)';
  const st = data.stats;
  g.fillText(`${fmt(st.commits)} commits · ${fmt(st.authors)} authors · ${compact(st.lines)} lines`, pad, ty, w - pad * 2);
  if (dateUnix) {
    ty += 64 * s;
    g.fillStyle = INK;
    g.font = `650 ${40 * s}px ${SANS}`;
    g.fillText(fmtMonth(dateUnix), pad, ty);
  }

  // Watermark, bottom right: the tool + repo.
  g.shadowBlur = 16 * s;
  const mark = 'gitcity';
  const sub = data.repo.name;
  g.font = `600 ${26 * s}px ${MONO}`;
  const mw = g.measureText(mark).width;
  g.font = `400 ${22 * s}px ${SANS}`;
  const sw = g.measureText(sub).width;
  const x1 = w - pad;
  const y1 = h - pad;
  g.fillStyle = 'rgba(244,239,230,0.7)';
  g.textAlign = 'right';
  g.fillText(sub, x1, y1);
  g.font = `600 ${26 * s}px ${MONO}`;
  g.fillStyle = INK;
  g.fillText(mark, x1 - sw - 22 * s, y1);
  g.shadowBlur = 14 * s;
  g.shadowColor = ACCENT;
  g.fillStyle = ACCENT;
  const box = 14 * s;
  g.fillRect(x1 - sw - 22 * s - mw - box - 12 * s, y1 - box - 3 * s, box, box);
  g.restore();
}

/** District names, projected like the live labels. */
function drawLabels(g: CanvasRenderingContext2D, app: App, w: number, h: number) {
  const s = Math.min(w, h) / 1080;
  const cam = app.stage.camera;
  const v = new THREE.Vector3();
  const order = app.data.districts
    .map((d, i) => ({ d, i }))
    .sort((a, b) => b.d.lines - a.d.lines)
    .slice(0, 10);
  const boxes: number[][] = [];
  g.save();
  g.font = `600 ${17 * s}px ${MONO}`;
  g.textAlign = 'center';
  g.fillStyle = INK;
  g.shadowColor = 'rgba(255,79,139,0.6)';
  g.shadowBlur = 12 * s;
  for (const { d, i } of order) {
    let tallest = 0;
    app.data.b.district.forEach((di, bi) => {
      if (di === i) tallest = Math.max(tallest, app.city.shown[bi]);
    });
    if (tallest <= 0) continue;
    v.set(d.x, tallest + 1.2, d.z).project(cam);
    if (v.z > 1 || Math.abs(v.x) > 0.95 || Math.abs(v.y) > 0.95) continue;
    const x = (v.x * 0.5 + 0.5) * w;
    const y = (-v.y * 0.5 + 0.5) * h;
    if (y < h * 0.2 || y > h - 120 * s) continue;
    const name = (d.name === '(root)' ? app.data.repo.name.split('/').pop() ?? '/' : d.name).toUpperCase().split('').join(' ');
    const tw = g.measureText(name).width;
    const bx = [x - tw / 2 - 8, y - 24 * s, x + tw / 2 + 8, y];
    if (boxes.some((b) => bx[0] < b[2] && bx[2] > b[0] && bx[1] < b[3] && bx[3] > b[1])) continue;
    boxes.push(bx);
    g.fillText(name, x, y);
  }
  g.restore();
}

/** Keeps the composition when the output aspect differs from the window's. */
function adaptCamera(app: App, aspect: number): () => void {
  const cam = app.stage.camera;
  const target = app.stage.controls.target;
  const saved = cam.position.clone();
  const current = app.stage.size.w / app.stage.size.h;
  if (aspect < current) {
    // Crop into the skyline rather than fitting the whole city into a narrow frame.
    const k = Math.pow(current / aspect, 0.45);
    cam.position.copy(target).add(saved.clone().sub(target).multiplyScalar(k));
  }
  return () => cam.position.copy(saved);
}

export async function exportPng(app: App, hooks: ExportHooks, w: number, h: number): Promise<void> {
  const ui = overlay('Rendering image…');
  hooks.setExporting(true);
  await new Promise((r) => requestAnimationFrame(r));
  const restoreCam = adaptCamera(app, w / h);
  try {
    app.stage.setFixedSize({ w, h });
    app.stage.camera.updateMatrixWorld();
    app.city.update(1, performance.now() / 1000);
    app.stage.render();
    const out = document.createElement('canvas');
    out.width = w;
    out.height = h;
    const g = out.getContext('2d')!;
    g.drawImage(app.stage.renderer.domElement, 0, 0, w, h);
    drawLabels(g, app, w, h);
    drawChrome(g, app, w, h, app.replay.final ? null : app.data.ticks.t[Math.max(0, app.replay.tick)]);
    const blob = await new Promise<Blob | null>((r) => out.toBlob(r, 'image/png'));
    if (!blob) throw new Error('Could not encode PNG');
    download(blob, `gitcity-${slug(app.data.repo.name)}-${w}x${h}.png`);
  } finally {
    restoreCam();
    app.stage.setFixedSize(null);
    hooks.setExporting(false);
    ui.el.remove();
  }
}

export function videoSupported(): boolean {
  return typeof MediaRecorder !== 'undefined' && typeof HTMLCanvasElement.prototype.captureStream === 'function';
}

/**
 * Records a 10-second time-lapse (first commit -> today) with a slow orbit, as WebM.
 * Rendering happens at 1920x1080 into the WebGL canvas, then is composited with the title,
 * date and watermark into a 2D canvas that MediaRecorder captures.
 */
export async function exportVideo(app: App, hooks: ExportHooks, opts: { w?: number; h?: number; seconds?: number } = {}): Promise<void> {
  if (!videoSupported()) throw new Error('This browser cannot record video (MediaRecorder missing).');
  const seconds = opts.seconds ?? 10;
  const ui = overlay('Recording time-lapse…');
  hooks.setExporting(true);
  // Slow GPUs would produce a choppy 1080p video (MediaRecorder records in real time), so
  // measure a few frames first and fall back to 720p when they are slow.
  let w = opts.w ?? 1920;
  let h = opts.h ?? 1080;
  if (!opts.w) {
    app.stage.setFixedSize({ w, h });
    const t = performance.now();
    for (let i = 0; i < 3; i++) app.stage.render();
    app.stage.renderer.getContext().finish();
    if ((performance.now() - t) / 3 > 40) {
      w = 1280;
      h = 720;
    }
  }

  const stage = app.stage;
  const cam = stage.camera;
  const target = stage.controls.target.clone();
  const savedPos = cam.position.clone();
  const savedTarget = stage.controls.target.clone();
  const wasProgress = app.timeline.progress;

  // Start from the overview pose.
  const pose = stage.homePose(app.city.radius, w / h);
  target.copy(pose.target);
  const offset = pose.pos.clone().sub(pose.target);

  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const g = out.getContext('2d')!;
  const types = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  const mimeType = types.find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
  const stream = out.captureStream(30);
  const rec = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: 10_000_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise<void>((r) => (rec.onstop = () => r()));

  try {
    stage.setFixedSize({ w, h });
    app.walkers.clear();
    hooks.seekTo(0, false);
    app.city.update(1, 0);
    rec.start(250);
    const grow = seconds - 1.2; // hold the final city for the last moment
    const t0 = performance.now();
    let last = t0;
    await new Promise<void>((done) => {
      const step = (now: number) => {
        const t = (now - t0) / 1000;
        const dt = Math.min(0.1, (now - last) / 1000);
        last = now;
        const p = Math.min(1, t / grow);
        hooks.seekTo(p * p * (3 - 2 * p) * 0.15 + p * 0.85, true);
        // Slow orbit of ~50 degrees while easing in slightly.
        const ang = (t / seconds) * 0.9;
        const zoom = 1.08 - 0.12 * Math.min(1, t / seconds);
        const o = offset.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), ang).multiplyScalar(zoom);
        cam.position.copy(target).add(o);
        cam.lookAt(target);
        stage.controls.target.copy(target);
        app.city.update(dt, t);
        app.walkers.update(dt);
        stage.render();
        g.drawImage(stage.renderer.domElement, 0, 0, w, h);
        drawChrome(g, app, w, h, app.data.ticks.t[Math.max(0, app.replay.tick)]);
        ui.set(`Recording time-lapse… ${Math.min(seconds, Math.ceil(seconds - t))}s`);
        if (t < seconds) requestAnimationFrame(step);
        else done();
      };
      requestAnimationFrame(step);
    });
    rec.stop();
    await stopped;
    const type = rec.mimeType || mimeType || 'video/webm';
    const blob = new Blob(chunks, { type });
    download(blob, `gitcity-${slug(app.data.repo.name)}-timelapse.${type.includes('mp4') ? 'mp4' : 'webm'}`);
  } finally {
    if (rec.state !== 'inactive') rec.stop();
    stream.getTracks().forEach((t) => t.stop());
    stage.setFixedSize(null);
    cam.position.copy(savedPos);
    stage.controls.target.copy(savedTarget);
    hooks.seekTo(wasProgress, false);
    hooks.setExporting(false);
    ui.el.remove();
  }
}
