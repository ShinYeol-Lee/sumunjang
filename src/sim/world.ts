import { DAM, ECONOMY, METHODS, STAGE_TICKS, TIME, TOWN, WATER, type MethodId, type UpgradeAxis } from '../data/balance';
import { getStage, type StageDef } from '../data/stages';
import { tickToDate, type GameDate } from './calendar';
import {
  applyBarrier,
  buildCost,
  canUpgrade,
  computeSiteGeom,
  effectiveOpening,
  gateTransfer,
  maxDurability,
  measureLevel,
  newDam,
  powerEfficiency,
  rebuildCost,
  repairCost,
  updateDurability,
  upgradeCost,
  type DamState,
  type SiteGeom,
} from './dam';
import { checkBankruptcy, earn, newEconomy, powerIncome, reliefAmount, spend, type EconomyState } from './economy';
import { computeStars, type StageResult } from './scoring';
import { generateTerrain, type Terrain } from './terrain';
import { layoutTown, newTownState, updateTown, type TownLayout, type TownState } from './town';
import { WaterGrid } from './water';
import { Weather, type WeatherDay, type WeatherState } from './weather';

export const SAVE_VERSION = 1;

export type WorldEventType =
  | 'built'
  | 'collapse'
  | 'chainCollapse'
  | 'overtopStart'
  | 'dangerLevel'
  | 'lowDurability'
  | 'floodStart'
  | 'bigFlood'
  | 'relief'
  | 'emergency'
  | 'dryRiverbed'
  | 'monthStart'
  | 'stageEnd';

export interface WorldEvent {
  type: WorldEventType;
  tick: number;
  siteId?: string;
  townId?: string;
  amount?: number;
}

export interface ActionResult {
  ok: boolean;
  reason?: string;
  cost?: number;
}

export interface WorldSave {
  saveVersion: number;
  stageId: number;
  seed: number;
  tick: number;
  finished: boolean;
  ground: number[];
  barrier: number[];
  depth: number[];
  fluxes: number[][];
  accounting: [number, number, number, number];
  dams: (DamState | null)[];
  towns: TownState[];
  economy: EconomyState;
  weather: WeatherState;
  alerts: Record<string, boolean>;
  result: StageResult | null;
}

export interface WorldOptions {
  /** 강수 배수 (안정성 테스트용) */
  rainScale?: number;
}

export class World {
  readonly stage: StageDef;
  readonly seed: number;
  readonly terrain: Terrain;
  readonly grid: WaterGrid;
  readonly sites: SiteGeom[];
  readonly townLayouts: TownLayout[];
  dams: (DamState | null)[];
  towns: TownState[];
  economy: EconomyState;
  weather: Weather;
  tick = 0;
  finished = false;
  result: StageResult | null = null;
  events: WorldEvent[] = [];
  today: WeatherDay;
  rainScale: number;
  /** 알림 중복 방지 플래그 */
  private alerts: Record<string, boolean> = {};

  constructor(stageId: number, seed: number, opts: WorldOptions = {}) {
    this.stage = getStage(stageId);
    this.seed = seed >>> 0;
    this.rainScale = opts.rainScale ?? 1;
    this.terrain = generateTerrain(this.stage);
    this.grid = new WaterGrid(this.terrain.w, this.terrain.h, this.terrain.ground);
    this.sites = this.stage.sites.map((s, i) => computeSiteGeom(s, i, this.terrain));
    this.townLayouts = this.stage.towns.map((t) => layoutTown(t, this.terrain.w, this.terrain.h));
    this.dams = this.sites.map(() => null);
    this.towns = this.townLayouts.map(newTownState);
    this.economy = newEconomy(this.stage.startFunds);
    this.weather = new Weather(this.stage, this.seed);
    this.today = this.weather.today(0);
    this.prefill();
  }

