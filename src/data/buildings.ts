// Building catalog for Farthest Frontier.
// Sizes: https://farthestfrontier.wiki/wiki/Buildings
// Desirability: https://farthestfrontier.wiki/wiki/Desirability (updated for game v1.1.0)
// Entries flagged `sizeUnverified` are best guesses; the rest are from the wiki or confirmed in-game (v1.1).

export type Category =
  | 'Housing'
  | 'Amenities'
  | 'Decorations'
  | 'Food'
  | 'Resources'
  | 'Storage'
  | 'Defenses'
  | 'Roads & Fences';

export const CATEGORIES: Category[] = [
  'Housing',
  'Amenities',
  'Decorations',
  'Food',
  'Resources',
  'Storage',
  'Defenses',
  'Roads & Fences',
];

export interface Desirability {
  /** Fraction at distance 0, e.g. 0.1 = +10%. */
  value: number;
  /** Maximum range in meters (1 tile = 5 m). */
  rangeM: number;
  /** "Const" buildings give their full value everywhere within range. */
  constant?: boolean;
  /** Sources sharing a tag don't stack; only the strongest one counts at a given point. */
  tag?: string;
}

export interface BuildingType {
  id: string;
  name: string;
  category: Category;
  w: number;
  h: number;
  desirability?: Desirability;
  house?: boolean;
  sizeUnverified?: boolean;
  /** Buildings whose size the player chooses (fields, graveyards). */
  variable?: { min: number; max: number };
}

type D = [value: number, rangeM: number, tag?: string, constant?: boolean];

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/'/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

export const BUILDINGS: BuildingType[] = [];

function add(
  category: Category,
  name: string,
  w: number,
  h: number,
  d?: D | null,
  extra: Partial<BuildingType> = {},
) {
  const b: BuildingType = { id: slug(name), name, category, w, h, ...extra };
  if (d) b.desirability = { value: d[0], rangeM: d[1], tag: d[2], constant: d[3] || undefined };
  BUILDINGS.push(b);
}

const unverified = { sizeUnverified: true };

// Housing — the level is derived from desirability, so there's a single house type.
add('Housing', 'House', 3, 3, null, { id: 'house', house: true });
add('Housing', 'Temporary Shelter', 3, 3);

// Amenities & services
add('Amenities', 'Town Center', 6, 6, [0.1, 200, 'TownCenter']);
add('Amenities', 'Market', 4, 4, [0.08, 80, 'MarketBuilding']);
add('Amenities', 'Market Square', 4, 4, [0.1, 90, 'MarketBuilding']);
add('Amenities', "Healer's House", 3, 3, [0.04, 150, 'HealersHouse']);
add('Amenities', 'Hospital', 3, 3, [0.08, 200, 'HealersHouse']);
add('Amenities', 'Library', 4, 3, [0.1, 150, 'Library']);
add('Amenities', 'School', 3, 4, [0.08, 180, 'School']);
add('Amenities', 'Pub', 2, 3, [0.04, 150, 'Pub']);
add('Amenities', 'Shrine', 3, 3, [0.06, 120, 'ShrineMedium']);
add('Amenities', 'Altar', 3, 3, [0.08, 120, 'ShrineMedium']);
add('Amenities', 'Temple', 5, 5, [0.05, 300, 'Temple']);
add('Amenities', 'Grand Temple', 5, 5, [0.1, 300, 'Temple']);
add('Amenities', 'Theater', 5, 5, [0.05, 300, 'Theater']);
add('Amenities', 'Grand Theater', 5, 5, [0.08, 400, 'Theater']);
add('Amenities', 'Festival Pole', 4, 4, [0.04, 180, 'FestivalPole']);
add('Amenities', 'Paved Festival Pole', 4, 4, [0.08, 180, 'FestivalPole']);
add('Amenities', 'Apothecary Shop', 2, 3);
// Added in game v1.1 and not on the wiki. Academy, Book Binder and Crypt sizes are confirmed in-game;
// the Treasury's fits the save's building centers but is unconfirmed.
add('Amenities', 'Academy', 4, 5);
add('Amenities', 'Book Binder', 2, 3);
add('Amenities', 'Crypt', 3, 3);
add('Amenities', 'Treasury', 3, 4, null, unverified);
add('Amenities', 'Guild Hall', 5, 4);
add('Amenities', 'Rat Catcher', 2, 2);
add('Amenities', 'Trading Post', 4, 5);
add('Amenities', 'Trading Center', 4, 5);
add('Amenities', 'Graveyard', 3, 3, null, { variable: { min: 3, max: 10 } });

