// Write planner changes back into a copy of the original .sav. Only moves and rotations of
// buildings imported from that save are supported: each one is a fixed-size patch inside the
// building's own record (header position and rotation, plus the occupied-tile block), which
// in-game tests showed is all the game needs. Everything else is reported as not written.

import { BUILDING_BY_ID, getType } from '../data/buildings';
import { TILE_M, footprint, type Placed, type Rect } from '../model/plan';
import type { MapData } from '../model/terrain';

export interface SaveEdit {
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
  'crop-field': 'Moved or resized crop fields',
  pasture: 'Moved or resized pastures',
  graveyard: 'Moved or resized graveyards',
  bridge: 'Moved bridge tiles',
};

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
    else if (!from.rec) bump(AREA_LABELS[b.typeId] ?? 'Moved buildings with no record position');
    else out.edits.push({ i: s.i, typeId: b.typeId, rect: footprint(b), rot: b.rot, rotated: b.rot !== s.rot });
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

  for (const e of edits) {
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

/** Mean ground height under a footprint, or null for maps stored without heights. */
function groundHeight(map: MapData, r: Rect): number | null {
  if (!map.heights) return null;
  let sum = 0;
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) sum += map.heights[y * map.size + x];
  return sum / (r.w * r.h);
}
