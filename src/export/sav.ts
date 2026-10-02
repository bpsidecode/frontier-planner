// Write planner changes back into a copy of the original .sav. Supported: moves and rotations of
// buildings imported from that save, each a fixed-size patch inside the building's own record
// (header position and rotation, plus the occupied-tile block), which in-game tests showed is all
// the game needs; and moves of crop fields and pastures, which shift every coordinate in the
// record (header, tile list, crop plants) plus the copies herds keep of their pasture. Everything
// else is reported as not written.

import { BUILDING_BY_ID, getType } from '../data/buildings';
import { TILE_M, footprint, type Placed, type Rect } from '../model/plan';
import type { MapData } from '../model/terrain';

export interface SaveEdit {
  /** A building (header and tile block) or a crop field or pasture (the whole record shifted). */
  kind: 'building' | 'area';
  /** Index into `MapData.buildings`. */
  i: number;
  typeId: string;
  /** The building's footprint and rotation in the plan now. */
  rect: Rect;
  rot: number;
  /** Whether its rotation changed (otherwise the save's own quaternion, with its slope tilt, is kept). */
  rotated: boolean;
}

export interface SaveExport {
  edits: SaveEdit[];
  /** Plan changes that can't be written back yet, as labels with counts. */
  notWritten: Record<string, number>;
  /** The map or plan predates save links, so nothing can be written until the save is imported again. */
  needsReimport: boolean;
}

export class SaveMismatchError extends Error {}

/** Objects imported from records the exporter can't patch yet. */
const AREA_LABELS: Record<string, string> = {
  'crop-field': 'Crop fields imported before moves could be written (import the save again)',
  pasture: 'Pastures imported before moves could be written (import the save again)',
  graveyard: 'Moved or resized graveyards',
  bridge: 'Moved bridge tiles',
};
const RESIZED_LABELS: Record<string, string> = { 'crop-field': 'Resized crop fields', pasture: 'Resized pastures' };

/** Compare the plan with the save it was imported from. */
export function planSaveExport(plan: { buildings: Placed[]; flattened: Rect[] }, map: MapData): SaveExport {
  const out: SaveExport = { edits: [], notWritten: {}, needsReimport: false };
  const bump = (k: string, n = 1) => (out.notWritten[k] = (out.notWritten[k] ?? 0) + n);
  const placedFromSave = map.buildings.filter((b) => BUILDING_BY_ID[b.typeId] && !b.skipped);
  if (placedFromSave.some((b) => b.typeId !== 'road') && !map.buildings.some((b) => b.rec)) {
    out.needsReimport = true;
    return out;
  }

  const seen = new Set<number>();
  for (const b of plan.buildings) {
    const road = b.typeId === 'road';
    if (!b.src) {
      bump(road ? 'Added road tiles' : 'Added buildings');
      continue;
    }
    const s = b.src;
    const from = map.buildings[s.i];
    if (!from || seen.has(s.i)) {
      bump('Buildings with no matching save record');
      continue;
    }
    seen.add(s.i);
    const moved = b.x !== s.x || b.y !== s.y || b.rot !== s.rot || b.w !== s.w || b.h !== s.h;
    if (b.typeId !== s.typeId) bump('Upgraded or downgraded buildings');
    else if (!moved) continue;
    else if (road) bump('Moved road tiles');
    else if (from.area && RESIZED_LABELS[b.typeId]) {
      // A turned field is a resize too: its width and height swap.
      if (b.w !== s.w || b.h !== s.h || b.rot !== s.rot) bump(RESIZED_LABELS[b.typeId]);
      else out.edits.push({ kind: 'area', i: s.i, typeId: b.typeId, rect: footprint(b), rot: b.rot, rotated: false });
    } else if (!from.rec) bump(AREA_LABELS[b.typeId] ?? 'Moved buildings with no record position');
    else out.edits.push({ kind: 'building', i: s.i, typeId: b.typeId, rect: footprint(b), rot: b.rot, rotated: b.rot !== s.rot });
  }
  map.buildings.forEach((b, i) => {
    if (seen.has(i) || !BUILDING_BY_ID[b.typeId] || b.skipped) return;
    bump(b.typeId === 'road' ? 'Deleted road tiles' : b.typeId === 'bridge' ? 'Deleted bridge tiles' : 'Deleted buildings');
  });
  if (plan.flattened.length) bump('Flattened areas', plan.flattened.length);
  return out;
}

