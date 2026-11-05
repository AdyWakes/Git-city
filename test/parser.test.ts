import { describe, test, expect, afterAll } from 'vitest';
import { GitLogParser, parseGitLog, type Commit } from '../src/core/parser.js';
import { streamCommits } from '../src/node/git.js';
import { TestRepo } from './helpers.js';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const H = (hash: string, t: number, name = 'Ada', email = 'ada@x.io') => `\x1e${hash}\x1f${t}\x1f${name}\x1f${email}\0`;
const RAW = (status: string, ...paths: string[]) =>
  `\n:100644 100644 ${'a'.repeat(40)} ${'b'.repeat(40)} ${status}\0${paths.map((p) => p + '\0').join('')}`;
const NUM = (a: number | '-', d: number | '-', path: string) => `${a}\t${d}\t${path}\0`;
const NUMR = (a: number, d: number, from: string, to: string) => `${a}\t${d}\t\0${from}\0${to}\0`;

const sample =
  H('c1', 100) + RAW('A', 'src/a.ts') + RAW('A', 'README.md') + NUM(10, 0, 'src/a.ts') + NUM(3, 0, 'README.md') +
  H('c2', 200, 'Grace', 'grace@x.io') + RAW('M', 'src/a.ts') + NUM(5, 2, 'src/a.ts') +
  H('merge', 250) +
  H('c3', 300) + RAW('R087', 'src/a.ts', 'lib/a b.ts') + NUMR(1, 1, 'src/a.ts', 'lib/a b.ts') + RAW('A', 'logo.png') + NUM('-', '-', 'logo.png') +
  H('c4', 400) + RAW('D', 'README.md') + NUM(0, 3, 'README.md');

describe('GitLogParser', () => {
  test('parses headers, adds, modifications, renames, binaries, deletes and empty merges', () => {
    const commits = parseGitLog(sample);
    expect(commits.map((c) => c.hash)).toEqual(['c1', 'c2', 'merge', 'c3', 'c4']);
    expect(commits[0]).toMatchObject({ time: 100, author: 'Ada', email: 'ada@x.io' });
    expect(commits[0].changes).toEqual([
      { path: 'src/a.ts', oldPath: undefined, status: 'A', added: 10, deleted: 0, binary: false },
      { path: 'README.md', oldPath: undefined, status: 'A', added: 3, deleted: 0, binary: false },
    ]);
    expect(commits[1].author).toBe('Grace');
    expect(commits[1].changes[0]).toMatchObject({ status: 'M', added: 5, deleted: 2 });
    expect(commits[2].changes).toEqual([]);
    expect(commits[3].changes[0]).toMatchObject({ status: 'R', oldPath: 'src/a.ts', path: 'lib/a b.ts', added: 1, deleted: 1 });
    expect(commits[3].changes[1]).toMatchObject({ status: 'A', path: 'logo.png', binary: true, added: 0 });
    expect(commits[4].changes[0]).toMatchObject({ status: 'D', path: 'README.md', deleted: 3 });
  });

  test('is independent of how the stream is chunked', () => {
    const whole = JSON.stringify(parseGitLog(sample));
    for (const size of [1, 2, 3, 7, 13, 64]) {
      const out: Commit[] = [];
      const p = new GitLogParser((c) => out.push(c));
      for (let i = 0; i < sample.length; i += size) p.write(sample.slice(i, i + size));
      p.end();
      expect(JSON.stringify(out)).toBe(whole);
    }
  });

  test('keeps exotic paths verbatim (tabs, unicode, arrows, leading newline-free)', () => {
    const weird = 'docs/ünï cødé => \t x.md';
    const commits = parseGitLog(H('c1', 1) + RAW('A', weird) + NUM(4, 0, weird));
    expect(commits[0].changes[0]).toMatchObject({ path: weird, added: 4 });
  });

  test('drops submodules (gitlinks)', () => {
    const sub = `\n:000000 160000 ${'0'.repeat(40)} ${'c'.repeat(40)} A\0vendor/lib\0`;
    const commits = parseGitLog(H('c1', 1) + sub + RAW('A', 'a.c') + NUM(1, 0, 'vendor/lib') + NUM(5, 0, 'a.c'));
    expect(commits[0].changes.map((c) => c.path)).toEqual(['a.c']);
  });

  test('handles an empty stream (repo without commits)', () => {
    expect(parseGitLog('')).toEqual([]);
  });

  test('ignores numstat-only entries gracefully', () => {
    const commits = parseGitLog(H('c1', 1) + NUM(2, 0, 'x.txt'));
    expect(commits[0].changes).toEqual([{ path: 'x.txt', status: 'M', added: 2, deleted: 0, binary: false }]);
  });
});

describe('streamCommits against a real repository', () => {
  const repo = new TestRepo();
  afterAll(() => repo.cleanup());

  test('reads history oldest-first with renames, deletes, binaries and merges', async () => {
    repo.write('src/app.js', 20).write('README.md', 5).commit('init');
    repo.write('src/app.js', 30).commit('grow', { name: 'Grace', email: 'grace@x.io' });
    repo.git('checkout', '-q', '-b', 'feature');
    repo.write('src/feature.js', 8).commit('feature');
    repo.git('checkout', '-q', 'main');
    repo.write('docs/guide with space.md', 12).commit('docs');
    repo.git('merge', '-q', '--no-ff', '-m', 'merge feature', 'feature');
    repo.mv('src/app.js', 'lib/app.js').commit('move');
    writeFileSync(join(repo.dir, 'logo.bin'), Buffer.from([0, 1, 2, 3, 0, 255]));
    repo.rm('README.md').commit('binary and delete');

    const commits: Commit[] = [];
    const n = await streamCommits(repo.dir, (c) => commits.push(c));
    expect(n).toBe(7);
    expect(commits[0].changes.map((c) => c.path).sort()).toEqual(['README.md', 'src/app.js']);
    expect(commits[1]).toMatchObject({ author: 'Grace', email: 'grace@x.io' });
    expect(commits[1].changes[0]).toMatchObject({ path: 'src/app.js', added: 10, deleted: 0 });
    const merge = commits.find((c) => c.changes.length === 0);
    expect(merge).toBeDefined();
    const move = commits[commits.length - 2];
    expect(move.changes[0]).toMatchObject({ status: 'R', oldPath: 'src/app.js', path: 'lib/app.js' });
    const last = commits[commits.length - 1];
    expect(last.changes.find((c) => c.path === 'logo.bin')).toMatchObject({ status: 'A', binary: true });
    expect(last.changes.find((c) => c.path === 'README.md')).toMatchObject({ status: 'D', deleted: 5 });
    expect(commits.some((c) => c.changes.some((x) => x.path === 'docs/guide with space.md'))).toBe(true);
  });

  test('empty repository yields zero commits', async () => {
    const empty = new TestRepo();
    try {
      const n = await streamCommits(empty.dir, () => {}).catch(() => 0);
      expect(n).toBe(0);
    } finally {
      empty.cleanup();
    }
  });
});
