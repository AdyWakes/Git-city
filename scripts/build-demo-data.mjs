// Generates the demo cities: clones each repo (full, bare) and writes compact JSON to demo/data.
// Usage: npm run build:cli && node scripts/build-demo-data.mjs [--cache <dir>] [id ...]
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { buildCity } from '../dist/node/build.js';

const REPOS = [
  { id: 'react', name: 'facebook/react', url: 'https://github.com/facebook/react', description: 'The library for web and native user interfaces' },
  { id: 'vue', name: 'vuejs/core', url: 'https://github.com/vuejs/core', description: 'Vue.js 3: the progressive JavaScript framework' },
  { id: 'redis', name: 'redis/redis', url: 'https://github.com/redis/redis', description: 'The in-memory data store, in C' },
  { id: 'flask', name: 'pallets/flask', url: 'https://github.com/pallets/flask', description: 'The Python micro framework for building web applications' },
];
const MAX_BUILDINGS = 5000;
const MAX_TICKS = 900;

const args = process.argv.slice(2);
const cacheIdx = args.indexOf('--cache');
const cache = cacheIdx >= 0 ? args.splice(cacheIdx, 2)[1] : '.gitcity-cache';
const only = new Set(args);
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));

mkdirSync('demo/data', { recursive: true });
mkdirSync(cache, { recursive: true });
for (const r of REPOS) {
  if (only.size && !only.has(r.id)) continue;
  const dir = join(cache, `${r.id}.git`);
  if (!existsSync(dir)) {
    console.log(`cloning ${r.url}`);
    execFileSync('git', ['clone', '--bare', '--', r.url, dir], { stdio: 'inherit' });
  } else {
    execFileSync('git', ['-C', dir, 'fetch', '--quiet', 'origin', '+refs/heads/*:refs/heads/*'], { stdio: 'inherit' });
  }
  const t = Date.now();
  const city = await buildCity(dir, {
    name: r.name,
    url: r.url,
    maxBuildings: MAX_BUILDINGS,
    maxTicks: MAX_TICKS,
    generator: `gitcity ${pkg.version}`,
  });
  const json = JSON.stringify(city);
  writeFileSync(`demo/data/${r.id}.json`, json);
  console.log(`${r.id}: ${city.stats.commits} commits, ${city.stats.rendered} buildings, ${(json.length / 1024).toFixed(0)} KB, ${Date.now() - t}ms`);
}
writeFileSync(
  'demo/manifest.json',
  JSON.stringify({ repos: REPOS.map((r) => ({ id: r.id, name: r.name, file: `data/${r.id}.json`, description: r.description })) }, null, 2) + '\n',
);