// Decorations (Extravagant variants behave identically to their base versions)
add('Decorations', 'Large Paved Park', 5, 5, [0.12, 200, 'Decorations']);
add('Decorations', 'Large Park', 5, 5, [0.08, 200, 'Decorations']);
add('Decorations', 'Small Paved Park', 3, 3, [0.09, 120, 'Decorations']);
add('Decorations', 'Small Park', 3, 3, [0.06, 120, 'Decorations']);
add('Decorations', 'Topiary Garden', 3, 3, [0.08, 60, 'Decorations'], unverified);
add('Decorations', 'Trellis', 1, 2, [0.03, 30, 'Decorations'], unverified);
add('Decorations', 'Large Statue', 3, 4, [0.12, 200, 'LargeStatue']);
add('Decorations', 'Medium Statue', 2, 3, [0.08, 150, 'MediumStatue']);
add('Decorations', 'Small Statue', 1, 1, [0.05, 100, 'SmallStatue']);
add('Decorations', 'Gazebo Plaza', 4, 4, [0.05, 100, 'Gazebo']);
add('Decorations', 'Hedge Garden', 3, 3, [0.04, 100, 'Hedge'], unverified);
add('Decorations', 'Grand Plaza', 5, 5, [0.06, 60]);
add('Decorations', 'Flag Pole', 2, 2, [0.02, 60, 'Flagpole']);
add('Decorations', 'Paved Flag Pole', 2, 2, [0.03, 60]);
add('Decorations', 'Medium Brick Plaza', 2, 2, [0.06, 40]);
add('Decorations', 'Medium Plaza', 2, 2, [0.04, 40]);
add('Decorations', 'Medium Paved Garden', 2, 2, [0.08, 36]);
add('Decorations', 'Medium Garden', 2, 2, [0.05, 36]);
add('Decorations', 'Rose Garden', 2, 3, [0.05, 36]);
add('Decorations', 'Garden Path', 1, 3, [0.06, 36]);
add('Decorations', 'Garden Trail', 1, 3, [0.04, 36]);
add('Decorations', 'Ornamental Tree', 2, 2, [0.04, 48]);
add('Decorations', 'Flower Urn', 1, 1, [0.05, 40]);
add('Decorations', 'Small Paved Garden', 1, 1, [0.05, 30]);
add('Decorations', 'Small Garden', 1, 1, [0.02, 30]);
add('Decorations', 'Small Shrub', 1, 1, [0.02, 25]);
add('Decorations', 'Small Juniper Bush', 1, 1, [0.02, 25]);
add('Decorations', 'Rose Bush', 1, 1, [0.02, 25], unverified);
add('Decorations', 'Low Brush', 1, 1, [0.02, 25], unverified);
add('Decorations', 'Tall Brush', 1, 1, [0.02, 25], unverified);
add('Decorations', 'Small Plaza', 1, 1);
add('Decorations', 'Small Brick Plaza', 1, 1);
add('Decorations', 'Tree', 1, 1);

// Food production
add('Food', 'Bakery', 2, 3, [0.04, 100, 'Bakery']);
add('Food', 'Pastry Shop', 2, 3, [0.08, 120, 'Bakery']);
add('Food', 'Barn', 4, 6, [-0.3, 50, 'Barn']);
add('Food', 'Large Barn', 4, 6, [-0.3, 50, 'Barn']);
add('Food', 'Goat Barn', 3, 4, [-0.3, 50, 'GoatBarn']);
add('Food', 'Large Goat Barn', 4, 3, [-0.3, 50]);
add('Food', 'Chicken Coop', 2, 4, [-0.1, 30, 'ChickenCoop']);
add('Food', 'Smokehouse', 2, 2, [-0.15, 40, 'SmokeHouse']);
add('Food', 'Windmill', 3, 3, [-0.15, 50]);
add('Food', 'Arborist Building', 2, 4);
add('Food', 'Cheesemaker', 3, 3);
add('Food', 'Fishing Shack', 2, 3);
add('Food', 'Forager Shack', 2, 3);
add('Food', 'Hunter Cabin', 2, 3);
add('Food', 'Hunter Lodge', 2, 3);
add('Food', 'Preservist Building', 3, 3);
add('Food', 'Crop Field', 5, 5, null, { variable: { min: 5, max: 12 } });

