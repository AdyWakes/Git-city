/**
 * Deterministic city layout.
 *
 * - Inside a district, buildings are placed in order of importance (lines, then path) on a
 *   square spiral that starts at the district center, so the tallest towers form a downtown
 *   core and smaller buildings spread outwards. Every 6th row/column is a street.
 * - Districts are placed largest first on a circular spiral around the city center, separated
 *   by avenues.
 *
 * No randomness: identical input always yields identical coordinates.
 */

export const BLOCK = 6; // 5 lots + 1 street
export const BUILDING_GAP = 0.28; // sidewalk around each building, in cells
export const AVENUE = 3; // gap between districts, in cells

export interface LayoutItem {
  /** Stable id returned in the result. */
  id: number;
  /** Footprint in cells (1..4). */
  k: number;
  /** Ordering weight; higher is placed closer to the center. */
  weight: number;
  /** Tie-breaker. */
  key: string;
}

export interface LayoutDistrict {
  name: string;
  weight: number;
  items: LayoutItem[];
}

export interface PlacedBuilding {
  id: number;
  x: number;
  z: number;
  size: number;
}

export interface PlacedDistrict {
  name: string;
  x: number;
  z: number;
  w: number;
  d: number;
}

export interface LayoutResult {
  districts: PlacedDistrict[];
  /** Indexed in the same order as the input districts. */
  buildings: PlacedBuilding[][];
  bounds: { minX: number; minZ: number; maxX: number; maxZ: number };
}

/** Footprint edge in cells from the number of commits: 1-9 -> 1, 10-99 -> 2, 100-999 -> 3, 1000+ -> 4. */
export function footprintCells(commits: number): number {
  if (commits < 10) return 1;
  if (commits < 100) return 2;
  if (commits < 1000) return 3;
  return 4;
}

const cmpItems = (a: LayoutItem, b: LayoutItem) =>
  b.weight - a.weight || b.k - a.k || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

const isStreet = (v: number) => ((v % BLOCK) + BLOCK) % BLOCK === BLOCK - 1;

/** Square spiral cell order, ring by ring, starting at (0,0). */
function squareSpiral(radius: number): Int32Array {
  const n = (2 * radius + 1) ** 2;
  const out = new Int32Array(n * 2);
  let i = 0;
  out[i++] = 0;
  out[i++] = 0;
  for (let r = 1; r <= radius; r++) {
    // top edge left->right, right edge top->bottom, bottom edge right->left, left edge bottom->top
    for (let x = -r; x < r; x++) (out[i++] = x), (out[i++] = -r);
    for (let y = -r; y < r; y++) (out[i++] = r), (out[i++] = y);
    for (let x = r; x > -r; x--) (out[i++] = x), (out[i++] = r);
    for (let y = r; y > -r; y--) (out[i++] = -r), (out[i++] = y);
  }
  return out;
}

interface Block {
  /** Building positions relative to block min corner, in cells. */
  placed: { id: number; cx: number; cy: number; k: number }[];
  w: number;
  h: number;
}

function layoutDistrict(items: LayoutItem[]): Block {
  const sorted = [...items].sort(cmpItems);
  let area = 0;
  for (const it of sorted) area += it.k * it.k;
  let radius = Math.ceil(Math.sqrt(area * 1.6) / 2) + 4;

  for (;;) {
    const spiral = squareSpiral(radius);
    const size = 2 * radius + 1;
    const occ = new Uint8Array(size * size);
    const pointer = [0, 0, 0, 0, 0];
    const placed: Block['placed'] = [];
    let ok = true;
    const free = (x: number, y: number, k: number) => {
      if (x < -radius || y < -radius || x + k - 1 > radius || y + k - 1 > radius) return false;
      for (let dx = 0; dx < k; dx++) {
        if (isStreet(x + dx)) return false;
        for (let dy = 0; dy < k; dy++) {
          if (isStreet(y + dy)) return false;
          if (occ[(y + dy + radius) * size + (x + dx + radius)]) return false;
        }
      }
      return true;
    };
    for (const it of sorted) {
      const k = it.k;
      const off = (k - 1) >> 1;
      let p = pointer[k];
      let found = false;
      for (; p < spiral.length / 2; p++) {
        const x = spiral[p * 2] - off;
        const y = spiral[p * 2 + 1] - off;
        if (free(x, y, k)) {
          for (let dx = 0; dx < k; dx++)
            for (let dy = 0; dy < k; dy++) occ[(y + dy + radius) * size + (x + dx + radius)] = 1;
          placed.push({ id: it.id, cx: x + k / 2, cy: y + k / 2, k });
          found = true;
          p++;
          break;
        }
      }
      pointer[k] = p;
      if (!found) {
        ok = false;
        break;
      }
    }
    if (!ok) {
      radius = Math.ceil(radius * 1.5) + 2;
      continue;
    }
    if (placed.length === 0) return { placed, w: 2, h: 2 };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const b of placed) {
      minX = Math.min(minX, b.cx - b.k / 2);
      minY = Math.min(minY, b.cy - b.k / 2);
      maxX = Math.max(maxX, b.cx + b.k / 2);
      maxY = Math.max(maxY, b.cy + b.k / 2);
    }
    for (const b of placed) {
      b.cx -= minX;
      b.cy -= minY;
    }
    return { placed, w: maxX - minX, h: maxY - minY };
  }
}

