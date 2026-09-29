import './style.css';
import { getDowngrade, getType, type BuildingType } from './data/buildings';
import { Plan, TILE_M, clamp, inBounds, rotatedSize, type Placed, type Rect } from './model/plan';
import { breakdown, computeField } from './model/desirability';
import { evaluateHouses, nextLevel, summarize, type HouseInfo } from './model/houses';
import { Camera } from './render/camera';
import { GREEN_AT, RED_AT, Renderer, desirabilityColor, layerColor, type Ghost, type View } from './render/canvas';
import { Palette } from './ui/sidebar';
import { renderStats } from './ui/stats';
import { exportPlan, loadAutosave, readPlanFile, saveMap, scheduleAutosave } from './storage';
import { Terrain, blockedMask, type MapData } from './model/terrain';
import { markersAt } from './model/markers';
import { importSaveBuildings } from './model/mapImport';
import { SaveFormatError, isSupportedVersion, parseSave } from './import/sav';
import { loadOverlays, renderMapPanel } from './ui/mapPanel';

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;

const canvas = $<HTMLCanvasElement>('#map');
const wrap = $('#canvas-wrap');
const tooltip = $('#tooltip');
const toastEl = $('#toast');
const infoEl = $('#info');
const infoTitle = $('#info-title');
const statsEl = $('#stats');
const mapPanelEl = $('#map-panel');

const cam = new Camera();
const renderer = new Renderer(canvas, cam);

const saved = loadAutosave();
let map: MapData | null = saved.map;
let blocked: Uint8Array | null = map ? blockedMask(map) : null;
let plan = restorePlan(saved.planData);
let field: Float32Array = new Float32Array(plan.size * plan.size);
let houseMap = new Map<number, HouseInfo>();

interface Placing {
  typeId: string;
  rot: number;
  w: number;
  h: number;
}
let placing: Placing | null = null;
let selectedId: number | null = null;
let hover: { x: number; y: number } | null = null;
let view: View = 'desirability';
const overlays = loadOverlays();
let showGrid = true;
let spaceDown = false;
let lastPointer: PointerEvent | null = null;

type Drag =
  | { kind: 'pan'; x: number; y: number; sx: number; sy: number; moved: boolean; button: number }
  | { kind: 'move'; id: number; offX: number; offY: number; before: string; moved: boolean }
  | { kind: 'paint'; before: string; placed: boolean; lastKey: string };
let drag: Drag | null = null;

// ---------- formatting ----------

const pct = (v: number, digits = 1) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v * 100).toFixed(digits)}%`;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function describeEffect(t: BuildingType): string {
  const d = t.desirability;
  if (!d) return '<p class="tagnote">No effect on desirability.</p>';
  const cls = d.value > 0 ? 'pos' : 'neg';
  const tiles = d.rangeM / TILE_M;
  const reach = d.constant
    ? `<b class="${cls}">${pct(d.value, 0)}</b> everywhere within ${d.rangeM} m (${tiles} tiles)`
    : `<b class="${cls}">${pct(d.value, 0)}</b> at its center, falling to <b class="${cls}">${pct(d.value / 2, 0)}</b> at ${d.rangeM} m (${tiles} tiles)`;
  const tag = d.tag
    ? `<p class="tagnote">Doesn't stack with other “${esc(d.tag)}” buildings. Only the strongest one counts at each spot.</p>`
    : `<p class="tagnote">Stacks with everything.</p>`;
  return `<p>${reach}.</p>${tag}`;
}

/** Rebuild a plan from saved data on the current map; data from another grid size starts fresh. */
function restorePlan(data: unknown): Plan {
  const size = map?.size ?? 100;
  try {
    if (data && (((data as { size?: number }).size ?? 100) === size)) return Plan.fromJSON(data, blocked, size);
  } catch {
    /* fall through */
  }
  return new Plan(size, blocked);
}

// ---------- history ----------

const undoStack: string[] = [];
const redoStack: string[] = [];
const snapshot = () => JSON.stringify(plan.toJSON());

function pushUndo(before = snapshot()) {
  undoStack.push(before);
  if (undoStack.length > 200) undoStack.shift();
  redoStack.length = 0;
}

