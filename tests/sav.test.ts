import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TYPE, parseSave, readRecordTable } from '../src/import/sav';
import { Terrain, classifyTerrain, deserializeMap, serializeMap } from '../src/model/terrain';
import { importSaveBuildings } from '../src/model/mapImport';
import { footprint } from '../src/model/plan';

// ---------- synthetic save builder ----------

class Writer {
  bytes: number[] = [];
  u8(v: number) {
    this.bytes.push(v & 255);
    return this;
  }
  u32(v: number) {
    const b = new ArrayBuffer(4);
    new DataView(b).setUint32(0, v, true);
    this.bytes.push(...new Uint8Array(b));
    return this;
  }
  f32(v: number) {
    const b = new ArrayBuffer(4);
    new DataView(b).setFloat32(0, v, true);
    this.bytes.push(...new Uint8Array(b));
    return this;
  }
  str(s: string) {
    this.u8(s.length);
    for (const c of s) this.bytes.push(c.charCodeAt(0));
    return this;
  }
  zeros(n: number) {
    for (let i = 0; i < n; i++) this.bytes.push(0);
    return this;
  }
  point(x: number, z: number) {
    return this.f32(x).f32(0).f32(z);
  }
}

/** Wrap a payload as a save record: type, name, size, id, then 1 pad byte before the payload. */
function record(out: Writer, name: string, id: number, payload: Writer) {
  out.u8(0).str(name).u32(4 + 1 + payload.bytes.length).u32(id).u8(0);
  out.bytes.push(...payload.bytes);
}

const N = 4;
const WORLD = 20; // 4 cells of 5 m

function syntheticSave(): ArrayBuffer {
  const out = new Writer();
  record(out, 'metaData', TYPE.MetaData, new Writer().u32(1).str('v1.1.2a'));

  // Agriculture: cell [i][j] has EnvFertility = j/10 (so mirrored columns are testable), water = i/10.
  const ag = new Writer().f32(WORLD).f32(WORLD).u32(N).u32(N);
  for (let i = 0; i < N; i++)
    for (let j = 0; j < N; j++)
      for (let t = 0; t < 12; t++) ag.f32(t === 0 ? j / 10 : t === 8 ? i / 10 : t === 4 ? 0.5 : 0);
  record(out, 'agricultureManager', TYPE.AgricultureManager, ag);

  // Terrain: no trees/objects/stumps; heights: row 0 is water (-1 m), the rest 10 m, one spike.
  const tr = new Writer().u32(0).u32(0).u32(0).u32(0).u32(0).u32(N).u32(N * N);
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) tr.f32(i === 0 ? -1 : i === 3 && j === 3 ? 30 : 10);
  record(out, 'terrainManager', TYPE.TerrainManager, tr);

  // Minerals: one clay at world (15, 10) r=5 → tile (1, 2) r=1; one iron deposit; no bonus sites.
  const mn = new Writer()
    .u32(1).point(15, 10).f32(5).u32(1000).u8(0)
    .u32(0)
    .u32(0)
    .u32(1).u32(7).u32(0).point(5, 5).f32(2.5).u32(500).u8(1)
    .u32(0);
  record(out, 'mineralManager', TYPE.MineralManager, mn);

  // Town center at world (10, 10), no parent transform, no rotation → tile (2, 2). Header is
  // id, hasParent, pad, position, quaternion (x, y, z, w), scale, class name, then building data.
  const tc = new Writer().u32(42).u8(0).u8(0).point(10, 10).f32(0).f32(0).f32(0).f32(1).f32(1).f32(1).f32(1).str('TownCenter').zeros(32);
  record(out, 'townCenter', 3556611327, tc);
  // A cabin rotated 90° (quaternion y = w = √½) at a half-tile center, and an unknown class that must be ignored.
  const s = Math.SQRT1_2;
  record(out, 'hunterBuilding', 1, new Writer().u32(43).u8(0).u8(0).point(7.5, 12.5).f32(0).f32(s).f32(0).f32(s).f32(1).f32(1).f32(1).str('HunterBuilding').zeros(32));
  record(out, 'mysteryBuilding', 2, new Writer().u32(44).u8(0).u8(0).point(5, 5).f32(0).f32(0).f32(0).f32(1).f32(1).f32(1).f32(1).str('Mystery').zeros(32));
  record(out, 'cropField', 3, new Writer().zeros(64));
  return new Uint8Array(out.bytes).buffer;
}

