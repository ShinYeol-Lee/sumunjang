import { METHODS, type MethodId, type UpgradeAxis } from '../data/balance';
import { buildCost, maxDurability, repairCost, upgradeCost } from '../sim/dam';
import type { World } from '../sim/world';

export type BotId = 'idle' | 'empty' | 'fill' | 'heuristic';

export interface Bot {
  id: BotId;
  name: string;
  /** 매 틱 호출된다 */
  act(world: World): void;
}

/** 방치 봇: 아무것도 짓지 않는다 */
export const idleBot = (): Bot => ({ id: 'idle', name: '방치 봇', act: () => {} });

function buildAll(world: World, method: MethodId): void {
  for (const s of world.sites) {
    if (world.dams[s.index]) continue;
    if (world.economy.funds >= buildCost(s.def, method)) world.build(s.def.id, method);
  }
}

/** 비움 봇: 최저가 공법으로 모두 짓고 수문을 항상 100% 연다. 내구도가 반 아래면 보수한다. */
export const emptyBot = (): Bot => ({
  id: 'empty',
  name: '비움 봇',
  act(world) {
    if (world.tick % 24 !== 0) return;
    buildAll(world, 'earth');
    for (const d of world.dams) {
      if (!d) continue;
      if (d.status === 'collapsed') world.rebuild(d.siteId);
      world.setGate(d.siteId, 1);
      if (d.status === 'ok' && d.durability < maxDurability(d) * 0.5) world.repair(d.siteId);
    }
  },
});

/** 채움 봇: 모두 짓고(석축, 모자라면 흙) 수문을 항상 0%로 둔다 */
export const fillBot = (): Bot => ({
  id: 'fill',
  name: '채움 봇',
  act(world) {
    if (world.tick % 24 !== 0) return;
    for (const s of world.sites) {
      if (world.dams[s.index]) continue;
      const m: MethodId = world.economy.funds >= buildCost(s.def, 'stone') ? 'stone' : 'earth';
      world.build(s.def.id, m);
    }
    for (const d of world.dams) if (d) world.setGate(d.siteId, 0);
  },
});

/**
 * 휴리스틱 봇: 계절과 수위에 맞춰 방류율을 조절하고, 돈이 모이면 짓고 올리고 보수한다.
 * 예보는 보지 않는다 (사람이 보는 정보만 쓴다).
 */
export const heuristicBot = (): Bot => {
  const UPGRADE_ORDER: UpgradeAxis[] = ['release', 'auto', 'power', 'capacity', 'durability'];
  return {
    id: 'heuristic',
    name: '휴리스틱 봇',
    act(world) {
      const date = world.date;
      const season = world.today.season;
      // 수문 조절은 3시간마다
      if (world.tick % 3 === 0) {
        for (const d of world.dams) {
          if (!d || d.status !== 'ok') continue;
          const preMonsoon = date.month === 6 || date.month === 7 || (date.month === 8 && date.day < 20);
          let target = 0.8;
          if (preMonsoon) target = 0.55;
          else if (season === 'summer' || date.month === 5) target = 0.68;
          else if (season === 'winter') target = 0.72;
          const raining = world.today.rain > 0.5;
          if (raining) target -= 0.08;
          let open = 0.35 + (d.level - target) * 4;
          if (d.level > 0.86) open = 1;
          world.setGate(d.siteId, Math.max(0, Math.min(1, open)));
        }
      }
      if (world.tick % 24 !== 0) return;
      const e = world.economy;
      // 보수와 재건
      for (const s of world.sites) {
        const d = world.dams[s.index];
        if (!d) continue;
        if (d.status === 'collapsed') world.rebuild(d.siteId);
        else if (d.durability < maxDurability(d) * 0.6 && e.funds > repairCost(d) + 500) world.repair(d.siteId);
      }
      // 건설: 부지 순서대로, 석축 우선 (여유가 크면 콘크리트)
      for (const s of world.sites) {
        if (world.dams[s.index]) continue;
        const reserve = 1500;
        const conc = buildCost(s.def, 'concrete');
        const stone = buildCost(s.def, 'stone');
        if (e.funds >= conc + reserve * 3) world.build(s.def.id, 'concrete');
        else if (e.funds >= stone + reserve) world.build(s.def.id, 'stone');
        break; // 하루에 하나씩, 앞 부지부터
      }
      // 업그레이드: 넉넉할 때만, 마지막 해 여름 이후에는 아낀다
      const late = date.year === 3 && date.month >= 8;
      if (!late) {
        for (const axis of UPGRADE_ORDER) {
          for (const s of world.sites) {
            const d = world.dams[s.index];
            if (!d || d.status !== 'ok') continue;
            if (d.levels[axis] >= Math.min(METHODS[d.method].maxUpgrade, axis === 'capacity' ? 2 : 3)) continue;
            const cost = upgradeCost(s.def, d, axis);
            if (e.funds > cost + 4000) {
              world.upgrade(s.def.id, axis);
              if (axis === 'auto') world.setAuto(s.def.id, true, 0.86);
              return;
            }
          }
        }
      }
    },
  };
};

export const BOT_FACTORIES: Record<BotId, () => Bot> = {
  idle: idleBot,
  empty: emptyBot,
  fill: fillBot,
  heuristic: heuristicBot,
};
