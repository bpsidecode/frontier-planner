import { Plan } from './model/plan';

const KEY = 'ff-planner:autosave:v1';

export function loadAutosave(): Plan | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? Plan.fromJSON(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

let timer: number | undefined;
export function scheduleAutosave(plan: Plan) {
  clearTimeout(timer);
  timer = window.setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(plan.toJSON()));
    } catch {
      // Storage unavailable (private mode, quota); the plan still works in memory.
    }
  }, 300);
}

export function exportPlan(plan: Plan) {
  const blob = new Blob([JSON.stringify(plan.toJSON(), null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  a.download = `farthest-frontier-plan-${stamp}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export async function importPlan(file: File): Promise<Plan> {
  return Plan.fromJSON(JSON.parse(await file.text()));
}
