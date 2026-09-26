// House levels by desirability. Thresholds for levels 2–4 and residents come from
// https://farthestfrontier.wiki/wiki/Shelter; the Estate level is a custom addition.

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
  { level: 3, name: 'Large House', minPct: 65, residents: 6, color: '#2563eb' },
  { level: 4, name: 'Manor', minPct: 85, residents: 8, color: '#7c3aed' },
  { level: 5, name: 'Estate', minPct: 100, residents: 10, color: '#be185d' },
];
