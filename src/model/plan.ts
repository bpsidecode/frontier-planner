import { BUILDING_BY_ID, canonicalTypeId, getType } from '../data/buildings';

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
  /** For buildings imported from a save: their index in `MapData.buildings` and how they were first placed. */
  src?: ImportSource;
}

export interface ImportSource {
  i: number;
  typeId: string;
  x: number;
  y: number;
  rot: number;
  /** Imported size of fields, pastures and graveyards. */
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
  /** 3 added `flattened`; 2 added `size`. Older versions still load. */
  version: 3;
  size: number;
  buildings: Placed[];
  /** Flattened ground areas, applied in order (each averages the ground's height across it). */
  flattened: Rect[];
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

export function isZone(typeId: string): boolean {
  return !!BUILDING_BY_ID[typeId]?.zone;
}

/** Whether rectangle `inner` lies entirely inside `outer`. */
export function contains(outer: Rect, inner: Rect): boolean {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
}

export function inBounds(r: Rect, size = DEFAULT_SIZE): boolean {
  return r.x >= 0 && r.y >= 0 && r.x + r.w <= size && r.y + r.h <= size;
}

export class Plan {
  buildings: Placed[] = [];
  /** Flattened ground areas in the order they were made. The controller turns them into `blocked`. */
  flattened: Rect[] = [];
  private nextId = 1;
  /** Building id occupying each tile, 0 when empty. Zones (fields, pastures, graveyards) are tracked separately. */
  private occ: Int32Array;
  /**
   * Topmost zone id under each tile, 0 when none. Buildings may stand on zones, and zones may
   * overlap each other (the game allows overlapping pastures).
   */
  private zoneOcc: Int32Array;

  /**
   * @param size tiles per side
   * @param blocked optional size×size mask of tiles (water, steep ground) where nothing may be placed
   */
  constructor(
    readonly size = DEFAULT_SIZE,
    private blocked: Uint8Array | null = null,
  ) {
    this.occ = new Int32Array(size * size);
    this.zoneOcc = new Int32Array(size * size);
  }

  private rebuild() {
    this.occ.fill(0);
    this.zoneOcc.fill(0);
    for (const b of this.buildings) this.stamp(footprint(b), b.id, isZone(b.typeId));
  }

  private stamp(r: Rect, id: number, zone = false) {
    const grid = zone ? this.zoneOcc : this.occ;
    for (let y = r.y; y < r.y + r.h; y++)
      for (let x = r.x; x < r.x + r.w; x++) grid[y * this.size + x] = id;
  }

  get(id: number): Placed | undefined {
    return this.buildings.find((b) => b.id === id);
  }

  /** Building occupying tile (x, y), or else the zone under it, if any. */
  at(x: number, y: number): Placed | undefined {
    if (x < 0 || y < 0 || x >= this.size || y >= this.size) return undefined;
    const i = y * this.size + x;
    const id = this.occ[i] || this.zoneOcc[i];
    return id ? this.get(id) : undefined;
  }

  /** Swap the terrain mask, e.g. after flattening. Existing buildings stay where they are. */
  setBlocked(blocked: Uint8Array | null) {
    this.blocked = blocked;
  }

  isBlocked(x: number, y: number): boolean {
    return !!this.blocked?.[y * this.size + x];
  }

  /** Whether a footprint lies entirely inside one zone of the given type (e.g. a graveyard). */
  insideZone(r: Rect, zoneType: string): boolean {
    return this.buildings.some((z) => z.typeId === zoneType && contains(footprint(z), r));
  }

