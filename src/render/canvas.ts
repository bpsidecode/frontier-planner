import { getType, type Category } from '../data/buildings';
import { GRID, TILE_M, center, footprint, type Placed, type Rect } from '../model/plan';
import type { HouseInfo } from '../model/houses';
import type { Camera } from './camera';

type RGB = [number, number, number];

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

export interface Scene {
  buildings: Placed[];
  houses: Map<number, HouseInfo>;
  selectedId: number | null;
  ghost: Ghost | null;
  showHeatmap: boolean;
  showGrid: boolean;
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private heat: HTMLCanvasElement;
  width = 0;
  height = 0;

  constructor(private canvas: HTMLCanvasElement, private cam: Camera) {
    this.ctx = canvas.getContext('2d')!;
    this.heat = document.createElement('canvas');
    this.heat.width = GRID;
    this.heat.height = GRID;
  }

  resize(w: number, h: number) {
    const dpr = window.devicePixelRatio || 1;
    this.width = w;
    this.height = h;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  setField(field: Float32Array) {
    const hctx = this.heat.getContext('2d')!;
    const img = hctx.createImageData(GRID, GRID);
    for (let i = 0; i < field.length; i++) {
      const [r, g, b] = desirabilityColor(field[i]);
      img.data[i * 4] = r;
      img.data[i * 4 + 1] = g;
      img.data[i * 4 + 2] = b;
      img.data[i * 4 + 3] = 255;
    }
    hctx.putImageData(img, 0, 0);
  }

  draw(scene: Scene) {
    const { ctx, cam } = this;
    const s = cam.scale;
    ctx.clearRect(0, 0, this.width, this.height);

    // Board
    const o = cam.toScreen(0, 0);
    const size = GRID * s;
    if (scene.showHeatmap) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this.heat, o.x, o.y, size, size);
    } else {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(o.x, o.y, size, size);
    }

    if (scene.showGrid && s >= 5) {
      ctx.strokeStyle = s >= 12 ? 'rgba(0,0,0,0.12)' : 'rgba(0,0,0,0.07)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i <= GRID; i++) {
        const p = Math.round(o.x + i * s) + 0.5;
        ctx.moveTo(p, o.y);
        ctx.lineTo(p, o.y + size);
        const q = Math.round(o.y + i * s) + 0.5;
        ctx.moveTo(o.x, q);
        ctx.lineTo(o.x + size, q);
      }
      ctx.stroke();
    }
    // 10-tile major lines help count distances.
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= GRID; i += 10) {
      const p = Math.round(o.x + i * s) + 0.5;
      ctx.moveTo(p, o.y);
      ctx.lineTo(p, o.y + size);
      const q = Math.round(o.y + i * s) + 0.5;
      ctx.moveTo(o.x, q);
      ctx.lineTo(o.x + size, q);
    }
    ctx.stroke();
    ctx.strokeStyle = '#44403c';
    ctx.lineWidth = 2;
    ctx.strokeRect(o.x, o.y, size, size);

    for (const b of scene.buildings) this.drawBuilding(b, scene.houses.get(b.id), b.id === scene.selectedId);

    const sel = scene.selectedId != null ? scene.buildings.find((b) => b.id === scene.selectedId) : undefined;
    if (sel) this.drawRadius(sel);

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
    ctx.fillRect(r.x, r.y, r.w, r.h);

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
