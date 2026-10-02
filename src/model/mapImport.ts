import { BUILDING_BY_ID, getType } from '../data/buildings';
import { Plan, rotatedSize } from './plan';
import { blockedMask, type MapData } from './terrain';

export interface ImportReport {
  plan: Plan;
  /** Planner buildings placed, by catalog id. */
  imported: Record<string, number>;
  /** Buildings that couldn't be placed because they'd overlap another one (usually a wrong catalog size). */
  overlapping: Record<string, number>;
  /** Catalog ids whose size doesn't match where the game put the building's center. */
  sizeMismatch: Record<string, number>;
}

/**
 * Buildings that share a class in the save but come in more than one footprint. When the center's
 * offsets don't fit the first type, the alternative is tried (wide gates are two tiles across).
 */
const SIZE_VARIANTS: Record<string, string> = { 'palisade-gate': 'wide-gate' };

/** Odd footprint sides center on a half tile, even sides on a whole tile. */
const isHalf = (v: number) => Math.abs((v % 1) - 0.5) < 0.25;

/**
 * A fresh plan on the map's grid with the save's player buildings placed as planner buildings.
 * Game positions are building centers. The planner rotation is chosen so the footprint's odd/even
 * sides match the center's half/whole-tile offsets, which also absorbs catalog entries whose
 * width and height are listed the other way round from the game's.
 */
export function importSaveBuildings(map: MapData): ImportReport {
  const plan = new Plan(map.size, blockedMask(map));
  const report: ImportReport = { plan, imported: {}, overlapping: {}, sizeMismatch: {} };
  const bump = (o: Record<string, number>, k: string) => (o[k] = (o[k] ?? 0) + 1);

  // Big buildings first, so a mis-sized small one can't block them.
  const ordered = map.buildings
    .map((b, i) => ({ b, i }))
    .filter(({ b }) => BUILDING_BY_ID[b.typeId])
    .sort((a, b) => area(b.b.typeId) - area(a.b.typeId));

  for (const { b, i } of ordered) {
    // Fields, pastures and graveyards are sized by the player; the save gives their size.
    const dims = (typeId: string) => {
      const t = getType(typeId);
      return t.variable && b.size ? b.size : { w: t.w, h: t.h };
    };
    const fits = (typeId: string, rot: number) => {
      const d = dims(typeId);
      const s = rotatedSize(d.w, d.h, rot);
      return (s.w % 2 === 1) === isHalf(b.x) && (s.h % 2 === 1) === isHalf(b.y);
    };
    // Keep the game's full rotation (0–3): a building turned 180° looks the same in the planner, but
    // writing it back must keep its door on the same side.
    let typeId = b.typeId;
    let rot = ((b.rot % 4) + 4) % 4;
    const variant = SIZE_VARIANTS[typeId];
    if (!fits(typeId, rot) && !fits(typeId, rot + 1) && variant) typeId = variant;
    if (!fits(typeId, rot)) {
      if (fits(typeId, rot + 1)) rot = (rot + 1) % 4;
      else bump(report.sizeMismatch, typeId);
    }
    const d = dims(typeId);
    const s = rotatedSize(d.w, d.h, rot);
    const x = Math.round(b.x - s.w / 2);
    const y = Math.round(b.y - s.h / 2);
    const sized = getType(typeId).variable ? { w: d.w, h: d.h } : {};
    const placed = plan.add({ typeId, x, y, rot, ...sized, src: { i, typeId, x, y, rot, ...sized } }, { ignoreTerrain: true });
    if (placed) delete b.skipped;
    else b.skipped = true;
    bump(placed ? report.imported : report.overlapping, typeId);
  }
  return report;
}

function area(typeId: string): number {
  const t = getType(typeId);
  return t.w * t.h;
}
