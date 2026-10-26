import { WEATHER } from '../data/balance';
import type { StageDef } from '../data/stages';
import { dayIndexToDate, weatherSeason, type WeatherSeason } from './calendar';
import { Rng } from './rng';

/** 하루치 날씨. 예보 UI·태풍·가뭄 이벤트는 이 스케줄을 보여주거나 고쳐 쓰면 된다. */
export interface WeatherDay {
  dayIndex: number;
  season: WeatherSeason;
  /** 강수 세기 (0이면 맑음) */
  rain: number;
  /** 강별 유역 강수 세기 (지류에 국지성 비) */
  riverRain: number[];
  /** 강별 기저 유량 편차 배수 */
  baseMult: number[];
  /** 2차 확장용 이벤트 태그 (typhoon, drought 등) */
  event?: string;
}

export interface WeatherState {
  rngState: number;
  schedule: WeatherDay[];
  wetYesterday: boolean;
  /** 강별 유역 응답(지수이동평균) */
  catchment: number[];
  /** 강별 기저유량 편차 AR(1) */
  baseNoise: number[];
}

export class Weather {
  state: WeatherState;
  private stage: StageDef;
  private rng: Rng;

  constructor(stage: StageDef, seed: number, state?: WeatherState) {
    this.stage = stage;
    if (state) {
      this.state = structuredClone(state);
    } else {
      this.state = {
        rngState: new Rng(seed ^ 0x5eed).state,
        schedule: [],
        wetYesterday: false,
        catchment: stage.rivers.map(() => 0),
        baseNoise: stage.rivers.map(() => 0),
      };
    }
    this.rng = new Rng(0);
    this.rng.state = this.state.rngState;
    this.ensure(0);
  }

  /** dayIndex부터 FORECAST_DAYS일까지 스케줄을 채운다 */
  ensure(dayIndex: number): void {
    const sch = this.state.schedule;
    while (sch.length && sch[0].dayIndex < dayIndex) sch.shift();
    let next = sch.length ? sch[sch.length - 1].dayIndex + 1 : dayIndex;
    while (next < dayIndex + WEATHER.FORECAST_DAYS) {
      sch.push(this.generateDay(next));
      next++;
    }
    this.state.rngState = this.rng.state;
  }

  private generateDay(dayIndex: number): WeatherDay {
    const rng = this.rng;
    const date = dayIndexToDate(dayIndex);
    const season = weatherSeason(date);
    const p = WEATHER.SEASONS[season];
    const wet = rng.next() < (this.state.wetYesterday ? p.pStay : p.pStart);
    this.state.wetYesterday = wet;
    let rain = 0;
    if (wet) {
      const mult = season === 'monsoon' ? this.stage.rainMult[1] : this.stage.rainMult[0];
      let k = 0.3 + rng.next() * 1.4;
      if (rng.next() < 0.12) k *= 2.2; // 가끔 큰 비
      rain = p.intensity * mult * k;
    }
    const riverRain: number[] = [];
    const baseMult: number[] = [];
    const v = this.stage.inflowVariance;
    this.stage.rivers.forEach((_, ri) => {
      // 지류는 국지성 비로 본류와 다르게 움직인다
      const local = ri === 0 ? 1 : 0.5 + rng.next() * 1.1;
      riverRain.push(rain * local);
      const bn = this.state.baseNoise[ri] * 0.85 + rng.normalish() * v * 0.5;
      this.state.baseNoise[ri] = Math.max(-0.8, Math.min(0.8, bn));
      baseMult.push(1 + this.state.baseNoise[ri]);
    });
    return { dayIndex, season, rain, riverRain, baseMult };
  }

  today(dayIndex: number): WeatherDay {
    const sch = this.state.schedule;
    if (!sch.length || sch[0].dayIndex !== dayIndex) this.ensure(dayIndex);
    return this.state.schedule[0];
  }

  /** 틱마다 호출: 셀당 강수량과 강별 유입량을 돌려준다 */
  tick(tick: number, ticksPerDay: number): { rainPerCell: number; inflow: number[]; evap: number; day: WeatherDay } {
    const dayIndex = Math.floor(tick / ticksPerDay);
    const day = this.today(dayIndex);
    const inflow: number[] = [];
    this.stage.rivers.forEach((r, ri) => {
      const tau = r.catchmentTau ?? WEATHER.CATCHMENT_TAU;
      const c = this.state.catchment[ri] + (day.riverRain[ri] - this.state.catchment[ri]) / tau;
      this.state.catchment[ri] = c;
      const base = WEATHER.BASE_INFLOW[day.season] * day.baseMult[ri];
      inflow.push((base + WEATHER.CATCHMENT_GAIN * c) * r.inflowMult);
    });
    const dry = day.season === 'winter';
    return {
      rainPerCell: day.rain * WEATHER.RAIN_PER_INTENSITY,
      inflow,
      evap: day.rain > 0 ? 0 : dry ? WEATHER.EVAPORATION_DRY : WEATHER.EVAPORATION_OTHER,
      day,
    };
  }
}
