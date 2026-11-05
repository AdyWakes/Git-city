import * as THREE from 'three';
import { CityView } from './city';
import { Stage } from './stage';
import { compact, fetchJson, fmt, fmtMonth, tryFetchJson, validate, type CityData, type DemoManifest } from './data';
import { Labels } from './labels';
import { Search } from './search';
import { Replay } from './replay';
import { TimelineUI } from './timeline';
import { Walkers } from './walkers';
import { exportPng, exportVideo, videoSupported, type ExportHooks } from './export';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export interface App {
  data: CityData;
  city: CityView;
  stage: Stage;
  labels: Labels;
  replay: Replay;
  timeline: TimelineUI;
  walkers: Walkers;
  hooks: ExportHooks;
}

let app: App | null = null;
let disposeApp: (() => void) | null = null;

async function boot() {
  const params = new URLSearchParams(location.search);
  const explicit = params.get('data');
  if (explicit) return load(explicit);

  const manifest = await tryFetchJson<DemoManifest>('./manifest.json');
  if (manifest && manifest.repos.length) {
    const nav = $('demo-switch');
    nav.hidden = false;
    const wanted = params.get('repo') ?? manifest.repos[0].id;
    const pick = (id: string) => {
      const r = manifest.repos.find((x) => x.id === id) ?? manifest.repos[0];
      for (const b of nav.querySelectorAll('button')) b.setAttribute('aria-current', String(b.dataset.id === r.id));
      const url = new URL(location.href);
      url.searchParams.set('repo', r.id);
      history.replaceState(null, '', url);
      return load(r.file);
    };
    for (const r of manifest.repos) {
      const b = document.createElement('button');
      b.textContent = r.name;
      b.dataset.id = r.id;
      b.title = r.description ?? r.name;
      b.onclick = () => pick(r.id);
      nav.append(b);
    }
    return pick(wanted);
  }
  return load('./city.json');
}

async function load(url: string) {
  const loading = $('loading');
  loading.classList.remove('done');
  $('loading-text').textContent = 'Loading city…';
  try {
    const data = validate(await fetchJson<CityData>(url));
    disposeApp?.();
    start(data);
    loading.classList.add('done');
  } catch (e) {
    $('loading-text').textContent = `Could not load the city: ${(e as Error).message}`;
    console.error(e);
  }
}

