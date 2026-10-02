import type { Plan } from './model/plan';
import { deserializeMap, serializeMap, type MapData } from './model/terrain';

const PLAN_KEY = 'ff-planner:autosave:v1';
const MAP_KEY = 'ff-planner:map:v1';

export interface Saved {
  planData: unknown | null;
  map: MapData | null;
}

export function loadAutosave(): Saved {
  const read = (key: string) => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  };
  return { planData: read(PLAN_KEY), map: deserializeMap(read(MAP_KEY)) };
}

let timer: number | undefined;
export function scheduleAutosave(plan: Plan) {
  clearTimeout(timer);
  timer = window.setTimeout(() => {
    try {
      localStorage.setItem(PLAN_KEY, JSON.stringify(plan.toJSON()));
    } catch {
      // Storage unavailable (private mode, quota); the plan still works in memory.
    }
  }, 300);
}

/** Persist the imported map (about 1 MB). Returns false when the browser refuses. */
export function saveMap(map: MapData | null): boolean {
  try {
    if (map) localStorage.setItem(MAP_KEY, JSON.stringify(serializeMap(map)));
    else localStorage.removeItem(MAP_KEY);
    return true;
  } catch {
    return false;
  }
}

/** Plans export with their map so the file is self-contained. */
export function exportPlan(plan: Plan, map: MapData | null) {
  const data = { ...plan.toJSON(), ...(map ? { map: serializeMap(map) } : {}) };
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  downloadBlob(new Blob([JSON.stringify(data)], { type: 'application/json' }), `farthest-frontier-plan-${stamp}.json`);
}

export function downloadBlob(blob: Blob, fileName: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Parse an exported plan file into its plan data and (optional) map. */
export async function readPlanFile(file: File): Promise<Saved> {
  const data = JSON.parse(await file.text());
  if (!data || !Array.isArray(data.buildings)) throw new Error('Not a planner file');
  return { planData: data, map: data.map ? deserializeMap(data.map) : null };
}
