# Frontier Planner

A desirability planner for [Farthest Frontier](https://farthestfrontier.wiki/wiki/Farthest_Frontier_Community_Wiki). Plan a town ahead of time to get as much desirability into your houses as possible. For each tile, the planner shows the total desirability, the level each house reaches, and how many residents the town can hold. Start on a blank 100×100 grid, or import one of your saves to plan on the real terrain, with its lakes, mountains, resources, animal spawns and enemies.

```bash
npm install
npm run dev     # http://localhost:5173
npm test        # unit tests for the desirability math and the save parser
FF_SAV=/path/to/save.sav npm test   # also check the parser against a real save
```

## To do

Things to confirm in the game and correct where needed:

- [ ] **Check the remaining guessed building sizes.** These have no confirmed footprint, so their sizes are guesses. They're marked `sizeUnverified` in [`src/data/buildings.ts`](src/data/buildings.ts) and shown with `*` in the app.
  - [ ] Treasury (3×4). This size fits where the game centers it in a save, but it isn't confirmed.
  - [ ] Hedge Garden (3×3), Topiary Garden (3×3)
  - [ ] Trellis (1×2)
  - [ ] Civic Monument, Military Monument (imported as 5×5). The save shows both sides are odd.
  - [x] Rose Bush, Low Brush, Tall Brush (1×1), confirmed by the decoration test row
  - [ ] Guard towers are imported as the 1×1 Lookout Tower. They sit on wall tiles, and 1×1 is the only size that doesn't collide with the walls around them.
- [x] **Confirm building sizes in-game (v1.1).** Confirmed and updated in the catalog:
  - [x] Academy 4×5, Book Binder 2×3, Crypt 3×3, Storage Depot 2×3
  - [x] Library 4×3, Theater 5×5, Temple 5×5, Guild Hall 5×4, Apothecary 2×3, Barracks 6×4
  - [x] Coal, Iron and Gold Mines 2×2 (the wiki says 3×3); Deep Mines 3×3; Clay and Sand Pits 3×3; Quarry 5×4
  - [x] Paper Mill 4×4, Furniture Workshop 5×3, Forester Camp 3×3, Large Goat Barn 4×3
  - [x] Rose Garden 2×3, Gazebo Plaza 4×4, Grand Plaza 5×5
- [x] **Check whether houses have a starting desirability.** Confirmed they don't: houses start at 0%, as the planner assumes.
- [ ] **Decide whether Extravagant decorations need their own entries.** They aren't listed separately, because the wiki says they behave exactly like their base versions.
- [x] **Check the imported map's orientation against the in-game map.** Confirmed correct. The planner mirrors the game's x axis, as [ff-game-map](https://github.com/mikh-abc/ff-game-map) does, so lakes and your town should appear where they are in the game.
- [x] **Check the terrain thresholds.** Both were calibrated on two saves and live in [`src/model/terrain.ts`](src/model/terrain.ts).
  - [x] Water is ground below 3 m (`WATER_BELOW_M`). Confirmed, and it holds on the alpine map too: its lakes sit at −7 m.
  - [x] Steep, unbuildable ground rises more than 4 m per tile (`STEEP_M_PER_TILE`). Confirmed it matches the game. If the game lets you build somewhere the planner blocks, raise it. If the planner allows spots the game refuses, lower it.
- [ ] **Decide which fertility layer to show.** The Fertility view uses the save's environmental fertility, as ff-game-map does. The save also has a current-fertility layer, which drops as fields are farmed.
- [x] **Show more forageables.** Berries, nuts, mushrooms and eggs are included alongside greens, herbs, roots and willow.
- [x] **Check boar spawns.** Boars have no spawn areas in v1.1 saves. They spawn from boar dens, which the save stores in the same record type as wolf dens. The Boar toggle shows boar dens, and the Enemies group shows only wolf dens.
- [ ] **Import all buildings from a save.** Most are done: building classes and prefab ids map to planner buildings with their position and rotation (`BUILDING_CLASSES` and `PREFAB_TYPES` in [`src/import/sav.ts`](src/import/sav.ts)). On the original Lametree save that's 1,182 buildings, with 2 skipped because they touch a neighbor. Still to do:
  - [x] **Upgrade tiers and variants.** Each building's `…Guids` record stores its prefab id, which identifies the exact variant. Two side-by-side test saves labeled every building upgrade pair, the Temple and Theater upgrades, all fences and fence gates, and nearly every decoration.
  - [ ] **Academy → Grand Academy.** The Academy's prefab didn't change between the two test saves, so the Grand Academy's id is still unknown.
  - [ ] **Two unidentified decorations:** a 1×1 decoration placed between the corner bench plazas and the medium plazas in the test row (prefab `fe6ea4b5…`), and a 2×2 decoration in the original town (prefab `1935626f…`).
  - [ ] **Which bush is which.** The four bushes were placed as a 2×2 block and are labeled in reading order. All four have the same size and desirability, so a mix-up doesn't change results.
  - [ ] **Crop fields, pastures and graveyards.** Their records store a list of tiles instead of a position.
  - [x] **Roads.** Road splines (`splineRoadContainer`) are rasterized onto the game's 5 m grid and imported as editable 1×1 Road objects.
  - [ ] **Bridges.**
  - [x] **Wide gates.** Gates centered as if two tiles wide import as the 2×1 Wide Gate (6 in the Lametree save).
  - [ ] **Raider guard towers.** Their records (`raiderGuardTower0`) use a different layout and aren't shown yet.
- [ ] **Add desirability values for v1.1 buildings.** The Academy, Book Binder, Crypt, Treasury, Storage Depots, Guild Hall, Forager Garden, the monuments, the bench plazas and Crates and Barrels are in the catalog without desirability values, as they aren't on the wiki. The Pharmacy hasn't appeared in any save yet. Add values in [`src/data/buildings.ts`](src/data/buildings.ts).
- [ ] **Support terrain flattening.** The game lets you flatten steep ground so you can build on it. The planner needs a way to mark tiles as flattened, so they no longer block placement, and to save that with the plan.
- [x] **Update the house upgrade desirability requirements to the current game values.** Houses upgrade at 30%, 60%, 80% and 100% (confirmed in-game), set in [`src/data/houses.ts`](src/data/houses.ts).
- [x] **Add upgrade and downgrade buttons to a building's details panel.** They appear only for confirmed upgrade paths, keep the building's position and rotation, validate footprint changes, and are undoable. Mines and deep mines are separate buildings, not upgrade pairs.
- [x] **Import every building type.** The Gazebo, Guild Hall, Grand Plaza, Stable, Altar, Pastry Shop, Hospital, Apothecary, Furniture Workshop, monuments and decorations now import.
  - [x] Unrecognized building classes are listed with their occurrence counts in the Map panel.
- [x] **Fix sideways Barracks.** The game's unrotated Barracks is 6×4, not 4×6, as the side-by-side pairs showed: each pair was placed touching, so the gap between centers is the building's width. Barracks, Fort and Barn (all even on both sides, where rotation can't be deduced from the center) now use the game's orientation, as do the Hunter Cabin, Firewood Splitter, Fletcher, Forager, Armory, Blacksmith, Foundry, Stable and Goat Barn.
- [x] **Build all buildings and their upgrades side by side in a test save.**
- [ ] **Reflect tech tree improvements,** mainly the ones that raise desirability.
- [x] **Tell fences apart from palisade walls.** Prefab ids separate palisade walls from fences, fieldstone, hedge and wrought iron fences, and their gates. The original Lametree town has 462 palisade wall tiles and 317 fence tiles.
- [ ] **Long term: write changes back to the `.sav` file.** The goal is to rearrange buildings in the planner and save them back into the game. This needs the full building record format, and it should always write a new file rather than overwrite the original save. ff-game-map's `GameMapChanger.cpp` is a starting point.

## Features

- **Grid and camera**
  - The grid is 100×100 tiles, or the map size (384×384) after importing a save.
  - The mouse wheel zooms toward the cursor.
  - Pan by dragging empty ground, dragging with the right or middle mouse button, or holding Space and dragging.
  - **Reset view** fits the whole grid in the window.
- **Placing buildings**
  - Pick a building from the searchable list on the left. A preview snaps to the grid and turns red when it's off the grid, overlapping another building, or on water or steep ground.
  - Click to place it. Drag to place several at once, which is handy for roads.
  - Esc or right-click stops placing.
- **Rotating:** press R or Tab, or use the toolbar button. This works on the preview and on a selected building. A rotated building keeps the same center.
- **Selecting, moving and deleting:** click a building to select it, drag it to move it, and press Delete or Backspace to remove it. Moves snap to the grid and only happen when the new spot is valid.
- **Undo and redo:** Ctrl+Z to undo, Ctrl+Shift+Z or Ctrl+Y to redo.
- **Range display:** a building's range circle only appears while it's selected or being placed. The circle is labeled with the range in meters and says whether the effect at the edge is half or full.
- **Heatmap**
  - Negative values fade from white to red, fully red at −50%.
  - 0 is white.
  - Positive values go from white to light green to dark green, darkest at 100% or more.
  - Hover over a tile to see its exact value.
  - H toggles the heatmap and G toggles the grid lines.
- **Houses**
  - Each level has its own color, a number badge, and a border that gets thicker as the level goes up. The Mansion gets a gold border.
  - Selecting a house shows its desirability, how much more it needs for the next level, and every building affecting it. A building that doesn't count because a stronger building with the same tag wins is struck through.
- **Population panel:** shows total residents and, for each level, how many houses are at that level and how many people they hold.
- **Saving:** plans autosave to the browser's localStorage, and you can export and import plans as JSON files.
- **Adjustable sizes:** Crop Field (5–12) and Graveyard (3–10) have width and height inputs.

## Importing a map from a save

Click **Import save** and choose a `.sav` file. Saves are in `Documents\My Games\Farthest Frontier\Save`. Use the `.sav` file; the `.map` file next to it only holds terrain-generation templates.

What the import brings in:

- **Grid:** the grid switches to the map's size, 384×384 tiles for a standard 1920 m map. One tile is 5 m, the same as the game's grid cell.
- **Terrain**
  - Water and steep ground are drawn on a shaded relief and block building placement. The placement preview turns red there, and a message says why.
  - Water is ground below 3 m. Steep ground rises more than 4 m to a neighboring tile.
- **Your town:** your buildings become planner buildings at their real position and rotation, so they count toward desirability and population. Roads are reconstructed from their saved curves as editable 1×1 road tiles. You can move or delete imported objects like anything placed in the planner. Crop fields, pastures, graveyards, bridges and a few decorations aren't imported yet; the Map panel lists what was left out.
- **Overlays:** the Map panel toggles each one. All are on by default, and your choices are remembered.
  - **Minerals:** clay, sand, stone, iron, gold and coal, drawn at their real radius and labeled with the amount (∞ for deep deposits).
  - **Forageables:** greens, herbs, roots, willow, berries, nuts, mushrooms and eggs.
  - **Animal spawn areas:** deer, boar, wolf and bear, as 64 m squares.
  - **Enemies:** wolf dens, raider camps, raiders and battering rams.
  - **Ruins:** relic and salvage sites.
- **Views**
  - The toolbar switches between **Desirability** (the default), **Fertility**, **Fodder** and **Water** (groundwater for wells).
  - Only one view shows at a time, and the legend and tooltip follow it.

The map is saved in the browser with the plan, about 1 MB. **Export** includes the map, so an exported plan file is self-contained. **Remove map** in the Map panel returns to a blank 100×100 plan.

The save parser is a TypeScript port of the relevant parts of [mikh-abc/ff-game-map](https://github.com/mikh-abc/ff-game-map) (Apache-2.0). It's been tested on two v1.1.2a saves: a 384×384 map and a smaller 256×256 alpine map. The spawn-area table is located by scanning, because the herd records in front of it changed shape since that project was written.

## How desirability is calculated

The data comes from the wiki for game v1.1.0: [Desirability](https://farthestfrontier.wiki/wiki/Desirability), [Buildings](https://farthestfrontier.wiki/wiki/Buildings) and [Shelter](https://farthestfrontier.wiki/wiki/Shelter).

- **Distance** is measured from the center of one building to the center of the other. One tile is 5 m.
- **Falloff:** `effect = value × (1 − 0.5 × distance / range)` when the distance is within range, and 0 beyond it. "Const" buildings (Glassmaker, Soap Shop, Stable) give their full value everywhere within range.
- **Stacking:** buildings with no tag, or with different tags, add together. Among buildings that share a tag, only the strongest one at each point counts. For example, a Market next to a Market Square adds nothing.
- **Displayed values** are percentages, so a value of 0.1 is shown as 10%.
- **House levels** are based on the desirability at the house's center. Every level is 3×3.

| Level | Name        | Desirability | Residents |
|-------|-------------|--------------|-----------|
| 1     | Shelter     | < 30%        | 4         |
| 2     | Homestead   | ≥ 30%        | 5         |
| 3     | Large House | ≥ 60%        | 6         |
| 4     | Manor       | ≥ 80%        | 8         |
| 5     | Mansion     | ≥ 100%       | 10        |

The thresholds and Mansion name are confirmed in-game for v1.1. The Mansion's 10-resident capacity was added at your request; residents for the other levels come from the wiki.

## Project layout

```
index.html
src/
  main.ts               – app controller: input, modes, info panel, toolbar, undo/redo
  import/sav.ts         – .sav parser: record table, agriculture grids, heights, minerals, forageables, spawns, enemies, sites
  data/buildings.ts     – building catalog: size, category, desirability {value, rangeM, constant, tag}
  data/overlays.ts      – map overlay groups, labels and colors
  data/houses.ts        – house level thresholds, residents and colors
  model/plan.ts         – placed buildings, grid size, terrain blocking, footprints, rotation, JSON load/save
  model/terrain.ts      – MapData, water/steep classification, hillshade, serialization
  model/mapImport.ts    – turns the save's Town Center and shelters into planner buildings
  model/markers.ts      – which overlay markers are under the cursor
  model/desirability.ts – effectAt, breakdown, pointDesirability, computeField (100×100 grid)
  model/houses.ts       – houseLevel, evaluateHouses, population summary
  render/camera.ts      – zoom and pan transforms (screen ↔ tile)
  render/canvas.ts      – terrain, views (desirability/fertility/fodder/water), overlays, grid, buildings, range circles, preview
  ui/sidebar.ts         – searchable building list
  ui/stats.ts           – population panel
  ui/mapPanel.ts        – Map panel: import/remove, overlay toggles
  storage.ts            – localStorage autosave, JSON export/import
tests/model.test.ts     – desirability, plan and house-level tests (vitest)
tests/sav.test.ts       – save parser tests on a synthetic save, plus an optional real-save check (FF_SAV)
```

## Verification

1. Run `npm test`. The unit tests cover the falloff formula, tag stacking, rotation, overlap checks, JSON round-trips and every level threshold (99.9% is a Manor, 100% is a Mansion).
2. Place a Town Center, then a House about 5 tiles away. The house should show roughly 10% × (1 − 0.5 × 25/200) ≈ 9.4%.
3. Place a Market and a Market Square near the house. Only the stronger one should count. A Well should add on top of them.
4. Add positive buildings around a house until it passes 30%, 60%, 80% and 100%. The label should go Shelter → Homestead → Large House → Manor → Mansion, and the population 4 → 5 → 6 → 8 → 10.
5. Place a Compost Yard next to the house. Nearby tiles should turn red and the house should drop a level. Drag the yard out of range and the house should recover.
6. Rotate a 3×4 building. The footprint should become 4×3, and the preview should refuse to overlap other buildings.
7. Reload the page and check that the plan is still there. Export the plan, clear it, then import the file and check that it comes back.
