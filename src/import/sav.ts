// Farthest Frontier .sav reader. Ported from the parts of mikh-abc/ff-game-map
// (FileDataReader.cpp, DataReader.cpp, StaticData.cpp, Apache-2.0) that locate terrain,
// resources, animal spawns, enemies and buildings.

import {
  classifyTerrain,
  hillshade,
  type AnimalKind,
  type EnemyKind,
  type FertilityBonus,
  type ForageKind,
  type MapData,
  type Mineral,
  type MineralKind,
  type Point,
  type RuinKind,
  type SaveBuilding,
  type SpawnArea,
} from '../model/terrain';

/** Record type ids from StaticData.cpp (BaseTypeById). */
export const TYPE = {
  MetaData: 3982492927,
  AgricultureManager: 2116582911,
  AnimalManager: 1357454847,
  MineralManager: 274602495,
  ForageableResource: 912881919,
  TerrainManager: 1767231999,
  WolfDen: 1676811007,
  RaiderCamp: 1974594303,
  Raider: 545559295,
  BatteringRam: 2094352639,
  TownCenter: 3556611327,
  Shelter: 2831428095,
  RelicExtraction: 2012388863,
  SalvagingSite: 117926143,
} as const;

const ITEM_FILLER = 417;
const SPAWN_AREA_M = 64;
/** Spawn dens are drawn as a small square this many meters across. */
const DEN_M = 15;
/** AgricultureInfo::DataType indexes; 12 floats per cell. */
const AGRI_LAYERS = 12;
const AGRI_ENV_FERTILITY = 0;
const AGRI_FODDER = 4;
const AGRI_WATER = 8;

const SPAWN_UUIDS: Record<string, AnimalKind> = {
  '7361af1e-8897-4099-b372-dfe646d10328': 'bear',
  'ac4a8fd7-b9cb-44e4-be78-105e11c07bd1': 'bear',
  '621e052e-99cb-483f-8cd8-6f0612e6d32c': 'bear',
  'ad9b2d3d-30fb-49a8-a688-724ec2dd3c1d': 'boar',
  'f0e7a583-81bc-4efe-8723-d5f3a602420d': 'boar',
  '9347bbe9-23eb-4f2a-90ab-f9620a2d8665': 'boar',
  '037681cb-0f6a-4431-bd1d-a62f629bad73': 'boar',
  'b4849983-c710-48e9-9d47-93f65369640b': 'deer',
  '6b4c3a15-9875-467e-83da-c9dc121fae87': 'deer',
  '1b89ffdd-78ca-4dc0-bbd4-cd81cda57fe1': 'deer',
  '9f9d0ef7-becd-4ddd-b219-2cc3898d930e': 'deer',
  '301d292d-b239-45fe-a021-83e1a08f1d69': 'wolf',
  '2fb21f39-f10a-43f2-80f2-cde6e225ef6e': 'wolf',
  '43c882e6-a835-4a85-a028-186c8a53e855': 'wolf',
  'ef151ac7-4e23-4687-95a5-bb9cd76eb28a': 'wolf',
  'c8ec56cb-e421-4d59-90cd-513dfe95d1a2': 'wolf',
  '95de49e0-f4dd-4f77-967c-c6832732585a': 'wolf',
  '6740a8ab-3747-4287-ab82-dd2b0d999c7c': 'wolf',
  '73212ffa-d2d9-4b27-b07c-4ef6b62edf86': 'wolf',
};

const FORAGE_ITEMS: Record<string, ForageKind> = {
  ItemGreens: 'greens',
  ItemHerbs: 'herbs',
  ItemRoots: 'roots',
  ItemWillow: 'willow',
};

const DEPOSIT_KINDS: Record<number, MineralKind> = { 0: 'iron', 1: 'gold', 2: 'coal' };

/**
 * Player buildings: the class name stored in each building record → planner catalog id.
 * Upgrade tiers aren't decoded yet, so upgradable buildings import at their base tier.
 */
