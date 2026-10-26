import { Color } from 'three';
import type { Season } from '../sim/calendar';

/** 계절별 풀·나무·농지 색 */
export const SEASON_COLORS: Record<Season, { grass: string; grassHigh: string; tree: string; field: string; snow: number }> = {
  spring: { grass: '#9ed46a', grassHigh: '#7fbf55', tree: '#6cbb4c', field: '#c3e48a', snow: 0 },
  summer: { grass: '#5ea544', grassHigh: '#4b8e38', tree: '#3d7f30', field: '#78b84a', snow: 0 },
  autumn: { grass: '#c9a24e', grassHigh: '#b88a3e', tree: '#e0782e', field: '#e2b84f', snow: 0 },
  winter: { grass: '#a38d6c', grassHigh: '#b7aa98', tree: '#8a7258', field: '#9b8160', snow: 0.75 },
};

export const COLORS = {
  sand: new Color('#d3bf8f'),
  gravel: new Color('#b9a57c'),
  rock: new Color('#9a8064'),
  soil: [new Color('#a8764a'), new Color('#c29462'), new Color('#93633f'), new Color('#b98656')],
  road: new Color('#dccb9f'),
  plaza: new Color('#c2c48c'),
  snow: new Color('#f4f3ef'),
  table: '#a7784e',
  background: '#efe3cf',
  waterShallow: new Color('#5fd0d0'),
  waterDeep: new Color('#13668a'),
  damEarth: '#9a7146',
  damStone: '#a3a197',
  damConcrete: '#dcd8cf',
  rubble: '#7d6f60',
  houseWalls: ['#f6ead2', '#f2dcc0', '#efe6dc', '#f8f1e2', '#e8d9c4'],
  houseRoofs: ['#d35d47', '#4f7fb5', '#e58f3c', '#7b9f4a', '#b5524f', '#5d6aa3'],
  trunk: '#7a5636',
  flag: '#e2513c',
};
