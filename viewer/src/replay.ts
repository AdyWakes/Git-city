import type { CityData } from './data';

/**
 * Rebuilds the city at any tick from the flat event list. Seeking forward applies only the new
 * events; seeking backward replays from zero (a few hundred thousand integer writes, <5ms).
 */
export class Replay {
  readonly ticks: number;
  readonly lines: Float64Array;
  readonly lots: Uint8Array;
  /** Cumulative commits up to and including each tick. */
  readonly cumulative: Int32Array;
  tick = -1;
  private ptr = 0;

  constructor(private data: CityData) {
    this.ticks = data.ticks.t.length;
    const n = data.b.path.length;
    this.lines = new Float64Array(n).fill(-1);
    this.lots = new Uint8Array(n);
    this.cumulative = new Int32Array(this.ticks);
    let c = 0;
    data.ticks.n.forEach((v, i) => (this.cumulative[i] = c += v));
  }

  reset(): void {
    this.lines.fill(-1);
    this.lots.fill(0);
    this.ptr = 0;
    this.tick = -1;
  }

  /**
   * Moves to `tick`. `onEvent(building, author)` is called for every event applied while moving
   * forward, so contributor lights can follow.
   */
  seek(tick: number, onEvent?: (building: number, author: number) => void): boolean {
    tick = Math.max(-1, Math.min(this.ticks - 1, Math.floor(tick)));
    if (tick === this.tick) return false;
    if (tick < this.tick) {
      this.reset();
      onEvent = undefined;
    }
    const ev = this.data.ev;
    const died = this.data.b.died;
    while (this.ptr < ev.length && ev[this.ptr] <= tick) {
      const b = ev[this.ptr + 1];
      this.lines[b] = ev[this.ptr + 2];
      if (died[b] !== -1 && died[b] <= tick) this.lots[b] = 1;
      onEvent?.(b, ev[this.ptr + 3]);
      this.ptr += 4;
    }
    this.tick = tick;
    return true;
  }

  get final(): boolean {
    return this.tick >= this.ticks - 1;
  }
}
