import { describe, test, expect, afterAll } from 'vitest';
import { existsSync } from 'node:fs';
import { parseArgs, ArgError } from '../src/node/args.js';
import { remoteUrl, repoNameFromUrl, cloneRepo } from '../src/node/clone.js';
import { buildCity } from '../src/node/build.js';
import { TestRepo } from './helpers.js';

describe('parseArgs', () => {
  test('defaults', () => {
    expect(parseArgs([])).toMatchObject({ target: '.', port: 4173, open: true, maxBuildings: 10000 });
  });
  test('flags and values', () => {
    expect(parseArgs(['./x', '-n', '500', '--no-open', '--port=9000', '--json', 'out.json'])).toMatchObject({
      target: './x', maxBuildings: 500, open: false, port: 9000, json: 'out.json',
    });
  });
  test('errors', () => {
    expect(() => parseArgs(['--wat'])).toThrow(ArgError);
    expect(() => parseArgs(['-n', 'abc'])).toThrow(ArgError);
    expect(() => parseArgs(['a', 'b'])).toThrow(ArgError);
    expect(() => parseArgs(['--port'])).toThrow(ArgError);
  });
});

describe('remote detection', () => {
  test('recognises URLs and shorthands', () => {
    expect(remoteUrl('https://github.com/vuejs/core')).toBe('https://github.com/vuejs/core');
    expect(remoteUrl('git@github.com:vuejs/core.git')).toBe('git@github.com:vuejs/core.git');
    expect(remoteUrl('github.com/vuejs/core')).toBe('https://github.com/vuejs/core');
    expect(remoteUrl('vuejs/core')).toBe('https://github.com/vuejs/core');
    expect(remoteUrl('.')).toBeNull();
    expect(remoteUrl('./some/dir')).toBeNull();
    expect(remoteUrl('../a/b')).toBeNull();
    expect(remoteUrl('-rf')).toBeNull();
  });
  test('names', () => {
    expect(repoNameFromUrl('https://github.com/facebook/react.git')).toBe('facebook/react');
    expect(repoNameFromUrl('git@github.com:facebook/react.git')).toBe('facebook/react');
    expect(repoNameFromUrl('https://gitlab.com/a/b/')).toBe('a/b');
  });
});

describe('cloneRepo', () => {
  const src = new TestRepo();
  afterAll(() => src.cleanup());
  test('clones a full history into a temp folder and cleans up', async () => {
    src.write('a.txt', 3).commit('one').write('b.txt', 4).commit('two');
    const phases = new Set<string>();
    const c = await cloneRepo(`file://${src.dir}`, (p) => phases.add(p.phase));
    try {
      const city = await buildCity(c.dir, { name: 'test/repo' });
      expect(city.stats.commits).toBe(2);
      expect(city.repo.name).toBe('test/repo');
    } finally {
      c.cleanup();
    }
    expect(existsSync(c.dir)).toBe(false);
  });
  test('reports a clear error for a missing repository', async () => {
    await expect(cloneRepo('file:///definitely/not/here')).rejects.toThrow();
  });
});
