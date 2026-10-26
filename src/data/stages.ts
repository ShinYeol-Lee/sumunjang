/** 스테이지 정의. 지형은 스테이지마다 고정이고, 게임 시드는 날씨만 바꾼다. */

export type FlowDir = 'E' | 'S' | 'N';

export interface RiverDef {
  /** 격자 좌표 꺾은선 (상류 → 하류) */
  path: [number, number][];
  /** 하도 반폭 */
  channelHalfWidth: number;
  channelDepth: number;
  /** 시작 지점 하상 높이 (지류는 합류점 높이에서 자동 계산) */
  startBed?: number;
  /** 셀당 하상 경사 */
  slope: number;
  /** 경로 길이 비율(0~1)별 계곡 반폭 [t, 반폭] */
  valley: [number, number][];
  /** 유입 유량 배수 */
  inflowMult: number;
  /** 지류 유역 응답 지연(틱) */
  catchmentTau?: number;
}

export interface DamSiteDef {
  id: string;
  name: string;
  x: number;
  y: number;
  /** 물이 흐르는 방향 */
  flow: FlowDir;
  /** 레벨 0 댐 높이 (부지 바닥 기준) */
  baseHeight: number;
  kind: 'narrow' | 'wide';
  /** 기준 건설비 (공법 배수 곱하기 전) */
  baseCost: number;
}

export interface TownDef {
  id: string;
  name: string;
  /** 마을 중심 */
  x: number;
  y: number;
  /** 가로·세로 크기 (셀) */
  w: number;
  h: number;
  /** 강 쪽 방향 (농지가 강 쪽에 깔린다) */
  riverSide: 'N' | 'S';
  /** 용수 계약 계측선 (마을 상류 쪽 x 좌표, 동쪽 흐름 기준) */
  gaugeX: number;
  /** 일일 요구 유량 (부피) */
  demandPerDay: number;
  /** 마을 지면을 하천 둑보다 얼마나 높게 둘지 */
  elevation: number;
}

export interface StageDef {
  id: number;
  name: string;
  description: string;
  width: number;
  height: number;
  plateau: number;
  rivers: RiverDef[];
  sites: DamSiteDef[];
  towns: TownDef[];
  startFunds: number;
  targetFunds: number;
  /** 강수 세기 배수: [평상시, 장마] */
  rainMult: [number, number];
  /** 유입 편차 (0이면 일정) */
  inflowVariance: number;
}

