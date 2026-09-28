// House levels by desirability. Thresholds (30/60/80/100%) are confirmed in-game for v1.1; residents
// for levels 1–4 come from https://farthestfrontier.wiki/wiki/Shelter. The Estate level was added on request.

export interface HouseLevel {
  level: number;
  name: string;
  /** Minimum desirability, in percent, needed to reach this level. */
  minPct: number;
  residents: number;
  color: string;
}

export const HOUSE_LEVELS: HouseLevel[] = [
  { level: 1, name: 'Shelter', minPct: -Infinity, residents: 4, color: '#78716c' },
  { level: 2, name: 'Homestead', minPct: 30, residents: 5, color: '#d97706' },
  { level: 3, name: 'Large House', minPct: 60, residents: 6, color: '#2563eb' },
  { level: 4, name: 'Manor', minPct: 80, residents: 8, color: '#7c3aed' },
  { level: 5, name: 'Estate', minPct: 100, residents: 10, color: '#be185d' },
];
