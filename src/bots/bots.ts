import { ECONOMY, METHODS, TIME, type MethodId, type UpgradeAxis } from '../data/balance';
import { DAM, TOWN } from '../data/balance';
import { buildCost, crestOf, maxDurability, maxRelease, repairCost, upgradeCost, upstreamTownMargin } from '../sim/dam';
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

/** 비움 봇: 최저가 공법으로 모두 짓고 수문을 항상 100% 연다. 내구도가 반 아래면 보수한다. */
export const emptyBot = (): Bot => ({
  id: 'empty',
  name: '비움 봇',
  act(world) {
    if (world.tick % TIME.TICKS_PER_DAY !== 0) return;
    for (const s of world.sites) {
      if (!world.dams[s.index] && world.economy.funds >= buildCost(s.def, 'earth')) world.build(s.def.id, 'earth');
    }
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
    if (world.tick % TIME.TICKS_PER_DAY !== 0) return;
    for (const s of world.sites) {
      if (world.dams[s.index]) continue;
      const m: MethodId = world.economy.funds >= buildCost(s.def, 'stone') ? 'stone' : 'earth';
      world.build(s.def.id, m);
    }
    for (const d of world.dams) if (d) world.setGate(d.siteId, 0);
  },
});

/** 하류가 잠기지 않는 방류량 (틱당) */
const SAFE_RELEASE = 2.4;

/** 월별 목표 수위: 장마 전에 비우고, 장마 뒤에 채워 겨울에 쓴다 */
const TARGET_BY_MONTH = [0.72, 0.72, 0.8, 0.82, 0.78, 0.55, 0.45, 0.5, 0.8, 0.84, 0.84, 0.76];

/**
 * 휴리스틱 봇: 계절과 수위에 맞춰 방류율을 조절하고, 돈이 모이면 짓고 올리고 보수한다.
 * 예보는 보지 않는다 (사람이 보는 정보만 쓴다).
 */
/** 스테이지별 건설 우선순위: 큰 마을 바로 위 홍수 조절 댐부터 */
const BUILD_PRIORITY: Record<number, string[]> = {
  1: ['s1a', 's1b'],
  2: ['s2b', 's2c', 's2a'],
  3: ['s3d', 's3b', 's3c', 's3a'],
};

export const heuristicBot = (): Bot => {
  const UPGRADE_PLAN: [UpgradeAxis, number][] = [
    ['release', 1],
    ['auto', 1],
    ['power', 1],
    ['capacity', 1],
    ['release', 2],
    ['capacity', 2],
  ];
  // 월류를 겪은 댐만 방류량 업그레이드가 필요하다
  const overtopSeen = new Set<string>();
  return {
    id: 'heuristic',
    name: '휴리스틱 봇',
    act(world) {
      const date = world.date;
      for (const d of world.dams) if (d && d.level > 0.97) overtopSeen.add(d.siteId);
      const dry = world.today.season === 'winter';
      if (world.tick % 2 === 0) {
        // 각 마을 바로 위 댐이 건기 용수 계약을 맡는다
        const minOpen = new Map<number, number>();
        if (dry) {
          for (const l of world.townLayouts) {
            let best = -1;
            for (const s of world.sites) {
              const d = world.dams[s.index];
              if (!d || d.status !== 'ok') continue;
              if (s.def.flow === 'E' && s.cx < l.def.gaugeX && (best < 0 || s.cx > world.sites[best].cx)) best = s.index;
            }
            if (best >= 0) {
              const need = (l.def.demandPerDay * ECONOMY.DRY_DEMAND_MULT) / TIME.TICKS_PER_DAY;
              minOpen.set(best, Math.min(1, (need * 1.15) / maxRelease(world.dams[best]!)));
            }
          }
        }
        for (const s of world.sites) {
          const d = world.dams[s.index];
          if (!d || d.status !== 'ok') continue;
          let target = TARGET_BY_MONTH[date.month - 1];
          if (world.today.rain > 1.5) target -= 0.1;
          let open = 0.3 + (d.level - target) * 6;
          open = Math.max(open, minOpen.get(s.index) ?? 0);
          // 하류 마을이 잠기기 시작하면 여유가 있는 한 물을 붙잡는다
          const downstreamFlooding = world.townLayouts.some(
            (l, ti) => (s.def.flow !== 'E' || l.def.x > s.cx) && world.towns[ti].floodRatio > 0.02,
          );
          // 급방류는 하류를 잠기게 하므로 안전 유량까지만 연다 (댐이 위험할 때만 활짝)
          const safeOpen = SAFE_RELEASE / maxRelease(d);
          if (downstreamFlooding && d.level < 0.93) open = Math.min(open, 0.05);
          else if (d.level > 0.95) open = 1;
          else open = Math.min(open, safeOpen);
          world.setGate(s.def.id, Math.max(0, Math.min(1, open)));
        }
      }
      if (world.tick % TIME.TICKS_PER_DAY !== 0) return;
      const e = world.economy;
      for (const s of world.sites) {
        const d = world.dams[s.index];
        if (!d) continue;
        if (d.status === 'collapsed') world.rebuild(d.siteId);
        else if (d.durability < maxDurability(d) * 0.5 && e.funds > repairCost(d) + 300) world.repair(d.siteId);
      }
      // 건설: 우선순위대로 석축. 남은 기간이 짧으면 새로 짓지 않는다
      const daysLeft = TIME.DAYS_PER_YEAR * TIME.STAGE_YEARS - date.dayIndex;
      const late = daysLeft < 300;
      if (!late) {
        for (const id of BUILD_PRIORITY[world.stage.id] ?? world.sites.map((s) => s.def.id)) {
          const s = world.sites[world.siteIndex(id)];
          if (world.dams[s.index]) continue;
          if (e.funds >= buildCost(s.def, 'stone') + 1500) world.build(s.def.id, 'stone');
          break;
        }
      }
      // 업그레이드: 넉넉할 때만
      if (late) return;
      for (const [axis, lvl] of UPGRADE_PLAN) {
        for (const s of world.sites) {
          const d = world.dams[s.index];
          if (!d || d.status !== 'ok' || d.levels[axis] >= Math.min(lvl, METHODS[d.method].maxUpgrade)) continue;
          if (axis === 'release' && !overtopSeen.has(d.siteId)) continue;
          if (axis === 'capacity') {
            const next = crestOf(s, d) + DAM.CAPACITY_STEP;
            if (upstreamTownMargin(s, next, world.terrain.ground, world.townLayouts, TOWN.FLOOD_DEPTH) < 1.5) continue;
          }
          if (e.funds > upgradeCost(s.def, d, axis) + 4000) {
            world.upgrade(s.def.id, axis);
            if (axis === 'auto') world.setAuto(s.def.id, true, 0.88);
          }
          return;
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


