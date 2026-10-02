// Map overlay categories and colors. Colors follow mikh-abc/ff-game-map's DataDefines.cpp where it defines them.

export interface OverlayItem {
  /** Visibility key, e.g. "mineral:iron". */
  key: string;
  label: string;
  color: string;
}

export interface OverlayGroup {
  id: string;
  label: string;
  items: OverlayItem[];
}

export const OVERLAY_GROUPS: OverlayGroup[] = [
  {
    id: 'minerals',
    label: 'Minerals',
    items: [
      { key: 'mineral:clay', label: 'Clay', color: '#9a3b2b' },
      { key: 'mineral:sand', label: 'Sand', color: '#e8d27a' },
      { key: 'mineral:stone', label: 'Stone', color: '#c8c8c8' },
      { key: 'mineral:iron', label: 'Iron', color: '#8c8c8c' },
      { key: 'mineral:gold', label: 'Gold', color: '#d4a017' },
      { key: 'mineral:coal', label: 'Coal', color: '#3a3a3a' },
    ],
  },
  {
    id: 'forage',
    label: 'Forageables',
    items: [
      { key: 'forage:greens', label: 'Greens', color: '#5ac85a' },
      { key: 'forage:herbs', label: 'Herbs', color: '#8b008b' },
      { key: 'forage:roots', label: 'Roots', color: '#808000' },
      { key: 'forage:willow', label: 'Willow', color: '#e6c800' },
      { key: 'forage:berries', label: 'Berries', color: '#dc2626' },
      { key: 'forage:nuts', label: 'Nuts', color: '#8b5a2b' },
      { key: 'forage:mushrooms', label: 'Mushrooms', color: '#c47f5b' },
      { key: 'forage:eggs', label: 'Eggs', color: '#f0dca0' },
      { key: 'forage:fruitTrees', label: 'Fruit trees', color: '#f97316' },
    ],
  },
  {
    id: 'spawns',
    label: 'Animal spawns',
    items: [
      { key: 'spawn:deer', label: 'Deer', color: '#00c000' },
      { key: 'spawn:boar', label: 'Boar', color: '#ffd800' },
      { key: 'spawn:wolf', label: 'Wolf', color: '#ff4040' },
      { key: 'spawn:bear', label: 'Bear', color: '#c040ff' },
    ],
  },
  {
    id: 'enemies',
    label: 'Enemies',
    items: [
      { key: 'enemy:wolfDen', label: 'Wolf dens', color: '#7f1d1d' },
      { key: 'enemy:raiderCamp', label: 'Raider camps', color: '#b91c1c' },
      { key: 'enemy:raider', label: 'Raiders', color: '#dc2626' },
      { key: 'enemy:batteringRam', label: 'Battering rams', color: '#991b1b' },
      { key: 'enemy:raiderTower', label: 'Raider guard towers', color: '#450a0a' },
    ],
  },
  {
    id: 'ruins',
    label: 'Ruins',
    items: [
      { key: 'ruin:relic', label: 'Relic sites', color: '#daa520' },
      { key: 'ruin:salvage', label: 'Salvage sites', color: '#c9b458' },
    ],
  },
];

export const OVERLAY_COLOR: Record<string, string> = Object.fromEntries(
  OVERLAY_GROUPS.flatMap((g) => g.items.map((i) => [i.key, i.color])),
);
export const OVERLAY_LABEL: Record<string, string> = Object.fromEntries(
  OVERLAY_GROUPS.flatMap((g) => g.items.map((i) => [i.key, i.label])),
);
export const ALL_OVERLAY_KEYS = OVERLAY_GROUPS.flatMap((g) => g.items.map((i) => i.key));
