import { BUILDING_BY_ID, getType } from '../data/buildings';

/** Grid size of a plan without an imported map. */
export const DEFAULT_SIZE = 100;
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
  version: 2;
  size: number;
  buildings: Placed[];
}

export type NewBuilding = Omit<Placed, 'id'> & { id?: number };

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

export function inBounds(r: Rect, size = DEFAULT_SIZE): boolean {
  return r.x >= 0 && r.y >= 0 && r.x + r.w <= size && r.y + r.h <= size;
}

export class Plan {
  buildings: Placed[] = [];
  private nextId = 1;
  /** Building id occupying each tile, 0 when empty. */
  private occ: Int32Array;

  /**
   * @param size tiles per side
   * @param blocked optional size×size mask of tiles (water, steep ground) where nothing may be placed
   */
  constructor(
    readonly size = DEFAULT_SIZE,
    readonly blocked: Uint8Array | null = null,
  ) {
    this.occ = new Int32Array(size * size);
  }

  private rebuild() {
    this.occ.fill(0);
    for (const b of this.buildings) this.stamp(footprint(b), b.id);
  }

  private stamp(r: Rect, id: number) {
    for (let y = r.y; y < r.y + r.h; y++)
      for (let x = r.x; x < r.x + r.w; x++) this.occ[y * this.size + x] = id;
  }

  get(id: number): Placed | undefined {
    return this.buildings.find((b) => b.id === id);
  }

  /** Building occupying tile (x, y), if any. */
  at(x: number, y: number): Placed | undefined {
    if (x < 0 || y < 0 || x >= this.size || y >= this.size) return undefined;
    const id = this.occ[y * this.size + x];
    return id ? this.get(id) : undefined;
  }

  isBlocked(x: number, y: number): boolean {
    return !!this.blocked?.[y * this.size + x];
  }

  canPlace(r: Rect, ignoreId = 0, ignoreTerrain = false): boolean {
    if (!inBounds(r, this.size)) return false;
    for (let y = r.y; y < r.y + r.h; y++)
      for (let x = r.x; x < r.x + r.w; x++) {
        const i = y * this.size + x;
        const id = this.occ[i];
        if (id && id !== ignoreId) return false;
        if (!ignoreTerrain && this.blocked?.[i]) return false;
      }
    return true;
  }

  /**
   * Place a building; an explicit id is kept when it's free (used when restoring saved plans).
   * `ignoreTerrain` lets imported or saved buildings sit where the terrain mask would refuse new ones.
   */
  add(p: NewBuilding, opts: { ignoreTerrain?: boolean } = {}): Placed | null {
    const id = p.id && p.id > 0 && !this.get(p.id) ? p.id : this.nextId;
    const b: Placed = { ...p, id };
    const r = footprint(b);
    if (!this.canPlace(r, 0, opts.ignoreTerrain)) return null;
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
    const x = clamp(Math.round(cx - r.w / 2), 0, this.size - r.w);
    const y = clamp(Math.round(cy - r.h / 2), 0, this.size - r.h);
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
    return { version: 2, size: this.size, buildings: this.buildings.map((b) => ({ ...b })) };
  }

  /**
   * Parse saved data, dropping anything unknown, out of bounds or overlapping.
   * Saved buildings are trusted on terrain (they were valid when placed or imported).
   */
  static fromJSON(data: unknown, blocked: Uint8Array | null = null, size?: number): Plan {
    const raw = data as Partial<PlanData> | null;
    const list = raw?.buildings;
    if (!Array.isArray(list)) throw new Error('Not a planner file');
    const plan = new Plan(size ?? (Number.isInteger(raw?.size) ? raw!.size! : DEFAULT_SIZE), blocked);
    for (const b of list) {
      if (!b || typeof b !== 'object' || !BUILDING_BY_ID[b.typeId]) continue;
      const p: NewBuilding = {
        id: int(b.id),
        typeId: b.typeId,
        x: int(b.x),
        y: int(b.y),
        rot: ((int(b.rot) % 4) + 4) % 4,
      };
      const v = getType(b.typeId).variable;
      if (v && b.w != null && b.h != null) {
        p.w = clamp(int(b.w), v.min, v.max);
        p.h = clamp(int(b.h), v.min, v.max);
      }
      plan.add(p, { ignoreTerrain: true });
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
