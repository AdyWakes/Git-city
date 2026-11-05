import { describe, test, expect } from 'vitest';
import { layoutCity, footprintCells, type LayoutDistrict } from '../src/core/layout.js';
import { fnv1a } from '../src/core/hash.js';

function synthetic(seed: number, nd: number, nb: number): LayoutDistrict[] {
  let s = seed;
  const rnd = () => ((s = fnv1a(String(s))) % 10000) / 10000;
  return Array.from({ length: nd }, (_, d) => ({
    name: `d${d}`,
    weight: Math.floor(rnd() * 1000),
    items: Array.from({ length: Math.max(1, Math.floor(rnd() * nb)) }, (_, i) => ({
      id: d * 100000 + i,
      k: footprintCells(Math.floor(rnd() ** 3 * 3000)),
      weight: Math.floor(rnd() * 5000),
      key: `d${d}/f${i}`,
    })),
  }));
}

describe('layoutCity', () => {
  test('footprint scale is logarithmic in commits', () => {
    expect([1, 9, 10, 99, 100, 999, 1000, 50000].map(footprintCells)).toEqual([1, 1, 2, 2, 3, 3, 4, 4]);
  });

  test('is deterministic', () => {
    const a = layoutCity(synthetic(1, 25, 300));
    const b = layoutCity(synthetic(1, 25, 300));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  test('does not depend on input item order', () => {
    const input = synthetic(7, 6, 200);
    const shuffled = input.map((d) => ({ ...d, items: [...d.items].reverse() }));
    expect(JSON.stringify(layoutCity(shuffled))).toBe(JSON.stringify(layoutCity(input)));
  });

  test('buildings never overlap and stay inside their district', () => {
    const input = synthetic(3, 20, 400);
    const r = layoutCity(input);
    r.buildings.forEach((list, di) => {
      const d = r.districts[di];
      expect(list.length).toBe(input[di].items.length);
      for (const b of list) {
        expect(b.x - b.size / 2).toBeGreaterThanOrEqual(d.x - d.w / 2 - 1e-6);
        expect(b.x + b.size / 2).toBeLessThanOrEqual(d.x + d.w / 2 + 1e-6);
        expect(b.z - b.size / 2).toBeGreaterThanOrEqual(d.z - d.d / 2 - 1e-6);
        expect(b.z + b.size / 2).toBeLessThanOrEqual(d.z + d.d / 2 + 1e-6);
      }
      const sorted = [...list].sort((a, b) => a.x - b.x);
      for (let i = 0; i < sorted.length; i++)
        for (let j = i + 1; j < sorted.length && sorted[j].x - sorted[i].x < 4; j++) {
          const a = sorted[i], b = sorted[j];
          const overlap = Math.abs(a.x - b.x) < (a.size + b.size) / 2 && Math.abs(a.z - b.z) < (a.size + b.size) / 2;
          expect(overlap).toBe(false);
        }
    });
  });

  test('districts never overlap', () => {
    const r = layoutCity(synthetic(5, 40, 150));
    for (let i = 0; i < r.districts.length; i++)
      for (let j = i + 1; j < r.districts.length; j++) {
        const a = r.districts[i], b = r.districts[j];
        const overlap = Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.z - b.z) < (a.d + b.d) / 2;
        expect(overlap).toBe(false);
      }
  });

  test('heaviest district sits at the center, heaviest building at its district core', () => {
    const input = synthetic(9, 12, 300);
    const r = layoutCity(input);
    const heaviest = input.reduce((m, d, i) => (d.weight > input[m].weight ? i : m), 0);
    const dist = (d: { x: number; z: number }) => Math.hypot(d.x, d.z);
    const sortedByDist = [...r.districts].sort((a, b) => dist(a) - dist(b));
    expect(sortedByDist[0].name).toBe(input[heaviest].name);
  });

  test('handles empty input', () => {
    const r = layoutCity([]);
    expect(r.districts).toEqual([]);
  });
});
