import { getType, type Category } from '../data/buildings';
import { OVERLAY_COLOR } from '../data/overlays';
import { TILE_M, center, footprint, type Placed, type Rect } from '../model/plan';
import type { HouseInfo } from '../model/houses';
import { formatAmount } from '../model/markers';
import { Terrain, type LayerView, type MapData } from '../model/terrain';
import type { Camera } from './camera';

export type RGB = [number, number, number];
export type View = 'desirability' | LayerView;

const WHITE: RGB = [255, 255, 255];
const RED: RGB = [220, 38, 38];
const LIGHT_GREEN: RGB = [134, 239, 172];
const DARK_GREEN: RGB = [20, 83, 45];

/** Fraction at which the red end of the scale saturates. */
export const RED_AT = -0.5;
/** Fraction at which the green end of the scale is darkest. */
export const GREEN_AT = 1.0;

const lerp = (a: RGB, b: RGB, t: number): RGB => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
];

/** Red (negative) → white (0) → light green → dark green (≥ 100%). */
export function desirabilityColor(v: number): RGB {
  if (v < 0) return lerp(WHITE, RED, Math.min(1, v / RED_AT));
  const t = Math.min(1, v / GREEN_AT);
  return t < 0.3 ? lerp(WHITE, LIGHT_GREEN, t / 0.3) : lerp(LIGHT_GREEN, DARK_GREEN, (t - 0.3) / 0.7);
}

const LAYER_STOPS: Record<LayerView, RGB[]> = {
  fertility: [
    [156, 112, 64],
    [214, 200, 110],
    [34, 120, 44],
  ],
  fodder: [
    [246, 238, 190],
    [160, 206, 120],
    [30, 110, 90],
  ],
  water: [
    [246, 250, 255],
    [120, 180, 235],
    [16, 70, 170],
  ],
};

/** Three-stop color ramp for a 0–1 layer value. */
export function layerColor(view: LayerView, v: number): RGB {
  const [a, b, c] = LAYER_STOPS[view];
  const t = Math.max(0, Math.min(1, v));
  return t < 0.5 ? lerp(a, b, t * 2) : lerp(b, c, (t - 0.5) * 2);
}

const TERRAIN_BASE: Record<number, RGB> = {
  [Terrain.Land]: [178, 196, 132],
  [Terrain.Steep]: [148, 132, 114],
  [Terrain.Water]: [92, 152, 212],
};

export const CATEGORY_COLORS: Record<Category, string> = {
  Housing: '#78716c',
  Amenities: '#93c5fd',
  Decorations: '#f5b8dc',
  Food: '#fde68a',
  Resources: '#cbd5e1',
  Storage: '#e7d8c4',
  Defenses: '#9ca3af',
  'Roads & Fences': '#b8b1a8',
};

export interface Ghost {
  typeId: string;
  rect: Rect;
  preview: Placed;
  valid: boolean;
}

/** Flatten mode: the areas already flattened and the one being dragged out. */
export interface FlattenScene {
  areas: Rect[];
  drag: Rect | null;
  valid: boolean;
}

export interface Scene {
  size: number;
  buildings: Placed[];
  houses: Map<number, HouseInfo>;
  selectedId: number | null;
  ghost: Ghost | null;
  view: View;
  showGrid: boolean;
  map: MapData | null;
  overlays: Set<string>;
  flatten: FlattenScene | null;
}

function makeCanvas(size: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  return c;
}

