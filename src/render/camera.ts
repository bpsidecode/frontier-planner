import { DEFAULT_SIZE, clamp } from '../model/plan';

/** Maps tile coordinates to CSS pixels: screen = tile * scale + offset. */
export class Camera {
  scale = 8;
  ox = 0;
  oy = 0;
  minScale = 3;
  readonly maxScale = 96;

  toTile(sx: number, sy: number): { x: number; y: number } {
    return { x: (sx - this.ox) / this.scale, y: (sy - this.oy) / this.scale };
  }

  toScreen(tx: number, ty: number): { x: number; y: number } {
    return { x: tx * this.scale + this.ox, y: ty * this.scale + this.oy };
  }

  zoomAt(sx: number, sy: number, factor: number) {
    const t = this.toTile(sx, sy);
    this.scale = clamp(this.scale * factor, this.minScale, this.maxScale);
    this.ox = sx - t.x * this.scale;
    this.oy = sy - t.y * this.scale;
  }

  pan(dx: number, dy: number) {
    this.ox += dx;
    this.oy += dy;
  }

  /** Fit a size×size grid in the view; zooming out stops at half the fitted scale. */
  fit(viewW: number, viewH: number, size = DEFAULT_SIZE, margin = 24) {
    const fitted = Math.max(0.2, Math.min((viewW - margin * 2) / size, (viewH - margin * 2) / size));
    this.minScale = Math.min(3, fitted / 2);
    this.scale = clamp(fitted, this.minScale, this.maxScale);
    this.ox = (viewW - size * this.scale) / 2;
    this.oy = (viewH - size * this.scale) / 2;
  }
}