describe('save parser (synthetic)', () => {
  const map = parseSave(syntheticSave(), 'Test.sav');

  it('reads the record table and metadata', () => {
    const table = readRecordTable(syntheticSave());
    expect(table.get(TYPE.TownCenter)).toHaveLength(1);
    expect(map.version).toBe('v1.1.2a');
    expect(map.name).toBe('Test');
    expect(map.size).toBe(N);
  });

  it('mirrors grid columns and keeps rows', () => {
    // Cell [i][j] lands at row i, col N-1-j: so column 0 holds j=3 (fertility 0.3).
    expect(map.fertility[0 * N + 0]).toBe(Math.round(0.3 * 255));
    expect(map.fertility[0 * N + 3]).toBe(0);
    expect(map.water[2 * N + 1]).toBe(Math.round(0.2 * 255));
    expect(map.fodder[5]).toBe(Math.round(0.5 * 255));
  });

  it('classifies water and steep terrain', () => {
    for (let c = 0; c < N; c++) expect(map.terrain[c]).toBe(Terrain.Water);
    // The 30 m spike at [3][3] → row 3, col 0 is steep, as is its neighbour.
    expect(map.terrain[3 * N + 0]).toBe(Terrain.Steep);
    expect(map.terrain[3 * N + 1]).toBe(Terrain.Steep);
    expect(map.terrain[2 * N + 2]).toBe(Terrain.Land);
  });

  it('converts point positions to tiles with mirrored x', () => {
    const clay = map.minerals.find((m) => m.kind === 'clay')!;
    expect(clay).toMatchObject({ x: 1, y: 2, r: 1, amount: 1000, deep: false });
    const iron = map.minerals.find((m) => m.kind === 'iron')!;
    expect(iron).toMatchObject({ x: 3, y: 1, r: 0.5, amount: 500, deep: true });
    expect(map.buildings).toEqual([
      { typeId: 'town-center', x: 2, y: 2, rot: 0 },
      { typeId: 'hunter-cabin', x: 2.5, y: 2.5, rot: 1 },
    ]);
    expect(map.notImported).toEqual({ 'Crop fields': 1 });
  });

  it('round-trips through serialization', () => {
    const back = deserializeMap(JSON.parse(JSON.stringify(serializeMap(map))))!;
    expect(back.size).toBe(N);
    expect(Array.from(back.terrain)).toEqual(Array.from(map.terrain));
    expect(Array.from(back.fertility)).toEqual(Array.from(map.fertility));
    expect(back.minerals).toEqual(map.minerals);
  });

  it('rejects files that are not saves', () => {
    expect(() => parseSave(new Uint8Array([1, 0, 0, 0, 128, 7, 0, 0, 65]).buffer)).toThrow();
  });
});

describe('classifyTerrain', () => {
  it('marks water below the threshold and steep rises', () => {
    const h = new Float32Array([0, 10, 10, 10, 10, 10, 10, 10, 20]);
    const t = classifyTerrain(h, 3);
    expect(t[0]).toBe(Terrain.Water);
    expect(t[4]).toBe(Terrain.Land);
    expect(t[8]).toBe(Terrain.Steep);
    expect(t[5]).toBe(Terrain.Steep); // neighbour of the 20 m tile
  });
});

// ---------- optional: a real save (FF_SAV=/path/to/file.sav npx vitest run) ----------

const realPath = process.env.FF_SAV;
describe.skipIf(!realPath)('real save file', () => {
  const buf = realPath ? readFileSync(realPath) : Buffer.alloc(0);
  const map = realPath ? parseSave(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, 'real.sav') : null!;

  it('parses the map with resources, all markers inside the grid', () => {
    expect([256, 384]).toContain(map.size);
    const inside = (p: { x: number; y: number }) => p.x >= 0 && p.y >= 0 && p.x <= map.size && p.y <= map.size;
    for (const list of [map.minerals, map.forageables, map.enemies, map.ruins, map.buildings, map.spawns]) expect(list.every(inside)).toBe(true);
    const count = (k: string) => map.minerals.filter((m) => m.kind === k).length;
    console.log('minerals', ['clay', 'sand', 'stone', 'iron', 'gold', 'coal'].map((k) => `${k}:${count(k)}`).join(' '));
    console.log('forageables', map.forageables.length, 'spawns', map.spawns.length, 'enemies', map.enemies.length, 'ruins', map.ruins.length, 'bonus', map.fertilityBonus.length);
    expect(map.minerals.length).toBeGreaterThan(0);
    expect(map.forageables.length).toBeGreaterThan(0);
    expect(map.spawns.length).toBeGreaterThan(0);
  });

  it('imports the town onto land', () => {
    const { plan, imported, overlapping, sizeMismatch } = importSaveBuildings(map);
    console.log('imported', JSON.stringify(imported));
    console.log('overlapping', JSON.stringify(overlapping), 'sizeMismatch', JSON.stringify(sizeMismatch));
    console.log('notImported', JSON.stringify(map.notImported));
    // A handful of buildings stand right against each other in real towns; a few one-tile clashes are expected.
    const count = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);
    expect(count(overlapping)).toBeLessThanOrEqual(5);
    // Some gates are two tiles wide (centered on a whole tile); every other building fits its catalog size.
    expect(Object.keys(sizeMismatch).filter((k) => k !== 'palisade-gate')).toEqual([]);
    // Walls and gates can run to the water's edge; every other building must stand on land.
    for (const b of plan.buildings.filter((x) => !x.typeId.startsWith('palisade-'))) {
      const f = footprint(b);
      for (let y = f.y; y < f.y + f.h; y++)
        for (let x = f.x; x < f.x + f.w; x++) expect(map.terrain[y * map.size + x]).not.toBe(Terrain.Water);
    }
  });
});