// Resources & industry
add('Resources', 'Basic Well', 2, 2, [0.05, 80, 'Well']);
add('Resources', 'Improved Well', 2, 2, [0.08, 80, 'Well']);
add('Resources', 'Compost Yard', 4, 4, [-0.5, 65, 'CompostYard']);
add('Resources', 'Charcoal Kiln', 3, 4, [-0.4, 65, 'CharcoalKiln']);
add('Resources', 'Glassmaker', 3, 4, [-0.3, 60, 'Glassmaker', true]);
add('Resources', 'Stable', 3, 4, [-0.3, 50, 'Stable', true]);
add('Resources', 'Tannery', 3, 3, [-0.3, 75]);
add('Resources', 'Paper Mill', 4, 4, [-0.3, 75]);
add('Resources', 'Coal Mine', 2, 2, [-0.25, 50, 'CoalMine']);
add('Resources', 'Deep Coal Mine', 3, 3, [-0.25, 65, 'CoalMine']);
add('Resources', 'Gold Mine', 2, 2, [-0.25, 50, 'GoldMine']);
add('Resources', 'Deep Gold Mine', 3, 3, [-0.25, 50, 'GoldMine']);
add('Resources', 'Iron Mine', 2, 2, [-0.2, 50, 'IronMine']);
add('Resources', 'Deep Iron Mine', 3, 3, [-0.25, 50, 'IronMine']);
add('Resources', 'Blacksmith Forge', 3, 4, [-0.2, 50, 'BlacksmithForge']);
add('Resources', 'Blacksmith Workshop', 3, 4, [-0.2, 50, 'BlacksmithForge']);
add('Resources', 'Foundry', 3, 4, [-0.2, 50, 'Foundry']);
add('Resources', 'Smeltery', 3, 4, [-0.2, 50, 'Foundry']);
add('Resources', 'Brickyard', 4, 5, [-0.2, 40, 'Brickyard']);
add('Resources', 'Quarry', 5, 4, [-0.2, 50, 'StonePit']);
add('Resources', 'Saw Pit', 3, 4, [-0.2, 65]);
add('Resources', 'Saw Mill', 3, 4, [-0.2, 65]);
add('Resources', 'Soap Shop', 3, 4, [-0.15, 45, 'SoapShop', true]);
add('Resources', 'Firewood Splitter', 2, 3, [-0.15, 35, 'WoodCutterBuilding']);
add('Resources', 'Firewood Splitter Workshop', 2, 3, [-0.15, 35, 'WoodCutterBuilding']);
add('Resources', 'Deep Clay Mine', 3, 3, [-0.1, 40, 'ClayPit']);
add('Resources', 'Deep Sand Mine', 3, 3, [-0.1, 40, 'SandPit']);
add('Resources', 'Work Camp', 3, 3, [-0.05, 50, 'WorkCamp']);
add('Resources', 'Forester Camp', 3, 3, [-0.05, 50, 'WorkCamp']);
add('Resources', 'Clay Pit', 3, 3);
add('Resources', 'Sand Pit', 3, 3);
add('Resources', 'Apiary', 1, 1);
add('Resources', 'Armory', 3, 4);
add('Resources', 'Arsenal', 3, 4);
add('Resources', 'Basket Shop', 2, 3);
add('Resources', 'Brewery', 4, 4);
add('Resources', 'Candle Shop', 2, 3);
add('Resources', 'Cobbler Shop', 2, 3);
add('Resources', 'Fletcher Building', 2, 3);
add('Resources', 'Fletcher Workshop', 2, 3);
add('Resources', 'Furniture Workshop', 5, 3);
add('Resources', 'Potter Building', 3, 4);
add('Resources', 'Weaver Building', 3, 4);

// Storage
add('Storage', 'Stockyard', 4, 4);
add('Storage', 'Large Stockyard', 4, 4);
add('Storage', 'Storehouse', 3, 4);
add('Storage', 'Warehouse', 3, 4);
add('Storage', 'Vault', 3, 4);
add('Storage', 'Granary', 2, 2);
add('Storage', 'Root Cellar', 2, 3);
add('Storage', 'Brick Root Cellar', 2, 3);
add('Storage', 'Cooper', 3, 3);
add('Storage', 'Wagon Shop', 3, 3);
add('Storage', 'Storage Depot', 2, 3);

// Defenses
add('Defenses', 'Barracks', 4, 6);
add('Defenses', 'Fort', 4, 6);
add('Defenses', 'Cavalry Stable', 4, 5);
add('Defenses', 'Lookout Tower', 1, 1);
add('Defenses', 'Watch Tower', 1, 1);
add('Defenses', 'Battlement Tower', 1, 1);
add('Defenses', 'Palisade Wall', 1, 1);
add('Defenses', 'Palisade Gate', 1, 1);
add('Defenses', 'Wide Gate', 2, 1);
add('Defenses', 'Fortified Wall', 1, 1);
add('Defenses', 'Fortified Gate', 1, 1);

// Roads & fences
add('Roads & Fences', 'Road', 1, 1);
add('Roads & Fences', 'Fence', 1, 1);
add('Roads & Fences', 'Fence Gate', 1, 1);
add('Roads & Fences', 'Fieldstone Fence', 1, 1);

export const BUILDING_BY_ID: Record<string, BuildingType> = Object.fromEntries(
  BUILDINGS.map((b) => [b.id, b]),
);

export function getType(id: string): BuildingType {
  const t = BUILDING_BY_ID[id];
  if (!t) throw new Error(`Unknown building type: ${id}`);
  return t;
}
