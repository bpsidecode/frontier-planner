// Farthest Frontier .sav reader. Ported from the parts of mikh-abc/ff-game-map
// (FileDataReader.cpp, DataReader.cpp, StaticData.cpp, Apache-2.0) that locate terrain,
// resources, animal spawns, enemies, buildings and roads.

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
  Guids: 4058971987,
  SplineRoadContainer: 3467803903,
  BridgeContainer: 1918126847,
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
  ItemBerries: 'berries',
  ItemNuts: 'nuts',
  ItemMushroom: 'mushrooms',
  ItemEggs: 'eggs',
};

const DEPOSIT_KINDS: Record<number, MineralKind> = { 0: 'iron', 1: 'gold', 2: 'coal' };

/**
 * Player buildings: the class name stored in each building record → planner catalog id.
 * Known upgrade tiers are refined below through prefab ids; unknown prefab variants fall back to
 * the class's base catalog entry.
 */
export const BUILDING_CLASSES: Record<string, string> = {
  TownCenter: 'town-center',
  Shelter: 'house',
  TemporaryShelter: 'temporary-shelter',
  Academy: 'academy',
  ApothecaryShop: 'apothecary-shop',
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
  FurnitureWorkshop: 'furniture-workshop',
  Gate: 'palisade-gate',
  Glassmaker: 'glassmaker',
  GoatBarn: 'goat-barn',
  GoldMine: 'gold-mine',
  Granary: 'granary',
  // All tower tiers are 1×1 (confirmed); prefab ids pick the tier.
  GuardTower: 'lookout-tower',
  GuildHall: 'guild-hall',
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
  SmallStatue: 'small-statue',
  Stable: 'stable',
  Stockyard: 'stockyard',
  StonePit: 'quarry',
  StorageDepot: 'storage-depot',
  Storehouse: 'storehouse',
  Tannery: 'tannery',
  Temple: 'temple',
  Theater: 'theater',
  TradingPost: 'trading-post',
  Treasury: 'vault',
  Urn: 'flower-urn',
  WagonShop: 'wagon-shop',
  Wall: 'palisade-wall',
  WeaverBuilding: 'weaver-building',
  Well: 'basic-well',
  Windmill: 'windmill',
  WoodCutterBuilding: 'firewood-splitter',
  WorkCamp: 'work-camp',
};

/**
 * Prefab ids of specific building variants, which override the class mapping. Upgrades share a class
 * with their base building (a Market Square is a "MarketBuilding"), so the prefab is what tells them
 * apart. Ids are stable across saves; these were labeled from side-by-side test builds in a v1.1.2a save.
 */