  /** 시작 시 강에 물을 흘려 둔다 (결정론적 예열) */
  private prefill(): void {
    for (let k = 0; k < 24 * 14; k++) {
      this.stage.rivers.forEach((r, ri) => this.grid.addInflow(this.terrain.sources[ri], (k < 24 * 7 ? 2.0 : 0.9) * r.inflowMult));
      for (let s = 0; s < WATER.SUBSTEPS; s++) this.grid.step();
    }
    this.grid.totalInflow = 0;
    this.grid.totalOutflow = 0;
    this.grid.totalRain = 0;
    this.grid.totalEvap = 0;
  }

  get date(): GameDate {
    return tickToDate(this.tick);
  }

  siteIndex(siteId: string): number {
    const i = this.sites.findIndex((s) => s.def.id === siteId);
    if (i < 0) throw new Error(`unknown site ${siteId}`);
    return i;
  }

  dam(siteId: string): DamState | null {
    return this.dams[this.siteIndex(siteId)];
  }

  private emit(e: Omit<WorldEvent, 'tick'>): void {
    this.events.push({ ...e, tick: this.tick });
  }

  drainEvents(): WorldEvent[] {
    const ev = this.events;
    this.events = [];
    return ev;
  }

  // ───── 플레이어 행동 ─────

  build(siteId: string, method: MethodId): ActionResult {
    const i = this.siteIndex(siteId);
    if (this.finished) return { ok: false, reason: '스테이지가 끝났습니다' };
    if (this.dams[i]) return { ok: false, reason: '이미 댐이 있습니다' };
    const cost = buildCost(this.sites[i].def, method);
    if (this.economy.funds < cost) return { ok: false, reason: '자금이 부족합니다', cost };
    spend(this.economy, 'build', cost);
    const dam = newDam(siteId, method);
    this.dams[i] = dam;
    applyBarrier(this.grid, this.sites[i], dam);
    measureLevel(this.grid, this.sites[i], dam);
    this.emit({ type: 'built', siteId });
    return { ok: true, cost };
  }

  upgrade(siteId: string, axis: UpgradeAxis): ActionResult {
    const i = this.siteIndex(siteId);
    const dam = this.dams[i];
    if (!dam) return { ok: false, reason: '댐이 없습니다' };
    if (!canUpgrade(dam, axis)) return { ok: false, reason: `${METHODS[dam.method].name}은 더 올릴 수 없습니다` };
    const cost = upgradeCost(this.sites[i].def, dam, axis);
    if (this.economy.funds < cost) return { ok: false, reason: '자금이 부족합니다', cost };
    spend(this.economy, 'upgrade', cost);
    const before = maxDurability(dam);
    dam.levels[axis]++;
    if (axis === 'durability') dam.durability += maxDurability(dam) - before;
    if (axis === 'auto' && dam.levels.auto === 1) dam.autoEnabled = true;
    applyBarrier(this.grid, this.sites[i], dam);
    return { ok: true, cost };
  }

  repair(siteId: string): ActionResult {
    const i = this.siteIndex(siteId);
    const dam = this.dams[i];
    if (!dam || dam.status !== 'ok') return { ok: false, reason: '보수할 댐이 없습니다' };
    const cost = repairCost(dam);
    if (cost <= 0) return { ok: false, reason: '이미 튼튼합니다' };
    if (this.economy.funds < cost) return { ok: false, reason: '자금이 부족합니다', cost };
    spend(this.economy, 'repair', cost);
    dam.durability = maxDurability(dam);
    this.alerts[`dur:${siteId}`] = false;
    return { ok: true, cost };
  }

  rebuild(siteId: string): ActionResult {
    const i = this.siteIndex(siteId);
    const dam = this.dams[i];
    if (!dam || dam.status !== 'collapsed') return { ok: false, reason: '무너진 댐이 아닙니다' };
    const cost = rebuildCost(this.sites[i].def, dam.method);
    if (this.economy.funds < cost) return { ok: false, reason: '자금이 부족합니다', cost };
    spend(this.economy, 'build', cost);
    dam.status = 'ok';
    dam.durability = maxDurability(dam);
    applyBarrier(this.grid, this.sites[i], dam);
    this.alerts[`dur:${siteId}`] = false;
    return { ok: true, cost };
  }

