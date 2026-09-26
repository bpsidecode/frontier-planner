import { getType } from '../data/buildings';
import { HOUSE_LEVELS, type HouseLevel } from '../data/houses';
import { center, type Placed } from './plan';
import { pointDesirability } from './desirability';

// Guards against float error putting e.g. 0.3 * 100 just under a threshold.
const EPS = 1e-6;

export function houseLevel(pct: number): HouseLevel {
  for (let i = HOUSE_LEVELS.length - 1; i > 0; i--)
    if (pct + EPS >= HOUSE_LEVELS[i].minPct) return HOUSE_LEVELS[i];
  return HOUSE_LEVELS[0];
}

export function nextLevel(level: HouseLevel): HouseLevel | undefined {
  return HOUSE_LEVELS[level.level];
}

export interface HouseInfo {
  building: Placed;
  pct: number;
  level: HouseLevel;
}

export function evaluateHouses(buildings: Placed[]): HouseInfo[] {
  return buildings
    .filter((b) => getType(b.typeId).house)
    .map((b) => {
      const { cx, cy } = center(b);
      const pct = pointDesirability(buildings, cx, cy) * 100;
      return { building: b, pct, level: houseLevel(pct) };
    });
}

export interface PopulationSummary {
  total: number;
  houses: number;
  byLevel: { level: HouseLevel; count: number; residents: number }[];
}

export function summarize(houses: HouseInfo[]): PopulationSummary {
  const byLevel = HOUSE_LEVELS.map((level) => {
    const count = houses.filter((h) => h.level === level).length;
    return { level, count, residents: count * level.residents };
  });
  return {
    total: byLevel.reduce((s, l) => s + l.residents, 0),
    houses: houses.length,
    byLevel,
  };
}