/** Paint a size×size image pixel by pixel. */
function paint(size: number, pixel: (i: number) => [number, number, number, number]): HTMLCanvasElement {
  const c = makeCanvas(size);
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const [r, g, b, a] = pixel(i);
    img.data[i * 4] = r;
    img.data[i * 4 + 1] = g;
    img.data[i * 4 + 2] = b;
    img.data[i * 4 + 3] = a;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private heat: HTMLCanvasElement = makeCanvas(1);
  private terrain: HTMLCanvasElement | null = null;
  private layers = new Map<LayerView, HTMLCanvasElement>();
  private map: MapData | null = null;
  width = 0;
  height = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    private cam: Camera,
  ) {
    this.ctx = canvas.getContext('2d')!;
  }

  resize(w: number, h: number) {
    const dpr = window.devicePixelRatio || 1;
    this.width = w;
    this.height = h;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /** Desirability image; over a map it's translucent so terrain shows through neutral tiles. */
  setField(field: Float32Array, size: number) {
    const overTerrain = !!this.map;
    this.heat = paint(size, (i) => {
      const v = field[i];
      const [r, g, b] = desirabilityColor(v);
      if (!overTerrain) return [r, g, b, 255];
      const a = v === 0 ? 0 : Math.round(Math.min(1, Math.abs(v) / 0.25) * 0.85 * 255);
      return [r, g, b, a];
    });
  }

  setMap(map: MapData | null) {
    this.map = map;
    this.layers.clear();
    this.setGround(map);
  }

  /** Repaint the terrain image, e.g. after flattening changes the slopes and shading. */
  setGround(ground: { terrain: Uint8Array; shade: Uint8Array } | null) {
    const size = this.map?.size;
    this.terrain =
      ground && size
        ? paint(size, (i) => {
            const base = TERRAIN_BASE[ground.terrain[i]];
            const k = ground.terrain[i] === Terrain.Water ? 1 : 0.72 + (ground.shade[i] / 255) * 0.56;
            return [Math.min(255, base[0] * k), Math.min(255, base[1] * k), Math.min(255, base[2] * k), 255];
          })
        : null;
  }

  private layer(view: LayerView): HTMLCanvasElement | null {
    const map = this.map;
    if (!map) return null;
    let c = this.layers.get(view);
    if (!c) {
      c = paint(map.size, (i) => {
        if (map.terrain[i] === Terrain.Water) return [0, 0, 0, 0];
        const [r, g, b] = layerColor(view, map[view][i] / 255);
        return [r, g, b, 215];
      });
      this.layers.set(view, c);
    }
    return c;
  }

  draw(scene: Scene) {
    const { ctx, cam } = this;
    const s = cam.scale;
    ctx.clearRect(0, 0, this.width, this.height);

    const o = cam.toScreen(0, 0);
    const size = scene.size * s;
    ctx.imageSmoothingEnabled = false;
    if (this.terrain) ctx.drawImage(this.terrain, o.x, o.y, size, size);
    else {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(o.x, o.y, size, size);
    }
    const layer = scene.view === 'desirability' ? this.heat : this.layer(scene.view);
    if (layer) ctx.drawImage(layer, o.x, o.y, size, size);

    this.drawGrid(scene.size, scene.showGrid, !!this.map);
    if (this.map) this.drawOverlays(this.map, scene);

    // Zones (fields, pastures, graveyards) first, so buildings standing on them draw on top.
    for (const b of scene.buildings) if (getType(b.typeId).zone) this.drawBuilding(b, undefined, b.id === scene.selectedId);
    for (const b of scene.buildings) if (!getType(b.typeId).zone) this.drawBuilding(b, scene.houses.get(b.id), b.id === scene.selectedId);

    const sel = scene.selectedId != null ? scene.buildings.find((b) => b.id === scene.selectedId) : undefined;
    if (sel) this.drawRadius(sel);

    if (scene.flatten) this.drawFlatten(scene.flatten);

    if (scene.ghost) {
      const g = scene.ghost;
      const r = this.rectToScreen(g.rect);
      ctx.fillStyle = g.valid ? 'rgba(59,130,246,0.35)' : 'rgba(220,38,38,0.35)';
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = g.valid ? '#1d4ed8' : '#b91c1c';
      ctx.lineWidth = 2;
      ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
      this.drawRadius(g.preview);
    }
  }

  private drawGrid(n: number, showGrid: boolean, onMap: boolean) {
    const { ctx, cam } = this;
    const s = cam.scale;
    const o = cam.toScreen(0, 0);
    const size = n * s;
    const lines = (step: number) => {
      ctx.beginPath();
      for (let i = 0; i <= n; i += step) {
        const p = Math.round(o.x + i * s) + 0.5;
        ctx.moveTo(p, o.y);
        ctx.lineTo(p, o.y + size);
        const q = Math.round(o.y + i * s) + 0.5;
        ctx.moveTo(o.x, q);
        ctx.lineTo(o.x + size, q);
      }
      ctx.stroke();
    };
    ctx.lineWidth = 1;
    if (showGrid && s >= 5) {
      ctx.strokeStyle = s >= 12 ? 'rgba(0,0,0,0.12)' : 'rgba(0,0,0,0.07)';
      lines(1);
    }
    // 10-tile major lines help count distances.
    if (showGrid || !onMap) {
      ctx.strokeStyle = onMap ? 'rgba(0,0,0,0.12)' : 'rgba(0,0,0,0.18)';
      lines(10);
    }
    ctx.strokeStyle = '#44403c';
    ctx.lineWidth = 2;
    ctx.strokeRect(o.x, o.y, size, size);
  }

  private drawOverlays(map: MapData, scene: Scene) {
    const { ctx, cam } = this;
    const s = cam.scale;
    const vis = scene.overlays;
    const view = { x0: cam.toTile(0, 0).x - 4, y0: cam.toTile(0, 0).y - 4 };
    const far = cam.toTile(this.width, this.height);
    const onScreen = (x: number, y: number, r: number) =>
      x + r >= view.x0 && y + r >= view.y0 && x - r <= far.x + 4 && y - r <= far.y + 4;

    // Spawn areas: translucent squares under everything else. Dens are drawn with the enemies below.
    for (const a of map.spawns) {
      const key = `spawn:${a.kind}`;
      if (a.den || !vis.has(key) || !onScreen(a.x + a.size / 2, a.y + a.size / 2, a.size)) continue;
      const p = cam.toScreen(a.x, a.y);
      const col = OVERLAY_COLOR[key];
      ctx.fillStyle = col + '2e';
      ctx.fillRect(p.x, p.y, a.size * s, a.size * s);
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(p.x + 0.75, p.y + 0.75, a.size * s - 1.5, a.size * s - 1.5);
      ctx.setLineDash([]);
      if (a.size * s > 60) {
        ctx.font = '600 11px system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillStyle = col;
        ctx.fillText(`${a.kind[0].toUpperCase()}${a.kind.slice(1)} spawn`, p.x + 4, p.y + 3);
      }
    }

    if (scene.view === 'fertility')
      for (const f of map.fertilityBonus) {
        if (!onScreen(f.x, f.y, f.r)) continue;
        const p = cam.toScreen(f.x, f.y);
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(2, f.r * s), 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(173,255,47,0.35)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(77,124,15,0.8)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }

    // Minerals: circles at the deposit's real radius, labeled with the amount when there's room.
    for (const m of map.minerals) {
      const key = `mineral:${m.kind}`;
      if (!vis.has(key) || !onScreen(m.x, m.y, m.r)) continue;
      const p = cam.toScreen(m.x, m.y);
      const r = Math.max(4, m.r * s);
      const col = OVERLAY_COLOR[key];
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fillStyle = col + '66';
      ctx.fill();
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      ctx.stroke();
      if (r >= 14) {
        const label = m.deep ? '∞' : formatAmount(m.amount);
        ctx.font = `700 ${Math.min(14, r * 0.55)}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.strokeText(label, p.x, p.y);
        ctx.fillStyle = '#1c1917';
        ctx.fillText(label, p.x, p.y);
      }
    }

    // Forageables: small dots.
    const dot = Math.max(2, Math.min(6, s * 0.35));
    for (const f of map.forageables) {
      const key = `forage:${f.kind}`;
      if (!vis.has(key) || !onScreen(f.x, f.y, 1)) continue;
      const p = cam.toScreen(f.x, f.y);
      ctx.beginPath();
      ctx.arc(p.x, p.y, dot, 0, Math.PI * 2);
      ctx.fillStyle = OVERLAY_COLOR[key];
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Enemies: dark-red diamonds (dens and camps larger), with an X.
    for (const e of map.enemies) {
      const key = `enemy:${e.kind}`;
      if (!vis.has(key) || !onScreen(e.x, e.y, 2)) continue;
      const p = cam.toScreen(e.x, e.y);
      const big = e.kind === 'wolfDen' || e.kind === 'raiderCamp';
      const r = Math.max(big ? 6 : 4, (big ? 1.4 : 0.8) * s);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - r);
      ctx.lineTo(p.x + r, p.y);
      ctx.lineTo(p.x, p.y + r);
      ctx.lineTo(p.x - r, p.y);
      ctx.closePath();
      ctx.fillStyle = OVERLAY_COLOR[key];
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.beginPath();
      const k = r * 0.35;
      ctx.moveTo(p.x - k, p.y - k);
      ctx.lineTo(p.x + k, p.y + k);
      ctx.moveTo(p.x + k, p.y - k);
      ctx.lineTo(p.x - k, p.y + k);
      ctx.stroke();
    }

    // Spawn dens (boars): diamonds in the animal's color.
    for (const a of map.spawns) {
      const key = `spawn:${a.kind}`;
      if (!a.den || !vis.has(key)) continue;
      const cx = a.x + a.size / 2;
      const cy = a.y + a.size / 2;
      if (!onScreen(cx, cy, 2)) continue;
      const p = cam.toScreen(cx, cy);
      const r = Math.max(6, 1.4 * s);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - r);
      ctx.lineTo(p.x + r, p.y);
      ctx.lineTo(p.x, p.y + r);
      ctx.lineTo(p.x - r, p.y);
      ctx.closePath();
      ctx.fillStyle = OVERLAY_COLOR[key];
      ctx.fill();
      ctx.strokeStyle = '#3f2d00';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // Ruins: gold squares.
    for (const r of map.ruins) {
      const key = `ruin:${r.kind}`;
      if (!vis.has(key) || !onScreen(r.x, r.y, 2)) continue;
      const p = cam.toScreen(r.x, r.y);
      const h = Math.max(5, 1.5 * s);
      ctx.fillStyle = OVERLAY_COLOR[key];
      ctx.fillRect(p.x - h, p.y - h, h * 2, h * 2);
      ctx.strokeStyle = '#5b4a0f';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(p.x - h, p.y - h, h * 2, h * 2);
    }
  }

  private drawFlatten(f: FlattenScene) {
    const { ctx } = this;
    ctx.save();
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#7c2d12';
    ctx.fillStyle = 'rgba(194,120,62,0.12)';
    for (const a of f.areas) {
      const r = this.rectToScreen(a);
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeRect(r.x + 0.75, r.y + 0.75, r.w - 1.5, r.h - 1.5);
    }
    ctx.restore();
    if (f.drag) {
      const r = this.rectToScreen(f.drag);
      ctx.fillStyle = f.valid ? 'rgba(194,120,62,0.35)' : 'rgba(220,38,38,0.35)';
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = f.valid ? '#9a3412' : '#b91c1c';
      ctx.lineWidth = 2;
      ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
    }
  }

  private rectToScreen(r: Rect) {
    const p = this.cam.toScreen(r.x, r.y);
    return { x: p.x, y: p.y, w: r.w * this.cam.scale, h: r.h * this.cam.scale };
  }

  private drawBuilding(b: Placed, house: HouseInfo | undefined, selected: boolean) {
    const { ctx } = this;
    const type = getType(b.typeId);
    const r = this.rectToScreen(footprint(b));
    if (r.x > this.width || r.y > this.height || r.x + r.w < 0 || r.y + r.h < 0) return;

    const fill = house ? house.level.color : CATEGORY_COLORS[type.category];
    ctx.fillStyle = fill;
    if (type.zone) {
      ctx.globalAlpha = 0.55;
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.globalAlpha = 1;
    } else ctx.fillRect(r.x, r.y, r.w, r.h);

    // Houses get a thicker border per level so tiers stay distinguishable at a glance.
    const d = type.desirability;
    if (house) {
      const lw = Math.min(1 + house.level.level * 0.8, r.w / 6);
      ctx.strokeStyle = house.level.level === 5 ? '#facc15' : 'rgba(0,0,0,0.55)';
      ctx.lineWidth = lw;
      ctx.strokeRect(r.x + lw / 2, r.y + lw / 2, r.w - lw, r.h - lw);
    } else {
      ctx.strokeStyle = d ? (d.value > 0 ? '#15803d' : '#b91c1c') : 'rgba(0,0,0,0.45)';
      ctx.lineWidth = d ? 2 : 1;
      ctx.strokeRect(r.x + ctx.lineWidth / 2, r.y + ctx.lineWidth / 2, r.w - ctx.lineWidth, r.h - ctx.lineWidth);
    }

    if (selected) {
      ctx.strokeStyle = '#0ea5e9';
      ctx.lineWidth = 3;
      ctx.setLineDash([]);
      ctx.strokeRect(r.x - 2, r.y - 2, r.w + 4, r.h + 4);
    }

    const s = this.cam.scale;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (house) {
      const fs = Math.max(8, Math.min(r.w * 0.34, 22));
      ctx.fillStyle = '#ffffff';
      ctx.font = `700 ${fs}px system-ui, sans-serif`;
      if (s >= 14) {
        ctx.fillText(house.level.name, r.x + r.w / 2, r.y + r.h / 2 - fs * 0.55, r.w - 6);
        ctx.font = `500 ${fs * 0.8}px system-ui, sans-serif`;
        ctx.fillText(`${Math.round(house.pct)}%`, r.x + r.w / 2, r.y + r.h / 2 + fs * 0.6, r.w - 6);
      } else if (s >= 4) {
        ctx.fillText(String(house.level.level), r.x + r.w / 2, r.y + r.h / 2);
      }
      return;
    }

    const mid = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
    if (r.w >= 44 && r.h >= 18) {
      const fs = Math.max(9, Math.min(13, s * 0.55));
      ctx.font = `600 ${fs}px system-ui, sans-serif`;
      ctx.fillStyle = '#1c1917';
      ctx.fillText(type.name, mid.x, mid.y, r.w - 6);
    }
    if (d && Math.min(r.w, r.h) >= 10) {
      const fs = Math.max(9, Math.min(14, s * 0.6));
      ctx.font = `800 ${fs}px system-ui, sans-serif`;
      ctx.fillStyle = d.value > 0 ? '#15803d' : '#b91c1c';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(d.value > 0 ? '+' : '−', r.x + 3, r.y + 1);
    }
  }

  private drawRadius(b: Placed) {
    const d = getType(b.typeId).desirability;
    if (!d) return;
    const { ctx, cam } = this;
    const { cx, cy } = center(b);
    const c = cam.toScreen(cx, cy);
    const rad = (d.rangeM / TILE_M) * cam.scale;
    const pos = d.value > 0;

    ctx.beginPath();
    ctx.arc(c.x, c.y, rad, 0, Math.PI * 2);
    ctx.fillStyle = pos ? 'rgba(22,163,74,0.08)' : 'rgba(220,38,38,0.08)';
    ctx.fill();
    ctx.setLineDash([8, 6]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = pos ? '#15803d' : '#b91c1c';
    ctx.stroke();
    ctx.setLineDash([]);

    const label = `${d.rangeM} m · ${d.constant ? 'full' : 'half'} effect at edge`;
    ctx.font = '600 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    const w = ctx.measureText(label).width + 10;
    const ly = c.y - rad - 4;
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillRect(c.x - w / 2, ly - 16, w, 16);
    ctx.fillStyle = pos ? '#14532d' : '#7f1d1d';
    ctx.fillText(label, c.x, ly - 2);
  }
}
