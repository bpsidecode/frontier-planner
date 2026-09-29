import { ALL_OVERLAY_KEYS, OVERLAY_GROUPS } from '../data/overlays';
import type { MapData } from '../model/terrain';

const STORE_KEY = 'ff-planner:overlays:v1';

/** Overlay visibility, remembered per browser. Everything is on unless the viewer turned it off. */
export function loadOverlays(): Set<string> {
  const on = new Set(ALL_OVERLAY_KEYS);
  try {
    const off = JSON.parse(localStorage.getItem(STORE_KEY) ?? '[]');
    if (Array.isArray(off)) for (const k of off) on.delete(k);
  } catch {
    /* ignore */
  }
  return on;
}

function saveOverlays(on: Set<string>) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(ALL_OVERLAY_KEYS.filter((k) => !on.has(k))));
  } catch {
    /* ignore */
  }
}

function counts(map: MapData): Record<string, number> {
  const c: Record<string, number> = {};
  const bump = (k: string) => (c[k] = (c[k] ?? 0) + 1);
  map.minerals.forEach((m) => bump(`mineral:${m.kind}`));
  map.forageables.forEach((f) => bump(`forage:${f.kind}`));
  map.spawns.forEach((s) => bump(`spawn:${s.kind}`));
  map.enemies.forEach((e) => bump(`enemy:${e.kind}`));
  map.ruins.forEach((r) => bump(`ruin:${r.kind}`));
  return c;
}

export interface MapPanelActions {
  importSave: () => void;
  removeMap: () => void;
  onOverlaysChange: (visible: Set<string>) => void;
}

export function renderMapPanel(root: HTMLElement, map: MapData | null, visible: Set<string>, actions: MapPanelActions) {
  if (!map) {
    root.innerHTML = `
      <p class="empty">Import a Farthest Frontier <b>.sav</b> file to plan on the real terrain. Lakes and steep ground block placement, and resources, spawns and enemies show on the grid.</p>
      <p class="tagnote">Saves are in <code>Documents\\My Games\\Farthest Frontier\\Save</code>. Use the <code>.sav</code> file; the matching <code>.map</code> only holds terrain templates.</p>
      <div class="actions"><button class="btn primary" data-map="import">Import save…</button></div>`;
    root.querySelector('[data-map="import"]')!.addEventListener('click', actions.importSave);
    return;
  }

  const c = counts(map);
  const groups = OVERLAY_GROUPS.map((g) => {
    const items = g.items
      .map(
        (i) => `
        <label class="ov-item ${c[i.key] ? '' : 'dim'}">
          <input type="checkbox" data-key="${i.key}" ${visible.has(i.key) ? 'checked' : ''}>
          <span class="swatch" style="background:${i.color}"></span>${i.label}
          <span class="count">${c[i.key] ?? 0}</span>
        </label>`,
      )
      .join('');
    return `
      <details class="ov-group" open>
        <summary><input type="checkbox" data-group="${g.id}" title="Show or hide all ${g.label.toLowerCase()}"> ${g.label}</summary>
        ${items}
      </details>`;
  }).join('');

  const pending = Object.entries(map.notImported ?? {}).sort((a, b) => b[1] - a[1]);
  const pendingNote = pending.length
    ? `<p class="tagnote">Not imported yet: ${pending.map(([k, n]) => `${escapeHtml(k.toLowerCase())} (${n})`).join(', ')}.</p>`
    : '';
  const unknown = Object.entries(map.unknownBuildingClasses ?? {}).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const unknownNote = unknown.length
    ? `<p class="tagnote">Unrecognized building classes: ${unknown.map(([k, n]) => `<code>${escapeHtml(k)}</code> (${n})`).join(', ')}. These records were not imported.</p>`
    : '';
  root.innerHTML = `
    <div class="map-meta"><b>${escapeHtml(map.name)}</b><br>
      <span class="tagnote">${map.size}×${map.size} tiles${map.version ? ` · game ${escapeHtml(map.version)}` : ''} · ${map.buildings.length} buildings from the save</span></div>
    ${pendingNote}
    ${unknownNote}
    ${groups}
    <div class="actions">
      <button class="btn" data-map="import">Import another…</button>
      <button class="btn danger" data-map="remove">Remove map</button>
    </div>`;

  const syncGroups = () => {
    for (const g of OVERLAY_GROUPS) {
      const box = root.querySelector<HTMLInputElement>(`[data-group="${g.id}"]`)!;
      const on = g.items.filter((i) => visible.has(i.key)).length;
      box.checked = on === g.items.length;
      box.indeterminate = on > 0 && on < g.items.length;
    }
  };
  const changed = () => {
    syncGroups();
    saveOverlays(visible);
    actions.onOverlaysChange(visible);
  };

  root.querySelectorAll<HTMLInputElement>('[data-key]').forEach((box) =>
    box.addEventListener('change', () => {
      box.checked ? visible.add(box.dataset.key!) : visible.delete(box.dataset.key!);
      changed();
    }),
  );
  root.querySelectorAll<HTMLInputElement>('[data-group]').forEach((box) => {
    // Clicking the checkbox inside <summary> shouldn't also collapse the group.
    box.addEventListener('click', (e) => e.stopPropagation());
    box.addEventListener('change', () => {
      const g = OVERLAY_GROUPS.find((x) => x.id === box.dataset.group)!;
      for (const i of g.items) {
        box.checked ? visible.add(i.key) : visible.delete(i.key);
        root.querySelector<HTMLInputElement>(`[data-key="${i.key}"]`)!.checked = box.checked;
      }
      changed();
    });
  });
  syncGroups();
  root.querySelector('[data-map="import"]')!.addEventListener('click', actions.importSave);
  root.querySelector('[data-map="remove"]')!.addEventListener('click', actions.removeMap);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
