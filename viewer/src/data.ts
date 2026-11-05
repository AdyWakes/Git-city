import type { CityData } from '../../src/core/format';

export type { CityData };

/** Visual height (world units) for a line count. Square root keeps generated giants in check. */
export function heightFor(lines: number, scale: number): number {
  if (lines <= 0) return 0.12;
  return 0.25 + Math.sqrt(lines) * scale;
}

export interface Source {
  url: string;
  label?: string;
}

export interface DemoManifest {
  repos: { id: string; name: string; file: string; description?: string }[];
}

export async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

export async function tryFetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const type = res.headers.get('content-type') ?? '';
    if (!type.includes('json')) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export function validate(data: CityData): CityData {
  if (!data || typeof data !== 'object' || !data.b || !Array.isArray(data.b.path)) {
    throw new Error('This does not look like a gitcity file.');
  }
  return data;
}

const nf = new Intl.NumberFormat('en-US');
export const fmt = (n: number) => nf.format(Math.round(n));
export function compact(n: number): string {
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M';
  if (n >= 1e4) return Math.round(n / 1e3) + 'k';
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(n);
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function fmtDate(unix: number): string {
  if (!unix) return '—';
  const d = new Date(unix * 1000);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}
export function fmtMonth(unix: number): string {
  if (!unix) return '—';
  const d = new Date(unix * 1000);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