/**
 * Patch a copy of the save. Throws `SaveMismatchError` when the file isn't the one the map was
 * imported from (a building isn't where the import found it), leaving nothing half-written.
 */
export function writeSaveEdits(buf: ArrayBuffer, map: MapData, edits: SaveEdit[]): ArrayBuffer {
  const out = buf.slice(0);
  const dv = new DataView(out);
  const worldM = map.size * TILE_M;
  const f32 = (o: number) => dv.getFloat32(o, true);
  const put = (o: number, v: number) => dv.setFloat32(o, v, true);
  const near = (a: number, b: number) => Math.abs(a - b) < 0.01;

  // Check every record first, so a wrong file is refused before anything is changed.
  for (const e of edits) {
    const b = map.buildings[e.i];
    if (e.kind === 'area') {
      const a = b?.area;
      const fits = a && a.end <= out.byteLength && near(f32(a.pos), worldM - b.x * TILE_M) && near(f32(a.pos + 8), b.y * TILE_M);
      if (!fits) throw new SaveMismatchError(`This file doesn't match the imported map (${getType(e.typeId).name} isn't where the import found it).`);
      continue;
    }
    const rec = b?.rec;
    if (!rec || rec.pos + 28 > out.byteLength || rec.block + 29 > out.byteLength)
      throw new SaveMismatchError('This file is not the save the map was imported from.');
    const x = worldM - b.x * TILE_M;
    const z = b.y * TILE_M;
    const count = dv.getUint32(rec.block + 25, true);
    const ok =
      near(f32(rec.pos), x) && near(f32(rec.pos + 8), z) && near(f32(rec.block), x) && near(f32(rec.block + 8), z) &&
      count === e.rect.w * e.rect.h && rec.block + 29 + count * 8 <= out.byteLength;
    if (!ok) throw new SaveMismatchError(`This file doesn't match the imported map (${getType(e.typeId).name} isn't where the import found it).`);
  }

  const src = new DataView(buf);
  shiftAreas(src, dv, map, edits.filter((e) => e.kind === 'area'));

  for (const e of edits) {
    if (e.kind === 'area') continue;
    const { pos, block } = map.buildings[e.i].rec!;
    const r = e.rect;
    const x = worldM - (r.x + r.w / 2) * TILE_M;
    const z = (r.y + r.h / 2) * TILE_M;
    const y = groundHeight(map, r) ?? f32(pos + 4);
    const blockLift = f32(block + 4) - f32(pos + 4);

    put(pos, x);
    put(pos + 4, y);
    put(pos + 8, z);
    if (e.rotated) {
      // An upright turn by the planner's quarter turns (the importer reads yaw = 2·atan2(qy, qw)).
      const half = (e.rot * Math.PI) / 4;
      put(pos + 12, 0);
      put(pos + 16, Math.sin(half));
      put(pos + 20, 0);
      put(pos + 24, Math.cos(half));
    }

    put(block, x);
    put(block + 4, y + blockLift);
    put(block + 8, z);
    put(block + 12, r.w * TILE_M); // size along world x (rotation applied)
    put(block + 20, r.h * TILE_M); // size along world z
    // Tile centers row by row (world z ascending), each row in world x ascending, as the game writes them.
    let o = block + 29;
    for (let row = r.y; row < r.y + r.h; row++)
      for (let col = r.x + r.w - 1; col >= r.x; col--) {
        put(o, worldM - (col + 0.5) * TILE_M);
        put(o + 4, (row + 0.5) * TILE_M);
        o += 8;
      }
  }
  return out;
}

/**
 * Move crop fields and pastures by shifting every coordinate inside their records: (x, y, z)
 * triples whose height is near the ground there (the header, crop plants) and (x, z) pairs on the
 * 2.5 m grid (tile centers and corners), as long as they fall within the area's old bounds. Heights
 * follow the ground. Exact copies of the header position elsewhere in the file (herds keep one
 * for their pasture) move too. Reads from the original so overlapping moves can't double-shift.
 */