/** Integer points inside a radius, sorted by distance then angle. */
function circularCandidates(radius: number): Int32Array {
  const pts: [number, number, number, number][] = [];
  const r2 = radius * radius;
  for (let x = -radius; x <= radius; x++)
    for (let y = -radius; y <= radius; y++) {
      const d = x * x + y * y;
      if (d <= r2) pts.push([x, y, d, Math.atan2(y, x)]);
    }
  pts.sort((a, b) => a[2] - b[2] || a[3] - b[3]);
  const out = new Int32Array(pts.length * 2);
  pts.forEach((p, i) => ((out[i * 2] = p[0]), (out[i * 2 + 1] = p[1])));
  return out;
}

const round = (v: number) => Math.round(v * 100) / 100;

export function layoutCity(districts: LayoutDistrict[]): LayoutResult {
  const blocks = districts.map((d) => layoutDistrict(d.items));
  const order = districts
    .map((d, i) => i)
    .sort((a, b) => districts[b].weight - districts[a].weight || (districts[a].name < districts[b].name ? -1 : 1));

  let total = 0;
  let maxDim = 0;
  for (const b of blocks) {
    total += (b.w + AVENUE) * (b.h + AVENUE);
    maxDim = Math.max(maxDim, b.w + AVENUE, b.h + AVENUE);
  }
  let radius = Math.ceil(Math.sqrt(total / Math.PI) * 1.3 + maxDim / 2) + 2;
  let cand = circularCandidates(radius);

  const rects: { x0: number; y0: number; x1: number; y1: number }[] = [];
  const centers: { x: number; y: number }[] = new Array(blocks.length);
  for (const i of order) {
    const b = blocks[i];
    const hw = (b.w + AVENUE) / 2;
    const hh = (b.h + AVENUE) / 2;
    let placed = false;
    while (!placed) {
      for (let p = 0; p < cand.length / 2; p++) {
        // Snap so block edges land on whole cells.
        const cx = cand[p * 2] + (b.w % 2) / 2;
        const cy = cand[p * 2 + 1] + (b.h % 2) / 2;
        const r = { x0: cx - hw, y0: cy - hh, x1: cx + hw, y1: cy + hh };
        let hit = false;
        for (const o of rects) {
          if (r.x0 < o.x1 && r.x1 > o.x0 && r.y0 < o.y1 && r.y1 > o.y0) {
            hit = true;
            break;
          }
        }
        if (!hit) {
          rects.push(r);
          centers[i] = { x: cx, y: cy };
          placed = true;
          break;
        }
      }
      if (!placed) {
        radius = Math.ceil(radius * 1.5);
        cand = circularCandidates(radius);
      }
    }
  }

  // Recenter on the city's bounding box.
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  blocks.forEach((b, i) => {
    const c = centers[i];
    minX = Math.min(minX, c.x - b.w / 2);
    maxX = Math.max(maxX, c.x + b.w / 2);
    minZ = Math.min(minZ, c.y - b.h / 2);
    maxZ = Math.max(maxZ, c.y + b.h / 2);
  });
  if (!blocks.length) minX = minZ = maxX = maxZ = 0;
  const ox = Math.round((minX + maxX) / 2);
  const oz = Math.round((minZ + maxZ) / 2);

  const outDistricts: PlacedDistrict[] = [];
  const outBuildings: PlacedBuilding[][] = [];
  blocks.forEach((b, i) => {
    const c = centers[i];
    const x0 = c.x - b.w / 2 - ox;
    const z0 = c.y - b.h / 2 - oz;
    outDistricts.push({ name: districts[i].name, x: round(c.x - ox), z: round(c.y - oz), w: b.w, d: b.h });
    outBuildings.push(
      b.placed.map((p) => ({ id: p.id, x: round(x0 + p.cx), z: round(z0 + p.cy), size: round(p.k - BUILDING_GAP) })),
    );
  });
  return { districts: outDistricts, buildings: outBuildings, bounds: { minX: minX - ox, minZ: minZ - oz, maxX: maxX - ox, maxZ: maxZ - oz } };
}