  setGate(siteId: string, value: number): void {
    const dam = this.dam(siteId);
    if (dam) dam.gate = Math.max(0, Math.min(1, value));
  }

  setAuto(siteId: string, enabled: boolean, setpoint?: number): ActionResult {
    const dam = this.dam(siteId);
    if (!dam) return { ok: false, reason: '댐이 없습니다' };
    if (dam.levels.auto < 1) return { ok: false, reason: '자동 수문을 먼저 업그레이드하세요' };
    dam.autoEnabled = enabled;
    if (setpoint !== undefined) dam.autoSetpoint = Math.max(0.3, Math.min(0.95, setpoint));
    return { ok: true };
  }

  // ───── 시뮬레이션 ─────

  /** 한 틱(게임 시간 1시간) 진행 */
  step(): void {
    if (this.finished) return;
    const g = this.grid;
    const w = this.weather.tick(this.tick, TIME.TICKS_PER_DAY);
    this.today = w.day;
    g.addRain(w.rainPerCell * this.rainScale);
    g.evaporate(w.evap);
    this.stage.rivers.forEach((_, ri) => g.addInflow(this.terrain.sources[ri], w.inflow[ri] * this.rainScale));

    const active: number[] = [];
    for (let i = 0; i < this.dams.length; i++) {
      const d = this.dams[i];
      if (d && d.status === 'ok') {
        d.opening = effectiveOpening(d);
        d.releasePerTick = 0;
        d.head = 0;
        active.push(i);
      } else if (d) {
        d.opening = 0;
        d.releasePerTick = 0;
      }
    }
    const energy = new Float64Array(this.dams.length);
    const S = WATER.SUBSTEPS;
    for (let s = 0; s < S; s++) {
      g.step();
      for (const i of active) {
        const [moved, e] = gateTransfer(g, this.sites[i], this.dams[i]!, S);
        this.dams[i]!.releasePerTick += moved;
        energy[i] += e;
      }
      for (let t = 0; t < this.towns.length; t++) {
        this.towns[t].flowToday += g.fluxAcrossColumn(this.townLayouts[t].def.gaugeX);
      }
    }

    this.updateDams(energy);
    this.updateTowns();

    this.tick++;
    if (this.tick % TIME.TICKS_PER_DAY === 0) this.endOfDay();
    if (checkBankruptcy(this.economy)) this.emit({ type: 'emergency' });
    if (this.tick >= STAGE_TICKS) this.finish();
  }

  private updateDams(energy: Float64Array): void {
    for (let i = 0; i < this.dams.length; i++) {
      const dam = this.dams[i];
      if (!dam) continue;
      const geom = this.sites[i];
      measureLevel(this.grid, geom, dam);
      if (dam.status !== 'ok') continue;
      if (dam.releasePerTick > 0) {
        dam.head = energy[i] / dam.releasePerTick;
        earn(this.economy, 'power', powerIncome(energy[i], powerEfficiency(dam)));
      }
      const id = dam.siteId;
      if (dam.overtopping && !this.alerts[`ot:${id}`]) {
        this.alerts[`ot:${id}`] = true;
        this.emit({ type: 'overtopStart', siteId: id });
      } else if (!dam.overtopping && dam.level < 0.85) {
        this.alerts[`ot:${id}`] = false;
      }
      if (dam.level >= DAM.DANGER_LEVEL && !this.alerts[`lv:${id}`]) {
        this.alerts[`lv:${id}`] = true;
        this.emit({ type: 'dangerLevel', siteId: id });
      } else if (dam.level < DAM.DANGER_LEVEL - 0.08) {
        this.alerts[`lv:${id}`] = false;
      }
      if (updateDurability(dam)) {
        dam.lastCollapseTick = this.tick;
        applyBarrier(this.grid, geom, dam);
        this.emit({ type: 'collapse', siteId: id });
        // 연쇄 붕괴: 상류 댐이 사흘 안에 먼저 무너졌다면
        for (let j = 0; j < i; j++) {
          const up = this.dams[j];
          if (up && up.lastCollapseTick >= 0 && this.tick - up.lastCollapseTick <= 72) {
            this.emit({ type: 'chainCollapse', siteId: id });
            break;
          }
        }
        this.alerts[`ot:${id}`] = false;
        this.alerts[`lv:${id}`] = false;
      } else if (dam.durability < maxDurability(dam) * 0.2 && !this.alerts[`dur:${id}`]) {
        this.alerts[`dur:${id}`] = true;
        this.emit({ type: 'lowDurability', siteId: id });
      }
    }
  }