function restore(s: string) {
  plan = Plan.fromJSON(JSON.parse(s), blocked, plan.size);
  if (selectedId != null && !plan.get(selectedId)) selectedId = null;
  changed();
}

function undo() {
  const s = undoStack.pop();
  if (!s) return;
  redoStack.push(snapshot());
  restore(s);
}

function redo() {
  const s = redoStack.pop();
  if (!s) return;
  undoStack.push(snapshot());
  restore(s);
}

// ---------- state updates ----------

function changed() {
  field = computeField(plan.buildings, plan.size);
  renderer.setField(field, plan.size);
  const houses = evaluateHouses(plan.buildings);
  houseMap = new Map(houses.map((h) => [h.building.id, h]));
  renderStats(statsEl, summarize(houses));
  renderInfo();
  updateToolbar();
  scheduleAutosave(plan);
  if (lastPointer && hover) updateTooltip(lastPointer);
  draw();
}

let raf = 0;
function draw() {
  if (raf) return;
  raf = requestAnimationFrame(() => {
    raf = 0;
    renderer.draw({
      size: plan.size,
      buildings: plan.buildings,
      houses: houseMap,
      selectedId,
      ghost: ghost(),
      view,
      showGrid,
      map,
      overlays,
    });
  });
}

let toastTimer: number | undefined;
function toast(msg: string) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toastEl.hidden = true), 2200);
}

function sizeFields(t: BuildingType): Pick<Placed, 'w' | 'h'> {
  return t.variable && placing ? { w: placing.w, h: placing.h } : {};
}

function ghost(): Ghost | null {
  if (!placing || !hover) return null;
  const t = getType(placing.typeId);
  const size = t.variable ? { w: placing.w, h: placing.h } : { w: t.w, h: t.h };
  const r = rotatedSize(size.w, size.h, placing.rot);
  const x = Math.floor(hover.x - r.w / 2 + 0.5);
  const y = Math.floor(hover.y - r.h / 2 + 0.5);
  const rect = { x, y, w: r.w, h: r.h };
  const preview: Placed = { id: -1, typeId: placing.typeId, x, y, rot: placing.rot, ...sizeFields(t) };
  return { typeId: placing.typeId, rect, preview, valid: plan.canPlace(rect) };
}

// ---------- modes & actions ----------

function pickType(typeId: string) {
  const t = getType(typeId);
  const keepRot = placing?.typeId === typeId ? placing.rot : 0;
  placing = { typeId, rot: keepRot, w: t.w, h: t.h };
  selectedId = null;
  palette.setActive(typeId);
  canvas.style.cursor = 'crosshair';
  renderInfo();
  updateToolbar();
  draw();
}

function stopPlacing() {
  placing = null;
  palette.setActive(null);
  canvas.style.cursor = '';
  renderInfo();
  updateToolbar();
  draw();
}

function select(id: number | null) {
  selectedId = id;
  renderInfo();
  updateToolbar();
  draw();
}

function rotate() {
  if (placing) {
    placing.rot = (placing.rot + 1) % 4;
    draw();
  } else if (selectedId != null) {
    const before = snapshot();
    if (plan.rotate(selectedId)) {
      pushUndo(before);
      changed();
    } else toast('No room to rotate here');
  }
}

function deleteSelected() {
  if (selectedId == null) return;
  pushUndo();
  plan.remove(selectedId);
  selectedId = null;
  changed();
}

function replaceSelected(typeId: string) {
  if (selectedId == null) return;
  const before = snapshot();
  if (plan.replaceType(selectedId, typeId)) {
    pushUndo(before);
    changed();
  } else {
    toast(`Not enough room for ${getType(typeId).name}`);
  }
}

function tryPaint(isClick: boolean) {
  if (!drag || drag.kind !== 'paint' || !placing) return;
  const g = ghost();
  if (!g) return;
  const key = `${g.rect.x},${g.rect.y}`;
  if (key === drag.lastKey) return;
  drag.lastKey = key;
  if (!g.valid) {
    if (isClick) toast(`Can’t place here: ${placeProblem(g.rect)}`);
    return;
  }
  const t = getType(placing.typeId);
  plan.add({ typeId: placing.typeId, x: g.rect.x, y: g.rect.y, rot: placing.rot, ...sizeFields(t) });
  if (!drag.placed) {
    pushUndo(drag.before);
    drag.placed = true;
  }
  changed();
}

