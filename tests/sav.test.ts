import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BUILDING_CLASSES, PREFAB_TYPES, TYPE, parseSave, readRecordTable } from '../src/import/sav';
import { BUILDING_BY_ID } from '../src/data/buildings';
import { ALL_OVERLAY_KEYS } from '../src/data/overlays';
import { markersAt } from '../src/model/markers';
import { Terrain, classifyTerrain, deserializeMap, serializeMap } from '../src/model/terrain';
import { importSaveBuildings } from '../src/model/mapImport';
import { footprint } from '../src/model/plan';
import { SaveMismatchError, planSaveExport, writeSaveEdits } from '../src/export/sav';

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

  // Four forageable records, one for each of the additional item kinds shown by the planner.
  const forage = (id: number, x: number, item: string) =>
    new Writer()
      .u32(id).u8(0).u8(0).point(x, 2.5)
      .zeros(28).str('ForageableResource').u8(0).u32(0)
      .zeros(38).u32(1).str(item).u32(1);
  record(out, 'forageableResource0', TYPE.ForageableResource, forage(20, 2.5, 'ItemBerries'));
  record(out, 'forageableResource1', TYPE.ForageableResource, forage(21, 7.5, 'ItemNuts'));
  record(out, 'forageableResource2', TYPE.ForageableResource, forage(22, 12.5, 'ItemMushroom'));
  record(out, 'forageableResource3', TYPE.ForageableResource, forage(23, 17.5, 'ItemEggs'));

  // Town center at world (10, 10), no parent transform, no rotation → tile (2, 2). Header is
  // id, hasParent, pad, position, quaternion (x, y, z, w), scale, class name, then building data.
  const tc = new Writer().u32(42).u8(0).u8(0).point(10, 10).f32(0).f32(0).f32(0).f32(1).f32(1).f32(1).f32(1).str('TownCenter').zeros(32);
  record(out, 'townCenter', 3556611327, tc);
  // A cabin rotated 90° (quaternion y = w = √½), an unknown class that is reported, and a tree that is neither imported nor reported.
  // Turned sideways the cabin is 2 × 3 tiles, so its center sits on a tile edge across and mid-tile down.
  // Its occupied-tile block comes after some unrelated bytes: center, size (10 × 15 m), flag, count, tile centers.
  const s = Math.SQRT1_2;
  const cabin = new Writer().u32(43).u8(0).u8(0).point(10, 12.5).f32(0).f32(s).f32(0).f32(s).f32(1).f32(1).f32(1).str('HunterBuilding').zeros(7);
  cabin.point(10, 12.5).f32(10).f32(1).f32(15).u8(1).u32(6);
  for (const z of [7.5, 12.5, 17.5]) for (const x of [7.5, 12.5]) cabin.f32(x).f32(z);
  record(out, 'hunterBuilding', 1, cabin.zeros(8));
  record(out, 'treeResource', 2, new Writer().u32(45).u8(0).u8(0).point(5, 5).f32(0).f32(0).f32(0).f32(1).f32(1).f32(1).f32(1).str('TreeResource').zeros(32));
  record(out, 'mysteryBuilding', 2, new Writer().u32(44).u8(0).u8(0).point(5, 5).f32(0).f32(0).f32(0).f32(1).f32(1).f32(1).f32(1).str('Mystery').zeros(32));
  // A straight road spline across the bottom row. The importer turns the continuous curve into
  // four editable 1×1 Road objects, one for each crossed grid cell.
  record(
    out,
    'splineRoadContainer0',
    TYPE.SplineRoadContainer,
    new Writer()
      .u32(45).u32(1).u32(0)
      .point(17.5, 17.5).point(12.5, 17.5).point(7.5, 17.5).point(2.5, 17.5)
      .f32(0).f32(15).zeros(63),
  );
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
    expect(map.forageables).toEqual([
      { kind: 'berries', x: 3.5, y: 0.5 },
      { kind: 'nuts', x: 2.5, y: 0.5 },
      { kind: 'mushrooms', x: 1.5, y: 0.5 },
      { kind: 'eggs', x: 0.5, y: 0.5 },
    ]);
  });

  it('classifies water and steep terrain', () => {
    for (let c = 0; c < N; c++) expect(map.terrain[c]).toBe(Terrain.Water);
    // The 30 m spike at [3][3] → row 3, col 0 is steep, as is its neighbour.
    expect(map.terrain[3 * N + 0]).toBe(Terrain.Steep);
    expect(map.terrain[3 * N + 1]).toBe(Terrain.Steep);
    expect(map.terrain[2 * N + 2]).toBe(Terrain.Land);
  });

  it('has visible overlay and tooltip metadata for every forageable kind', () => {
    const visible = new Set(ALL_OVERLAY_KEYS);
    const labels: Record<string, string> = { berries: 'Berries', nuts: 'Nuts', mushrooms: 'Mushrooms', eggs: 'Eggs' };
    for (const f of map.forageables) expect(markersAt(map, visible, f.x, f.y)).toContain(labels[f.kind]);
  });

  it('converts point positions to tiles with mirrored x', () => {
    const clay = map.minerals.find((m) => m.kind === 'clay')!;
    expect(clay).toMatchObject({ x: 1, y: 2, r: 1, amount: 1000, deep: false });
    const iron = map.minerals.find((m) => m.kind === 'iron')!;
    expect(iron).toMatchObject({ x: 3, y: 1, r: 0.5, amount: 500, deep: true });
    expect(map.buildings).toEqual([
      { typeId: 'town-center', x: 2, y: 2, rot: 0 },
      { typeId: 'hunter-cabin', x: 2, y: 2.5, rot: 1, size: { w: 2, h: 3 }, rec: { pos: expect.any(Number), block: expect.any(Number) } },
      { typeId: 'road', x: 0.5, y: 3.5, rot: 0 },
      { typeId: 'road', x: 1.5, y: 3.5, rot: 0 },
      { typeId: 'road', x: 2.5, y: 3.5, rot: 0 },
      { typeId: 'road', x: 3.5, y: 3.5, rot: 0 },
    ]);
    expect(map.notImported).toEqual({ 'Crop fields': 1 });
    expect(map.unknownBuildingClasses).toEqual({ Mystery: 1 });
  });

  it('round-trips through serialization', () => {
    const back = deserializeMap(JSON.parse(JSON.stringify(serializeMap(map))))!;
    expect(back.size).toBe(N);
    expect(Array.from(back.terrain)).toEqual(Array.from(map.terrain));
    expect(Array.from(back.fertility)).toEqual(Array.from(map.fertility));
    expect(back.minerals).toEqual(map.minerals);
    expect(back.unknownBuildingClasses).toEqual({ Mystery: 1 });
  });

  it('rejects files that are not saves', () => {
    expect(() => parseSave(new Uint8Array([1, 0, 0, 0, 128, 7, 0, 0, 65]).buffer)).toThrow();
  });
});

