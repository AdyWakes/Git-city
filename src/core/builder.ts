import type { Commit } from './parser.js';
import { FORMAT_VERSION, type CityData } from './format.js';
import { languageOf, languageColor } from './languages.js';
import { footprintCells, layoutCity, type LayoutDistrict } from './layout.js';

export const DEFAULT_MAX_BUILDINGS = 10000;
export const DEFAULT_MAX_TICKS = 1200;
export const ROOT_DISTRICT = '(root)';

interface FileRec {
  id: number;
  path: string;
  lines: number;
  peak: number;
  commits: number;
  born: number;
  died: number;
  binary: boolean;
  authors: Map<number, number>;
  lastTick: number;
  lastEv: number;
}

export interface BuilderOptions {
  /** Total number of commits that will be fed (from `git rev-list --count`), used to bucket ticks. */
  totalCommits: number;
  maxTicks?: number;
}

export interface FinalizeOptions {
  maxBuildings?: number;
  /** Max deleted-file lots. Defaults to 12% of maxBuildings. */
  maxLots?: number;
  repo: CityData['repo'];
  generator?: string;
  /** Override the timestamp (tests use this for byte-identical output). */
  generatedAt?: string;
}

/**
 * Consumes commits (oldest first) and keeps per-file aggregates plus a compact event list.
 * Memory is O(files + events), never O(raw log).
 */
export class CityBuilder {
  private files: FileRec[] = [];
  private alive = new Map<string, number>();
  private authorIds = new Map<string, number>();
  private authors: { name: string; commits: number }[] = [];
  private ev = new Int32Array(1 << 16);
  private evLen = 0;
  private readonly ticks: number;
  private readonly tickTime: number[];
  private readonly tickCount: number[];
  private commitIndex = 0;
  private first = 0;
  private last = 0;

  constructor(private readonly opts: BuilderOptions) {
    const max = opts.maxTicks ?? DEFAULT_MAX_TICKS;
    this.ticks = Math.max(1, Math.min(max, opts.totalCommits || 1));
    this.tickTime = new Array(this.ticks).fill(0);
    this.tickCount = new Array(this.ticks).fill(0);
  }

  get commitsSeen(): number {
    return this.commitIndex;
  }

  private tickOf(index: number): number {
    const total = Math.max(1, this.opts.totalCommits);
    return Math.min(this.ticks - 1, Math.floor((index * this.ticks) / total));
  }

  private author(name: string, email: string): number {
    const key = (email || name).toLowerCase();
    let id = this.authorIds.get(key);
    if (id === undefined) {
      id = this.authors.length;
      this.authorIds.set(key, id);
      this.authors.push({ name: name || email || 'unknown', commits: 0 });
    }
    return id;
  }

  private create(path: string, tick: number): FileRec {
    const f: FileRec = {
      id: this.files.length,
      path,
      lines: 0,
      peak: 0,
      commits: 0,
      born: tick,
      died: -1,
      binary: false,
      authors: new Map(),
      lastTick: -1,
      lastEv: -1,
    };
    this.files.push(f);
    this.alive.set(path, f.id);
    return f;
  }

  private kill(f: FileRec, tick: number) {
    f.died = tick;
    if (this.alive.get(f.path) === f.id) this.alive.delete(f.path);
  }

  private pushEvent(f: FileRec, tick: number, author: number) {
    if (f.lastTick === tick && f.lastEv >= 0) {
      this.ev[f.lastEv + 2] = f.lines;
      this.ev[f.lastEv + 3] = author;
      return;
    }
    if (this.evLen + 4 > this.ev.length) {
      const next = new Int32Array(this.ev.length * 2);
      next.set(this.ev);
      this.ev = next;
    }
    const i = this.evLen;
    this.ev[i] = tick;
    this.ev[i + 1] = f.id;
    this.ev[i + 2] = f.lines;
    this.ev[i + 3] = author;
    this.evLen += 4;
    f.lastTick = tick;
    f.lastEv = i;
  }