/** Why a footprint can't be placed, for the toast. */
function placeProblem(r: Rect): string {
  if (!inBounds(r, plan.size)) return 'it goes past the edge of the map';
  let water = false;
  let steep = false;
  for (let y = r.y; y < r.y + r.h; y++)
    for (let x = r.x; x < r.x + r.w; x++) {
      if (plan.at(x, y)) return 'it overlaps another building';
      const t = map?.terrain[y * plan.size + x];
      water ||= t === Terrain.Water;
      steep ||= t === Terrain.Steep;
    }
  return water ? 'that’s water' : steep ? 'the ground is too steep' : 'the spot is blocked';
}

function updateToolbar() {
  const btn = (a: string) => document.querySelector<HTMLButtonElement>(`[data-act="${a}"]`)!;
  btn('select').classList.toggle('on', !placing);
  btn('delete').disabled = selectedId == null;
  btn('rotate').disabled = !placing && selectedId == null;
  btn('undo').disabled = undoStack.length === 0;
  btn('redo').disabled = redoStack.length === 0;
}

// ---------- info panel ----------

function sizeInputs(t: BuildingType, w: number, h: number): string {
  if (!t.variable) return '';
  const { min, max } = t.variable;
  return `<div class="sizes">Size
    <input type="number" id="size-w" min="${min}" max="${max}" value="${w}"> ×
    <input type="number" id="size-h" min="${min}" max="${max}" value="${h}"></div>`;
}

function bindSizeInputs(onChange: (w: number, h: number) => void) {
  const wEl = infoEl.querySelector<HTMLInputElement>('#size-w');
  const hEl = infoEl.querySelector<HTMLInputElement>('#size-h');
  if (!wEl || !hEl) return;
  const fire = () => onChange(Number(wEl.value), Number(hEl.value));
  wEl.addEventListener('change', fire);
  hEl.addEventListener('change', fire);
}