describe('save export (synthetic)', () => {
  const buf = syntheticSave();
  const fresh = () => {
    const map = parseSave(buf, 'Test.sav');
    const plan = importSaveBuildings(map).plan;
    plan.setBlocked(null);
    // Clear the imported road tiles so the cabin has room to move and turn.
    for (const r of plan.buildings.filter((b) => b.typeId === 'road')) plan.remove(r.id);
    const cabin = plan.buildings.find((b) => b.typeId === 'hunter-cabin')!;
    return { map, plan, cabin };
  };
  const f32 = (b: ArrayBuffer, o: number) => new DataView(b).getFloat32(o, true);

  it('finds nothing to write in an unchanged plan', () => {
    const map = parseSave(buf, 'Test.sav');
    const plan = importSaveBuildings(map).plan;
    expect(planSaveExport(plan, map)).toEqual({ edits: [], notWritten: {}, needsReimport: false });
  });

  it('writes a move into the building header and its tile block', () => {
    const { map, plan, cabin } = fresh();
    expect(footprint(cabin)).toEqual({ x: 1, y: 1, w: 2, h: 3 });
    expect(plan.update(cabin.id, { x: 0 })).toBe(true);
    const ex = planSaveExport(plan, map);
    expect(ex.edits).toHaveLength(1);
    expect(ex.edits[0]).toMatchObject({ rotated: false, rect: { x: 0, y: 1, w: 2, h: 3 } });
    expect(ex.notWritten).toEqual({ 'Deleted road tiles': 2 });

    const out = writeSaveEdits(buf, map, ex.edits);
    expect(out.byteLength).toBe(buf.byteLength);
    const back = parseSave(out, 'Test.sav');
    const moved = back.buildings.find((b) => b.typeId === 'hunter-cabin')!;
    expect(moved).toMatchObject({ x: 1, y: 2.5, rot: 1, size: { w: 2, h: 3 } });
    // Tile centers: rows by world z, each row in world x ascending (planner columns 1 then 0).
    const { block } = moved.rec!;
    const tiles = Array.from({ length: 6 }, (_, k) => [f32(out, block + 29 + k * 8), f32(out, block + 33 + k * 8)]);
    expect(tiles).toEqual([[12.5, 7.5], [17.5, 7.5], [12.5, 12.5], [17.5, 12.5], [12.5, 17.5], [17.5, 17.5]]);
    // The original buffer is untouched.
    expect(parseSave(buf, 'Test.sav').buildings.find((b) => b.typeId === 'hunter-cabin')!.x).toBe(2);
  });

  it('writes a rotation as an upright quarter turn and swaps the block size', () => {
    const { map, plan, cabin } = fresh();
    expect(plan.rotate(cabin.id)).toBe(true);
    const ex = planSaveExport(plan, map);
    expect(ex.edits).toMatchObject([{ rot: 2, rotated: true }]);
    const out = writeSaveEdits(buf, map, ex.edits);
    const turned = parseSave(out, 'Test.sav').buildings.find((b) => b.typeId === 'hunter-cabin')!;
    expect(turned).toMatchObject({ rot: 2, size: { w: 3, h: 2 } });
    const { pos } = turned.rec!;
    expect(f32(out, pos + 12)).toBe(0);
    expect(f32(out, pos + 16)).toBeCloseTo(1, 6); // yaw 180°: qy = sin 90°
    expect(f32(out, pos + 24)).toBeCloseTo(0, 6);
  });

  it('refuses a file that is not the imported save', () => {
    const { map, plan, cabin } = fresh();
    plan.update(cabin.id, { x: 0 });
    const ex = planSaveExport(plan, map);
    const other = writeSaveEdits(buf, map, ex.edits); // the cabin is no longer where the import found it
    expect(() => writeSaveEdits(other, map, ex.edits)).toThrow(SaveMismatchError);
  });

  it('lists the changes it cannot write back', () => {
    const { map, plan, cabin } = fresh();
    expect(plan.add({ typeId: 'small-plaza', x: 0, y: 0, rot: 0 })).not.toBeNull();
    plan.replaceType(cabin.id, 'hunter-lodge');
    plan.flattened.push({ x: 0, y: 0, w: 2, h: 2 });
    const ex = planSaveExport(plan, map);
    expect(ex.edits).toEqual([]);
    expect(ex.notWritten).toEqual({
      'Added buildings': 1,
      'Upgraded or downgraded buildings': 1,
      'Deleted road tiles': 2,
      'Flattened areas': 1,
    });
    plan.remove(cabin.id);
    expect(planSaveExport(plan, map).notWritten['Deleted buildings']).toBe(1);
  });

  it('asks for a re-import when the map has no record positions', () => {
    const map = parseSave(buf, 'Test.sav');
    const plan = importSaveBuildings(map).plan;
    for (const b of map.buildings) delete b.rec;
    expect(planSaveExport(plan, map).needsReimport).toBe(true);
  });
});