export const BUILDING_CLASSES: Record<string, string> = {
  TownCenter: 'town-center',
  Shelter: 'house',
  TemporaryShelter: 'temporary-shelter',
  Academy: 'academy',
  Apiary: 'apiary',
  ArboristBuilding: 'arborist-building',
  Armory: 'armory',
  Bakery: 'bakery',
  Barn: 'barn',
  Barracks: 'barracks',
  BasketShop: 'basket-shop',
  BlacksmithForge: 'blacksmith-forge',
  BookBinder: 'book-binder',
  Brewery: 'brewery',
  Brickyard: 'brickyard',
  CandleShop: 'candle-shop',
  CharcoalKiln: 'charcoal-kiln',
  Cheesemaker: 'cheesemaker',
  ChickenCoop: 'chicken-coop',
  ClayPitBuilding: 'clay-pit',
  CoalMine: 'coal-mine',
  CobblerShop: 'cobbler-shop',
  CompostYard: 'compost-yard',
  CooperBuilding: 'cooper',
  Crypt: 'crypt',
  FestivalPole: 'festival-pole',
  FishingShack: 'fishing-shack',
  Flagpole: 'flag-pole',
  FletcherBuilding: 'fletcher-building',
  ForagerShack: 'forager-shack',
  Foundry: 'foundry',
  Gate: 'palisade-gate',
  Glassmaker: 'glassmaker',
  GoatBarn: 'goat-barn',
  GoldMine: 'gold-mine',
  Granary: 'granary',
  // Towers sit on wall tiles; 1×1 is the only size that doesn't collide with the walls around them.
  GuardTower: 'lookout-tower',
  HealersHouse: 'healers-house',
  HunterBuilding: 'hunter-cabin',
  IronMine: 'iron-mine',
  LargeStatue: 'large-statue',
  Library: 'library',
  MarketBuilding: 'market',
  MediumStatue: 'medium-statue',
  OrnamentalTree: 'ornamental-tree',
  PaperMill: 'paper-mill',
  PotterBuilding: 'potter-building',
  Preservist: 'preservist-building',
  Pub: 'pub',
  RatCatcherBuilding: 'rat-catcher',
  RootCellar: 'root-cellar',
  SandPitBuilding: 'sand-pit',
  SawPitBuilding: 'saw-pit',
  School: 'school',
  ShrineMedium: 'shrine',
  SmokeHouse: 'smokehouse',
  SoapShop: 'soap-shop',
  Stockyard: 'stockyard',
  StonePit: 'quarry',
  StorageDepot: 'storage-depot',
  Storehouse: 'storehouse',
  Tannery: 'tannery',
  Temple: 'temple',
  Theater: 'theater',
  TradingPost: 'trading-post',
  Treasury: 'treasury',
  Urn: 'flower-urn',
  WagonShop: 'wagon-shop',
  Wall: 'palisade-wall',
  WeaverBuilding: 'weaver-building',
  Well: 'basic-well',
  Windmill: 'windmill',
  WoodCutterBuilding: 'firewood-splitter',
  WorkCamp: 'work-camp',
};

/** Save records (by name prefix) that are player-built but not imported yet. */
const NOT_IMPORTED: Record<string, string> = {
  cropField: 'Crop fields',
  grazingArea: 'Pastures',
  graveyard: 'Graveyards',
  splineRoadContainer: 'Road segments',
  bridgeContainer: 'Bridges',
  buildingBuildSite: 'Construction sites',
  gateBuildSite: 'Construction sites',
};

export class SaveFormatError extends Error {}

class Reader {
  private dv: DataView;
  private dec = new TextDecoder('latin1');
  constructor(
    private buf: ArrayBuffer,
    public pos = 0,
  ) {
    this.dv = new DataView(buf);
  }
  get length() {
    return this.buf.byteLength;
  }
  u8() {
    return this.dv.getUint8(this.pos++);
  }
  u32() {
    const v = this.dv.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }
  f32() {
    const v = this.dv.getFloat32(this.pos, true);
    this.pos += 4;
    return v;
  }
  skip(n: number) {
    this.pos += n;
    if (this.pos > this.length) throw new RangeError('read past end');
  }
  /** u8 length-prefixed string (readArray<quint8>). */
  str() {
    const n = this.u8();
    const s = this.dec.decode(new Uint8Array(this.buf, this.pos, n));
    this.pos += n;
    return s;
  }
  /** Vector3; returns ground-plane (x, z). */
  point(): { x: number; z: number } {
    const x = this.f32();
    this.skip(4);
    const z = this.f32();
    return { x, z };
  }
}

