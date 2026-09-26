# Frontier Planner

A desirability planner for [Farthest Frontier](https://farthestfrontier.wiki/wiki/Farthest_Frontier_Community_Wiki). Plan a town ahead of time on a 100×100 grid to get as much desirability into your houses as possible. For each tile, the planner shows the total desirability, the level each house reaches, and how many residents the town can hold.

```bash
npm install
npm run dev     # http://localhost:5173
npm test        # unit tests for the desirability math
```

## To do

Things to confirm in the game and correct where needed:

- [ ] **Check the guessed building sizes.** The wiki lists a desirability value for these buildings but no footprint, so their sizes are guesses. They're marked `sizeUnverified` in [`src/data/buildings.ts`](src/data/buildings.ts) and shown with `*` in the app.
  - [ ] Paper Mill (3×4)
  - [ ] Quarry (4×4)
  - [ ] Deep Clay Mine, Deep Coal Mine, Deep Gold Mine, Deep Iron Mine, Deep Sand Mine (3×3)
  - [ ] Forester Camp (3×3)
  - [ ] Large Goat Barn (3×4)
  - [ ] Gazebo Plaza (3×3)
  - [ ] Grand Plaza (4×4)
  - [ ] Hedge Garden (3×3)
  - [ ] Topiary Garden (3×3)
  - [ ] Trellis (1×2)
  - [ ] Rose Garden (2×2)
  - [ ] Rose Bush, Low Brush, Tall Brush (1×1)
- [ ] **Check whether houses have a starting desirability.** The planner assumes houses start at 0%. If the game gives a base amount, add it in `evaluateHouses` in [`src/model/houses.ts`](src/model/houses.ts).
- [ ] **Decide whether Extravagant decorations need their own entries.** They aren't listed separately, because the wiki says they behave exactly like their base versions.

## Features

- **Grid and camera**
  - The grid is 100×100 tiles.
  - The mouse wheel zooms toward the cursor.
  - Pan by dragging empty ground, dragging with the right or middle mouse button, or holding Space and dragging.
  - **Reset view** fits the whole grid in the window.
- **Placing buildings**
  - Pick a building from the searchable list on the left. A preview snaps to the grid and turns red when it's off the grid or overlapping another building.
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
  - Each level has its own color, a number badge, and a border that gets thicker as the level goes up. The Estate gets a gold border.
  - Selecting a house shows its desirability, how much more it needs for the next level, and every building affecting it. A building that doesn't count because a stronger building with the same tag wins is struck through.
- **Population panel:** shows total residents and, for each level, how many houses are at that level and how many people they hold.
- **Saving:** plans autosave to the browser's localStorage, and you can export and import plans as JSON files.
- **Adjustable sizes:** Crop Field (5–12) and Graveyard (3–10) have width and height inputs.

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
| 3     | Large House | ≥ 65%        | 6         |
| 4     | Manor       | ≥ 85%        | 8         |
| 5     | Estate      | ≥ 100%       | 10        |

Estate is a custom level and isn't in the wiki data.

## Project layout

```
index.html
src/
  main.ts               – app controller: input, modes, info panel, toolbar, undo/redo
  data/buildings.ts     – building catalog: size, category, desirability {value, rangeM, constant, tag}
  data/houses.ts        – house level thresholds, residents and colors
  model/plan.ts         – placed buildings, footprints, rotation, overlap/bounds checks, JSON load/save
  model/desirability.ts – effectAt, breakdown, pointDesirability, computeField (100×100 grid)
  model/houses.ts       – houseLevel, evaluateHouses, population summary
  render/camera.ts      – zoom and pan transforms (screen ↔ tile)
  render/canvas.ts      – heatmap, grid, buildings, range circles, placement preview
  ui/sidebar.ts         – searchable building list
  ui/stats.ts           – population panel
  storage.ts            – localStorage autosave, JSON export/import
tests/model.test.ts     – unit tests (vitest)
```

## Verification

1. Run `npm test`. The unit tests cover the falloff formula, tag stacking, rotation, overlap checks, JSON round-trips and every level threshold (99.9% is a Manor, 100% is an Estate).
2. Place a Town Center, then a House about 5 tiles away. The house should show roughly 10% × (1 − 0.5 × 25/200) ≈ 9.4%.
3. Place a Market and a Market Square near the house. Only the stronger one should count. A Well should add on top of them.
4. Add positive buildings around a house until it passes 30%, 65%, 85% and 100%. The label should go Shelter → Homestead → Large House → Manor → Estate, and the population 4 → 5 → 6 → 8 → 10.
5. Place a Compost Yard next to the house. Nearby tiles should turn red and the house should drop a level. Drag the yard out of range and the house should recover.
6. Rotate a 3×4 building. The footprint should become 4×3, and the preview should refuse to overlap other buildings.
7. Reload the page and check that the plan is still there. Export the plan, clear it, then import the file and check that it comes back.
