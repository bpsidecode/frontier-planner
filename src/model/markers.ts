import type { MapData } from './terrain';

const SINGULAR: Record<string, string> = {
  'mineral:clay': 'Clay deposit',
  'mineral:sand': 'Sand deposit',
  'mineral:stone': 'Stone deposit',
  'mineral:iron': 'Iron deposit',
  'mineral:gold': 'Gold deposit',
  'mineral:coal': 'Coal deposit',
  'forage:greens': 'Greens',
  'forage:herbs': 'Herbs',
  'forage:roots': 'Roots',
  'forage:willow': 'Willow',
  'spawn:deer': 'Deer spawn area',
  'spawn:boar': 'Boar spawn area',
  'spawn:wolf': 'Wolf spawn area',
  'spawn:bear': 'Bear spawn area',
  'enemy:wolfDen': 'Wolf den',
  'enemy:raiderCamp': 'Raider camp',
  'enemy:raider': 'Raider',
  'enemy:batteringRam': 'Battering ram',
  'ruin:relic': 'Relic site',
  'ruin:salvage': 'Salvage site',
};

export function formatAmount(n: number): string {
  return n >= 10000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

/** Descriptions of visible map markers at tile point (x, y), nearest-first within each kind. */
export function markersAt(map: MapData, visible: Set<string>, x: number, y: number): string[] {
  const out: string[] = [];
  const near = (px: number, py: number, r: number) => Math.hypot(px - x, py - y) <= r;
  for (const m of map.minerals) {
    const key = `mineral:${m.kind}`;
    if (visible.has(key) && near(m.x, m.y, Math.max(m.r, 1)))
      out.push(`${SINGULAR[key]} · ${m.deep ? 'unlimited' : formatAmount(m.amount)}`);
  }
  for (const e of map.enemies) {
    const key = `enemy:${e.kind}`;
    if (visible.has(key) && near(e.x, e.y, 1.5)) out.push(SINGULAR[key]);
  }
  for (const r of map.ruins) {
    const key = `ruin:${r.kind}`;
    if (visible.has(key) && near(r.x, r.y, 2)) out.push(SINGULAR[key]);
  }
  const forage = new Set<string>();
  for (const f of map.forageables) {
    const key = `forage:${f.kind}`;
    if (visible.has(key) && near(f.x, f.y, 1)) forage.add(SINGULAR[key]);
  }
  out.push(...forage);
  for (const s of map.spawns) {
    const key = `spawn:${s.kind}`;
    if (visible.has(key) && x >= s.x && x < s.x + s.size && y >= s.y && y < s.y + s.size)
      out.push(s.den ? SINGULAR[key].replace('spawn area', 'den') : SINGULAR[key]);
  }
  return out;
}