function shiftAreas(src: DataView, out: DataView, map: MapData, edits: SaveEdit[]) {
  if (!edits.length) return;
  const worldM = map.size * TILE_M;
  const get = (o: number) => src.getFloat32(o, true);
  const put = (o: number, v: number) => out.setFloat32(o, v, true);
  const ground = (x: number, z: number) => {
    if (!map.heights) return 0;
    const col = Math.min(map.size - 1, Math.max(0, Math.floor((worldM - x) / TILE_M)));
    const row = Math.min(map.size - 1, Math.max(0, Math.floor(z / TILE_M)));
    return map.heights[row * map.size + col];
  };
  const onGrid = (v: number) => Math.abs(v / 2.5 - Math.round(v / 2.5)) < 1e-4;
  /** Moved header positions, keyed by their first four bytes. */
  const copies = new Map<number, { pos: number; dx: number; dz: number }[]>();
  const shift = (o: number, dx: number, dz: number) => {
    const x = get(o);
    const z = get(o + 8);
    put(o, x + dx);
    put(o + 4, get(o + 4) + ground(x + dx, z + dz) - ground(x, z));
    put(o + 8, z + dz);
  };

  for (const e of edits) {
    const b = map.buildings[e.i];
    const { start, end, pos } = b.area!;
    const w = b.size!.w;
    const h = b.size!.h;
    const oldX = Math.round(b.x - w / 2);
    const oldY = Math.round(b.y - h / 2);
    const dx = -(e.rect.x - oldX) * TILE_M; // planner columns run against world x
    const dz = (e.rect.y - oldY) * TILE_M;
    const margin = TILE_M;
    const x0 = worldM - (oldX + w) * TILE_M - margin;
    const x1 = worldM - oldX * TILE_M + margin;
    const z0 = oldY * TILE_M - margin;
    const z1 = (oldY + h) * TILE_M + margin;
    const inX = (v: number) => v >= x0 && v <= x1;
    const inZ = (v: number) => v >= z0 && v <= z1;
    shift(pos, dx, dz);
    for (let o = start; o + 8 <= end; o++) {
      if (o >= pos - 3 && o < pos + 12) continue; // the header, already moved
      const x = get(o);
      if (!inX(x)) continue;
      if (o + 12 <= end) {
        const y = get(o + 4);
        const z = get(o + 8);
        if (inZ(z) && Math.abs(y - ground(x, z)) < 3) {
          put(o, x + dx);
          put(o + 4, y + ground(x + dx, z + dz) - ground(x, z));
          put(o + 8, z + dz);
          o += 11;
          continue;
        }
      }
      const z = get(o + 4);
      if (inZ(z) && onGrid(x) && onGrid(z)) {
        put(o, x + dx);
        put(o + 4, z + dz);
        o += 7;
      }
    }
    const key = src.getUint32(pos, true);
    copies.set(key, [...(copies.get(key) ?? []), { pos, dx, dz }]);
  }

  // Copies of a header position elsewhere: the same 12 bytes outside the area's own record.
  const records = edits.map((e) => map.buildings[e.i].area!);
  for (let o = 0; o + 12 <= src.byteLength; o++) {
    const list = copies.get(src.getUint32(o, true));
    if (!list) continue;
    const c = list.find((c) => src.getUint32(o + 4, true) === src.getUint32(c.pos + 4, true) && src.getUint32(o + 8, true) === src.getUint32(c.pos + 8, true));
    // Copies inside the moved records were already shifted by the scan above.
    if (!c || records.some((a) => o >= a.start && o < a.end)) continue;
    shift(o, c.dx, c.dz);
    o += 11;
  }
}

/** Mean ground height under a footprint, or null for maps stored without heights. */
function groundHeight(map: MapData, r: Rect): number | null {
  if (!map.heights) return null;
  let sum = 0;
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) sum += map.heights[y * map.size + x];
  return sum / (r.w * r.h);
}