function renderInfo() {
  if (placing) {
    const t = getType(placing.typeId);
    infoTitle.textContent = 'Placing';
    infoEl.innerHTML = `
      <div class="card-title">${esc(t.name)}</div>
      <div class="sub">${t.category} · ${t.variable ? 'adjustable size' : `${t.w}×${t.h} tiles`}${t.sizeUnverified ? ' (size is a guess)' : ''}</div>
      ${sizeInputs(t, placing.w, placing.h)}
      ${t.house ? '<p>A house’s level depends on the desirability at its center. See the table above.</p>' : describeEffect(t)}
      <p class="tagnote">Click to place, or drag to place several. R rotates. Esc or right-click stops placing.</p>`;
    bindSizeInputs((w, h) => {
      if (!placing || !t.variable) return;
      placing.w = clamp(Math.round(w) || t.w, t.variable.min, t.variable.max);
      placing.h = clamp(Math.round(h) || t.h, t.variable.min, t.variable.max);
      renderInfo();
      draw();
    });
    return;
  }

  const b = selectedId != null ? plan.get(selectedId) : undefined;
  if (!b) {
    infoTitle.textContent = 'Selection';
    infoEl.innerHTML = `<p class="empty">Pick a building on the left to place it, or click a building on the map to inspect, move or delete it.</p>`;
    return;
  }

  const t = getType(b.typeId);
  const size = rotatedSize(b.w ?? t.w, b.h ?? t.h, b.rot);
  infoTitle.textContent = 'Selected';
  let html = `
    <div class="card-title">${esc(t.name)}</div>
    <div class="sub">${t.category} · ${size.w}×${size.h} tiles at (${b.x}, ${b.y})${t.sizeUnverified ? ' · size is a guess' : ''}</div>
    ${sizeInputs(t, b.w ?? t.w, b.h ?? t.h)}`;

  const house = houseMap.get(b.id);
  if (house) {
    const next = nextLevel(house.level);
    const [r, g, bl] = desirabilityColor(house.pct / 100);
    html += `
      <div class="house-level"><span class="lvl" style="background:${house.level.color}${house.level.level === 5 ? ';box-shadow:0 0 0 2px #facc15' : ''}">${house.level.level}</span>
        ${house.level.name} · ${house.level.residents} residents</div>
      <dl class="kv"><dt>Desirability</dt><dd><b>${house.pct.toFixed(1)}%</b></dd>
      <dt>Next level</dt><dd>${next ? `${next.name} at ${next.minPct}% (needs ${(next.minPct - house.pct).toFixed(1)}% more)` : 'Maximum level reached'}</dd></dl>
      <div class="progress"><div style="width:${clamp(house.pct, 0, 100)}%;background:rgb(${r},${g},${bl})"></div></div>`;
    const parts = breakdown(plan.buildings, b.x + size.w / 2, b.y + size.h / 2);
    html += parts.length
      ? `<p class="tagnote">What affects this house (struck-through items are outranked by a stronger building with the same tag):</p>
         <ul class="contrib">${parts
           .map(
             (c) =>
               `<li data-id="${c.building.id}" class="${c.counted ? '' : 'off'}" title="${c.counted ? '' : 'A stronger building with the same tag wins here'}">
                 <span>${esc(c.type.name)}</span><span class="v ${c.effect > 0 ? 'pos' : 'neg'}">${pct(c.effect)}</span></li>`,
           )
           .join('')}</ul>`
      : '<p class="tagnote">No buildings affect this house yet.</p>';
  } else {
    html += describeEffect(t);
  }
  const upgrade = t.upgradeTo ? getType(t.upgradeTo) : undefined;
  const downgrade = getDowngrade(t.id);
  if (upgrade || downgrade) {
    html += `<div class="actions upgrade-actions">
      ${upgrade ? `<button class="btn primary" data-info="upgrade" title="Upgrade to ${esc(upgrade.name)}">Upgrade</button>` : ''}
      ${downgrade ? `<button class="btn" data-info="downgrade" title="Downgrade to ${esc(downgrade.name)}">Downgrade</button>` : ''}
    </div>`;
  }
  html += `<div class="actions"><button class="btn" data-info="rotate">Rotate</button><button class="btn danger" data-info="delete">Delete</button></div>`;
  infoEl.innerHTML = html;

  if (upgrade) infoEl.querySelector('[data-info="upgrade"]')!.addEventListener('click', () => replaceSelected(upgrade.id));
  if (downgrade) infoEl.querySelector('[data-info="downgrade"]')!.addEventListener('click', () => replaceSelected(downgrade.id));
  infoEl.querySelector('[data-info="rotate"]')!.addEventListener('click', rotate);
  infoEl.querySelector('[data-info="delete"]')!.addEventListener('click', deleteSelected);
  infoEl.querySelectorAll<HTMLElement>('.contrib li').forEach((li) =>
    li.addEventListener('click', () => select(Number(li.dataset.id))),
  );
  bindSizeInputs((w, h) => {
    if (!t.variable) return;
    const nw = clamp(Math.round(w) || t.w, t.variable.min, t.variable.max);
    const nh = clamp(Math.round(h) || t.h, t.variable.min, t.variable.max);
    const before = snapshot();
    if (plan.update(b.id, { w: nw, h: nh })) {
      pushUndo(before);
      changed();
    } else {
      toast('Not enough room for that size');
      renderInfo();
    }
  });
}

// ---------- tooltip ----------