  private updateTowns(): void {
    for (let t = 0; t < this.towns.length; t++) {
      const st = this.towns[t];
      const r = updateTown(this.grid, this.townLayouts[t], st);
      spend(this.economy, 'damage', r.damage);
      if (r.floodStarted) this.emit({ type: 'floodStart', townId: st.id });
      if (r.bigFloodStarted) this.emit({ type: 'bigFlood', townId: st.id });
      if (r.bigFloodEnded) {
        const amount = reliefAmount(r.eventDamage);
        earn(this.economy, 'relief', amount);
        this.economy.reliefCount++;
        this.emit({ type: 'relief', townId: st.id, amount });
      }
    }
  }

  private endOfDay(): void {
    const season = this.today.season;
    const dry = season === 'winter';
    let anyRoadFlooded = false;
    for (let t = 0; t < this.towns.length; t++) {
      const st = this.towns[t];
      const def = this.townLayouts[t].def;
      const demand = def.demandPerDay * (dry ? ECONOMY.DRY_DEMAND_MULT : 1);
      st.contractDays++;
      const met = st.flowToday >= demand && !st.farmFloodedToday;
      if (met) {
        st.contractMet++;
        earn(this.economy, 'contract', ECONOMY.CONTRACT_INCOME);
        st.trust = Math.min(100, st.trust + TOWN.TRUST_CONTRACT_MET);
      } else {
        spend(this.economy, 'penalty', ECONOMY.CONTRACT_PENALTY);
        st.trust = Math.max(0, st.trust - TOWN.TRUST_CONTRACT_MISS);
      }
      if (st.flooded === 0) st.trust = Math.min(100, st.trust + TOWN.TRUST_RECOVER_PER_DAY);
      if (st.roadFloodedToday) anyRoadFlooded = true;
      st.flowToday = 0;
      st.farmFloodedToday = false;
      st.roadFloodedToday = false;
    }

    for (let i = 0; i < this.dams.length; i++) {
      const dam = this.dams[i];
      if (!dam) continue;
      dam.levelHistory.push(dam.level);
      if (dam.levelHistory.length > 7) dam.levelHistory.shift();
      if (dam.status !== 'ok') continue;
      const h = dam.levelHistory;
      if (!anyRoadFlooded && h.length === 7) {
        const range = Math.max(...h) - Math.min(...h);
        if (range <= ECONOMY.TOURISM_MAX_RANGE && dam.level >= ECONOMY.TOURISM_MIN_LEVEL) {
          earn(this.economy, 'tourism', ECONOMY.TOURISM_INCOME);
        }
      }
      if (dry && dam.level < 0.1 && !this.alerts[`dry:${dam.siteId}`]) {
        this.alerts[`dry:${dam.siteId}`] = true;
        this.emit({ type: 'dryRiverbed', siteId: dam.siteId });
      }
    }

    const next = tickToDate(this.tick);
    if (next.day === 1 && this.tick < STAGE_TICKS) {
      this.monthly();
      for (const k of Object.keys(this.alerts)) if (k.startsWith('dry:')) this.alerts[k] = false;
    }
  }

  private monthly(): void {
    for (const st of this.towns) earn(this.economy, 'tax', (st.trust / 100) * ECONOMY.TAX_PER_MONTH);
    for (const d of this.dams) if (d) spend(this.economy, 'upkeep', METHODS[d.method].upkeepPerMonth);
    this.economy.monthIncome = 0;
    this.economy.monthExpense = 0;
    this.emit({ type: 'monthStart' });
  }