  addCommit(c: Commit): void {
    const tick = this.tickOf(this.commitIndex++);
    const a = this.author(c.author, c.email);
    this.authors[a].commits++;
    if (!this.first || c.time < this.first) this.first = c.time;
    if (c.time > this.last) this.last = c.time;
    if (c.time > this.tickTime[tick]) this.tickTime[tick] = c.time;
    this.tickCount[tick]++;

    // Order matters inside one commit: deletes free their paths, then renames/copies move
    // files, then adds/modifications see the final paths.
    const rank = (s: string) => (s === 'D' ? 0 : s === 'R' || s === 'C' ? 1 : 2);
    const changes = c.changes.length > 1 ? [...c.changes].sort((x, y) => rank(x.status) - rank(y.status)) : c.changes;
    for (const ch of changes) {
      let f: FileRec | undefined;
      if (ch.status === 'R' && ch.oldPath !== undefined) {
        const oldId = this.alive.get(ch.oldPath);
        const clash = this.alive.get(ch.path);
        if (clash !== undefined && clash !== oldId) this.kill(this.files[clash], tick);
        if (oldId !== undefined) {
          f = this.files[oldId];
          this.alive.delete(ch.oldPath);
          f.path = ch.path;
          this.alive.set(ch.path, f.id);
        } else {
          f = this.create(ch.path, tick);
        }
      } else if (ch.status === 'C' && ch.oldPath !== undefined) {
        const src = this.alive.get(ch.oldPath);
        const clash = this.alive.get(ch.path);
        if (clash !== undefined) this.kill(this.files[clash], tick);
        f = this.create(ch.path, tick);
        if (src !== undefined) f.lines = this.files[src].lines;
      } else {
        const id = this.alive.get(ch.path);
        f = id !== undefined ? this.files[id] : this.create(ch.path, tick);
      }

      f.binary = ch.binary;
      f.lines = Math.max(0, f.lines + ch.added - ch.deleted);
      if (f.lines > f.peak) f.peak = f.lines;
      f.commits++;
      f.authors.set(a, (f.authors.get(a) ?? 0) + 1);
      if (ch.status === 'D') {
        f.lines = 0;
        this.kill(f, tick);
      }
      this.pushEvent(f, tick, a);
    }
  }

  finalize(opts: FinalizeOptions): CityData {
    const maxBuildings = Math.max(1, opts.maxBuildings ?? DEFAULT_MAX_BUILDINGS);
    const maxLots = opts.maxLots ?? Math.round(maxBuildings * 0.12);
    const byPath = (a: FileRec, b: FileRec) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.id - b.id);

    const aliveFiles = this.files.filter((f) => f.died === -1 && !f.binary);
    const selected = [...aliveFiles].sort((a, b) => b.lines - a.lines || byPath(a, b)).slice(0, maxBuildings);
    const lots = this.files
      .filter((f) => f.died !== -1 && !f.binary && f.peak > 0)
      .sort((a, b) => b.peak - a.peak || byPath(a, b))
      // Lots are a memory, not the city: never more than half as many lots as buildings.
      .slice(0, Math.min(maxLots, Math.max(8, Math.ceil(selected.length * 0.5))));
    const chosen = [...selected, ...lots];

    // Districts: top-level folders. A folder holding more than half of the city is split into
    // its sub-folders (monorepos: packages/*, src/*), up to three levels deep.
    const split = new Set<string>();
    const districtOf = (path: string): string => {
      const parts = path.split('/');
      if (parts.length === 1) return ROOT_DISTRICT;
      let key = parts[0];
      let i = 1;
      while (split.has(key) && i < parts.length - 1) key += '/' + parts[i++];
      return key;
    };
    for (let iter = 0; iter < 3; iter++) {
      const counts = new Map<string, number>();
      for (const f of chosen) {
        const d = districtOf(f.path);
        counts.set(d, (counts.get(d) ?? 0) + 1);
      }
      let changed = false;
      for (const [d, n] of counts) {
        if (d === ROOT_DISTRICT || split.has(d) || n <= chosen.length * 0.5) continue;
        const subs = new Set<string>();
        for (const f of chosen) {
          if (districtOf(f.path) !== d) continue;
          const rest = f.path.slice(d.length + 1);
          const slash = rest.indexOf('/');
          if (slash > 0) subs.add(rest.slice(0, slash));
        }
        if (subs.size >= 2) {
          split.add(d);
          changed = true;
        }
      }
      if (!changed) break;
    }

