// Terrain flattening, as the game does it: every tile in the chosen rectangle is set to the area's
// average height, so some ground is raised and some lowered. Tiles just outside can become steeper.

import type { Rect } from './plan';
import { Terrain, classifyTerrain, hillshade, type MapData } from './terrain';

/** Square meters per tile, for earthwork volumes. */
const TILE_AREA_M2 = 25;

/** The terrain after the plan's flattened areas are applied in order. */
export interface Ground {
  /** Row-major heights in meters, or null for maps imported before heights were kept. */
  heights: Float32Array | null;
  terrain: Uint8Array;
  shade: Uint8Array;
  /** 1 where nothing may be built (water or steep ground). */
  blocked: Uint8Array;
}

export interface FlattenPreview {
  /** The height every tile in the area ends up at, in meters. */
  target: number;
  /** Earth removed from tiles above the target and added to tiles below it, in cubic meters. */
  cutM3: number;
  fillM3: number;
  /** Largest change on one tile, in meters. */
  maxRaise: number;
  maxLower: number;
  /** Tiles (inside the area or around it) that become buildable or unbuildable. */
  freed: number;
  newlySteep: number;
  /** Why the area can't be flattened, if it can't. */
  problem?: string;
}

export function blockedFrom(terrain: Uint8Array): Uint8Array {
  return terrain.map((t) => (t === Terrain.Land ? 0 : 1));
}

/** Apply flattened areas in order; later areas average the already-flattened ground. */
export function applyFlattens(base: Float32Array, size: number, areas: readonly Rect[]): Float32Array {
  const h = base.slice();
  for (const r of areas) flattenInPlace(h, size, r);
  return h;
}

function flattenInPlace(h: Float32Array, size: number, r: Rect) {
  const target = averageHeight(h, size, r);
  for (let y = r.y; y < r.y + r.h; y++) h.fill(target, y * size + r.x, y * size + r.x + r.w);
}

export function averageHeight(h: Float32Array, size: number, r: Rect): number {
  let sum = 0;
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) sum += h[y * size + x];
  return sum / (r.w * r.h);
}

/** The map's ground with the given flattened areas. Maps without heights can't be flattened. */
export function groundFor(map: MapData, areas: readonly Rect[]): Ground {
  if (!map.heights || !areas.length)
    return { heights: map.heights ?? null, terrain: map.terrain, shade: map.shade, blocked: blockedFrom(map.terrain) };
  const heights = applyFlattens(map.heights, map.size, areas);
  const terrain = classifyTerrain(heights, map.size);
  return { heights, terrain, shade: hillshade(heights, map.size), blocked: blockedFrom(terrain) };
}

/** Why an area can't be flattened, or undefined when it can. Water can't be flattened. */
export function flattenProblem(ground: Ground, size: number, r: Rect): string | undefined {
  if (!ground.heights) return 'this map was imported before heights were kept; import the save again';
  if (r.x < 0 || r.y < 0 || r.x + r.w > size || r.y + r.h > size) return 'it goes past the edge of the map';
  if (r.w * r.h < 2) return 'drag over at least two tiles';
  for (let y = r.y; y < r.y + r.h; y++)
    for (let x = r.x; x < r.x + r.w; x++) if (ground.terrain[y * size + x] === Terrain.Water) return 'it includes water';
  return undefined;
}

/** What flattening `r` on the current ground would do. */
export function previewFlatten(ground: Ground, size: number, r: Rect): FlattenPreview {
  const problem = flattenProblem(ground, size, r);
  const empty = { target: 0, cutM3: 0, fillM3: 0, maxRaise: 0, maxLower: 0, freed: 0, newlySteep: 0 };
  if (problem || !ground.heights) return { ...empty, problem };
  const h = ground.heights;
  const target = averageHeight(h, size, r);
  const out: FlattenPreview = { ...empty, target };
  for (let y = r.y; y < r.y + r.h; y++)
    for (let x = r.x; x < r.x + r.w; x++) {
      const d = target - h[y * size + x];
      if (d > 0) {
        out.fillM3 += d * TILE_AREA_M2;
        out.maxRaise = Math.max(out.maxRaise, d);
      } else {
        out.cutM3 -= d * TILE_AREA_M2;
        out.maxLower = Math.max(out.maxLower, -d);
      }
    }
  // Only the area and its one-tile border can change class; classify that window before and after.
  const x0 = Math.max(0, r.x - 2);
  const y0 = Math.max(0, r.y - 2);
  const x1 = Math.min(size, r.x + r.w + 2);
  const y1 = Math.min(size, r.y + r.h + 2);
  const w = x1 - x0;
  const win = new Float32Array(w * (y1 - y0));
  for (let y = y0; y < y1; y++) win.set(h.subarray(y * size + x0, y * size + x1), (y - y0) * w);
  const before = classifyTerrain(win, w, y1 - y0);
  flattenInPlace(win, w, { x: r.x - x0, y: r.y - y0, w: r.w, h: r.h });
  const after = classifyTerrain(win, w, y1 - y0);
  // The window's outer ring lacks its outside neighbors, so skip it except where it's the map edge.
  const rows = y1 - y0;
  for (let y = y0 > 0 ? 1 : 0; y < (y1 < size ? rows - 1 : rows); y++)
    for (let x = x0 > 0 ? 1 : 0; x < (x1 < size ? w - 1 : w); x++) {
      const i = y * w + x;
      if (before[i] === Terrain.Steep && after[i] === Terrain.Land) out.freed++;
      else if (before[i] === Terrain.Land && after[i] === Terrain.Steep) out.newlySteep++;
    }
  return out;
}
