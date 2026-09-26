import { getType, type BuildingType } from '../data/buildings';
import { GRID, TILE_M, center, type Placed } from './plan';

/**
 * Effect of one source at point (px, py), in tile coordinates.
 * Linear falloff from full value at the center to half value at max range, 0 beyond.
 */
export function effectAt(src: Placed, px: number, py: number): number {
  const d = getType(src.typeId).desirability;
  if (!d) return 0;
  const { cx, cy } = center(src);
  const dist = Math.hypot(px - cx, py - cy) * TILE_M;
  if (dist > d.rangeM) return 0;
  return d.constant ? d.value : d.value * (1 - (0.5 * dist) / d.rangeM);
}

export interface Contribution {
  building: Placed;
  type: BuildingType;
  effect: number;
  /** False when a stronger source with the same tag wins at this point. */
  counted: boolean;
}

/** Every source affecting point (px, py), strongest first. */
export function breakdown(buildings: Placed[], px: number, py: number): Contribution[] {
  const out: Contribution[] = [];
  const bestByTag = new Map<string, Contribution>();
  for (const b of buildings) {
    const effect = effectAt(b, px, py);
    if (effect === 0) continue;
    const type = getType(b.typeId);
    const c: Contribution = { building: b, type, effect, counted: true };
    out.push(c);
    const tag = type.desirability!.tag;
    if (!tag) continue;
    const best = bestByTag.get(tag);
    if (!best || Math.abs(effect) > Math.abs(best.effect)) {
      if (best) best.counted = false;
      bestByTag.set(tag, c);
    } else {
      c.counted = false;
    }
  }
  return out.sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect));
}

/** Total desirability (as a fraction) at point (px, py). */
export function pointDesirability(buildings: Placed[], px: number, py: number): number {
  return breakdown(buildings, px, py).reduce((s, c) => (c.counted ? s + c.effect : s), 0);
}

/** Desirability at the center of every tile, row-major GRID×GRID, as fractions. */
export function computeField(buildings: Placed[]): Float32Array {
  const field = new Float32Array(GRID * GRID);
  const byTag = new Map<string, Placed[]>();

  for (const b of buildings) {
    const d = getType(b.typeId).desirability;
    if (!d) continue;
    if (d.tag) {
      const list = byTag.get(d.tag) ?? [];
      list.push(b);
      byTag.set(d.tag, list);
    } else {
      forEachInRange(b, (i, e) => {
        field[i] += e;
      });
    }
  }

  const best = new Float32Array(GRID * GRID);
  for (const list of byTag.values()) {
    best.fill(0);
    for (const b of list)
      forEachInRange(b, (i, e) => {
        if (Math.abs(e) > Math.abs(best[i])) best[i] = e;
      });
    for (let i = 0; i < best.length; i++) field[i] += best[i];
  }
  return field;
}

function forEachInRange(src: Placed, fn: (index: number, effect: number) => void) {
  const d = getType(src.typeId).desirability!;
  const { cx, cy } = center(src);
  const r = d.rangeM / TILE_M;
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(GRID - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(GRID - 1, Math.ceil(cy + r));
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const e = effectAt(src, x + 0.5, y + 0.5);
      if (e !== 0) fn(y * GRID + x, e);
    }
}
