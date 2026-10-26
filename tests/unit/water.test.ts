import { describe, expect, it } from 'vitest';
import { WATER } from '../../src/data/balance';
import { Rng } from '../../src/sim/rng';
import { WaterGrid } from '../../src/sim/water';
import { World } from '../../src/sim/world';

function randomTerrain(seed: number, w: number, h: number): Float64Array {
  const rng = new Rng(seed);
  const g = new Float64Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      g[y * w + x] = 6 - x * 0.04 + Math.abs(y - h / 2) * 0.15 + rng.range(-0.6, 0.6);
    }
  }
  return g;
}

describe('물 시뮬레이션', () => {
  it('물 보존: 무작위 지형·강수 1,000틱의 보존식 오차가 0.1% 이내', () => {
    for (const seed of [1, 2, 3]) {
      const w = 64;
      const h = 32;
      const grid = new WaterGrid(w, h, randomTerrain(seed, w, h));
      const rng = new Rng(seed * 7);
      const sources = [15 * w, 16 * w, 17 * w];
      const v0 = grid.volume();
      for (let t = 0; t < 1000; t++) {
        grid.addRain(rng.next() < 0.3 ? rng.range(0, 0.004) : 0);
        grid.evaporate(rng.range(0, 0.0001));
        grid.addInflow(sources, rng.range(0.2, 3));
        for (let s = 0; s < WATER.SUBSTEPS; s++) grid.step();
      }
      const v1 = grid.volume();
      const expected = v0 + grid.totalInflow + grid.totalRain - grid.totalOutflow - grid.totalEvap;
      const scale = grid.totalInflow + grid.totalRain;
      const err = Math.abs(v1 - expected) / scale;
      expect(err).toBeLessThan(0.001);
      expect(grid.totalOutflow).toBeGreaterThan(0);
    }
  });

  it('스테이지 월드에서도 매 틱 보존식이 성립한다', () => {
    const world = new World(3, 5);
    const g = world.grid;
    let prev = g.volume();
    let prevAcc = [g.totalInflow, g.totalRain, g.totalOutflow, g.totalEvap];
    for (let t = 0; t < 400; t++) {
      world.step();
      const v = g.volume();
      const d = [g.totalInflow - prevAcc[0], g.totalRain - prevAcc[1], g.totalOutflow - prevAcc[2], g.totalEvap - prevAcc[3]];
      const expected = prev + d[0] + d[1] - d[2] - d[3];
      expect(Math.abs(v - expected)).toBeLessThan(1e-6 * Math.max(1, v));
      prev = v;
      prevAcc = [g.totalInflow, g.totalRain, g.totalOutflow, g.totalEvap];
    }
  });

  it('안정성: 평소의 10배 강수로 3년을 돌려도 NaN·음수·무한대가 없다', () => {
    const world = new World(2, 9, { rainScale: 10 });
    const check = () => {
      const d = world.grid.depth;
      for (let i = 0; i < d.length; i++) {
        if (!Number.isFinite(d[i]) || d[i] < 0) throw new Error(`bad depth ${d[i]} at ${i} tick ${world.tick}`);
      }
    };
    while (!world.finished) {
      world.runTicks(500);
      check();
    }
    expect(Number.isFinite(world.economy.funds)).toBe(true);
    expect(world.grid.volume()).toBeLessThan(1e7);
  }, 300_000);
});