interface Span {
  /** Record name without its trailing index, e.g. "hunterBuilding". */
  name: string;
  /** First payload byte (after the type id and one pad byte). */
  start: number;
  /** One past the record's last byte. */
  end: number;
}

/** Payload spans of every record, grouped by type id (FileDataReader::loadSave). */
export function readRecordSpans(buf: ArrayBuffer): Map<number, Span[]> {
  const r = new Reader(buf);
  const table = new Map<number, Span[]>();
  while (r.pos < r.length) {
    r.skip(1); // component type
    const name = r.str().replace(/\d+$/, '');
    const size = r.u32();
    const start = r.pos;
    if (size < 4 || start + size > r.length) throw new SaveFormatError('This doesn’t look like a Farthest Frontier save');
    const id = r.u32();
    const list = table.get(id) ?? [];
    list.push({ name, start: start + 5, end: start + size });
    table.set(id, list);
    r.pos = start + size;
  }
  return table;
}

/** Payload offsets of every record, grouped by type id. */
export function readRecordTable(buf: ArrayBuffer): Map<number, number[]> {
  return new Map([...readRecordSpans(buf)].map(([id, spans]) => [id, spans.map((s) => s.start)]));
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Find the spawn-area dictionary inside the AnimalManager record: u32 count, then count × (u32 area, u8 36, uuid).
 * Picks the candidate with the most known spawn uuids whose area indexes fit the map.
 */
function findSpawnTable(buf: ArrayBuffer, start: number, end: number, maxKey: number): { key: number; uuid: string }[] {
  const dv = new DataView(buf);
  const dec = new TextDecoder('latin1');
  let best: { key: number; uuid: string }[] = [];
  let bestScore = 0;
  for (let p = start; p + 4 <= end; p++) {
    const n = dv.getUint32(p, true);
    if (n < 1 || n > maxKey || p + 4 + n * 41 > end) continue;
    const entries: { key: number; uuid: string }[] = [];
    let score = 0;
    for (let k = 0; k < n; k++) {
      const q = p + 4 + k * 41;
      const key = dv.getUint32(q, true);
      if (dv.getUint8(q + 4) !== 36 || key >= maxKey) break;
      const uuid = dec.decode(new Uint8Array(buf, q + 5, 36));
      if (!UUID_RE.test(uuid)) break;
      entries.push({ key, uuid });
      if (SPAWN_UUIDS[uuid]) score++;
    }
    if (entries.length === n && score > bestScore) {
      best = entries;
      bestScore = score;
    }
  }
  return best;
}

export function parseSave(buf: ArrayBuffer, fileName = 'save'): MapData {
  const spans = readRecordSpans(buf);
  const first = (id: number) => spans.get(id)?.[0]?.start;
  const all = (id: number) => (spans.get(id) ?? []).map((s) => s.start);
  const at = (pos: number) => new Reader(buf, pos);

  const agriPos = first(TYPE.AgricultureManager);
  const terrPos = first(TYPE.TerrainManager);
  if (agriPos == null || terrPos == null) throw new SaveFormatError('The save has no terrain data');

  // --- metadata
  let version = '';
  const metaPos = first(TYPE.MetaData);
  if (metaPos != null) {
    try {
      const r = at(metaPos);
      r.skip(4);
      version = r.str();
    } catch {
      /* optional */
    }
  }

  // --- agriculture grids: world size, then [i][j] cells of 12 floats; tile row = i, col = N-1-j
  const ag = at(agriPos);
  const worldM = ag.f32();
  ag.f32();
  const N = ag.u32();
  const nh = ag.u32();
  if (N !== nh || N < 2 || N > 2048) throw new SaveFormatError(`Unsupported map size ${N}×${nh}`);
  const cellM = worldM / N;
  const fertility = new Uint8Array(N * N);
  const fodder = new Uint8Array(N * N);
  const water = new Uint8Array(N * N);
  const q = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255);
  for (let i = 0; i < N; i++)
    for (let j = 0; j < N; j++) {
      const t = i * N + (N - 1 - j);
      const base = ag.pos;
      ag.pos = base + AGRI_ENV_FERTILITY * 4;
      fertility[t] = q(ag.f32());
      ag.pos = base + AGRI_FODDER * 4;
      fodder[t] = q(ag.f32());
      ag.pos = base + AGRI_WATER * 4;
      water[t] = q(ag.f32());
      ag.pos = base + AGRI_LAYERS * 4;
    }

  const toTile = (p: { x: number; z: number }) => ({ x: (worldM - p.x) / cellM, y: p.z / cellM });

  // --- heights (Terrain2Manager): skip tree/object/stump blocks, then mapSize² floats
  const tr = at(terrPos);
  tr.skip(tr.u32() * 96);
  tr.skip(tr.u32() * 104);
  tr.skip(tr.u32() * 12);
  tr.skip(tr.u32() * 122);
  const stumps = tr.u32();
  for (let s = 0; s < stumps; s++) {
    tr.skip(40);
    tr.str();
    tr.skip(4);
  }
  const hs = tr.u32();
  tr.u32();
  const heights = new Float32Array(N * N);
  for (let i = 0; i < hs; i++)
    for (let j = 0; j < hs; j++) {
      const v = tr.f32();
      if (hs === N) heights[i * N + (N - 1 - j)] = v;
      else {
        // Different resolution: nearest-neighbour into the agriculture grid.
        const row = Math.floor((i * N) / hs);
        const col = N - 1 - Math.floor((j * N) / hs);
        heights[row * N + col] = v;
      }
    }

  // --- minerals
  const minerals: Mineral[] = [];
  const fertilityBonus: FertilityBonus[] = [];
  const minPos = first(TYPE.MineralManager);
  if (minPos != null) {
    const r = at(minPos);
    const readDeposit = (kind: MineralKind) => {
      const p = toTile(r.point());
      const rad = r.f32() / cellM;
      const amount = r.u32();
      const deep = r.u8() !== 0;
      minerals.push({ kind, ...p, r: rad, amount, deep });
    };
    for (const kind of ['clay', 'sand', 'stone'] as const) {
      const n = r.u32();
      for (let k = 0; k < n; k++) readDeposit(kind);
    }
    const n = r.u32();
    for (let k = 0; k < n; k++) {
      r.u32(); // id
      const kind = DEPOSIT_KINDS[r.u32()];
      if (kind) readDeposit(kind);
      else r.skip(12 + 4 + 4 + 1);
    }
    const nb = r.u32();
    for (let k = 0; k < nb; k++) {
      const p = toTile(r.point());
      r.skip(12);
      const rad = r.f32() / cellM;
      r.f32(); // bonus
      fertilityBonus.push({ ...p, r: rad });
    }
  }

  // --- forageables (only the kinds the planner shows)
  const forageables: Point<ForageKind>[] = [];
  for (const pos of all(TYPE.ForageableResource)) {
    try {
      const r = at(pos);
      r.skip(4);
      if (r.u8()) r.skip(4);
      r.skip(1);
      const p = toTile(r.point());
      r.skip(28);
      r.str(); // resource class
      r.skip(1);
      const bundles = r.u32();
      for (let k = 0; k < bundles; k++) {
        r.str();
        r.skip(ITEM_FILLER + 4);
      }
      r.skip(5 + 33);
      const n = r.u32();
      for (let k = 0; k < n; k++) {
        const kind = FORAGE_ITEMS[r.str()];
        r.u32();
        if (kind) {
          forageables.push({ kind, ...p });
          break;
        }
      }
    } catch {
      /* skip unreadable record */
    }
  }

  // --- animal spawn areas (AnimalManager): a count-prefixed table of (u32 area index, uuid string).
  // The herd records before it changed shape across game versions, so locate the table directly.
  const spawns: SpawnArea[] = [];
  const animal = spans.get(TYPE.AnimalManager)?.[0];
  if (animal) {
    const perRow = Math.round(worldM / SPAWN_AREA_M);
    for (const { key, uuid } of findSpawnTable(buf, animal.start, animal.end, perRow * perRow)) {
      const kind = SPAWN_UUIDS[uuid];
      if (!kind) continue;
      // Area (row, col) covers world x ∈ [col·64, col·64+64), z ∈ [row·64, row·64+64); x is mirrored on screen.
      const row = Math.floor(key / perRow);
      const col = key % perRow;
      spawns.push({
        kind,
        x: (worldM - (col + 1) * SPAWN_AREA_M) / cellM,
        y: (row * SPAWN_AREA_M) / cellM,
        size: SPAWN_AREA_M / cellM,
      });
    }
  }

  // --- dens: "wolfDen" records hold both wolf dens and boar dens (class "BoarDen").
  // Boars have no spawn areas in v1.1 saves, so their dens are the boar spawns.
  const enemies: Point<EnemyKind>[] = [];
  const latin1 = new TextDecoder('latin1');
  for (const span of spans.get(TYPE.WolfDen) ?? []) {
    try {
      const r = at(span.start);
      r.skip(5);
      const p = toTile(r.point());
      if (latin1.decode(new Uint8Array(buf, span.start, span.end - span.start)).includes('BoarDen')) {
        const size = DEN_M / cellM;
        spawns.push({ kind: 'boar', x: p.x - size / 2, y: p.y - size / 2, size, den: true });
      } else enemies.push({ kind: 'wolfDen', ...p });
    } catch {
      /* skip */
    }
  }

  // --- enemies
  const pushAll = (id: number, kind: EnemyKind, read: (r: Reader) => { x: number; z: number }) => {
    for (const pos of all(id)) {
      try {
        enemies.push({ kind, ...toTile(read(at(pos))) });
      } catch {
        /* skip */
      }
    }
  };
  pushAll(TYPE.RaiderCamp, 'raiderCamp', (r) => {
    r.skip(4);
    if (r.u8()) r.skip(4);
    r.skip(1);
    return r.point();
  });
  pushAll(TYPE.Raider, 'raider', (r) => (r.skip(5), r.point()));
  pushAll(TYPE.BatteringRam, 'batteringRam', (r) => (r.skip(5), r.point()));

  // --- sites (DataReader::readResource)
  const readSite = (r: Reader) => {
    r.u32();
    if (r.u8()) r.skip(41);
    r.skip(1);
    return toTile(r.point());
  };
  const ruins: Point<RuinKind>[] = [];
  const collect = <K extends string>(id: number, kind: K, into: Point<K>[]) => {
    for (const pos of all(id)) {
      try {
        into.push({ kind, ...readSite(at(pos)) });
      } catch {
        /* skip */
      }
    }
  };
  collect(TYPE.RelicExtraction, 'relic', ruins);
  collect(TYPE.SalvagingSite, 'salvage', ruins);

  // --- player buildings: every record whose header decodes to a known building class.
  // Header: u32 id, u8 hasParent (+41 bytes), 1 byte, position, rotation quaternion, scale, class name.
  const buildings: SaveBuilding[] = [];
  const notImported: Record<string, number> = {};
  for (const list of spans.values())
    for (const span of list) {
      const label = NOT_IMPORTED[span.name];
      if (label) {
        notImported[label] = (notImported[label] ?? 0) + 1;
        continue;
      }
      if (span.name.startsWith('raider') || span.end - span.start < 60) continue;
      try {
        const r = at(span.start);
        r.u32();
        const parent = r.u8();
        if (parent > 1) continue;
        if (parent) r.skip(41);
        r.skip(1);
        const p = r.point();
        r.skip(4); // quaternion x
        const qy = r.f32();
        r.skip(4);
        const qw = r.f32();
        r.skip(12); // scale
        const cls = r.str();
        const typeId = BUILDING_CLASSES[cls];
        if (!typeId) {
          if (cls === 'Decorations') notImported['Other decorations'] = (notImported['Other decorations'] ?? 0) + 1;
          continue;
        }
        if (!(p.x >= 0 && p.x <= worldM && p.z >= 0 && p.z <= worldM)) continue;
        const yaw = 2 * Math.atan2(qy, qw);
        buildings.push({ typeId, ...toTile(p), rot: ((Math.round(yaw / (Math.PI / 2)) % 4) + 4) % 4 });
      } catch {
        /* not a building record */
      }
    }

  return {
    name: fileName.replace(/\.sav$/i, ''),
    version,
    size: N,
    terrain: classifyTerrain(heights, N),
    shade: hillshade(heights, N, cellM),
    fertility,
    fodder,
    water,
    minerals,
    forageables,
    spawns,
    enemies,
    ruins,
    fertilityBonus,
    buildings,
    notImported,
  };
}

/** The repo refuses saves older than v1.1.0; we only warn. */
export function isSupportedVersion(version: string): boolean {
  return !version || version.localeCompare('v1.1.0') >= 0;
}
