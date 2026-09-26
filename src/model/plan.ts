import { BUILDING_BY_ID, getType } from '../data/buildings';

export const GRID = 100;
/** Meters per tile. */
export const TILE_M = 5;

export interface Placed {
  id: number;
  typeId: string;
  /** Top-left tile of the (rotated) footprint. */
  x: number;
  y: number;
  /** Quarter turns, 0–3. */
  rot: number;
  /** Size override for variable-size buildings (unrotated). */
  w?: number;
  h?: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PlanData {
  version: 1;
  buildings: Placed[];
}

export function baseSize(p: Pick<Placed, 'typeId' | 'w' | 'h'>): { w: number; h: number } {
  const t = getType(p.typeId);
  return { w: p.w ?? t.w, h: p.h ?? t.h };
}

export function rotatedSize(w: number, h: number, rot: number): { w: number; h: number } {
  return rot % 2 === 1 ? { w: h, h: w } : { w, h };
}

export function footprint(p: Placed): Rect {
  const s = baseSize(p);
  const r = rotatedSize(s.w, s.h, p.rot);
  return { x: p.x, y: p.y, w: r.w, h: r.h };
}

export function center(p: Placed): { cx: number; cy: number } {
  const f = footprint(p);
  return { cx: f.x + f.w / 2, cy: f.y + f.h / 2 };
}

export function inBounds(r: Rect): boolean {
  return r.x >= 0 && r.y >= 0 && r.x + r.w <= GRID && r.y + r.h <= GRID;
}

export class Plan {
  buildings: Placed[] = [];
  private nextId = 1;
  /** Building id occupying each tile, 0 when empty. */
  private occ = new Int32Array(GRID * GRID);

  constructor(buildings: Placed[] = []) {
    for (const b of buildings) {
      this.buildings.push({ ...b });
      this.nextId = Math.max(this.nextId, b.id + 1);
    }
    this.rebuild();
  }

  private rebuild() {
    this.occ.fill(0);
    for (const b of this.buildings) this.stamp(footprint(b), b.id);
  }

  private stamp(r: Rect, id: number) {
    for (let y = r.y; y < r.y + r.h; y++)
      for (let x = r.x; x < r.x + r.w; x++) this.occ[y * GRID + x] = id;
  }

  get(id: number): Placed | undefined {
    return this.buildings.find((b) => b.id === id);
  }

  /** Building occupying tile (x, y), if any. */
  at(x: number, y: number): Placed | undefined {
    if (x < 0 || y < 0 || x >= GRID || y >= GRID) return undefined;
    const id = this.occ[y * GRID + x];
    return id ? this.get(id) : undefined;
  }

  canPlace(r: Rect, ignoreId = 0): boolean {
    if (!inBounds(r)) return false;
    for (let y = r.y; y < r.y + r.h; y++)
      for (let x = r.x; x < r.x + r.w; x++) {
        const id = this.occ[y * GRID + x];
        if (id && id !== ignoreId) return false;
      }
    return true;
  }

  /** Place a building; an explicit id is kept when it's free (used when restoring saved plans). */
  add(p: Omit<Placed, 'id'> & { id?: number }): Placed | null {
    const id = p.id && p.id > 0 && !this.get(p.id) ? p.id : this.nextId;
    const b: Placed = { ...p, id };
    const r = footprint(b);
    if (!this.canPlace(r)) return null;
    this.nextId = Math.max(this.nextId, id + 1);
    this.buildings.push(b);
    this.stamp(r, b.id);
    return b;
  }

  /** Apply changes to a building if the result is a valid placement. */
  update(id: number, changes: Partial<Omit<Placed, 'id' | 'typeId'>>): boolean {
    const b = this.get(id);
    if (!b) return false;
    const next = { ...b, ...changes };
    const r = footprint(next);
    if (!this.canPlace(r, id)) return false;
    this.stamp(footprint(b), 0);
    Object.assign(b, changes);
    this.stamp(r, id);
    return true;
  }

  /** Rotate 90° clockwise around the building's center, nudging it back into bounds if needed. */
  rotate(id: number): boolean {
    const b = this.get(id);
    if (!b) return false;
    const { cx, cy } = center(b);
    const rot = (b.rot + 1) % 4;
    const s = baseSize(b);
    const r = rotatedSize(s.w, s.h, rot);
    const x = clamp(Math.round(cx - r.w / 2), 0, GRID - r.w);
    const y = clamp(Math.round(cy - r.h / 2), 0, GRID - r.h);
    return this.update(id, { rot, x, y });
  }

  remove(id: number) {
    this.buildings = this.buildings.filter((b) => b.id !== id);
    this.rebuild();
  }

  clear() {
    this.buildings = [];
    this.rebuild();
  }

  toJSON(): PlanData {
    return { version: 1, buildings: this.buildings.map((b) => ({ ...b })) };
  }

  /** Parse saved data, dropping anything unknown, out of bounds or overlapping. */
  static fromJSON(data: unknown): Plan {
    const plan = new Plan();
    const list = (data as PlanData | null)?.buildings;
    if (!Array.isArray(list)) throw new Error('Not a planner file');
    for (const raw of list) {
      if (!raw || typeof raw !== 'object' || !BUILDING_BY_ID[raw.typeId]) continue;
      const p: Omit<Placed, 'id'> & { id?: number } = {
        id: int(raw.id),
        typeId: raw.typeId,
        x: int(raw.x),
        y: int(raw.y),
        rot: ((int(raw.rot) % 4) + 4) % 4,
      };
      const v = getType(raw.typeId).variable;
      if (v && raw.w != null && raw.h != null) {
        p.w = clamp(int(raw.w), v.min, v.max);
        p.h = clamp(int(raw.h), v.min, v.max);
      }
      plan.add(p);
    }
    return plan;
  }
}

function int(v: unknown): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : 0;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
