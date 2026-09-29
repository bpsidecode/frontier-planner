# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Frontier Planner is a browser-based town planner for the game Farthest Frontier. You place buildings on a grid, it calculates desirability for each tile, and it shows each house's level and the total population. It can also import a game `.sav` file so you plan on the real terrain and resources. It's built with Vite and TypeScript, draws on a `<canvas>`, and uses no UI framework. The feature list and the project's to-do list are in `README.md`; keep that to-do list up to date when you finish or add work.

## Commands

```bash
npm run dev                      # dev server at http://localhost:5173
npm test                         # vitest, all tests
npx vitest run tests/model.test.ts -t "house levels"   # a single file or test name
npx tsc -p .                     # type-check (there is no linter)
npm run build                    # tsc, then vite build
FF_SAV=/path/to/save.sav npm test   # also runs the real-save parser tests (skipped otherwise)
```

Never commit save files; `.gitignore` excludes `*.sav` and `test-fixtures/`. To test an import in the browser, copy a save into `test-fixtures/`, fetch it from the page and put it into the `#sav-file` input with a `DataTransfer`, because the file dialog can't be driven.

## Architecture

**Model modules are pure and DOM-free**, so they run in vitest's Node environment. These are `src/model/*`, `src/data/*` and `src/import/sav.ts`. Only `main.ts`, `render/*`, `ui/*` and `storage.ts` touch the DOM.

**`src/main.ts` is the single controller and holds all app state.** This includes:
- `plan`, `map`, `view` and `overlays`
- the placement and drag modes
- the undo and redo stacks, which store JSON snapshots of the plan

Every mutation ends in `changed()`, which runs one recompute pipeline in this order:
1. `computeField`
2. `renderer.setField`
3. `evaluateHouses`
4. the stats, info panel and toolbar
5. a debounced autosave
6. `draw()`, batched with `requestAnimationFrame`

Replacing the map goes through `setMapAndPlan()`, which also resets history and the camera.

**`Plan` (`model/plan.ts`) owns the grid.**
- **Size:** set per plan, 100 by default or the map's size (384 for standard maps, 256 for small ones).
- **Terrain mask:** an optional `blocked` array marking water and steep tiles.
- **Occupancy:** an `Int32Array` of building ids per tile.
- **Validation:** `add`, `update` and `rotate` all validate bounds, overlaps and terrain. `ignoreTerrain` is used only when importing or restoring buildings, which may already sit on blocked tiles.
- **Ids:** `fromJSON` keeps building ids, and undo and redo depend on that to keep the selection.
- **Saved format:** `PlanData` is version 2 and includes `size`.

**Desirability rules** are in `model/desirability.ts`, with data from farthestfrontier.wiki:
- One tile is 5 m. Distances are measured center to center.
- Effect: `value × (1 − 0.5·d/range)` within range, and 0 beyond it. "Const" buildings give their full value everywhere in range.
- Buildings that share a tag don't stack; only the one with the largest absolute effect counts at each point.
- `computeField` (the whole grid) and `pointDesirability`/`breakdown` (a single point) must agree, and a test checks that they do.
- A house's level comes from the desirability at the house's center. The thresholds (30/60/80/100%) are in `data/houses.ts` and confirmed in-game; the Estate level's name and 10 residents were requested by the user, not taken from the wiki.

