/** 모든 밸런스 숫자는 이 파일에 둔다. */

export const GAME_TITLE = '수문장';

export const TIME = {
  TICKS_PER_DAY: 24,
  DAYS_PER_YEAR: 365,
  STAGE_YEARS: 3,
  /** 시작 월(1~12). 3월 1일 봄에서 시작한다. */
  START_MONTH: 3,
  /** 1배속에서 하루가 걸리는 실제 초 */
  SECONDS_PER_DAY_1X: 3,
  SPEEDS: [0, 1, 2, 3] as const,
};

export const STAGE_TICKS = TIME.TICKS_PER_DAY * TIME.DAYS_PER_YEAR * TIME.STAGE_YEARS;

export const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export const WATER = {
  /** 틱당 물 서브스텝 수 */
  SUBSTEPS: 4,
  /** 파이프 가속 계수 (수면차·유효수심에 곱함) */
  PIPE_ACCEL: 0.12,
  /** 서브스텝당 플럭스 감쇠(마찰) */
  PIPE_DAMPING: 0.94,
  /** 얕은 물도 흐르도록 유효수심에 더하는 값 */
  MIN_FLOW_DEPTH: 0.03,
  /** 한 서브스텝에 한 셀이 내보낼 수 있는 최대 비율 */
  MAX_OUT_FRACTION: 0.9,
  /** 하류 출구 가상 셀의 지면 낙차 */
  OUTLET_DROP: 0.08,
  /** 이 수심 미만의 얇은 막은 땅에 스민다(손실로 집계) */
  FILM_DEPTH: 0.0015,
};

export const WEATHER = {
  /** 미리 생성해 두는 강수 스케줄 길이(일) */
  FORECAST_DAYS: 14,
  /** 계절별: 비 올 확률(맑은 날 다음), 비 온 다음날 비 확률, 평균 강수 세기 */
  SEASONS: {
    spring: { pStart: 0.22, pStay: 0.45, intensity: 0.8 },
    summer: { pStart: 0.35, pStay: 0.6, intensity: 1.2 },
    monsoon: { pStart: 0.6, pStay: 0.8, intensity: 1.8 },
    autumn: { pStart: 0.18, pStay: 0.4, intensity: 0.8 },
    winter: { pStart: 0.08, pStay: 0.3, intensity: 0.4 },
  },
  /** 장마 기간 (연중 일차, 3월1일=0 기준이 아니라 1월1일=0 기준) */
  MONSOON_START_DOY: 172, // 6월 21일
  MONSOON_END_DOY: 212, // 7월 31일
  /** 강수 세기 1.0일 때 셀당 틱당 강수량 */
  RAIN_PER_INTENSITY: 0.00025,
  /** 계절별 기본 유입 유량 (틱당 부피) */
  BASE_INFLOW: { spring: 0.9, summer: 1.1, monsoon: 1.3, autumn: 0.8, winter: 0.45 },
  /** 유역 효과: 강수 세기 1.0이 유입에 더하는 유량 */
  CATCHMENT_GAIN: 0.9,
  /** 유역 응답 시간상수(틱) */
  CATCHMENT_TAU: 48,
  /** 건기 증발량 (셀당 틱당) */
  EVAPORATION_DRY: 0.00004,
  EVAPORATION_OTHER: 0.00001,
};

export type MethodId = 'earth' | 'stone' | 'concrete';

export interface MethodStats {
  name: string;
  /** 부지 기준비에 곱하는 배수 */
  costMult: number;
  baseDurability: number;
  maxUpgrade: number;
  /** 시간당 기본 노후 */
  decayPerTick: number;
  /** 월류 시 틱당 내구도 감소 */
  overtopDecayPerTick: number;
  powerEfficiency: number;
  /** 월 유지비 */
  upkeepPerMonth: number;
}

