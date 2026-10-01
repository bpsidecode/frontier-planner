// Imported game map: terrain classification, layers and resource markers, all in tile coordinates.

import { canonicalTypeId } from '../data/buildings';

/** Heights below this (meters) are water. Calibrated on a v1.1.2 save: every cell below ~3 m has zero fertility and shoreline. */
export const WATER_BELOW_M = 3;
/** A rise steeper than this (meters per 5 m tile, to any neighbor) counts as unbuildable slope. Existing towns top out around 3.5. */
export const STEEP_M_PER_TILE = 4;

export enum Terrain {
  Land = 0,
  Water = 1,
  Steep = 2,
}

export type MineralKind = 'clay' | 'sand' | 'stone' | 'iron' | 'gold' | 'coal';
export type ForageKind = 'greens' | 'herbs' | 'roots' | 'willow' | 'berries' | 'nuts' | 'mushrooms' | 'eggs';
export type AnimalKind = 'deer' | 'boar' | 'wolf' | 'bear';
export type EnemyKind = 'raiderCamp' | 'raider' | 'batteringRam' | 'wolfDen';
export type RuinKind = 'relic' | 'salvage';

/** Positions are tile coordinates (floats); (0, 0) is the top-left corner of the grid. */
export interface Mineral {
  kind: MineralKind;
  x: number;
  y: number;
  /** Radius in tiles. */
  r: number;
  amount: number;
  deep: boolean;
}
export interface Point<K extends string> {
  kind: K;
  x: number;
  y: number;
}
/** Axis-aligned square, top-left corner and side length in tiles. */
export interface SpawnArea {
  kind: AnimalKind;
  x: number;
  y: number;
  size: number;
  /** A den (a point the animals spawn from) rather than a 64 m spawn area. Boars spawn from dens. */
  den?: boolean;
}
export interface FertilityBonus {
  x: number;
  y: number;
  r: number;
}
/** A player building from the save. */
export interface SaveBuilding {
  /** Planner catalog id, e.g. "town-center". */
  typeId: string;
  /** Center in tile coordinates. */
  x: number;
  y: number;
  /** Game rotation in quarter turns (0–3). */
  rot: number;
  /** The game's prefab id for this building, which identifies its exact variant (tier). */
  prefab?: string;
}

export interface MapData {
  name: string;
  version: string;
  /** Tiles per side. */
  size: number;
  /** Row-major size×size layers. */
  terrain: Uint8Array;
  /** Ground height in meters, row-major. Missing on maps stored before heights were kept. */
  heights?: Float32Array;
  /** Hillshade, 0–255 (128 = flat). */
  shade: Uint8Array;
  /** 0–255 = 0–100%. */
  fertility: Uint8Array;
  fodder: Uint8Array;
  water: Uint8Array;
  minerals: Mineral[];
  forageables: Point<ForageKind>[];
  spawns: SpawnArea[];
  enemies: Point<EnemyKind>[];
  ruins: Point<RuinKind>[];
  fertilityBonus: FertilityBonus[];
  buildings: SaveBuilding[];
  /** Save objects the importer doesn't handle yet, by label (e.g. "Crop fields": 11). */
  notImported: Record<string, number>;
  /** Building class names that have a standard building header but no catalog mapping. */
  unknownBuildingClasses: Record<string, number>;
}

export type LayerView = 'fertility' | 'fodder' | 'water';

/** Classify tiles from a row-major height grid (meters), `width` wide. Water wins over steep. */
export function classifyTerrain(heights: Float32Array, width: number, rows = width): Uint8Array {
  const size = width;
  const out = new Uint8Array(width * rows);
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < width; x++) {
      const i = y * size + x;
      const h = heights[i];
      if (h < WATER_BELOW_M) {
        out[i] = Terrain.Water;
        continue;
      }
      let rise = 0;
      if (x > 0) rise = Math.max(rise, Math.abs(heights[i - 1] - h));
      if (x < size - 1) rise = Math.max(rise, Math.abs(heights[i + 1] - h));
      if (y > 0) rise = Math.max(rise, Math.abs(heights[i - size] - h));
      if (y < rows - 1) rise = Math.max(rise, Math.abs(heights[i + size] - h));
      if (rise > STEEP_M_PER_TILE) out[i] = Terrain.Steep;
    }
  return out;
}