function start(data: CityData) {
  const canvas = $<HTMLCanvasElement>('c');
  const city = new CityView(data);
  const stage = new Stage(canvas, city.radius);
  stage.scene.add(city.group);
  const walkers = new Walkers(city);
  stage.scene.add(walkers.points);
  stage.onResize = (w, h) => {
    city.setViewport(w, h);
    walkers.setViewport(h);
  };
  stage.resize();

  // Time-lapse ---------------------------------------------------------------------------------
  const replay = new Replay(data);
  replay.seek(replay.ticks - 1);
  city.setState(replay.lines, replay.lots, true);
  const timeline = new TimelineUI(data, replay);
  const seekTo = (p: number, follow: boolean) => {
    const tick = timeline.tickFor(p);
    if (replay.seek(tick, follow ? (b, a) => walkers.visit(a, b) : undefined)) {
      city.setState(replay.lines, replay.lots);
      labels.setActiveFrom(replay.lines);
    }
  };
  timeline.onSeek = (p, fromUser) => seekTo(p, timeline.playing && !fromUser);
  timeline.onPlayToggle = (playing) => {
    if (playing) {
      stage.controls.autoRotate = true;
      if (timeline.progress === 0) walkers.clear();
    }
  };

  const labels = new Labels($('labels'), data, city, stage, (d) => flyToDistrict(d));
  app = { data, city, stage, labels, replay, timeline, walkers, hooks: null as unknown as ExportHooks };
  renderHeader(data);
  renderLegend(data);

  // Interaction ----------------------------------------------------------------------------
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const tip = $('tip');
  let pointer: { x: number; y: number } | null = null;
  let hovered = -1;
  let hoverDistrict = -1;
  let pinned = -1;
  let downAt: { x: number; y: number; t: number } | null = null;
  let idleSince = performance.now();

  const pickAt = (x: number, y: number) => {
    const r = canvas.getBoundingClientRect();
    ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, stage.camera);
    const bi = city.pick(raycaster.ray);
    let di = bi >= 0 ? data.b.district[bi] : -1;
    if (di < 0) {
      const t = -raycaster.ray.origin.y / raycaster.ray.direction.y;
      if (t > 0) {
        const p = raycaster.ray.at(t, new THREE.Vector3());
        di = city.districtAt(p.x, p.z);
      }
    }
    return { bi, di };
  };

  const onMove = (e: PointerEvent) => {
    pointer = { x: e.clientX, y: e.clientY };
    idleSince = performance.now();
  };
  const onDown = (e: PointerEvent) => {
    downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
    stage.controls.autoRotate = false;
  };
  const onUp = (e: PointerEvent) => {
    if (!downAt) return;
    const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
    const quick = performance.now() - downAt.t < 450;
    downAt = null;
    if (moved > 5 || !quick) return;
    const { bi, di } = pickAt(e.clientX, e.clientY);
    if (bi >= 0) {
      pinned = bi;
      focusBuilding(bi, false);
    } else if (di >= 0) {
      pinned = -1;
      flyToDistrict(di);
    } else {
      pinned = -1;
      city.setHighlight([]);
      city.showBeacon(-1);
    }
  };
  const onLeave = () => {
    pointer = null;
  };
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointerleave', onLeave);
  canvas.addEventListener('wheel', () => (stage.controls.autoRotate = false), { passive: true });
  canvas.addEventListener('dblclick', () => {
    stage.flyToPose(stage.homePose(city.radius, stage.camera.aspect), 1.6);
  });

  function flyToDistrict(di: number) {
    const d = data.districts[di];
    if (!d) return;
    stage.controls.autoRotate = false;
    stage.flyTo(new THREE.Vector3(d.x, 0, d.z), Math.max(18, Math.max(d.w, d.d) * 1.5));
  }

  function focusBuilding(bi: number, beacon: boolean) {
    stage.controls.autoRotate = false;
    city.setHighlight([bi]);
    city.showBeacon(beacon ? bi : -1);
    const top = city.topOf(bi);
    stage.flyTo(new THREE.Vector3(top.x, top.y * 0.5, top.z), Math.max(14, top.y * 2.2 + 10));
  }

  const search = new Search($<HTMLInputElement>('search'), $('results'), data, (bi) => {
    pinned = bi;
    focusBuilding(bi, true);
  });

  const showTip = (bi: number, x: number, y: number) => {
    if (bi < 0) {
      tip.classList.remove('on');
      return;
    }
    const b = data.b;
    const path = b.path[bi];
    const slash = path.lastIndexOf('/');
    const lang = data.langs[b.lang[bi]];
    const lines = city.currentLines(bi);
    const gone = b.died[bi] !== -1 && city.isLot(bi);
    tip.innerHTML = `
      <div class="t-name"><i style="background:${lang?.color ?? '#888'}"></i>${esc(path.slice(slash + 1))}</div>
      ${slash > 0 ? `<div class="t-path">${esc(path.slice(0, slash + 1))}</div>` : ''}
      <div class="t-stats"><b>${fmt(gone ? b.peak[bi] : lines)}</b> ${gone ? 'lines at peak' : 'lines'} · <b>${fmt(b.commits[bi])}</b> commits${
        data.authors[b.author[bi]] ? ` · top author <b>${esc(data.authors[b.author[bi]].name)}</b>` : ''
      }</div>
      ${gone ? `<div class="t-gone">Deleted ${fmtMonth(data.ticks.t[b.died[bi]])}</div>` : ''}`;
    tip.classList.add('on');
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    const px = x + 18 + tw > innerWidth ? x - tw - 14 : x + 18;
    const py = y + 18 + th > innerHeight ? y - th - 12 : y + 18;
    tip.style.transform = `translate(${px}px, ${py}px)`;
  };

  // Frame loop --------------------------------------------------------------------------------
  let last = performance.now();
  let running = true;
  stage.controls.autoRotate = true;
  let exporting = false;
  const frame = (now: number) => {
    if (!running) return;
    if (exporting) {
      last = now;
      requestAnimationFrame(frame);
      return;
    }
    const dt = Math.min(0.1, (now - last) / 1000);
    stage.trackFrame(now - last, now);
    last = now;

    if (!stage.flying && now - idleSince > 25000 && !downAt) stage.controls.autoRotate = true;
    timeline.advance(dt);
    stage.update(dt);
    city.update(dt, now / 1000);
    walkers.update(dt);

    if (pointer && !stage.flying) {
      const { bi, di } = pickAt(pointer.x, pointer.y);
      if (bi !== hovered) {
        hovered = bi;
        if (pinned < 0) city.setHighlight(bi >= 0 ? [bi] : []);
        canvas.style.cursor = bi >= 0 || di >= 0 ? 'pointer' : '';
      }
      if (di !== hoverDistrict) {
        hoverDistrict = di;
        city.setHoverDistrict(di);
      }
      showTip(bi, pointer.x, pointer.y);
    } else if (!pointer) {
      if (hovered !== -1 && pinned < 0) city.setHighlight([]);
      hovered = -1;
      if (hoverDistrict !== -1) city.setHoverDistrict((hoverDistrict = -1));
      tip.classList.remove('on');
    }

    stage.render();
    labels.update();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  // Export -------------------------------------------------------------------------------------
  const hooks: ExportHooks = {
    setExporting: (on) => {
      exporting = on;
      labels.visible = !on;
      if (!on) labels.update();
    },
    seekTo: (p, follow) => {
      seekTo(p, follow);
      if (!exporting) timeline.setProgress(p);
    },
  };
  const menu = $('export-menu');
  const menuBtn = $('export-btn');
  const closeMenu = () => menu.classList.remove('open');
  const onMenu = (e: MouseEvent) => {
    e.stopPropagation();
    menu.classList.toggle('open');
  };
  const onExport = async (e: MouseEvent) => {
    const kind = (e.target as HTMLElement).closest<HTMLElement>('[data-export]')?.dataset.export;
    if (!kind || !app) return;
    closeMenu();
    if (timeline.playing) timeline.toggle(false);
    try {
      if (kind === 'png-wide') await exportPng(app, hooks, 1920, 1080);
      else if (kind === 'png-tall') await exportPng(app, hooks, 1080, 1920);
      else if (kind === 'video') await exportVideo(app, hooks);
    } catch (err) {
      toast((err as Error).message);
    }
  };
  menuBtn.addEventListener('click', onMenu);
  menu.addEventListener('click', onExport);
  document.addEventListener('click', closeMenu);
  if (!videoSupported()) menu.querySelector<HTMLButtonElement>('[data-export="video"]')!.disabled = true;

  disposeApp = () => {
    menuBtn.removeEventListener('click', onMenu);
    menu.removeEventListener('click', onExport);
    document.removeEventListener('click', closeMenu);
    running = false;
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointerup', onUp);
    canvas.removeEventListener('pointerleave', onLeave);
    search.dispose();
    timeline.dispose();
    labels.dispose();
    stage.dispose();
    app = null;
  };
  app.hooks = hooks;
  (window as unknown as { gitcity: unknown }).gitcity = app;
}

