import { describe, test, expect, afterAll } from 'vitest';
import { Replay } from '../viewer/src/replay.js';
import { buildCity } from '../src/node/build.js';
import { TestRepo } from './helpers.js';

describe('viewer Replay', () => {
  const repo = new TestRepo();
  afterAll(() => repo.cleanup());

  test('replaying every event reproduces HEAD, and seeking backwards is consistent', async () => {
    repo.write('a.js', 10).write('b/c.ts', 5).commit('1');
    repo.write('a.js', 30).write('b/d.ts', 7).commit('2');
    repo.mv('b/c.ts', 'b/e.ts').commit('3');
    repo.rm('b/d.ts').write('a.js', 12).commit('4');
    const city = await buildCity(repo.dir);
    const r = new Replay(city);
    r.seek(r.ticks - 1);
    city.b.path.forEach((p, i) => {
      if (city.b.died[i] === -1) expect({ p, l: r.lines[i] }).toEqual({ p, l: city.b.lines[i] });
      else expect({ p, lot: r.lots[i] }).toEqual({ p, lot: 1 });
    });
    const forward = Array.from(r.lines);
    r.seek(0);
    const a = city.b.path.indexOf('a.js');
    expect(r.lines[a]).toBe(10);
    expect(r.lines[city.b.path.indexOf('b/d.ts')]).toBe(-1); // not born yet
    r.seek(r.ticks - 1);
    expect(Array.from(r.lines)).toEqual(forward);
  });
});
