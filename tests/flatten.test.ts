import { describe, expect, it } from 'vitest';
import { applyFlattens, flattenProblem, groundFor, previewFlatten } from '../src/model/flatten';
import { Plan } from '../src/model/plan';
import { Terrain, classifyTerrain, deserializeMap, hillshade, serializeMap, type MapData } from '../src/model/terrain';

const N = 6;

/** A 6×6 map: flat 10 m ground with a 16 m step on columns 3–5, and one water tile at (0, 5). */
function testMap(): MapData {
  const heights = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) heights[y * N + x] = x >= 3 ? 16 : 10;
  heights[5 * N + 0] = 1;
  const zeros = new Uint8Array(N * N);
  return {
    name: 't',
    version: '1.1.2',
    size: N,
    heights,
    terrain: classifyTerrain(heights, N),
    shade: hillshade(heights, N),
    fertility: zeros,
    fodder: zeros,
    water: zeros,
    minerals: [],
    forageables: [],
    spawns: [],
    enemies: [],
    ruins: [],
    fertilityBonus: [],
    buildings: [],
    notImported: {},
    unknownBuildingClasses: {},
  };
}

describe('flattening', () => {
  it('sets an area to its average height and leaves the rest alone', () => {
    const map = testMap();
    const h = applyFlattens(map.heights!, N, [{ x: 2, y: 0, w: 2, h: 2 }]);
    for (const [x, y] of [[2, 0], [3, 0], [2, 1], [3, 1]]) expect(h[y * N + x]).toBe(13);
    expect(h[2 * N + 2]).toBe(10);
    expect(map.heights![0 * N + 2]).toBe(10); // the map's own heights are untouched
  });

  it('applies areas in order', () => {
    const map = testMap();
    const h = applyFlattens(map.heights!, N, [
      { x: 2, y: 0, w: 2, h: 1 }, // → 13, 13
      { x: 3, y: 0, w: 2, h: 1 }, // (13 + 16) / 2
    ]);
    expect(h[2]).toBe(13);
    expect(h[3]).toBe(14.5);
    expect(h[4]).toBe(14.5);
  });

  it('frees steep tiles inside the area and steepens the ground next to it', () => {
    const map = testMap();
    // The 6 m step makes columns 2 and 3 steep.
    expect(map.terrain[2]).toBe(Terrain.Steep);
    expect(map.terrain[3]).toBe(Terrain.Steep);
    const r = { x: 2, y: 0, w: 2, h: 6 };
    const before = groundFor(map, []);
    const p = previewFlatten(before, N, r);
    expect(p.problem).toBeUndefined();
    expect(p.target).toBe(13);
    expect(p.maxRaise).toBe(3);
    expect(p.maxLower).toBe(3);
    expect(p.cutM3).toBe(6 * 3 * 25);
    expect(p.fillM3).toBe(6 * 3 * 25);

    // After levelling both columns to 13 m, each is only 3 m from its outside neighbor: buildable.
    const after = groundFor(map, [r]);
    for (let y = 0; y < N; y++) {
      expect(after.terrain[y * N + 2]).toBe(Terrain.Land);
      expect(after.terrain[y * N + 3]).toBe(Terrain.Land);
      expect(after.blocked[y * N + 2]).toBe(0);
    }
    const changedTiles = (from: number, to: number) =>
      Array.from(after.terrain).filter((t, i) => before.terrain[i] === from && t === to).length;
    expect(p.freed).toBe(changedTiles(Terrain.Steep, Terrain.Land));
    expect(p.newlySteep).toBe(changedTiles(Terrain.Land, Terrain.Steep));
  });

  it('counts neighbors that become steep', () => {
    const map = testMap();
    // Raise column 4 to 18 m: only 2 m above column 3, so not steep. Levelling columns 1–3 lowers
    // column 3 to 12 m, and column 4 now faces a 6 m drop.
    for (let y = 0; y < N; y++) map.heights![y * N + 4] = 18;
    map.terrain = classifyTerrain(map.heights!, N);
    const ground = groundFor(map, []);
    const r = { x: 1, y: 0, w: 3, h: 6 }; // 10, 10, 16 → 12 m
    const p = previewFlatten(ground, N, r);
    const after = groundFor(map, [r]);
    expect(after.terrain[0 * N + 4]).toBe(Terrain.Steep); // 18 next to 12
    expect(p.newlySteep).toBe(
      Array.from(after.terrain).filter((t, i) => ground.terrain[i] === Terrain.Land && t === Terrain.Steep).length,
    );
  });

  it('refuses water, the map edge and maps without heights', () => {
    const map = testMap();
    const ground = groundFor(map, []);
    expect(flattenProblem(ground, N, { x: 0, y: 4, w: 2, h: 2 })).toMatch(/water/);
    expect(flattenProblem(ground, N, { x: 5, y: 0, w: 2, h: 1 })).toMatch(/edge/);
    expect(flattenProblem(ground, N, { x: 1, y: 1, w: 1, h: 1 })).toMatch(/two tiles/);
    delete map.heights;
    expect(flattenProblem(groundFor(map, []), N, { x: 1, y: 1, w: 2, h: 2 })).toMatch(/import the save again/);
  });

  it('saves flattened areas with the plan', () => {
    const plan = new Plan(N);
    plan.flattened.push({ x: 2, y: 0, w: 2, h: 6 });
    const back = Plan.fromJSON(JSON.parse(JSON.stringify(plan.toJSON())));
    expect(back.flattened).toEqual([{ x: 2, y: 0, w: 2, h: 6 }]);
    // Version 2 plans have none; out-of-bounds areas are dropped.
    expect(Plan.fromJSON({ version: 2, size: N, buildings: [] }).flattened).toEqual([]);
    expect(Plan.fromJSON({ version: 3, size: N, buildings: [], flattened: [{ x: 5, y: 5, w: 2, h: 2 }] }).flattened).toEqual([]);
  });

  it('lets buildings onto flattened ground once the plan has the new mask', () => {
    const map = testMap();
    const plan = new Plan(N, groundFor(map, []).blocked);
    const spot = { typeId: 'basic-well', x: 2, y: 0, rot: 0 };
    expect(plan.add(spot)).toBeNull();
    plan.flattened.push({ x: 2, y: 0, w: 2, h: 6 });
    plan.setBlocked(groundFor(map, plan.flattened).blocked);
    expect(plan.add(spot)).not.toBeNull();
  });

  it('keeps heights through map serialization', () => {
    const map = testMap();
    const back = deserializeMap(JSON.parse(JSON.stringify(serializeMap(map))))!;
    // Stored to the centimeter.
    back.heights!.forEach((v, i) => expect(v).toBeCloseTo(map.heights![i], 2));
    const old = serializeMap(map) as Record<string, unknown>;
    delete old.heights;
    expect(deserializeMap(JSON.parse(JSON.stringify(old)))!.heights).toBeUndefined();
  });
});
