import { BUILDINGS, CATEGORIES, type BuildingType } from '../data/buildings';
import { CATEGORY_COLORS } from '../render/canvas';

export function formatEffect(t: BuildingType): string {
  const d = t.desirability;
  if (!d) return '';
  const pct = Math.round(d.value * 100);
  return `${pct > 0 ? '+' : ''}${pct}% · ${d.rangeM} m`;
}

export class Palette {
  private items = new Map<string, HTMLButtonElement>();
  private groups: { el: HTMLElement; types: BuildingType[] }[] = [];

  constructor(root: HTMLElement, search: HTMLInputElement, private onPick: (typeId: string) => void) {
    for (const cat of CATEGORIES) {
      const types = BUILDINGS.filter((b) => b.category === cat);
      const group = document.createElement('details');
      group.className = 'group';
      group.open = cat === 'Housing' || cat === 'Amenities' || cat === 'Decorations';
      const summary = document.createElement('summary');
      summary.innerHTML = `<span class="swatch" style="background:${CATEGORY_COLORS[cat]}"></span>${cat}<span class="count">${types.length}</span>`;
      group.append(summary);

      for (const t of types) {
        const btn = document.createElement('button');
        btn.className = 'item';
        btn.dataset.id = t.id;
        const effect = formatEffect(t);
        const cls = t.desirability ? (t.desirability.value > 0 ? 'pos' : 'neg') : '';
        const size = t.variable ? `${t.variable.min}–${t.variable.max}` : `${t.w}×${t.h}`;
        btn.innerHTML =
          `<span class="name">${t.name}</span>` +
          `<span class="meta"><span class="size" title="${t.sizeUnverified ? 'Size not listed on the wiki — best guess' : 'Footprint in tiles'}">${size}${t.sizeUnverified ? '*' : ''}</span>` +
          (effect ? `<span class="effect ${cls}">${effect}</span>` : '') +
          `</span>`;
        btn.addEventListener('click', () => this.onPick(t.id));
        group.append(btn);
        this.items.set(t.id, btn);
      }
      root.append(group);
      this.groups.push({ el: group, types });
    }

    search.addEventListener('input', () => this.filter(search.value));
  }

  private filter(q: string) {
    const needle = q.trim().toLowerCase();
    for (const g of this.groups) {
      let any = false;
      for (const t of g.types) {
        const show = !needle || t.name.toLowerCase().includes(needle);
        this.items.get(t.id)!.hidden = !show;
        any ||= show;
      }
      g.el.hidden = !any;
      if (needle && any) (g.el as HTMLDetailsElement).open = true;
    }
  }

  setActive(typeId: string | null) {
    for (const [id, btn] of this.items) btn.classList.toggle('active', id === typeId);
  }
}
