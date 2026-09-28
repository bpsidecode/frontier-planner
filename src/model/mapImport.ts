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
  const ordered = [...map.buildings]
    .filter((b) => BUILDING_BY_ID[b.typeId])
    .sort((a, b) => area(b.typeId) - area(a.typeId));

  for (const b of ordered) {
    const t = getType(b.typeId);
    const fits = (rot: number) => {
      const s = rotatedSize(t.w, t.h, rot);
      return (s.w % 2 === 1) === isHalf(b.x) && (s.h % 2 === 1) === isHalf(b.y);
    };
    let rot = b.rot % 2;
    if (!fits(rot)) {
      if (fits(1 - rot)) rot = 1 - rot;
      else bump(report.sizeMismatch, b.typeId);
    }
    const s = rotatedSize(t.w, t.h, rot);
    const placed = plan.add(
      { typeId: b.typeId, x: Math.round(b.x - s.w / 2), y: Math.round(b.y - s.h / 2), rot },
      { ignoreTerrain: true },
    );
    bump(placed ? report.imported : report.overlapping, b.typeId);
  }
  return report;
}

function area(typeId: string): number {
  const t = getType(typeId);
  return t.w * t.h;
}
