import { getType } from '../data/buildings';
import { Plan } from './plan';
import { blockedMask, type MapData, type SaveBuildingKind } from './terrain';

const TYPE_FOR: Record<SaveBuildingKind, string> = {
  townCenter: 'town-center',
  shelter: 'house',
};

/** A fresh plan on the map's grid, with the save's Town Center and shelters as planner buildings. */
export function importSaveBuildings(map: MapData): {
  plan: Plan;
  townCenters: number;
  houses: number;
  skipped: number;
} {
  const plan = new Plan(map.size, blockedMask(map));
  let townCenters = 0;
  let houses = 0;
  let skipped = 0;
  for (const b of map.buildings) {
    const typeId = TYPE_FOR[b.kind];
    const t = getType(typeId);
    // Game positions are building centers.
    const placed = plan.add(
      { typeId, x: Math.round(b.x - t.w / 2), y: Math.round(b.y - t.h / 2), rot: 0 },
      { ignoreTerrain: true },
    );
    if (!placed) skipped++;
    else if (b.kind === 'townCenter') townCenters++;
    else houses++;
  }
  return { plan, townCenters, houses, skipped };
}