function renderHeader(data: CityData) {
  const name = $('repo-name');
  name.innerHTML = data.repo.url ? `<a href="${esc(data.repo.url)}" target="_blank" rel="noopener">${esc(data.repo.name)}</a>` : esc(data.repo.name);
  const s = data.stats;
  const since = s.first ? new Date(s.first * 1000).getUTCFullYear() : null;
  $('repo-stats').innerHTML =
    s.commits === 0
      ? 'No commits yet. Make one and run gitcity again.'
      : `<b>${fmt(s.commits)}</b> commits · <b>${fmt(s.authors)}</b> authors · <b>${compact(s.lines)}</b> lines${since ? ` · since ${since}` : ''}`;
  document.title = `${data.repo.name} · gitcity`;
}

function renderLegend(data: CityData) {
  const totals = new Map<number, number>();
  data.b.lang.forEach((l, i) => totals.set(l, (totals.get(l) ?? 0) + data.b.lines[i]));
  const top = [...totals.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 6);
  $('legend').innerHTML = top
    .map(([l]) => `<div><i style="background:${data.langs[l].color}"></i>${esc(data.langs[l].name)}</div>`)
    .join('');
}

function toast(msg: string) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.append(t);
  setTimeout(() => t.remove(), 4000);
}

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function getApp(): App | null {
  return app;
}

boot();
