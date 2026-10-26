import { describe, expect, it } from 'vitest';
import { heuristicBot } from '../../src/bots/bots';
import { STAGES } from '../../src/data/stages';
import { TOWN } from '../../src/data/balance';
import { crestOf, maxCrestHeight, newDam } from '../../src/sim/dam';
import { World } from '../../src/sim/world';

describe('스테이지 데이터', () => {
  for (const st of STAGES) {
    it(`스테이지 ${st.id} ${st.name}: 부지·마을·유입이 올바르다`, () => {
      const w = new World(st.id, 1);
      expect(w.sites.length).toBe(st.sites.length);
      for (const s of w.sites) {
        const top = s.bottom + maxCrestHeight(s.def);
        const ends = [s.cells[0], s.cells[s.cells.length - 1]];
        // 댐 라인 양 끝은 최대 마루보다 높은 땅이라 물이 돌아가지 못한다
        for (const c of ends) expect(w.terrain.ground[c]).toBeGreaterThanOrEqual(top);
        expect(s.gatePairs.length).toBeGreaterThan(0);
      }
      for (const l of w.townLayouts) {
        expect(l.facilities.filter((f) => f.type === 'building').length).toBeGreaterThan(10);
        expect(l.facilities.some((f) => f.type === 'farm')).toBe(true);
        expect(l.facilities.some((f) => f.type === 'road')).toBe(true);
      }
      w.terrain.sources.forEach((cells) => expect(cells.length).toBeGreaterThan(0));
      // 기본 높이 댐을 가득 채워도 상류 마을은 잠기지 않는다 (용량 업그레이드를 많이 하면 잠길 수 있다)
      for (const s of w.sites) {
        const crest = crestOf(s, newDam(s.def.id, 'stone'));
        for (const l of w.townLayouts) {
          if (l.def.x >= s.cx || s.def.flow !== 'E') continue;
          const lowest = Math.min(...l.facilities.map((f) => w.terrain.ground[f.cell] + TOWN.FLOOD_DEPTH[f.type]));
          expect(lowest).toBeGreaterThan(crest + 0.5);
        }
      }
      // 예열 후 하류 출구까지 물이 흐른다
      const g = w.grid;
      let edgeWet = false;
      for (let y = 0; y < g.h; y++) if (g.depth[y * g.w + g.w - 1] > 0.05) edgeWet = true;
      expect(edgeWet).toBe(true);
      // 처음에는 어느 마을도 잠겨 있지 않다
      w.step();
      for (const t of w.towns) expect(t.floodRatio).toBe(0);
    });
  }
});

describe('세 스테이지 모두 3년 완주 가능', () => {
  for (const st of STAGES) {
    it(`스테이지 ${st.id}`, () => {
      const w = new World(st.id, 99);
      const bot = heuristicBot();
      while (!w.finished) {
        bot.act(w);
        w.step();
      }
      expect(w.result?.finished).toBe(true);
      expect(w.result!.stars).toBeGreaterThanOrEqual(1);
    }, 120_000);
  }
});
