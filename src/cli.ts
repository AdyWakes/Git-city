#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ArgError, HELP, parseArgs, type CliArgs } from './node/args.js';
import { buildCity } from './node/build.js';
import { isGitRepo, repoRoot } from './node/git.js';
import { openBrowser } from './node/open.js';
import { serve } from './node/server.js';

const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')) as { version: string };
const isTTY = process.stderr.isTTY;
const dim = (s: string) => (isTTY ? `\x1b[2m${s}\x1b[22m` : s);
const accent = (s: string) => (isTTY ? `\x1b[38;2;255;79;139m${s}\x1b[39m` : s);
const log = (s = '') => process.stderr.write(s + '\n');

function progress(label: string, done: number, total: number) {
  if (!isTTY) return;
  const w = 28;
  const f = total ? Math.min(1, done / total) : 0;
  const bar = '█'.repeat(Math.round(f * w)).padEnd(w, '░');
  process.stderr.write(`\r  ${label} ${accent(bar)} ${dim(`${done.toLocaleString('en-US')}/${total.toLocaleString('en-US')}`)}   `);
  if (done >= total) process.stderr.write('\n');
}

export async function main(argv: string[]): Promise<void> {
  let args: CliArgs;
  try {
    args = parseArgs(argv);
  } catch (e) {
    if (e instanceof ArgError) {
      log(`gitcity: ${e.message}\nRun gitcity --help for usage.`);
      process.exitCode = 2;
      return;
    }
    throw e;
  }
  if (args.help) return void process.stdout.write(HELP.trimStart());
  if (args.version) return void process.stdout.write(pkg.version + '\n');

  log(`\n  ${accent('■')} gitcity ${dim('v' + pkg.version)}\n`);

  const dir = resolve(args.target);
  if (!existsSync(dir)) throw new UserError(`No such folder: ${dir}`);
  if (!(await isGitRepo(dir))) throw new UserError(`${dir} is not a git repository.`);
  const root = await repoRoot(dir);

  const started = Date.now();
  const city = await buildCity(root, {
    maxBuildings: args.maxBuildings,
    generator: `gitcity ${pkg.version}`,
    onProgress: (d, t) => progress('reading history', d, t),
  });
  const s = city.stats;
  log(
    `  ${s.commits.toLocaleString('en-US')} commits, ${s.authors.toLocaleString('en-US')} authors, ${s.alive.toLocaleString('en-US')} files ` +
      dim(`(${s.rendered.toLocaleString('en-US')} buildings, ${((Date.now() - started) / 1000).toFixed(1)}s)`),
  );
  if (s.commits === 0) log(dim('  This repository has no commits yet; the city will be empty.'));

  const json = JSON.stringify(city);
  if (args.json) {
    writeFileSync(args.json, json);
    log(`  wrote ${args.json} ${dim(`(${(json.length / 1024).toFixed(0)} KB)`)}\n`);
    return;
  }

  const viewer = fileURLToPath(new URL('./viewer/', import.meta.url));
  if (!existsSync(resolve(viewer, 'index.html'))) throw new UserError('Viewer bundle missing. Run `npm run build` first.');
  const { url } = await serve({ root: viewer, cityJson: json, port: args.port, host: args.host });
  log(`\n  ${accent('→')} ${url}\n  ${dim('Ctrl+C to stop')}\n`);
  if (args.open) openBrowser(url);
}

export class UserError extends Error {}

main(process.argv.slice(2)).catch((e) => {
  if (e instanceof UserError) log(`  gitcity: ${e.message}`);
  else log(`  gitcity: unexpected error\n${(e as Error).stack ?? e}`);
  process.exitCode = 1;
});
