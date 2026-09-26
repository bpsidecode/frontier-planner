import { describe, expect, it } from 'vitest';
import { Plan, footprint, center, type Placed } from '../src/model/plan';
import { breakdown, computeField, effectAt, pointDesirability } from '../src/model/desirability';
import { evaluateHouses, houseLevel, summarize } from '../src/model/houses';
import { BUILDINGS } from '../src/data/buildings';

const P = (typeId: string, x: number, y: number, rot = 0, id = 0): Placed => ({ id, typeId, x, y, rot });

describe('catalog', () => {
  it('has unique ids and sane sizes', () => {
    const ids = new Set(BUILDINGS.map((b) => b.id));
    expect(ids.size).toBe(BUILDINGS.length);
    for (const b of BUILDINGS) {
      expect(b.w).toBeGreaterThan(0);
      expect(b.h).toBeGreaterThan(0);
    }
  });
});

describe('effectAt', () => {
  const tc = P('town-center', 0, 0); // center (3, 3), +10%, 200 m

  it('falls off linearly to half at max range', () => {
    expect(effectAt(tc, 8, 3)).toBeCloseTo(0.1 * (1 - 0.5 * 25 / 200)); // 5 tiles = 25 m
    expect(effectAt(tc, 43, 3)).toBeCloseTo(0.05); // exactly 200 m
    expect(effectAt(tc, 43.2, 3)).toBe(0);
  });

  it('gives constant buildings full value throughout their range', () => {
    const stable = P('stable', 0, 0); // 3x4, center (1.5, 2), -30%, 50 m
    expect(effectAt(stable, 1.5, 11.9)).toBeCloseTo(-0.3);
    expect(effectAt(stable, 1.5, 12.1)).toBe(0);
  });
});

describe('stacking', () => {
  it('only counts the strongest source for a shared tag', () => {
    const a = P('market', 0, 0, 0, 1);
    const b = P('market-square', 10, 0, 0, 2);
    const at = { x: 6, y: 2 };
    const expected = Math.max(effectAt(a, at.x, at.y), effectAt(b, at.x, at.y));
    expect(pointDesirability([a, b], at.x, at.y)).toBeCloseTo(expected);
    const parts = breakdown([a, b], at.x, at.y);
    expect(parts.filter((p) => p.counted)).toHaveLength(1);
  });

  it('adds sources with different tags', () => {
    const market = P('market', 0, 0, 0, 1);
    const well = P('basic-well', 6, 0, 0, 2);
    const sum = effectAt(market, 5, 5) + effectAt(well, 5, 5);
    expect(pointDesirability([market, well], 5, 5)).toBeCloseTo(sum);
  });

  it('adds untagged sources freely', () => {
    const a = P('flower-urn', 5, 5, 0, 1);
    const b = P('flower-urn', 6, 5, 0, 2);
    expect(pointDesirability([a, b], 5.5, 6)).toBeCloseTo(effectAt(a, 5.5, 6) + effectAt(b, 5.5, 6));
  });
});

describe('computeField', () => {
  it('matches pointDesirability at tile centers', () => {
    const bs = [
      P('town-center', 40, 40, 0, 1),
      P('market', 30, 30, 0, 2),
      P('market-square', 36, 30, 0, 3),
      P('compost-yard', 55, 45, 0, 4),
      P('stable', 20, 60, 1, 5),
      P('flower-urn', 45, 50, 0, 6),
    ];
    const field = computeField(bs);
    for (const [x, y] of [[0, 0], [33, 33], [50, 44], [21, 61], [45, 51], [99, 99], [43, 43]]) {
      expect(field[y * 100 + x]).toBeCloseTo(pointDesirability(bs, x + 0.5, y + 0.5), 5);
    }
  });
});

describe('plan', () => {
  it('rotation swaps the footprint', () => {
    const lib = P('library', 10, 10, 1);
    expect(footprint(lib)).toEqual({ x: 10, y: 10, w: 4, h: 3 });
  });

  it('rejects overlaps and out-of-bounds placements', () => {
    const plan = new Plan();
    expect(plan.add({ typeId: 'house', x: 0, y: 0, rot: 0 })).not.toBeNull();
    expect(plan.add({ typeId: 'house', x: 2, y: 2, rot: 0 })).toBeNull();
    expect(plan.add({ typeId: 'house', x: 98, y: 0, rot: 0 })).toBeNull();
    expect(plan.add({ typeId: 'house', x: 3, y: 0, rot: 0 })).not.toBeNull();
  });

  it('moves and rotates around the center', () => {
    const plan = new Plan();
    const lib = plan.add({ typeId: 'library', x: 10, y: 10, rot: 0 })!; // 3x4, center (11.5, 12)
    expect(plan.rotate(lib.id)).toBe(true);
    expect(footprint(lib)).toEqual({ x: 10, y: 11, w: 4, h: 3 });
    expect(center(lib).cx).toBeCloseTo(12);
    expect(plan.update(lib.id, { x: 50, y: 50 })).toBe(true);
    expect(plan.at(51, 51)?.id).toBe(lib.id);
    expect(plan.at(11, 11)).toBeUndefined();
  });

  it('round-trips through JSON and drops invalid entries', () => {
    const plan = new Plan();
    plan.add({ typeId: 'house', x: 5, y: 5, rot: 0 });
    plan.add({ typeId: 'crop-field', x: 20, y: 20, rot: 0, w: 8, h: 6 });
    const data = plan.toJSON();
    data.buildings.push({ id: 99, typeId: 'nope', x: 0, y: 0, rot: 0 });
    data.buildings.push({ id: 100, typeId: 'house', x: 6, y: 6, rot: 0 }); // overlaps
    const back = Plan.fromJSON(JSON.parse(JSON.stringify(data)));
    expect(back.buildings).toHaveLength(2);
    expect(footprint(back.buildings[1])).toEqual({ x: 20, y: 20, w: 8, h: 6 });
  });
});

describe('house levels', () => {
  it.each([
    [-20, 'Shelter'],
    [0, 'Shelter'],
    [29.99, 'Shelter'],
    [30, 'Homestead'],
    [64.9, 'Homestead'],
    [65, 'Large House'],
    [84.9, 'Large House'],
    [85, 'Manor'],
    [99.9, 'Manor'],
    [100, 'Estate'],
    [140, 'Estate'],
  ])('%s%% → %s', (pct, name) => {
    expect(houseLevel(pct).name).toBe(name);
  });

  it('counts population across levels', () => {
    // A lone house is a Shelter (4). Houses next to many untagged urns climb levels.
    const plan = new Plan();
    plan.add({ typeId: 'house', x: 80, y: 80, rot: 0 });
    const h = plan.add({ typeId: 'house', x: 10, y: 10, rot: 0 })!; // center (11.5, 11.5)
    // Surround with flower urns (+5% each, untagged) until the house reaches 100%.
    for (let y = 6; y <= 17 && evaluateHouses(plan.buildings)[1].pct < 100; y++)
      for (let x = 6; x <= 17 && evaluateHouses(plan.buildings)[1].pct < 100; x++)
        plan.add({ typeId: 'flower-urn', x, y, rot: 0 });
    const houses = evaluateHouses(plan.buildings);
    expect(houses.find((x) => x.building.id === h.id)!.level.name).toBe('Estate');
    const s = summarize(houses);
    expect(s.total).toBe(4 + 10);
    expect(s.byLevel.find((l) => l.level.name === 'Estate')!.count).toBe(1);
  });
});
