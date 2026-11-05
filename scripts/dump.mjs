// dev helper: node scripts/dump.mjs <repo> -> prints summary
import { buildCity } from '../dist/node/build.js';
const t = Date.now();
const c = await buildCity(process.argv[2] ?? '.', { maxBuildings: Number(process.argv[3] ?? 10000) });
const s = JSON.stringify(c);
console.log({ ms: Date.now() - t, bytes: s.length, stats: c.stats, districts: c.districts.length, ev: c.ev.length / 4, langs: c.langs.map((l) => l.name).join(',') });
console.log(c.districts.slice(0, 8));