  private finish(): void {
    this.finished = true;
    this.result = this.currentResult(true);
    this.emit({ type: 'stageEnd' });
  }

  currentResult(finished = this.finished): StageResult {
    const contractDays = this.towns.reduce((a, t) => a + t.contractDays, 0);
    const contractMet = this.towns.reduce((a, t) => a + t.contractMet, 0);
    const base = {
      finished,
      funds: this.economy.funds,
      targetFunds: this.stage.targetFunds,
      totalDamage: this.towns.reduce((a, t) => a + t.totalDamage, 0),
      collapses: this.dams.reduce((a, d) => a + (d ? d.collapses : 0), 0),
      bigFloods: this.towns.reduce((a, t) => a + t.bigFloods, 0),
      reliefCount: this.economy.reliefCount,
      emergencyCount: this.economy.emergencyCount,
      contractRate: contractDays ? contractMet / contractDays : 1,
    };
    return { ...base, stars: computeStars(base) };
  }

  runTicks(n: number): void {
    for (let k = 0; k < n && !this.finished; k++) this.step();
  }

  runToEnd(): void {
    while (!this.finished) this.step();
  }

  // ───── 저장 ─────

  serialize(): WorldSave {
    const g = this.grid;
    return {
      saveVersion: SAVE_VERSION,
      stageId: this.stage.id,
      seed: this.seed,
      tick: this.tick,
      finished: this.finished,
      ground: Array.from(g.ground),
      barrier: Array.from(g.barrier),
      depth: Array.from(g.depth),
      fluxes: [g.fL, g.fR, g.fU, g.fD].map((f) => Array.from(f)),
      accounting: [g.totalInflow, g.totalRain, g.totalOutflow, g.totalEvap],
      dams: structuredClone(this.dams),
      towns: structuredClone(this.towns),
      economy: structuredClone(this.economy),
      weather: structuredClone(this.weather.state),
      alerts: { ...this.alerts },
      result: this.result ? { ...this.result } : null,
    };
  }

  static deserialize(save: WorldSave, opts: WorldOptions = {}): World {
    if (save.saveVersion !== SAVE_VERSION) throw new Error(`지원하지 않는 저장 버전 ${save.saveVersion}`);
    const w = new World(save.stageId, save.seed, opts);
    const g = w.grid;
    g.ground.set(save.ground);
    g.barrier.set(save.barrier);
    g.depth.set(save.depth);
    [g.fL, g.fR, g.fU, g.fD].forEach((f, k) => f.set(save.fluxes[k]));
    [g.totalInflow, g.totalRain, g.totalOutflow, g.totalEvap] = save.accounting;
    w.tick = save.tick;
    w.finished = save.finished;
    w.dams = structuredClone(save.dams);
    w.towns = structuredClone(save.towns);
    w.economy = structuredClone(save.economy);
    w.weather = new Weather(w.stage, w.seed, save.weather);
    w.today = w.weather.today(Math.floor(w.tick / TIME.TICKS_PER_DAY));
    w.alerts = { ...save.alerts };
    w.result = save.result ? { ...save.result } : null;
    return w;
  }

  /** 상태 해시 (결정론 검증용) */
  hash(): string {
    let h1 = 0x811c9dc5 >>> 0;
    const mix = (arr: Float64Array) => {
      const u = new Uint32Array(arr.buffer, arr.byteOffset, arr.length * 2);
      for (let i = 0; i < u.length; i++) {
        h1 ^= u[i];
        h1 = Math.imul(h1, 16777619) >>> 0;
      }
    };
    const g = this.grid;
    mix(g.depth);
    mix(g.barrier);
    mix(g.fL);
    mix(g.fR);
    mix(g.fU);
    mix(g.fD);
    const rest = JSON.stringify({
      t: this.tick,
      d: this.dams,
      tw: this.towns,
      e: this.economy,
      w: this.weather.state,
    });
    for (let i = 0; i < rest.length; i++) {
      h1 ^= rest.charCodeAt(i);
      h1 = Math.imul(h1, 16777619) >>> 0;
    }
    return h1.toString(16).padStart(8, '0');
  }
}