/** Simple hillshade lit from the north-west. */
export function hillshade(heights: Float32Array, size: number, tileM = 5): Uint8Array {
  const out = new Uint8Array(size * size);
  const at = (x: number, y: number) =>
    heights[Math.min(size - 1, Math.max(0, y)) * size + Math.min(size - 1, Math.max(0, x))];
  const [lx, ly, lz] = normalize(-1, -1, 1.4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const dzdx = (at(x + 1, y) - at(x - 1, y)) / (2 * tileM);
      const dzdy = (at(x, y + 1) - at(x, y - 1)) / (2 * tileM);
      const [nx, ny, nz] = normalize(-dzdx, -dzdy, 1);
      const flat = lz; // brightness of level ground
      const lit = nx * lx + ny * ly + nz * lz;
      out[y * size + x] = Math.max(0, Math.min(255, Math.round(128 + (lit - flat) * 220)));
    }
  return out;
}

function normalize(x: number, y: number, z: number): [number, number, number] {
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
}

/** Tiles where planner buildings can't go. */
export function blockedMask(map: MapData): Uint8Array {
  return map.terrain.map((t) => (t === Terrain.Land ? 0 : 1));
}

// ---------- serialization (localStorage / plan export) ----------

const LAYERS = ['terrain', 'shade', 'fertility', 'fodder', 'water'] as const;

export function serializeMap(map: MapData): object {
  const out: Record<string, unknown> = { ...map };
  for (const k of LAYERS) out[k] = toBase64(map[k]);
  if (map.heights) out.heights = toBase64(new Uint8Array(encodeHeights(map.heights).buffer));
  return out;
}

export function deserializeMap(raw: unknown): MapData | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const size = Number(o.size);
  if (!Number.isInteger(size) || size < 2 || size > 2048) return null;
  const map = { ...o, size } as unknown as MapData;
  for (const k of LAYERS) {
    const bytes = typeof o[k] === 'string' ? fromBase64(o[k] as string) : null;
    if (!bytes || bytes.length !== size * size) return null;
    (map as unknown as Record<string, Uint8Array>)[k] = bytes;
  }
  const hb = typeof o.heights === 'string' ? fromBase64(o.heights) : null;
  if (hb && hb.length === size * size * 2) map.heights = decodeHeights(new Uint16Array(hb.buffer));
  else delete map.heights;
  for (const k of ['minerals', 'forageables', 'spawns', 'enemies', 'ruins', 'fertilityBonus', 'buildings'] as const)
    if (!Array.isArray(map[k])) (map as unknown as Record<string, unknown[]>)[k] = [];
  // Maps saved before all buildings were imported stored { kind: 'townCenter' | 'shelter', x, y }.
  const legacy: Record<string, string> = { townCenter: 'town-center', shelter: 'house' };
  map.buildings = map.buildings
    .map((b) => {
      const o = b as unknown as Record<string, unknown>;
      return { typeId: canonicalTypeId(String(o.typeId ?? legacy[String(o.kind)] ?? '')), x: Number(o.x), y: Number(o.y), rot: Number(o.rot ?? 0) };
    })
    .filter((b) => b.typeId);
  if (!map.notImported || typeof map.notImported !== 'object') map.notImported = {};
  if (!map.unknownBuildingClasses || typeof map.unknownBuildingClasses !== 'object') map.unknownBuildingClasses = {};
  return map;
}

// Heights are stored as whole centimeters above −100 m in 16 bits (−100 m to 555 m), half the size
// of float32. Maps seen so far span about −9 m to 180 m.
const HEIGHT_OFFSET_M = 100;

function encodeHeights(h: Float32Array): Uint16Array {
  return Uint16Array.from(h, (v) => Math.max(0, Math.min(65535, Math.round((v + HEIGHT_OFFSET_M) * 100))));
}

function decodeHeights(q: Uint16Array): Float32Array {
  return Float32Array.from(q, (v) => v / 100 - HEIGHT_OFFSET_M);
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(s: string): Uint8Array | null {
  try {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}
