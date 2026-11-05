import { describe, test, expect, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { CityBuilder } from '../src/core/builder.js';
import { buildCity, nameFromRemote, httpUrl } from '../src/node/build.js';
import { languageOf } from '../src/core/languages.js';
import type { Commit } from '../src/core/parser.js';
import { TestRepo } from './helpers.js';

const C = (time: number, changes: Commit['changes'], author = 'Ada'): Commit => ({
  hash: String(time), time, author, email: `${author.toLowerCase()}@x.io`, changes,
});
const ch = (status: Commit['changes'][0]['status'], path: string, added = 0, deleted = 0, oldPath?: string) => ({
  status, path, added, deleted, binary: false, ...(oldPath ? { oldPath } : {}),
});

describe('CityBuilder', () => {
  test('tracks lines, renames, deletes and top authors', () => {
    const b = new CityBuilder({ totalCommits: 5 });
    // Grace touches src/a.ts three times, Ada once.
    b.addCommit(C(1, [ch('A', 'src/a.ts', 100), ch('A', 'README.md', 10)]));
    b.addCommit(C(2, [ch('M', 'src/a.ts', 20, 5)], 'Grace'));
    b.addCommit(C(3, [ch('M', 'src/a.ts', 1, 1)], 'Grace'));
    b.addCommit(C(4, [ch('R', 'lib/a.ts', 0, 15, 'src/a.ts')], 'Grace'));
    b.addCommit(C(5, [ch('D', 'README.md', 0, 10)]));
    const city = b.finalize({ repo: { name: 't' }, generatedAt: 'x' });
    const i = city.b.path.indexOf('lib/a.ts');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(city.b.path).not.toContain('src/a.ts');
    expect(city.b.lines[i]).toBe(100);
    expect(city.b.peak[i]).toBe(115);
    expect(city.b.commits[i]).toBe(4);
    expect(city.authors[city.b.author[i]].name).toBe('Grace');
    const r = city.b.path.indexOf('README.md');
    expect(city.b.died[r]).toBe(4);
    expect(city.b.lines[r]).toBe(0);
    expect(city.stats).toMatchObject({ commits: 5, authors: 2, alive: 1, lines: 100 });
    expect(city.langs.map((l) => l.name).sort()).toEqual(['Markdown', 'TypeScript']);
  });

  test('a delete and a rename onto the same path in one commit keep the moved file', () => {
    const b = new CityBuilder({ totalCommits: 2 });
    b.addCommit(C(1, [ch('A', 'a.txt', 5), ch('A', 'b.txt', 9)]));
    b.addCommit(C(2, [ch('R', 'a.txt', 0, 0, 'b.txt'), ch('D', 'a.txt', 0, 5)]));
    const city = b.finalize({ repo: { name: 't' } });
    const alive = city.b.path.filter((_, i) => city.b.died[i] === -1);
    expect(alive).toEqual(['a.txt']);
    expect(city.b.lines[city.b.path.findIndex((p, i) => p === 'a.txt' && city.b.died[i] === -1)]).toBe(9);
  });

  test('a file re-created after deletion becomes a new building', () => {
    const b = new CityBuilder({ totalCommits: 3 });
    b.addCommit(C(1, [ch('A', 'x.js', 50)]));
    b.addCommit(C(2, [ch('D', 'x.js', 0, 50)]));
    b.addCommit(C(3, [ch('A', 'x.js', 7)]));
    const city = b.finalize({ repo: { name: 't' } });
    expect(city.b.path.filter((p) => p === 'x.js').length).toBe(2);
    expect(city.stats.alive).toBe(1);
  });

  test('caps buildings to the largest N files and buckets ticks', () => {
    const b = new CityBuilder({ totalCommits: 100, maxTicks: 10 });
    for (let i = 0; i < 100; i++) b.addCommit(C(i + 1, [ch('A', `f${String(i).padStart(3, '0')}.py`, i + 1)]));
    const city = b.finalize({ repo: { name: 't' }, maxBuildings: 10 });
    expect(city.b.path.length).toBe(10);
    expect(Math.min(...city.b.lines)).toBe(91);
    expect(city.ticks.t.length).toBe(10);
    expect(city.ticks.n.reduce((a, b) => a + b, 0)).toBe(100);
    for (let i = 4; i < city.ev.length; i += 4) expect(city.ev[i]).toBeGreaterThanOrEqual(city.ev[i - 4]);
  });

  test('timeline dates never go backwards', () => {
    const b = new CityBuilder({ totalCommits: 4, maxTicks: 4 });
    for (const t of [100, 300, 200, 400]) b.addCommit(C(t, [ch('M', 'a.txt', 1)]));
    expect(b.finalize({ repo: { name: 't' } }).ticks.t).toEqual([100, 300, 300, 400]);
  });

  test('monorepo container folders are split into districts', () => {
    const b = new CityBuilder({ totalCommits: 1 });
    const changes = [];
    for (const pkg of ['core', 'cli', 'web']) for (let i = 0; i < 10; i++) changes.push(ch('A', `packages/${pkg}/f${i}.ts`, 10));
    changes.push(ch('A', 'README.md', 3));
    b.addCommit(C(1, changes));
    const city = b.finalize({ repo: { name: 't' } });
    expect(city.districts.map((d) => d.name).sort()).toEqual(['(root)', 'packages/cli', 'packages/core', 'packages/web']);
  });

  test('empty history gives an empty but valid city', () => {
    const city = new CityBuilder({ totalCommits: 0 }).finalize({ repo: { name: 'empty' } });
    expect(city.b.path).toEqual([]);
    expect(city.districts).toEqual([]);
    expect(city.ticks.t.length).toBe(1);
  });
});

describe('buildCity on real repositories', () => {
  const repo = new TestRepo();
  afterAll(() => repo.cleanup());

  test('line counts at HEAD match the working tree for a merge-heavy history', async () => {
    repo.write('src/main.c', 40).write('include/x.h', 10).write('docs/a.md', 3).commit('init');
    for (let i = 0; i < 6; i++) {
      repo.git('checkout', '-q', '-b', `topic${i}`);
      repo.write(`src/mod${i}.c`, 10 + i).write('src/main.c', 40 + i).commit(`topic ${i}`, { name: `Dev${i}`, email: `dev${i}@x.io` });
      repo.git('checkout', '-q', 'main');
      repo.write(`docs/n${i}.md`, 2).commit(`docs ${i}`);
      repo.git('merge', '-q', '--no-ff', '-m', `merge ${i}`, `topic${i}`);
    }
    repo.mv('include/x.h', 'src/x.h').commit('move header');
    repo.rm('docs/a.md').commit('drop');
    const city = await buildCity(repo.dir, { generatedAt: 'fixed' });
    const files = repo.git('ls-files').trim().split('\n');
    for (const f of files) {
      const expected = Number(execFileSync('wc', ['-l', f], { cwd: repo.dir, encoding: 'utf8' }).trim().split(/\s+/)[0]);
      const i = city.b.path.findIndex((p, j) => p === f && city.b.died[j] === -1);
      expect({ f, lines: city.b.lines[i] }).toEqual({ f, lines: expected });
    }
    expect(city.b.path).not.toContain('include/x.h');
    expect(city.b.died[city.b.path.indexOf('docs/a.md')]).toBeGreaterThan(-1);
    expect(city.stats.commits).toBe(Number(repo.git('rev-list', '--count', 'HEAD').trim()));
  });

  test('same repository gives the same city', async () => {
    const a = await buildCity(repo.dir, { generatedAt: 'fixed' });
    const b = await buildCity(repo.dir, { generatedAt: 'fixed' });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  test('empty repository builds an empty city', async () => {
    const empty = new TestRepo();
    try {
      const city = await buildCity(empty.dir);
      expect(city.stats.commits).toBe(0);
      expect(city.b.path.length).toBe(0);
    } finally {
      empty.cleanup();
    }
  });
});

describe('helpers', () => {
  test('languageOf', () => {
    expect(languageOf('a/b/c.tsx')).toBe('TypeScript');
    expect(languageOf('Makefile')).toBe('Shell');
    expect(languageOf('.gitignore')).toBe('Other');
    expect(languageOf('x.unknownext')).toBe('Other');
  });
  test('remote parsing', () => {
    expect(nameFromRemote('git@github.com:facebook/react.git')).toBe('facebook/react');
    expect(nameFromRemote('https://github.com/vuejs/core')).toBe('vuejs/core');
    expect(httpUrl('git@github.com:facebook/react.git')).toBe('https://github.com/facebook/react');
    expect(httpUrl('https://tok@github.com/a/b.git')).toBe('https://github.com/a/b');
  });
});