describe('building lookups', () => {
  it('map every save class and prefab to a catalog building', () => {
    for (const id of [...Object.values(BUILDING_CLASSES), ...Object.values(PREFAB_TYPES)]) expect(BUILDING_BY_ID[id], id).toBeDefined();
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
    expect([256, 384, 512]).toContain(map.size);
    // Unity positions at the exact map edge can pick up tiny float32 roundoff.
    const inside = (p: { x: number; y: number }) => p.x >= -0.001 && p.y >= -0.001 && p.x <= map.size + 0.001 && p.y <= map.size + 0.001;
    for (const [name, list] of Object.entries({
      minerals: map.minerals,
      forageables: map.forageables,
      enemies: map.enemies,
      ruins: map.ruins,
      buildings: map.buildings,
      spawns: map.spawns,
    }))
      expect(list.filter((p) => !inside(p)), `${name} outside map`).toEqual([]);
    const count = (k: string) => map.minerals.filter((m) => m.kind === k).length;
    console.log('minerals', ['clay', 'sand', 'stone', 'iron', 'gold', 'coal'].map((k) => `${k}:${count(k)}`).join(' '));
    console.log('forageables', map.forageables.length, 'spawns', map.spawns.length, 'enemies', map.enemies.length, 'ruins', map.ruins.length, 'bonus', map.fertilityBonus.length);
    expect(map.minerals.length).toBeGreaterThan(0);
    expect(map.forageables.length).toBeGreaterThan(0);
    expect(map.spawns.length).toBeGreaterThan(0);
  });

  it('has catalog footprints in the game\'s unrotated orientation', () => {
    // Each building record stores the tiles it occupies, as placed. Rotating the catalog's w×h by the
    // save's rotation must give the same size, or the planner and the game disagree on orientation.
    const wrong = new Map<string, string>();
    let checked = 0;
    for (const b of map.buildings) {
      if (!b.size) continue;
      const t = BUILDING_BY_ID[b.typeId];
      if (t.variable) continue;
      checked++;
      const exp = b.rot % 2 ? { w: t.h, h: t.w } : { w: t.w, h: t.h };
      // Gates centered as if two tiles wide import as the Wide Gate.
      const wide = b.typeId === 'palisade-gate' && b.size.w * b.size.h === 2;
      if (!wide && (exp.w !== b.size.w || exp.h !== b.size.h))
        wrong.set(b.typeId, `save ${b.size.w}×${b.size.h} at rot ${b.rot}, catalog ${t.w}×${t.h}`);
    }
    console.log('footprints checked', checked);
    expect(checked).toBeGreaterThan(0);
    expect(Object.fromEntries(wrong)).toEqual({});
  });

  it('writes moved and rotated buildings back without disturbing anything else', () => {
    const plan = importSaveBuildings(map).plan;
    plan.setBlocked(null);
    const tryMove = (pick: (b: (typeof plan.buildings)[number]) => boolean) => {
      for (const b of plan.buildings.filter(pick))
        for (let d = 1; d <= 8; d++)
          for (const [dx, dy] of [[d, 0], [-d, 0], [0, d], [0, -d]])
            if (plan.update(b.id, { x: b.x + dx, y: b.y + dy })) return b;
      return null;
    };
    const well = tryMove((b) => b.typeId === 'basic-well' && !!b.src);
    const turned = plan.buildings.find((b) => {
      const f = footprint(b);
      return b.src && f.w !== f.h && b.typeId !== 'road' && plan.rotate(b.id);
    });
    expect(well).toBeTruthy();
    expect(turned).toBeTruthy();
    const ex = planSaveExport(plan, map);
    expect(ex.edits.map((e) => e.i).sort()).toEqual([well!.src!.i, turned!.src!.i].sort());

    const out = writeSaveEdits(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, map, ex.edits);
    const back = parseSave(out, 'real.sav');
    expect(back.buildings).toHaveLength(map.buildings.length);
    const changed = new Set(ex.edits.map((e) => e.i));
    back.buildings.forEach((b, i) => {
      const a = map.buildings[i];
      // The importer marks buildings it couldn't place; a fresh parse has no such flag.
      const { skipped: _skipped, ...original } = a;
      if (!changed.has(i)) expect(b, `building ${i}`).toEqual(original);
    });
    for (const e of ex.edits) {
      const b = back.buildings[e.i];
      expect(b.x).toBeCloseTo(e.rect.x + e.rect.w / 2, 3);
      expect(b.y).toBeCloseTo(e.rect.y + e.rect.h / 2, 3);
      expect(b.rot).toBe(e.rot);
      expect(b.size).toEqual({ w: e.rect.w, h: e.rect.h });
    }
  });

  it('imports the town onto land', () => {
    const { plan, imported, overlapping, sizeMismatch } = importSaveBuildings(map);
    console.log('imported', JSON.stringify(imported));
    console.log('overlapping', JSON.stringify(overlapping), 'sizeMismatch', JSON.stringify(sizeMismatch));
    console.log('notImported', JSON.stringify(map.notImported));
    // A handful of buildings stand right against each other in real towns; a few one-tile clashes are expected.
    // Road cells beneath gates and building entrances are deliberately skipped because the plan has one object per tile.
    const count = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);
    expect(count({ ...overlapping, road: 0 })).toBeLessThanOrEqual(5);
    // Every building's center fits its catalog size (wide gates are detected from their offsets).
    expect(sizeMismatch).toEqual({});
    // Walls and gates can run to the water's edge; every other building must stand on land.
    for (const b of plan.buildings.filter((x) => !x.typeId.startsWith('palisade-'))) {
      const f = footprint(b);
      for (let y = f.y; y < f.y + f.h; y++)
        for (let x = f.x; x < f.x + f.w; x++) expect(map.terrain[y * map.size + x]).not.toBe(Terrain.Water);
    }
  });
});