export const PREFAB_TYPES: Record<string, string> = {
  // Wells, markets, parks, plazas, gates and towers: first side-by-side test save.
  '22c84713-ff1b-4f89-81f2-f3d62baa8b4e': 'basic-well',
  'dc035044-3e19-4053-a0c7-d5e9c16ba477': 'improved-well',
  '16229e85-cc53-4931-abb6-b5ae358094b0': 'market',
  'b08516c8-9111-473f-b9f6-8c79aba707a5': 'market-square',
  '4d51c83c-781c-47a7-b309-339cbf67c093': 'lookout-tower',
  '423285e9-6276-4e4d-a846-351845b68717': 'watch-tower',
  'c6a2916c-9ece-41a7-bec8-9b8db1e2a96e': 'battlement-tower',
  '8dde25cb-aec6-40ba-8b78-9e42f581b40e': 'palisade-gate',
  'cd1960fb-02eb-4a82-8449-399507a526a6': 'wide-gate',
  'c49a87dd-0e3c-417d-94fc-777e734d8224': 'small-park',
  'bc6f5552-1052-4118-8edb-ef2812825f70': 'small-paved-park',
  '27677ae3-da7a-48cf-ad13-b119587361f9': 'medium-plaza',
  'c59ab465-75e3-493d-bc62-938b1717735c': 'medium-brick-plaza',
  // Saved with class "Barracks", but it's a separate building.
  '5eaaad6d-8751-453a-9af7-04093e35f1dd': 'cavalry-stable',

  // Buildings and their upgrades: second side-by-side test save.
  '54e91523-8f99-44c9-8d17-1cc2e55edd71': 'shrine',
  '36a3754b-4d14-4131-9873-9299675c6dda': 'altar',
  'cbc2b933-ce47-4b00-8c55-92c650e7ab09': 'healers-house',
  'e09ab024-18dc-4612-8c33-6b35cf0bf154': 'hospital',
  '1765d63c-6c6e-4ee3-b8f9-a7ae11008eb2': 'festival-pole',
  '2d7f916c-5306-4dc5-98b0-a4839dfbf97e': 'paved-festival-pole',
  '5db9bcdf-af08-4405-aaa6-5d279da60a66': 'stockyard',
  '0ef93576-d6ce-4efd-8609-c3ac6b0e55cf': 'large-stockyard',
  '841b5b9f-5c86-4b9d-8b21-5bef8b290144': 'storage-depot',
  'e96ef773-b836-4037-b6ae-c793e5ae8527': 'large-storage-depot',
  '9280e305-68d9-4c96-b9e6-8990e7e25337': 'root-cellar',
  'cf42fb2f-4497-4e87-8e20-89507f8e53d3': 'brick-root-cellar',
  'f0a8c3ed-08b1-49fb-ba22-7c6f46f53388': 'hunter-cabin',
  'a21d3041-c33b-4f76-a567-46d9ccb39d6b': 'hunter-lodge',
  '4f4953b1-80b1-4c7a-b9ed-60f7df949a98': 'forager-shack',
  '69285038-0e2e-47ec-b006-8b4b5c07efe6': 'forager-garden',
  '2d453598-bfd3-4268-a60d-3985f93b1106': 'barn',
  '6465bb67-21cf-4e1f-ac8b-2dbada47e8af': 'large-barn',
  'a059c161-ee62-4be3-aa96-0d73337d928e': 'goat-barn',
  '4c1ca3b9-ddca-46fc-9b2a-0e6e862d5eb6': 'large-goat-barn',
  '7784f21e-c08d-4fda-a129-162fd72d1404': 'firewood-splitter',
  'e5ef9b0a-7136-401e-8d8f-79560a5fde72': 'firewood-splitter-workshop',
  '3e928118-a726-4b8c-9d2d-048822b08650': 'saw-pit',
  '124efc76-83c7-431b-94cd-608222e81b6c': 'saw-mill',
  '99f9886f-a44f-4fad-8654-1cfd22c90d4e': 'fletcher-building',
  '5b492fad-9efe-488d-af88-2aea90cf96a7': 'fletcher-workshop',
  '455c1798-b820-4814-a7b2-c6c92252a88d': 'work-camp',
  'f4d917c4-69b6-4c99-bebf-d45cdbb265a0': 'forester-camp',
  '8cdce969-f32f-4727-a9a3-b295fbe3d80a': 'armory',
  '40bfe3df-bc7b-4361-8dd9-f6691f4a5348': 'arsenal',
  '443ca053-30c6-4673-b3f8-398ea45edd3a': 'blacksmith-forge',
  'be206448-7b52-4ffb-a8b3-388f43511742': 'blacksmith-workshop',
  '0d535d8b-8e53-4a82-b45d-86efbff7f510': 'foundry',
  '734936d6-ca10-4fa6-a498-c531656c4847': 'smeltery',
  '93e0768b-1c78-4529-ac50-04c63c163c65': 'barracks',
  '04a8e223-4e5c-4246-b1e6-28e450ad23ae': 'fort',
  '11822877-3597-4177-8575-309d1f76fd77': 'bakery',
  'c730e323-25c2-4d49-b9b6-47aa288a50c6': 'pastry-shop',
  '3036bb04-a6cf-4390-aae3-d61f167b20c5': 'temple',
  '756c2a31-7dd4-40b8-af45-617847ba371b': 'grand-temple',
  'c71566df-c01f-4147-a655-f48a42c45fa0': 'theater',
  '17fe1f61-936b-4700-a207-de9b2db38fa7': 'grand-theater',
  '4aa6d551-fca5-4454-94e9-9bb91bf81e2e': 'civic-monument',
  '0bffb5aa-f886-409a-9ad4-c4491a1a5b1a': 'military-monument',

  // Walls, fences and gates share the classes "Wall" and "Gate".
  'fc599b8e-8bee-45f8-a48e-c924278f6fc2': 'palisade-wall',
  '9b1c2ed5-e3ed-4b64-b3c5-a26093dfebee': 'fence',
  'e3d86a52-a9f6-4d6d-a7ef-e9ba0ccf04c3': 'fence-gate',
  '399f5529-55fe-4539-955d-00b28a56f057': 'fieldstone-fence',
  'f1c044f7-ce22-435b-8508-211f0e37167f': 'hedge-fence',
  '8253db9c-a5e3-4f80-86ad-4db304e51448': 'hedge-fence-gate',
  '35ad8560-fcce-4f8a-8b7c-5f6a0093b639': 'wrought-iron-fence',
  '2493d8ef-10f7-4355-828a-f8c636d83c93': 'wrought-iron-fence-gate',

  // Decorations share the class "Decorations" unless noted.
  // The four bushes were placed as a 2×2 block; which is which is read in row order, and all four
  // have the same size and desirability, so a mix-up wouldn't change results.
  'bf9a9455-ef30-4b55-a22a-2a490fb62971': 'small-shrub',
  '9840674c-94d2-4901-be93-378ee7b560cb': 'small-juniper-bush',
  '7203cc1c-57b8-4db0-936a-3095cc823074': 'low-brush',
  '10d97fe3-7c0b-4bee-874a-3a2301db4603': 'tall-brush',
  '1d6d6b98-5c78-44fb-ba4e-412cf5195a87': 'small-garden',
  '6ee906cc-4865-44b4-9390-e26e06d1fbce': 'small-paved-garden',
  '031c78fc-4409-4a67-aa5c-82fc7d26c667': 'medium-garden',
  '7b63537a-242d-4bf1-ab78-517ec78b6607': 'medium-paved-garden',
  '9fe84d67-db88-471f-a403-4359eb8b0e25': 'garden-trail',
  '6cbdb964-a26f-4657-8763-21dfa9820370': 'garden-path',
  '66e2b2d4-d34c-4999-8013-b68f6a615370': 'small-plaza',
  '3b248d2e-be63-424b-8f09-18e07945ab5c': 'small-brick-plaza',
  '546744b5-a121-4c29-b5cf-ab9eb1870f0b': 'flag-pole',
  '0b0a8320-76b3-4e7a-b736-d133c7ffb82f': 'paved-flag-pole',
  'd327e215-54e7-449f-a8fb-619da3b15d43': 'small-bench-plaza',
  '2e086822-25c6-4307-91c1-269f5edec420': 'small-brick-bench-plaza',
  '8c15e9e2-dea5-4731-89d7-12d555ba81e0': 'small-corner-bench-plaza',
  'd576284a-cb31-4e62-b370-ef03e3ef056b': 'small-brick-corner-bench-plaza',
  '57eff353-ab68-4a97-b2e7-e29da51fcd54': 'large-park',
  '79577d38-7829-4b2b-a945-74b8bfd7c787': 'large-paved-park',
  '7f505c85-b1df-4ff6-b54c-cf1252f67c55': 'crates-and-barrels',
  '4370e75d-c237-4912-9fb3-9738191e0c27': 'rose-bush',
  '4e2ad3ee-96a9-444e-b73f-66c9e5124021': 'rose-garden',
  '0d68253d-4d23-42bd-9092-dcfc4a8ec970': 'gazebo-plaza',
  '2991ffa0-d738-4717-95fb-de141924839f': 'grand-plaza',
};