    const districtNames = [...new Set(chosen.map((f) => districtOf(f.path)))].sort();
    const districtIndex = new Map(districtNames.map((n, i) => [n, i]));
    const groups: LayoutDistrict[] = districtNames.map((name) => ({ name, weight: 0, items: [] }));
    const local = new Map<number, number>(); // file id -> building index
    chosen.forEach((f, i) => local.set(f.id, i));
    chosen.forEach((f, i) => {
      const g = groups[districtIndex.get(districtOf(f.path))!];
      const weight = f.died === -1 ? f.lines : f.peak;
      g.weight += weight;
      g.items.push({ id: i, k: footprintCells(f.commits), weight, key: f.path });
    });
    const layout = layoutCity(groups);

    const langNames: string[] = [];
    const langIndex = new Map<string, number>();
    const n = chosen.length;
    const b: CityData['b'] = {
      path: new Array(n),
      district: new Array(n),
      lang: new Array(n),
      x: new Array(n),
      z: new Array(n),
      size: new Array(n),
      lines: new Array(n),
      peak: new Array(n),
      commits: new Array(n),
      author: new Array(n),
      born: new Array(n),
      died: new Array(n),
    };
    chosen.forEach((f, i) => {
      const lang = languageOf(f.path);
      let li = langIndex.get(lang);
      if (li === undefined) {
        li = langNames.length;
        langNames.push(lang);
        langIndex.set(lang, li);
      }
      let top = 0;
      let topN = -1;
      for (const [aid, cnt] of f.authors) if (cnt > topN || (cnt === topN && aid < top)) (top = aid), (topN = cnt);
      b.path[i] = f.path;
      b.district[i] = districtIndex.get(districtOf(f.path))!;
      b.lang[i] = li;
      b.lines[i] = f.died === -1 ? f.lines : 0;
      b.peak[i] = f.peak;
      b.commits[i] = f.commits;
      b.author[i] = top;
      b.born[i] = f.born;
      b.died[i] = f.died;
    });
    layout.buildings.forEach((list) => {
      for (const p of list) {
        b.x[p.id] = p.x;
        b.z[p.id] = p.z;
        b.size[p.id] = p.size;
      }
    });

    const districts = layout.districts.map((d, i) => {
      let files = 0;
      let lines = 0;
      for (const it of groups[i].items) {
        files++;
        lines += b.lines[it.id];
      }
      return { ...d, files, lines };
    });

    const ev: number[] = [];
    for (let i = 0; i < this.evLen; i += 4) {
      const bi = local.get(this.ev[i + 1]);
      if (bi === undefined) continue;
      ev.push(this.ev[i], bi, this.ev[i + 2], this.ev[i + 3]);
    }

    // Fill tick times for empty buckets so the timeline never shows 1970.
    const tickTime = [...this.tickTime];
    for (let i = 0; i < tickTime.length; i++) if (!tickTime[i]) tickTime[i] = i > 0 ? tickTime[i - 1] : this.first;

    let totalLines = 0;
    for (const f of aliveFiles) totalLines += f.lines;

    return {
      v: FORMAT_VERSION,
      generator: opts.generator ?? 'gitcity',
      generatedAt: opts.generatedAt ?? new Date().toISOString(),
      repo: opts.repo,
      stats: {
        commits: this.commitIndex,
        authors: this.authors.length,
        files: this.files.filter((f) => !f.binary).length,
        alive: aliveFiles.length,
        rendered: n,
        lines: totalLines,
        first: this.first,
        last: this.last,
      },
      langs: langNames.map((name) => ({ name, color: languageColor(name) })),
      authors: this.authors.map((a) => ({ name: a.name, commits: a.commits })),
      ticks: { t: tickTime, n: [...this.tickCount] },
      districts,
      b,
      ev,
    };
  }
}