**Save import (`import/sav.ts`)** is a TypeScript port of parts of [mikh-abc/ff-game-map](https://github.com/mikh-abc/ff-game-map).
- **Record format:** a save is a flat list of records: a `u8` type, a `u8`-length-prefixed name, a `u32` size, a `u32` type id, then one pad byte. The type ids come from that repo's `StaticData.cpp`.
- **`.map` files are not used.** They only hold terrain-generation templates; everything the planner needs is in the `.sav`.
- **Point coordinates:** world `(x, z)` in meters maps to tile `col = (worldM − x)/cell` and `row = z/cell`, so x is mirrored.
- **Grid coordinates:** grids stored `[i][j]` map to `row = i`, `col = N−1−j`.
- **Checked in-game:** the orientation is confirmed against the game.
- **Spawn areas:** the spawn-area table in the AnimalManager record is found by scanning (`findSpawnTable`), because the herd records in front of it changed format in v1.1.x. Forageable records use a fixed 417-byte item filler. Boars never have a spawn area in v1.1 saves; see dens below.
- **Output:** the parser produces a `MapData` (`model/terrain.ts`):
  - `Uint8Array` layers (terrain class, hillshade, fertility, fodder and groundwater, each 0–255)
  - lists of markers, already in tile coordinates
- **Terrain thresholds:** `WATER_BELOW_M = 3` and `STEEP_M_PER_TILE = 4`. Both have been checked against the game.
- **Buildings:** any record whose header decodes (id, parent flag, position, quaternion, scale, then a class-name string) and whose class is in `BUILDING_CLASSES` becomes a `SaveBuilding`. Records with other layouts (fields, pastures, graveyards, roads, bridges) are counted in `MapData.notImported` by record name; standard building records with an unmapped class are counted in `MapData.unknownBuildingClasses`. `model/mapImport.ts` places imported buildings treating game positions as building centers. It picks the planner rotation whose odd/even sides match the center's half/whole-tile offsets, which also handles catalog entries listed as w×h where the game uses h×w. Its report of overlaps and size mismatches is the way to check catalog sizes against a real save.
- **Variants and tiers:** upgrades share a class with their base building (a Market Square is a `MarketBuilding`). Each `<name>Guids` record (type id `Guids`) lists every instance's prefab id in record-index order (`well3` → entry 3). `PREFAB_TYPES` maps known prefab ids to catalog ids and overrides `BUILDING_CLASSES`. To label a new variant, build the base and upgraded versions side by side in-game and diff their prefab ids.
- **Dens:** `wolfDen` records hold both wolf dens and boar dens (class `BoarDen`). Boar dens are the boar spawns (`SpawnArea` with `den: true`).
- **Keep `Terrain` a regular `enum`.** A `const enum` breaks under Vite's per-file transpilation.

**Overlays** are identified by keys of the form `group:kind`, such as `mineral:iron` or `forage:herbs`. The keys, labels and colors are defined once in `data/overlays.ts`, and the renderer, the Map panel (`ui/mapPanel.ts`) and the tooltip (`model/markers.ts`) all use them. To add a kind, add it to three places: the parser's lookup (e.g. `FORAGE_ITEMS`), the union type in `terrain.ts`, and `OVERLAY_GROUPS`.

**Rendering (`render/canvas.ts`)**
- **Offscreen images:** the renderer keeps size×size offscreen canvases (the desirability heat, the terrain and one per layer view) and draws them scaled with smoothing off. Each view's layer canvas is built the first time that view is shown.
- **Heat opacity:** the heat image is opaque when there's no map and translucent over terrain.
- **Draw order:** terrain → view layer → grid → overlays → buildings → the selected building's range → the placement preview.
- **Camera:** `render/camera.ts` maps tiles to screen pixels, and `fit()` sets the minimum zoom for the grid size.

**Persistence (`storage.ts`, localStorage)**
- **Keys:** `ff-planner:autosave:v1` holds the plan, `ff-planner:map:v1` the map (about 1 MB, layers stored as base64), and `ff-planner:overlays:v1` the overlay toggles.
- **Export:** JSON exports include the map, so an exported file is self-contained.
- **Size mismatch:** a saved plan whose size doesn't match the loaded map is discarded.

**Building catalog:** `data/buildings.ts` holds each building's footprint and desirability. `w×h` is the game's unrotated orientation (measured from side-by-side pairs placed touching in a save); this matters for buildings with two even or two odd sides, whose import rotation comes straight from the save. Entries marked `sizeUnverified` have guessed footprints, and the README's to-do list tracks them.
