import { MONTH_DAYS, TIME, WEATHER } from '../data/balance';

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';
/** 강수 패턴용 세부 계절 (장마 포함) */
export type WeatherSeason = Season | 'monsoon';

export interface GameDate {
  year: number; // 1부터
  month: number; // 1~12
  day: number; // 1부터
  hour: number;
  /** 스테이지 시작부터 지난 일수 */
  dayIndex: number;
  /** 1월 1일 = 0 */
  dayOfYear: number;
}

const MONTH_START: number[] = [];
{
  let acc = 0;
  for (const d of MONTH_DAYS) {
    MONTH_START.push(acc);
    acc += d;
  }
}

export function startDayOfYear(): number {
  return MONTH_START[TIME.START_MONTH - 1];
}

export function dayIndexToDate(dayIndex: number, hour = 0): GameDate {
  const absolute = startDayOfYear() + dayIndex;
  const yearOffset = Math.floor(absolute / TIME.DAYS_PER_YEAR);
  const doy = absolute - yearOffset * TIME.DAYS_PER_YEAR;
  let month = 12;
  for (let m = 0; m < 12; m++) {
    if (doy < MONTH_START[m] + MONTH_DAYS[m]) {
      month = m + 1;
      break;
    }
  }
  return {
    year: yearOffset + 1,
    month,
    day: doy - MONTH_START[month - 1] + 1,
    hour,
    dayIndex,
    dayOfYear: doy,
  };
}

export function tickToDate(tick: number): GameDate {
  const dayIndex = Math.floor(tick / TIME.TICKS_PER_DAY);
  return dayIndexToDate(dayIndex, tick - dayIndex * TIME.TICKS_PER_DAY);
}

export function seasonOfMonth(month: number): Season {
  if (month >= 3 && month <= 5) return 'spring';
  if (month >= 6 && month <= 8) return 'summer';
  if (month >= 9 && month <= 11) return 'autumn';
  return 'winter';
}

export function weatherSeason(date: GameDate): WeatherSeason {
  if (date.dayOfYear >= WEATHER.MONSOON_START_DOY && date.dayOfYear <= WEATHER.MONSOON_END_DOY) return 'monsoon';
  return seasonOfMonth(date.month);
}

export const SEASON_NAMES: Record<Season, string> = {
  spring: '봄',
  summer: '여름',
  autumn: '가을',
  winter: '겨울',
};

export function formatDate(d: GameDate): string {
  return `${d.year}년차 ${d.month}월 ${d.day}일`;
}