function updateTooltip(e: PointerEvent) {
  if (!hover || drag?.kind === 'pan') {
    tooltip.hidden = true;
    return;
  }
  const tx = Math.floor(hover.x);
  const ty = Math.floor(hover.y);
  const n = plan.size;
  if (tx < 0 || ty < 0 || tx >= n || ty >= n) {
    tooltip.hidden = true;
    return;
  }
  const i = ty * n + tx;
  let text = `(${tx}, ${ty}) · desirability <b>${pct(field[i])}</b>`;
  if (map) {
    if (view !== 'desirability') text += `<br>${VIEW_LABEL[view]} <b>${Math.round((map[view][i] / 255) * 100)}%</b>`;
    const t = map.terrain[i];
    if (t !== Terrain.Land) text += `<br><i>${t === Terrain.Water ? 'Water' : 'Steep ground'}: can’t build</i>`;
    for (const m of markersAt(map, overlays, hover.x, hover.y).slice(0, 6)) text += `<br>${esc(m)}`;
  }
  const b = plan.at(tx, ty);
  if (b) {
    const h = houseMap.get(b.id);
    text += `<br>${esc(getType(b.typeId).name)}${h ? ` · ${h.level.name} (${h.pct.toFixed(1)}%)` : ''}`;
  }
  tooltip.innerHTML = text;
  tooltip.hidden = false;
  const rect = wrap.getBoundingClientRect();
  let x = e.clientX - rect.left + 14;
  let y = e.clientY - rect.top + 14;
  if (x + tooltip.offsetWidth > rect.width - 4) x -= tooltip.offsetWidth + 24;
  if (y + tooltip.offsetHeight > rect.height - 4) y -= tooltip.offsetHeight + 24;
  tooltip.style.left = `${x}px`;
  tooltip.style.top = `${y}px`;
}

// ---------- pointer input ----------

function tileAt(e: { clientX: number; clientY: number }) {
  const r = canvas.getBoundingClientRect();
  return cam.toTile(e.clientX - r.left, e.clientY - r.top);
}

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  lastPointer = e;
  hover = tileAt(e);
  if (e.button === 1 || e.button === 2 || (e.button === 0 && spaceDown)) {
    drag = { kind: 'pan', x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false, button: e.button };
    canvas.style.cursor = 'grabbing';
    return;
  }
  if (e.button !== 0) return;
  if (placing) {
    drag = { kind: 'paint', before: snapshot(), placed: false, lastKey: '' };
    tryPaint(true);
    return;
  }
  const hit = plan.at(Math.floor(hover.x), Math.floor(hover.y));
  if (hit) {
    drag = { kind: 'move', id: hit.id, offX: hit.x - hover.x, offY: hit.y - hover.y, before: snapshot(), moved: false };
    select(hit.id);
    canvas.style.cursor = 'move';
  } else {
    if (selectedId != null) select(null);
    drag = { kind: 'pan', x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false, button: 0 };
    canvas.style.cursor = 'grabbing';
  }
});

canvas.addEventListener('pointermove', (e) => {
  lastPointer = e;
  hover = tileAt(e);
  if (drag?.kind === 'pan') {
    cam.pan(e.clientX - drag.x, e.clientY - drag.y);
    drag.x = e.clientX;
    drag.y = e.clientY;
    if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 4) drag.moved = true;
  } else if (drag?.kind === 'move') {
    const b = plan.get(drag.id);
    const nx = Math.round(hover.x + drag.offX);
    const ny = Math.round(hover.y + drag.offY);
    if (b && (nx !== b.x || ny !== b.y) && plan.update(drag.id, { x: nx, y: ny })) {
      if (!drag.moved) {
        pushUndo(drag.before);
        drag.moved = true;
      }
      changed();
    }
  } else if (drag?.kind === 'paint') {
    tryPaint(false);
  }
  updateTooltip(e);
  draw();
});

function endDrag(e: PointerEvent) {
  if (drag?.kind === 'pan' && drag.button === 2 && !drag.moved) {
    if (placing) stopPlacing();
    else select(null);
  }
  drag = null;
  canvas.style.cursor = placing ? 'crosshair' : '';
  if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  updateToolbar();
}
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('pointerleave', () => {
  if (drag) return;
  hover = null;
  tooltip.hidden = true;
  draw();
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    cam.zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-delta * 0.0015));
    hover = tileAt(e);
    draw();
  },
  { passive: false },
);

// ---------- keyboard ----------