  /**
   * Whether a footprint is free of other buildings (zones only need the bounds and terrain), and
   * meets the type's placement rule, such as a Crypt needing a Graveyard. `ignoreTerrain` (imports
   * and restores) also trusts the placement rule.
   */
  canPlace(r: Rect, ignoreId = 0, ignoreTerrain = false, typeId?: string): boolean {
    if (!inBounds(r, this.size)) return false;
    const zone = !!typeId && isZone(typeId);
    const within = typeId ? BUILDING_BY_ID[typeId]?.within : undefined;
    if (within && !ignoreTerrain && !this.insideZone(r, within)) return false;
    for (let y = r.y; y < r.y + r.h; y++)
      for (let x = r.x; x < r.x + r.w; x++) {
        const i = y * this.size + x;
        const id = zone ? 0 : this.occ[i];
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
    const zone = isZone(b.typeId);
    if (!this.canPlace(r, 0, opts.ignoreTerrain, b.typeId)) return null;
    this.nextId = Math.max(this.nextId, id + 1);
    this.buildings.push(b);
    this.stamp(r, b.id, zone);
    return b;
  }

  /** Apply changes to a building if the result is a valid placement. */
  update(id: number, changes: Partial<Omit<Placed, 'id' | 'typeId'>>): boolean {
    const b = this.get(id);
    if (!b) return false;
    const next = { ...b, ...changes };
    const r = footprint(next);
    const zone = isZone(b.typeId);
    if (!this.canPlace(r, id, false, b.typeId)) return false;
    const old = footprint(b);
    const before = { x: b.x, y: b.y, rot: b.rot, w: b.w, h: b.h };
    // Buildings that must stand inside a zone (crypts) and currently do.
    const dependents = zone ? this.buildings.filter((d) => this.ruleHolds(d)) : [];
    // A zone moved without resizing carries the buildings that must stand inside it (a graveyard's crypt).
    const dx = next.x - b.x;
    const dy = next.y - b.y;
    const sameShape = next.w === b.w && next.h === b.h && next.rot === b.rot;
    const carried =
      zone && sameShape && (dx || dy)
        ? dependents.filter((d) => BUILDING_BY_ID[d.typeId].within === b.typeId && contains(old, footprint(d)))
        : [];
    const carriedFrom = carried.map((d) => ({ d, x: d.x, y: d.y }));
    Object.assign(b, changes);
    // Zones can overlap, so clearing one's old tiles could clear a neighbor's: restamp them all.
    if (zone) {
      const undo = () => {
        Object.assign(b, before);
        if (before.w === undefined) delete b.w;
        if (before.h === undefined) delete b.h;
        for (const c of carriedFrom) Object.assign(c.d, { x: c.x, y: c.y });
        this.rebuild();
        return false;
      };
      this.rebuild();
      for (const d of carried) {
        const r = { ...footprint(d), x: d.x + dx, y: d.y + dy };
        if (!this.canPlace(r, d.id, false, d.typeId)) return undo();
        this.stamp(footprint(d), 0);
        Object.assign(d, { x: r.x, y: r.y });
        this.stamp(r, d.id);
      }
      // Don't move or shrink a graveyard out from under its crypt.
      if (!dependents.every((d) => this.ruleHolds(d))) return undo();
    } else {
      this.stamp(old, 0);
      this.stamp(r, id);
    }
    return true;
  }

  /** Swap a building to another catalog type while keeping its id, position and rotation. */
  replaceType(id: number, typeId: string): boolean {
    const b = this.get(id);
    if (!b || !BUILDING_BY_ID[typeId]) return false;
    const old = footprint(b);
    const next: Placed = { id: b.id, typeId, x: b.x, y: b.y, rot: b.rot };
    const r = footprint(next);
    if (!inBounds(r, this.size) || isZone(typeId) !== isZone(b.typeId)) return false;
    const zone = isZone(typeId);
    for (let y = r.y; y < r.y + r.h; y++)
      for (let x = r.x; x < r.x + r.w; x++) {
        const i = y * this.size + x;
        const occupant = zone ? 0 : this.occ[i];
        if (occupant && occupant !== id) return false;
        // Imported buildings may already touch terrain classified as blocked. Let a same-size or
        // smaller replacement keep those tiles, but don't let a larger replacement claim new ones.
        const wasCovered = x >= old.x && x < old.x + old.w && y >= old.y && y < old.y + old.h;
        if (this.blocked?.[i] && !wasCovered) return false;
      }
    b.typeId = typeId;
    delete b.w;
    delete b.h;
    if (zone) this.rebuild();
    else {
      this.stamp(old, 0);
      this.stamp(r, id);
    }
    return true;
  }

  /** Whether a building with a placement rule (see `within`) meets it. */
  private ruleHolds(b: Placed): boolean {
    const within = BUILDING_BY_ID[b.typeId]?.within;
    return !!within && this.insideZone(footprint(b), within);
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
    return {
      version: 3,
      size: this.size,
      buildings: this.buildings.map((b) => ({ ...b })),
      flattened: this.flattened.map((r) => ({ ...r })),
    };
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
      if (!b || typeof b !== 'object') continue;
      const typeId = canonicalTypeId(String(b.typeId));
      if (!BUILDING_BY_ID[typeId]) continue;
      const p: NewBuilding = {
        id: int(b.id),
        typeId,
        x: int(b.x),
        y: int(b.y),
        rot: ((int(b.rot) % 4) + 4) % 4,
      };
      const s = b.src as Partial<ImportSource> | undefined;
      if (s && typeof s === 'object' && typeof s.typeId === 'string')
        p.src = {
          i: int(s.i),
          typeId: s.typeId,
          x: int(s.x),
          y: int(s.y),
          rot: ((int(s.rot) % 4) + 4) % 4,
          ...(s.w != null && s.h != null ? { w: int(s.w), h: int(s.h) } : {}),
        };
      const v = getType(typeId).variable;
      if (v && b.w != null && b.h != null) {
        p.w = clamp(int(b.w), v.min, v.max);
        p.h = clamp(int(b.h), v.min, v.max);
      }
      plan.add(p, { ignoreTerrain: true });
    }
    if (Array.isArray(raw?.flattened))
      for (const f of raw.flattened) {
        if (!f || typeof f !== 'object') continue;
        const r = { x: int(f.x), y: int(f.y), w: int(f.w), h: int(f.h) };
        if (r.w > 0 && r.h > 0 && inBounds(r, plan.size)) plan.flattened.push(r);
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