export const METHODS: Record<MethodId, MethodStats> = {
  earth: {
    name: '흙댐',
    costMult: 1.0,
    baseDurability: 100,
    maxUpgrade: 1,
    decayPerTick: 0.0025,
    overtopDecayPerTick: 4.0,
    powerEfficiency: 1.0,
    upkeepPerMonth: 60,
  },
  stone: {
    name: '석축댐',
    costMult: 2.0,
    baseDurability: 200,
    maxUpgrade: 3,
    decayPerTick: 0.004,
    overtopDecayPerTick: 2.0,
    powerEfficiency: 1.0,
    upkeepPerMonth: 120,
  },
  concrete: {
    name: '콘크리트댐',
    costMult: 3.6,
    baseDurability: 400,
    maxUpgrade: 5,
    decayPerTick: 0.006,
    overtopDecayPerTick: 1.6,
    powerEfficiency: 1.35,
    upkeepPerMonth: 220,
  },
};

export type UpgradeAxis = 'capacity' | 'release' | 'durability' | 'power' | 'auto';

export const UPGRADE_AXES: UpgradeAxis[] = ['capacity', 'release', 'durability', 'power', 'auto'];

export const UPGRADE_NAMES: Record<UpgradeAxis, string> = {
  capacity: '저수 용량',
  release: '수문 방류량',
  durability: '내구도',
  power: '발전 효율',
  auto: '자동 수문',
};

export const DAM = {
  /** 레벨당 마루 높이 증가 */
  CAPACITY_STEP: 0.45,
  /** 기본 최대 방류량 (틱당 부피) */
  BASE_RELEASE: 2.2,
  RELEASE_PER_LEVEL: 0.5,
  DURABILITY_PER_LEVEL: 0.3,
  DECAY_REDUCTION_PER_LEVEL: 0.12,
  POWER_PER_LEVEL: 0.15,
  /** 위험 구간(만수위 비율) */
  DANGER_LEVEL: 0.9,
  DANGER_DECAY_MULT: 6,
  /** 월류 판정 여유 */
  OVERTOP_MARGIN: 0.02,
  /** 업그레이드 기본가 (부지 기준비 대비 비율), 단계마다 곱해짐 */
  UPGRADE_COST_RATIO: 0.35,
  /** 내구도 1당 보수비 */
  REPAIR_COST_PER_POINT: 6,
  /** 재건비 (건설비 대비) */
  REBUILD_RATIO: 0.7,
  /** 자동 수문 기본 설정 수위 */
  AUTO_DEFAULT_SETPOINT: 0.8,
  AUTO_BASE_OPEN: 0.6,
  AUTO_OPEN_PER_LEVEL: 0.1,
  /** 수문이 물을 끌어오는 바닥 근처 높이 범위 */
  GATE_BAND: 1.2,
};

export const TOWN = {
  FLOOD_DEPTH: { building: 0.12, road: 0.08, farm: 0.1 },
  /** 침수 시설 하나당 틱당 피해액 */
  DAMAGE_PER_TICK: { building: 1.2, road: 0.4, farm: 0.6 },
  START_TRUST: 70,
  /** 침수 비율 1.0일 때 틱당 신뢰도 하락 */
  TRUST_FLOOD_PER_TICK: 1.2,
  TRUST_RECOVER_PER_DAY: 0.15,
  TRUST_CONTRACT_MISS: 1.5,
  TRUST_CONTRACT_MET: 0.1,
  BIG_FLOOD_RATIO: 0.3,
  BIG_FLOOD_END_RATIO: 0.1,
};

export const ECONOMY = {
  /** 낙차 × 방류량 1당 발전 수입 */
  POWER_PRICE: 0.4,
  /** 일일 용수 계약 수입 (요구량 충족 시) */
  CONTRACT_INCOME: 4,
  CONTRACT_PENALTY: 2,
  /** 건기 요구량 배수 */
  DRY_DEMAND_MULT: 1.6,
  /** 관광: 7일 변동폭 한계(만수위 비율), 최소 수위, 일 수입 */
  TOURISM_MAX_RANGE: 0.08,
  TOURISM_MIN_LEVEL: 0.35,
  TOURISM_INCOME: 10,
  /** 신뢰도 100일 때 마을당 월 세금 */
  TAX_PER_MONTH: 150,
  /** 대형 침수 후 복구 지원금 (해당 침수 피해액 대비, 상하한) */
  RELIEF_RATIO: 0.6,
  RELIEF_MIN: 1000,
  RELIEF_MAX: 4000,
};