window.addEventListener('keydown', (e) => {
  const target = e.target as HTMLElement;
  const typing = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
  if (typing && e.key !== 'Escape') return;
  const mod = e.ctrlKey || e.metaKey;

  if (mod && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    e.shiftKey ? redo() : undo();
    updateToolbar();
  } else if (mod && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    redo();
    updateToolbar();
  } else if (mod) {
    return;
  } else if (e.key === ' ') {
    e.preventDefault();
    if (!spaceDown) {
      spaceDown = true;
      canvas.style.cursor = 'grab';
    }
  } else if (e.key === 'r' || e.key === 'R' || e.key === 'Tab') {
    e.preventDefault();
    rotate();
  } else if (e.key === 'Escape') {
    if (typing) target.blur();
    if (placing) stopPlacing();
    else select(null);
  } else if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    deleteSelected();
  } else if (e.key === 'v' || e.key === 'V') {
    stopPlacing();
  } else if (e.key === 'h' || e.key === 'H') {
    setView('desirability');
  } else if (e.key === 'g' || e.key === 'G') {
    setGrid(!showGrid);
  }
});
window.addEventListener('keyup', (e) => {
  if (e.key === ' ') {
    spaceDown = false;
    canvas.style.cursor = placing ? 'crosshair' : '';
  }
});

// ---------- toolbar ----------

const gridToggle = $<HTMLInputElement>('#toggle-grid');
function setGrid(on: boolean) {
  showGrid = gridToggle.checked = on;
  draw();
}
gridToggle.addEventListener('change', () => setGrid(gridToggle.checked));

const VIEW_LABEL: Record<View, string> = {
  desirability: 'Desirability',
  fertility: 'Fertility',
  fodder: 'Fodder',
  water: 'Groundwater',
};

function setView(v: View) {
  if (v !== 'desirability' && !map) return;
  view = v;
  document.querySelectorAll<HTMLButtonElement>('#view-seg [data-view]').forEach((b) => {
    b.classList.toggle('on', b.dataset.view === v);
    b.disabled = b.dataset.view !== 'desirability' && !map;
  });
  buildLegend();
  if (lastPointer && hover) updateTooltip(lastPointer);
  draw();
}
document.querySelectorAll<HTMLButtonElement>('#view-seg [data-view]').forEach((b) =>
  b.addEventListener('click', () => {
    setView(b.dataset.view as View);
    b.blur();
  }),
);

/** Swap in a new map (or none) and plan, resetting history and the camera. */
function setMapAndPlan(nextMap: MapData | null, nextPlan: Plan) {
  map = nextMap;
  blocked = map ? blockedMask(map) : null;
  plan = nextPlan;
  selectedId = null;
  undoStack.length = 0;
  redoStack.length = 0;
  renderer.setMap(map);
  if (!saveMap(map)) toast('The map is too large to keep after a reload; export the plan to save it');
  if (!map && view !== 'desirability') view = 'desirability';
  cam.fit(renderer.width, renderer.height, plan.size);
  renderMap();
  setView(view);
  changed();
}

const fileInput = $<HTMLInputElement>('#file');
fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  fileInput.value = '';
  if (!file) return;
  try {
    const next = await readPlanFile(file);
    if (next.map) {
      const nextBlocked = blockedMask(next.map);
      setMapAndPlan(next.map, Plan.fromJSON(next.planData, nextBlocked, next.map.size));
    } else if (map && ((next.planData as { size?: number }).size ?? 100) !== map.size) {
      // A plan made without a map: drop the map and go back to its own grid.
      setMapAndPlan(null, Plan.fromJSON(next.planData));
    } else {
      pushUndo();
      plan = Plan.fromJSON(next.planData, blocked, plan.size);
      selectedId = null;
      changed();
    }
  } catch {
    toast('That file isn’t a planner export');
  }
});

