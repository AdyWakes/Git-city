// Generates a large synthetic git repository with `git fast-import`, for performance testing.
//
//   node scripts/synth-repo.mjs <dir> [--commits 50000] [--files 20000] [--authors 300]
//
// Deterministic (seeded PRNG). Files grow and shrink, get renamed and deleted; a few hot files
// receive a large share of commits, like real projects.
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';

const argv = process.argv.slice(2);
const dir = argv[0];
if (!dir) {
  console.error('usage: node scripts/synth-repo.mjs <dir> [--commits N] [--files N] [--authors N]');
  process.exit(2);
}
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? Number(argv[i + 1]) : def;
};
const COMMITS = opt('commits', 50000);
const FILES = opt('files', 20000);
const AUTHORS = opt('authors', 300);

let seed = 42;
const rnd = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};
const zipf = (n, s = 1.1) => Math.min(n - 1, Math.floor(Math.pow(rnd(), s * 3) * n));

const TOP = ['src', 'lib', 'packages', 'docs', 'test', 'tools', 'scripts', 'examples', 'benchmarks', 'config', 'assets', 'api', 'web', 'cli', 'core', 'plugins', 'vendor', 'internal', 'cmd', 'pkg'];
const SUB = ['compiler', 'runtime', 'server', 'client', 'shared', 'utils', 'dom', 'parser', 'router', 'store', 'net', 'io', 'ui', 'auth', 'db', 'cache', 'events', 'hooks', 'render', 'math'];
const EXT = ['ts', 'ts', 'ts', 'js', 'js', 'go', 'rs', 'py', 'c', 'h', 'md', 'json', 'css', 'html', 'sh', 'yml'];

if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
execFileSync('git', ['init', '-q', '-b', 'main', dir]);
const fi = spawn('git', ['fast-import', '--quiet', '--done'], { cwd: dir, stdio: ['pipe', 'inherit', 'inherit'] });

let pending = [];
let pendingBytes = 0;
async function write(s) {
  pending.push(s);
  pendingBytes += s.length;
  if (pendingBytes > 1 << 20) await flush();
}
async function flush() {
  const chunk = pending.join('');
  pending = [];
  pendingBytes = 0;
  if (!fi.stdin.write(chunk)) await new Promise((r) => fi.stdin.once('drain', r));
}

const files = []; // { path, lines, version, alive }
const alive = [];
let created = 0;
const content = (f) => {
  let s = `// ${f.path} v${f.version}\n`;
  for (let i = 1; i < f.lines; i++) s += `${i}\n`;
  return s;
};
const newPath = (id) => {
  const top = TOP[zipf(TOP.length, 0.7)];
  const sub = SUB[Math.floor(rnd() * SUB.length)];
  const deep = rnd() < 0.4 ? `/${SUB[Math.floor(rnd() * SUB.length)]}` : '';
  return `${top}/${sub}${deep}/file_${id}.${EXT[Math.floor(rnd() * EXT.length)]}`;
};
const bodyLines = () => Math.max(2, Math.floor(Math.pow(rnd(), 2.6) * 1800) + 5);

let time = 1262304000; // 2010-01-01
for (let c = 0; c < COMMITS; c++) {
  time += 600 + Math.floor(rnd() * 7200);
  const a = zipf(AUTHORS, 0.9);
  const ops = [];
  const want = 1 + Math.floor(Math.pow(rnd(), 2) * 6);
  const progress = c / COMMITS;
  for (let k = 0; k < want; k++) {
    const r = rnd();
    const needCreate = created < FILES && (alive.length < 5 || rnd() < (FILES - created) / FILES / Math.max(0.15, 1 - progress) * 0.55);
    if (needCreate) {
      const f = { path: newPath(created), lines: bodyLines(), version: 0, alive: true };
      created++;
      files.push(f);
      alive.push(f);
      ops.push(`M 100644 inline ${f.path}\ndata ${Buffer.byteLength(content(f))}\n${content(f)}\n`);
    } else if (r < 0.012 && alive.length > 50) {
      const i = Math.floor(rnd() * alive.length);
      const f = alive[i];
      alive.splice(i, 1);
      f.alive = false;
      ops.push(`D ${f.path}\n`);
    } else if (r < 0.02 && alive.length > 50) {
      const f = alive[Math.floor(rnd() * alive.length)];
      const to = newPath(`${created}_r${c}`);
      ops.push(`R ${f.path} ${to}\n`);
      f.path = to;
      // fast-import needs the rename applied before further edits in the same commit; stop here.
      break;
    } else if (alive.length) {
      const f = alive[zipf(alive.length, 1.4)];
      f.version++;
      const delta = Math.floor((rnd() - 0.35) * 60);
      f.lines = Math.max(2, f.lines + delta);
      ops.push(`M 100644 inline ${f.path}\ndata ${Buffer.byteLength(content(f))}\n${content(f)}\n`);
    }
  }
  if (!ops.length) continue;
  const msg = `commit ${c}`;
  await write(
    `commit refs/heads/main\nauthor Dev${a} <dev${a}@example.com> ${time} +0000\ncommitter Dev${a} <dev${a}@example.com> ${time} +0000\ndata ${msg.length}\n${msg}\n${ops.join('')}\n`,
  );
  if (c % 5000 === 0) process.stderr.write(`\r${c}/${COMMITS} commits, ${created} files`);
}
await write('done\n');
await flush();
fi.stdin.end();
await new Promise((r) => fi.on('close', r));
process.stderr.write(`\rdone: ${COMMITS} commits, ${created} files created, ${alive.length} alive\n`);
