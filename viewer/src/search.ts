import type { CityData } from './data';
import { compact } from './data';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** File finder: substring match on path, ranked by file-name hits, then size. */
export class Search {
  private lower: string[];
  private matches: number[] = [];
  private active = 0;
  private abort = new AbortController();

  constructor(
    private input: HTMLInputElement,
    private list: HTMLElement,
    private data: CityData,
    private onPick: (building: number) => void,
  ) {
    this.lower = data.b.path.map((p) => p.toLowerCase());
    input.value = '';
    list.innerHTML = '';
    const sig = { signal: this.abort.signal };
    input.addEventListener('input', () => this.run(), sig);
    input.addEventListener(
      'keydown',
      (e) => {
        if (e.key === 'ArrowDown') this.move(1), e.preventDefault();
        else if (e.key === 'ArrowUp') this.move(-1), e.preventDefault();
        else if (e.key === 'Enter' && this.matches.length) this.choose(this.matches[this.active]);
        else if (e.key === 'Escape') this.clear(), input.blur();
      },
      sig,
    );
    list.addEventListener(
      'pointerdown',
      (e) => {
        const li = (e.target as HTMLElement).closest('li');
        if (li) this.choose(Number(li.dataset.i)), e.preventDefault();
      },
      sig,
    );
    input.addEventListener('blur', () => setTimeout(() => (list.innerHTML = ''), 150), sig);
    input.addEventListener('focus', () => this.run(), sig);
    window.addEventListener(
      'keydown',
      (e) => {
        if ((e.key === '/' || (e.key === 'k' && (e.metaKey || e.ctrlKey))) && document.activeElement !== input) {
          e.preventDefault();
          input.focus();
          input.select();
        }
      },
      sig,
    );
  }

  private run() {
    const q = this.input.value.trim().toLowerCase();
    if (!q) {
      this.matches = [];
      this.list.innerHTML = '';
      return;
    }
    const b = this.data.b;
    const scored: [number, number][] = [];
    for (let i = 0; i < this.lower.length; i++) {
      const p = this.lower[i];
      const at = p.indexOf(q);
      if (at < 0) continue;
      const nameStart = p.lastIndexOf('/') + 1;
      let score = 0;
      if (at >= nameStart) score += 1000;
      if (at === nameStart) score += 500;
      if (b.died[i] !== -1) score -= 800;
      score += Math.log10(1 + b.lines[i]) * 40 - p.length * 0.5;
      scored.push([score, i]);
    }
    scored.sort((a, b) => b[0] - a[0]);
    this.matches = scored.slice(0, 8).map((s) => s[1]);
    this.active = 0;
    this.render();
  }

  private render() {
    const b = this.data.b;
    this.list.innerHTML = this.matches
      .map((i, k) => {
        const p = b.path[i];
        const s = p.lastIndexOf('/');
        const gone = b.died[i] !== -1;
        return `<li role="option" data-i="${i}" aria-selected="${k === this.active}"><span class="name">${esc(p.slice(s + 1))}</span><span class="dir">${esc(s > 0 ? p.slice(0, s) : '/')}</span><span class="num">${gone ? 'deleted' : compact(b.lines[i]) + ' lines'}</span></li>`;
      })
      .join('');
    if (!this.matches.length) this.list.innerHTML = '<li><span class="name">No match</span></li>';
  }

  private move(d: number) {
    if (!this.matches.length) return;
    this.active = (this.active + d + this.matches.length) % this.matches.length;
    this.render();
  }

  private choose(i: number) {
    if (Number.isNaN(i)) return;
    this.input.value = this.data.b.path[i];
    this.list.innerHTML = '';
    this.input.blur();
    this.onPick(i);
  }

  clear() {
    this.input.value = '';
    this.matches = [];
    this.list.innerHTML = '';
  }

  dispose() {
    this.abort.abort();
  }
}