const saveInput = $<HTMLInputElement>('#sav-file');
saveInput.addEventListener('change', async () => {
  const file = saveInput.files?.[0];
  saveInput.value = '';
  if (!file) return;
  if (plan.buildings.length && !confirm('Importing a save replaces the current plan. Export it first if you want to keep it. Continue?')) return;
  toast('Loading map…');
  await new Promise((r) => setTimeout(r, 30)); // let the toast paint before the parse blocks
  try {
    const nextMap = parseSave(await file.arrayBuffer(), file.name);
    const report = importSaveBuildings(nextMap);
    setMapAndPlan(nextMap, report.plan);
    const total = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);
    const placed = total(report.imported);
    const overlapping = total(report.overlapping);
    const pending = total(nextMap.notImported);
    const parts = [`Imported ${nextMap.size}×${nextMap.size} map with ${placed} building${placed === 1 ? '' : 's'}`];
    if (overlapping) parts.push(`${overlapping} skipped (overlapping)`);
    if (pending) parts.push(`${pending} not supported yet (see Map panel)`);
    console.info('Save import', report, nextMap.notImported);
    if (!isSupportedVersion(nextMap.version)) parts.push(`save version ${nextMap.version} is older than v1.1.0 and may be incomplete`);
    toast(parts.join(' · '));
  } catch (err) {
    console.error(err);
    toast(err instanceof SaveFormatError ? err.message : 'Couldn’t read that save file');
  }
});

function importSave() {
  saveInput.click();
}

function removeMap() {
  if (!confirm('Remove the imported map and start a blank 100×100 plan? Export first if you want to keep this plan.')) return;
  setMapAndPlan(null, new Plan());
}

function renderMap() {
  renderMapPanel(mapPanelEl, map, overlays, {
    importSave,
    removeMap,
    onOverlaysChange: () => {
      if (lastPointer && hover) updateTooltip(lastPointer);
      draw();
    },
  });
}

const actions: Record<string, () => void> = {
  select: stopPlacing,
  rotate,
  delete: deleteSelected,
  undo,
  redo,
  fit: () => {
    cam.fit(renderer.width, renderer.height, plan.size);
    draw();
  },
  export: () => exportPlan(plan, map),
  import: () => fileInput.click(),
  'import-save': importSave,
  clear: () => {
    if (!plan.buildings.length || !confirm('Remove every building from the plan? You can undo this.')) return;
    pushUndo();
    plan.clear();
    selectedId = null;
    changed();
  },
};
document.querySelectorAll<HTMLButtonElement>('#toolbar [data-act]').forEach((btn) =>
  btn.addEventListener('click', () => {
    actions[btn.dataset.act!]?.();
    updateToolbar();
    btn.blur();
  }),
);

// ---------- legend ----------

function buildLegend() {
  $('.legend-title').textContent = view === 'water' ? 'Groundwater (for wells)' : VIEW_LABEL[view];
  if (view !== 'desirability') {
    const stops = Array.from({ length: 11 }, (_, i) => {
      const [r, g, b] = layerColor(view as Exclude<View, 'desirability'>, i / 10);
      return `rgb(${r},${g},${b}) ${i * 10}%`;
    });
    $('.legend-bar').style.background = `linear-gradient(to right, ${stops.join(',')})`;
    $('.legend-labels').innerHTML = [0, 25, 50, 75, 100].map((l) => `<span style="left:${l}%">${l}%</span>`).join('');
    return;
  }
  const span = GREEN_AT - RED_AT;
  const stops: string[] = [];
  for (let i = 0; i <= 30; i++) {
    const v = RED_AT + (span * i) / 30;
    const [r, g, b] = desirabilityColor(v);
    stops.push(`rgb(${r},${g},${b}) ${((i / 30) * 100).toFixed(1)}%`);
  }
  $('.legend-bar').style.background = `linear-gradient(to right, ${stops.join(',')})`;
  const labels = [-50, -25, 0, 30, 60, 100];
  $('.legend-labels').innerHTML = labels
    .map((l) => `<span style="left:${((l / 100 - RED_AT) / span) * 100}%">${l > 0 ? '+' : ''}${l}%</span>`)
    .join('');
}

// ---------- boot ----------

const palette = new Palette($('#palette'), $<HTMLInputElement>('#search'), pickType);

let fitted = false;
new ResizeObserver(() => {
  renderer.resize(wrap.clientWidth, wrap.clientHeight);
  if (!fitted && wrap.clientWidth > 0) {
    cam.fit(wrap.clientWidth, wrap.clientHeight, plan.size);
    fitted = true;
  }
  draw();
}).observe(wrap);

renderer.setMap(map);
renderMap();
setView('desirability');
changed();