export const STAGES: StageDef[] = [
  {
    id: 1,
    name: '실개천 마을',
    description: '좁고 곧은 실개천. 장마가 약해 댐 하나로도 마을을 지킬 수 있다.',
    width: 128,
    height: 64,
    plateau: 9,
    rivers: [
      {
        path: [
          [0, 30],
          [40, 31],
          [80, 33],
          [128, 34],
        ],
        channelHalfWidth: 2.2,
        channelDepth: 0.9,
        startBed: 12,
        slope: 0.07,
        valley: [
          [0, 9],
          [0.25, 12],
          [0.33, 5],
          [0.36, 5],
          [0.45, 13],
          [0.58, 15],
          [0.62, 7],
          [0.66, 8],
          [0.8, 16],
          [1, 16],
        ],
        inflowMult: 0.8,
      },
    ],
    sites: [
      { id: 's1a', name: '여울목', x: 44, y: 31, flow: 'E', baseHeight: 2.6, kind: 'narrow', baseCost: 2200 },
      { id: 's1b', name: '넓은둑', x: 79, y: 33, flow: 'E', baseHeight: 2.8, kind: 'wide', baseCost: 3600 },
    ],
    towns: [
      {
        id: 't1',
        name: '아랫마을',
        x: 106,
        y: 42,
        w: 16,
        h: 8,
        riverSide: 'N',
        gaugeX: 96,
        demandPerDay: 14,
        elevation: 0.15,
      },
    ],
    startFunds: 9000,
    targetFunds: 26000,
    rainMult: [0.8, 0.7],
    inflowVariance: 0.1,
  },
  {
    id: 2,
    name: '두 계곡',
    description: '길게 굽은 강과 중간의 평지. 위아래 댐을 차례로 다뤄야 한다.',
    width: 128,
    height: 64,
    plateau: 10,
    rivers: [
      {
        path: [
          [0, 14],
          [22, 16],
          [40, 26],
          [56, 40],
          [74, 46],
          [94, 40],
          [110, 30],
          [128, 28],
        ],
        channelHalfWidth: 2.2,
        channelDepth: 0.9,
        startBed: 13,
        slope: 0.055,
        valley: [
          [0, 8],
          [0.14, 10],
          [0.2, 5],
          [0.23, 5],
          [0.32, 12],
          [0.48, 16],
          [0.55, 7],
          [0.58, 7],
          [0.64, 10],
          [0.78, 15],
          [0.85, 9],
          [0.88, 9],
          [1, 14],
        ],
        inflowMult: 1.0,
      },
    ],
    sites: [
      { id: 's2a', name: '윗골 협곡', x: 32, y: 21, flow: 'E', baseHeight: 2.6, kind: 'narrow', baseCost: 2400 },
      { id: 's2b', name: '가운데 들목', x: 77, y: 45, flow: 'E', baseHeight: 2.8, kind: 'wide', baseCost: 3600 },
      { id: 's2c', name: '아랫목', x: 103, y: 35, flow: 'E', baseHeight: 2.4, kind: 'narrow', baseCost: 2800 },
    ],
    towns: [
      {
        id: 't2a',
        name: '들말',
        x: 60,
        y: 54,
        w: 14,
        h: 7,
        riverSide: 'N',
        gaugeX: 50,
        demandPerDay: 10,
        elevation: 0.12,
      },
      {
        id: 't2b',
        name: '강끝마을',
        x: 112,
        y: 23,
        w: 14,
        h: 8,
        riverSide: 'S',
        gaugeX: 104,
        demandPerDay: 14,
        elevation: 0.0,
      },
    ],
    startFunds: 11000,
    targetFunds: 34000,
    rainMult: [1.0, 1.0],
    inflowVariance: 0.2,
  },
  {
    id: 3,
    name: '합류점',
    description: '본류와 지류가 만나는 곳 아래 큰 마을. 두 물줄기의 홍수가 겹치는 날을 조심하라.',
    width: 128,
    height: 64,
    plateau: 10,
    rivers: [
      {
        path: [
          [0, 44],
          [24, 45],
          [48, 42],
          [70, 40],
          [96, 41],
          [128, 40],
        ],
        channelHalfWidth: 2.4,
        channelDepth: 0.9,
        startBed: 12.5,
        slope: 0.06,
        valley: [
          [0, 8],
          [0.12, 9],
          [0.17, 5],
          [0.2, 5],
          [0.3, 10],
          [0.36, 6],
          [0.39, 6],
          [0.48, 10],
          [0.62, 16],
          [0.68, 8],
          [0.71, 8],
          [0.78, 15],
          [1, 15],
        ],
        inflowMult: 0.8,
      },
      {
        path: [
          [44, 0],
          [48, 12],
          [56, 24],
          [66, 34],
          [70, 40],
        ],
        channelHalfWidth: 1.8,
        channelDepth: 0.8,
        slope: 0.08,
        valley: [
          [0, 7],
          [0.35, 9],
          [0.45, 4.5],
          [0.5, 4.5],
          [0.62, 8],
          [1, 9],
        ],
        inflowMult: 0.6,
        catchmentTau: 30,
      },
    ],
    sites: [
      { id: 's3a', name: '서쪽 여울', x: 23, y: 45, flow: 'E', baseHeight: 2.4, kind: 'narrow', baseCost: 2400 },
      { id: 's3b', name: '본류 협곡', x: 46, y: 42, flow: 'E', baseHeight: 2.8, kind: 'wide', baseCost: 3400 },
      { id: 's3c', name: '지류 바위목', x: 52, y: 18, flow: 'S', baseHeight: 2.6, kind: 'narrow', baseCost: 2600 },
      { id: 's3d', name: '합수목', x: 89, y: 41, flow: 'E', baseHeight: 2.6, kind: 'narrow', baseCost: 3800 },
    ],
    towns: [
      {
        id: 't3a',
        name: '합수 읍내',
        x: 112,
        y: 50,
        w: 20,
        h: 9,
        riverSide: 'N',
        gaugeX: 100,
        demandPerDay: 18,
        elevation: 0.27,
      },
      {
        id: 't3b',
        name: '서쪽 외딴말',
        x: 12,
        y: 36,
        w: 10,
        h: 6,
        riverSide: 'S',
        gaugeX: 8,
        demandPerDay: 6,
        elevation: 0.15,
      },
    ],
    startFunds: 13000,
    targetFunds: 42000,
    rainMult: [1.0, 1.3],
    inflowVariance: 0.25,
  },
];

export function getStage(id: number): StageDef {
  const s = STAGES.find((st) => st.id === id);
  if (!s) throw new Error(`unknown stage ${id}`);
  return s;
}
