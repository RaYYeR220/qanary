// A relief for a flat silhouette: the distance to the outline becomes a height
// (a quarter-circle profile of radius R), and its gradient becomes a surface
// normal. It lets a drawn outline - a canary's body, a wing - take light like a
// rounded form, which is what tells the hatching where to swell.

import { bbox, insidePoly, type Pt } from './geom';

export type Vec3 = readonly [number, number, number];

export const norm3 = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
export const dot3 = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export class Pillow {
  private readonly x0: number;
  private readonly y0: number;
  private readonly cell: number;
  private readonly nx: number;
  private readonly ny: number;
  private readonly h: Float32Array;
  private readonly polys: Pt[][];

  constructor(polys: Pt[][], readonly R: number, cell = 3) {
    this.polys = polys;
    let [ax, ay, bx, by] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const p of polys) {
      const [a, b, c, d] = bbox(p);
      ax = Math.min(ax, a); ay = Math.min(ay, b); bx = Math.max(bx, c); by = Math.max(by, d);
    }
    this.cell = cell;
    this.x0 = ax - cell * 2;
    this.y0 = ay - cell * 2;
    this.nx = Math.ceil((bx - ax) / cell) + 5;
    this.ny = Math.ceil((by - ay) / cell) + 5;
    const N = this.nx * this.ny;
    const inside = new Uint8Array(N);
    for (let j = 0; j < this.ny; j++) {
      for (let i = 0; i < this.nx; i++) {
        const x = this.x0 + i * cell, y = this.y0 + j * cell;
        inside[j * this.nx + i] = polys.some((p) => insidePoly(p, x, y)) ? 1 : 0;
      }
    }
    // chamfer distance transform (3-4), in cells
    const INF = 1e9;
    const d = new Float32Array(N);
    for (let k = 0; k < N; k++) d[k] = inside[k] ? INF : 0;
    const w = this.nx;
    for (let j = 1; j < this.ny - 1; j++)
      for (let i = 1; i < w - 1; i++) {
        const k = j * w + i;
        if (!inside[k]) continue;
        d[k] = Math.min(d[k]!, d[k - 1]! + 1, d[k - w]! + 1, d[k - w - 1]! + 1.414, d[k - w + 1]! + 1.414);
      }
    for (let j = this.ny - 2; j > 0; j--)
      for (let i = w - 2; i > 0; i--) {
        const k = j * w + i;
        if (!inside[k]) continue;
        d[k] = Math.min(d[k]!, d[k + 1]! + 1, d[k + w]! + 1, d[k + w + 1]! + 1.414, d[k + w - 1]! + 1.414);
      }
    const h = new Float32Array(N);
    for (let k = 0; k < N; k++) {
      if (!inside[k]) continue;
      const t = Math.min(1, (d[k]! * cell) / R);
      h[k] = R * Math.sqrt(1 - (1 - t) * (1 - t));
    }
    // two box passes take the chamfer facets out of the light
    this.h = blur(blur(h, this.nx, this.ny), this.nx, this.ny);
  }

  inside(x: number, y: number) {
    return this.polys.some((p) => insidePoly(p, x, y));
  }

  height(x: number, y: number): number {
    const fx = (x - this.x0) / this.cell, fy = (y - this.y0) / this.cell;
    const i = Math.floor(fx), j = Math.floor(fy);
    if (i < 0 || j < 0 || i >= this.nx - 1 || j >= this.ny - 1) return 0;
    const tx = fx - i, ty = fy - j, w = this.nx, k = j * w + i;
    const a = this.h[k]!, b = this.h[k + 1]!, c = this.h[k + w]!, e = this.h[k + w + 1]!;
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + e) * tx * ty;
  }

  normal(x: number, y: number): Vec3 {
    const e = this.cell;
    const hx = (this.height(x + e, y) - this.height(x - e, y)) / (2 * e);
    const hy = (this.height(x, y + e) - this.height(x, y - e)) / (2 * e);
    return norm3([-hx, -hy, 1]);
  }
}

function blur(src: Float32Array, w: number, h: number): Float32Array {
  const out = new Float32Array(src.length);
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      let s = 0, n = 0;
      for (let dj = -1; dj <= 1; dj++)
        for (let di = -1; di <= 1; di++) {
          const ii = i + di, jj = j + dj;
          if (ii < 0 || jj < 0 || ii >= w || jj >= h) continue;
          s += src[jj * w + ii]!;
          n++;
        }
      out[j * w + i] = src[j * w + i] ? s / n : 0;
    }
  return out;
}
