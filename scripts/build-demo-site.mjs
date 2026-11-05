// Assembles the static demo site: the viewer bundle + manifest + pre-generated cities.
// Usage: npm run build:viewer && node scripts/build-demo-site.mjs  -> ./demo-site
import { cpSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';

const out = 'demo-site';
if (!existsSync('dist/viewer/index.html')) {
  console.error('dist/viewer missing: run `npm run build:viewer` first');
  process.exit(1);
}
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync('dist/viewer', out, { recursive: true });
cpSync('demo/manifest.json', `${out}/manifest.json`);
cpSync('demo/data', `${out}/data`, { recursive: true });
writeFileSync(`${out}/.nojekyll`, '');
console.log(`demo site ready in ./${out}`);