/** Classes with a building-style header that aren't player buildings (trees, stones, fish, carts). */
const isNonBuildingClass = (cls: string) => cls.endsWith('Resource') || cls === 'SupplyWagon';

/** Save records (by name prefix) that are player-built but not imported yet. */
const NOT_IMPORTED: Record<string, string> = {
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
  /** The record name's trailing index (hunterBuilding3 → 3), or -1. */
  index: number;
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
    const full = r.str();
    const name = full.replace(/\d+$/, '');
    const index = name === full ? -1 : Number(full.slice(name.length));
    const size = r.u32();
    const start = r.pos;
    if (size < 4 || start + size > r.length) throw new SaveFormatError('This doesn’t look like a Farthest Frontier save');
    const id = r.u32();
    const list = table.get(id) ?? [];
    list.push({ name, index, start: start + 5, end: start + size });
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

/**
 * Tile centers (world x, z) of a crop field, pasture or graveyard record: a grid block of cell size,
 * columns, rows and the half-size offsets (−cols·cell/2, 0.5, −rows·cell/2), five more bytes, a u32
 * count, then that many (x, z) pairs. Every one seen so far is a full rectangle.
 */
export function readAreaTiles(buf: ArrayBuffer, start: number, end: number, cellM = 5): { x: number; z: number }[] | null {
  const dv = new DataView(buf);
  const f = (o: number) => dv.getFloat32(o, true);
  const u = (o: number) => dv.getUint32(o, true);
  for (let p = start; p + 33 <= Math.min(end, start + 512); p++) {
    if (f(p) !== cellM) continue;
    const cols = u(p + 4);
    const rows = u(p + 8);
    if (!(cols > 0 && cols < 400 && rows > 0 && rows < 400)) continue;
    if (Math.abs(f(p + 12) + (cols * cellM) / 2) > 1e-3 || f(p + 16) !== 0.5 || Math.abs(f(p + 20) + (rows * cellM) / 2) > 1e-3) continue;
    const count = u(p + 29);
    const first = p + 33;
    if (count < 1 || count > cols * rows || first + count * 8 > end) return null;
    return Array.from({ length: count }, (_, k) => ({ x: f(first + k * 8), z: f(first + k * 8 + 4) }));
  }
  return null;
}

/** The occupied-tile block inside a building record (see `findFootprintBlock`). */
export interface FootprintBlock {
  /** Byte offset of the block's center Vector3. */
  offset: number;
  /** Footprint in tiles along world x and z, as placed (rotation already applied). */
  w: number;
  h: number;
}

/**
 * Find a building's occupied-tile block: center Vector3 (same x and z as the header), size Vector3
 * in meters, a u8 flag, a u32 tile count, then that many (x, z) tile centers. Every building and
 * decoration record seen so far has exactly one, after the class name.
 */
export function findFootprintBlock(buf: ArrayBuffer, from: number, end: number, x: number, z: number, cellM = 5): FootprintBlock | null {
  const dv = new DataView(buf);
  for (let p = from; p + 29 <= end; p++) {
    if (dv.getFloat32(p, true) !== x || dv.getFloat32(p + 8, true) !== z) continue;
    const w = dv.getFloat32(p + 12, true) / cellM;
    const h = dv.getFloat32(p + 20, true) / cellM;
    const count = dv.getUint32(p + 25, true);
    if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || count !== w * h) continue;
    if (p + 29 + count * 8 > end) continue;
    return { offset: p, w, h };
  }
  return null;
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

  // --- forageables
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

  // --- roads: each SplineRoadContainer holds a cubic Bezier centerline (four Vector3s).
  // Roads are built on the same 5 m grid as the planner, but long and curved stretches are saved as
  // one spline rather than one object per tile. Sample densely enough to visit every crossed cell,
  // then deduplicate cells shared by adjoining splines and intersections.
  const roads: SaveBuilding[] = [];
  const bridges: SaveBuilding[] = [];
  const bridgeCells = new Set<number>();
  /** 1×1 bridge tiles for every grid cell a straight span crosses. */
  const rasterizeSegment = (a: { x: number; z: number }, b: { x: number; z: number }) => {
    const out: SaveBuilding[] = [];
    const steps = Math.max(1, Math.ceil((Math.hypot(b.x - a.x, b.z - a.z) / cellM) * 4));
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const p = toTile({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
      const x = Math.floor(p.x);
      const y = Math.floor(p.y);
      if (x < 0 || y < 0 || x >= N || y >= N || bridgeCells.has(y * N + x)) continue;
      bridgeCells.add(y * N + x);
      out.push({ typeId: 'bridge', x: x + 0.5, y: y + 0.5, rot: 0 });
    }
    return out;
  };
  const roadCells = new Set<number>();
  const cubic = (a: number, b: number, c: number, d: number, t: number) => {
    const u = 1 - t;
    return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
  };
  for (const span of spans.get(TYPE.SplineRoadContainer) ?? []) {
    try {
      if (span.name !== 'splineRoadContainer' || span.end - span.start < 68) continue;
      const r = at(span.start + 12);
      const points = [r.point(), r.point(), r.point(), r.point()];
      r.f32(); // reserved
      const savedLengthM = r.f32();
      if (!points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.z))) continue;
      const controlLengthM = points.slice(1).reduce((n, p, i) => n + Math.hypot(p.x - points[i].x, p.z - points[i].z), 0);
      const lengthM = Number.isFinite(savedLengthM) && savedLengthM > 0 ? Math.max(savedLengthM, controlLengthM) : controlLengthM;
      const steps = Math.max(1, Math.ceil((lengthM / cellM) * 4));
      for (let k = 0; k <= steps; k++) {
        const t = k / steps;
        const p = toTile({
          x: cubic(points[0].x, points[1].x, points[2].x, points[3].x, t),
          z: cubic(points[0].z, points[1].z, points[2].z, points[3].z, t),
        });
        const x = Math.floor(p.x);
        const y = Math.floor(p.y);
        if (x < 0 || y < 0 || x >= N || y >= N) continue;
        const key = y * N + x;
        if (roadCells.has(key)) continue;
        roadCells.add(key);
        roads.push({ typeId: 'road', x: x + 0.5, y: y + 0.5, rot: 0 });
      }
    } catch {
      /* skip unreadable road */
    }
  }

  // --- player buildings: every record whose header decodes to a known building class.
  // Header: u32 id, u8 hasParent (+41 bytes), 1 byte, position, rotation quaternion, scale, class name.
  // "<name>Guids" records list each instance's prefab id, in record-index order.
  const prefabs = new Map<string, string[]>();
  for (const span of spans.get(TYPE.Guids) ?? []) {
    try {
      const r = at(span.start + 2);
      const n = r.u32();
      const ids: string[] = [];
      for (let k = 0; k < n; k++) ids.push(r.str());
      prefabs.set(span.name.replace(/Guids$/, ''), ids);
    } catch {
      /* skip */
    }
  }

  const buildings: SaveBuilding[] = [];
  const notImported: Record<string, number> = {};
  const unknownBuildingClasses: Record<string, number> = {};
  const nonBuildingTypes = new Set<number>([
    TYPE.MetaData,
    TYPE.AgricultureManager,
    TYPE.AnimalManager,
    TYPE.MineralManager,
    TYPE.ForageableResource,
    TYPE.TerrainManager,
    TYPE.WolfDen,
    TYPE.RaiderCamp,
    TYPE.Raider,
    TYPE.BatteringRam,
    TYPE.RelicExtraction,
    TYPE.SalvagingSite,
    TYPE.Guids,
    TYPE.SplineRoadContainer,
  ]);
  // --- areas laid out on the tile grid: crop fields, pastures and graveyards. Each holds a grid
  // block (cell size 5, columns, rows, the half-size offsets) and then the list of its tile centers.
  const AREA_TYPES: Record<string, string> = { cropField: 'crop-field', grazingArea: 'pasture', graveyard: 'graveyard' };
  const areaRecords = new Set<Span>();
  for (const list of spans.values())
    for (const span of list) {
      const typeId = AREA_TYPES[span.name];
      if (!typeId) continue;
      areaRecords.add(span);
      const area = readAreaTiles(buf, span.start, span.end, cellM);
      if (!area) {
        notImported[`Unreadable ${typeId.replace('-', ' ')}s`] = (notImported[`Unreadable ${typeId.replace('-', ' ')}s`] ?? 0) + 1;
        continue;
      }
      const cols = area.map((t) => (worldM - t.x) / cellM - 0.5);
      const rows = area.map((t) => t.z / cellM - 0.5);
      const x0 = Math.round(Math.min(...cols));
      const y0 = Math.round(Math.min(...rows));
      const w = Math.round(Math.max(...cols)) - x0 + 1;
      const h = Math.round(Math.max(...rows)) - y0 + 1;
      const b: SaveBuilding = { typeId, x: x0 + w / 2, y: y0 + h / 2, rot: 0, size: { w, h } };
      // Fields and pastures start with u32 id, a 4, then the area's center: keep where, for writing moves back.
      const dv = new DataView(buf);
      const centerX = worldM - b.x * cellM;
      const centerZ = b.y * cellM;
      if (
        typeId !== 'graveyard' &&
        dv.getUint8(span.start + 4) === 4 &&
        Math.abs(dv.getFloat32(span.start + 5, true) - centerX) < 0.01 &&
        Math.abs(dv.getFloat32(span.start + 13, true) - centerZ) < 0.01
      )
        b.area = { start: span.start, end: span.end, pos: span.start + 5 };
      buildings.push(b);
    }

  // --- bridges: the header (with a 4 in the flag byte that buildings use for "has parent") is
  // followed by the class name and then the span's two end points.
  for (const span of spans.get(TYPE.BridgeContainer) ?? []) {
    try {
      if (span.name !== 'bridgeContainer') continue;
      const r = at(span.start + 4);
      if (r.u8() !== 4) continue;
      r.skip(40); // position, rotation, scale
      if (r.str() !== 'Bridge') continue;
      const a = r.point();
      const b = r.point();
      bridges.push(...rasterizeSegment(a, b));
    } catch {
      notImported['Unreadable bridges'] = (notImported['Unreadable bridges'] ?? 0) + 1;
    }
  }

  for (const [recordType, list] of spans)
    for (const span of list) {
      if (areaRecords.has(span)) continue;
      const label = NOT_IMPORTED[span.name];
      if (label) {
        notImported[label] = (notImported[label] ?? 0) + 1;
        continue;
      }
      if (nonBuildingTypes.has(recordType)) continue;
      const raiderTower = span.name === 'raiderGuardTower';
      if ((span.name.startsWith('raider') && !raiderTower) || span.end - span.start < 60) continue;
      try {
        const r = at(span.start);
        r.u32();
        const parent = r.u8();
        if (parent > 1) continue;
        if (parent) r.skip(41);
        r.skip(1);
        const headerPos = r.pos;
        const p = r.point();
        r.skip(4); // quaternion x
        const qy = r.f32();
        r.skip(4);
        const qw = r.f32();
        r.skip(12); // scale
        const cls = r.str();
        if (!(p.x >= 0 && p.x <= worldM && p.z >= 0 && p.z <= worldM)) continue;
        // Avoid reporting arbitrary record bytes that happen to resemble the start of a building.
        if (!/^[A-Za-z][A-Za-z0-9_.+`]{0,127}$/.test(cls)) continue;
        // Raider guard towers use the player tower's class; fruit trees use a building-style header.
        if (raiderTower) {
          enemies.push({ kind: 'raiderTower', ...toTile(p) });
          continue;
        }
        if (cls === 'FruitTreeResource') {
          forageables.push({ kind: 'fruitTrees', ...toTile(p) });
          continue;
        }
        const prefab = prefabs.get(span.name)?.[span.index];
        const typeId = (prefab && PREFAB_TYPES[prefab]) || BUILDING_CLASSES[cls];
        if (!typeId) {
          if (cls === 'Decorations') notImported['Other decorations'] = (notImported['Other decorations'] ?? 0) + 1;
          else if (!isNonBuildingClass(cls)) unknownBuildingClasses[cls] = (unknownBuildingClasses[cls] ?? 0) + 1;
          continue;
        }
        const yaw = 2 * Math.atan2(qy, qw);
        const block = findFootprintBlock(buf, r.pos, span.end, p.x, p.z, cellM);
        buildings.push({
          typeId,
          ...toTile(p),
          rot: ((Math.round(yaw / (Math.PI / 2)) % 4) + 4) % 4,
          ...(prefab ? { prefab } : {}),
          ...(block ? { size: { w: block.w, h: block.h }, rec: { pos: headerPos, block: block.offset } } : {}),
        });
      } catch {
        /* not a building record */
      }
    }

  // Keep bridges and then roads after structures. Both roads and many gates/fences are 1x1, and the
  // stable area sort in mapImport preserves this order, so a road running under an entrance or onto
  // a bridge never hides it.
  buildings.push(...bridges, ...roads);

  return {
    name: fileName.replace(/\.sav$/i, ''),
    version,
    size: N,
    heights,
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
    unknownBuildingClasses,
  };
}

/** The repo refuses saves older than v1.1.0; we only warn. */
export function isSupportedVersion(version: string): boolean {
  return !version || version.localeCompare('v1.1.0') >= 0;
}
