// Plane geometry for the engraving engine: points, curves sampled by arc length,
// a small SVG path reader, and polygon helpers. All units are plate units.

export type Pt = readonly [number, number];

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const clamp = (v: number, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v);
export const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
export const mix = (a: Pt, b: Pt, t: number): Pt => [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
export const dist = (a: Pt, b: Pt) => Math.hypot(b[0] - a[0], b[1] - a[1]);

/** Cubic Bézier point. */
export function cubicAt(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return [a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]];
}

function quadAt(p0: Pt, p1: Pt, p2: Pt, t: number): Pt {
  const u = 1 - t;
  return [u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]];
}

/**
 * Reads an SVG path string (M, L, H, V, C, S, Q, T, Z; absolute and relative)
 * into flattened subpaths. Arcs are not supported; the plates do not use them.
 */
export function readPath(d: string, step = 2): Pt[][] {
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? [];
  const out: Pt[][] = [];
  let cur: Pt[] = [];
  let i = 0;
  let cmd = '';
  let x = 0, y = 0, sx = 0, sy = 0;
  let lastCtl: Pt | null = null;
  let lastQ: Pt | null = null;
  const num = () => parseFloat(tokens[i++]!);
  const isNum = () => i < tokens.length && !/[a-zA-Z]/.test(tokens[i]!);
  const push = (p: Pt) => cur.push(p);
  const flat = (f: (t: number) => Pt, approxLen: number) => {
    const n = Math.max(2, Math.ceil(approxLen / step));
    for (let k = 1; k <= n; k++) push(f(k / n));
  };
  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i]!)) cmd = tokens[i++]!;
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    if (C === 'Z') {
      if (cur.length) { push([sx, sy]); out.push(cur); cur = []; }
      x = sx; y = sy; lastCtl = lastQ = null;
      continue;
    }
    if (!isNum()) { i++; continue; }
    do {
      const ox = rel ? x : 0, oy = rel ? y : 0;
      if (C === 'M') {
        if (cur.length) out.push(cur);
        x = num() + ox; y = num() + oy; sx = x; sy = y; cur = [[x, y]];
        cmd = rel ? 'l' : 'L';
        lastCtl = lastQ = null;
      } else if (C === 'L') {
        x = num() + ox; y = num() + oy; push([x, y]); lastCtl = lastQ = null;
      } else if (C === 'H') {
        x = num() + ox; push([x, y]); lastCtl = lastQ = null;
      } else if (C === 'V') {
        y = num() + oy; push([x, y]); lastCtl = lastQ = null;
      } else if (C === 'C' || C === 'S') {
        const p0: Pt = [x, y];
        let p1: Pt;
        if (C === 'C') p1 = [num() + ox, num() + oy];
        else p1 = lastCtl ? [2 * x - lastCtl[0], 2 * y - lastCtl[1]] : [x, y];
        const p2: Pt = [num() + ox, num() + oy];
        const p3: Pt = [num() + ox, num() + oy];
        const L = dist(p0, p1) + dist(p1, p2) + dist(p2, p3);
        flat((t) => cubicAt(p0, p1, p2, p3, t), L);
        x = p3[0]; y = p3[1]; lastCtl = p2; lastQ = null;
      } else if (C === 'Q' || C === 'T') {
        const p0: Pt = [x, y];
        let p1: Pt;
        if (C === 'Q') p1 = [num() + ox, num() + oy];
        else p1 = lastQ ? [2 * x - lastQ[0], 2 * y - lastQ[1]] : [x, y];
        const p2: Pt = [num() + ox, num() + oy];
        flat((t) => quadAt(p0, p1, p2, t), dist(p0, p1) + dist(p1, p2));
        x = p2[0]; y = p2[1]; lastQ = p1; lastCtl = null;
      } else {
        i++;
      }
    } while (isNum());
  }
  if (cur.length) out.push(cur);
  return out;
}

/** A polyline re-parameterised by normalised arc length. */
export class Curve {
  readonly pts: Pt[];
  readonly cum: number[];
  readonly length: number;
  constructor(pts: Pt[]) {
    this.pts = pts.length > 1 ? pts : [pts[0] ?? [0, 0], pts[0] ?? [0, 0]];
    this.cum = [0];
    for (let k = 1; k < this.pts.length; k++) this.cum.push(this.cum[k - 1]! + dist(this.pts[k - 1]!, this.pts[k]!));
    this.length = this.cum[this.cum.length - 1]! || 1e-9;
  }
  static fromPath(d: string): Curve {
    return new Curve(readPath(d, 1.5).flat());
  }
  private seg(t: number): [number, number] {
    const target = clamp(t) * this.length;
    let lo = 0, hi = this.cum.length - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (this.cum[m]! < target) lo = m; else hi = m;
    }
    const span = this.cum[hi]! - this.cum[lo]! || 1e-9;
    return [lo, (target - this.cum[lo]!) / span];
  }
  at(t: number): Pt {
    const [k, f] = this.seg(t);
    return mix(this.pts[k]!, this.pts[k + 1] ?? this.pts[k]!, f);
  }
  tangent(t: number): Pt {
    const [k] = this.seg(t);
    const a = this.pts[k]!, b = this.pts[k + 1] ?? a;
    const l = dist(a, b) || 1;
    return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
  }
  /** Left-hand normal (screen coordinates, y down). */
  normal(t: number): Pt {
    const [tx, ty] = this.tangent(t);
    return [ty, -tx];
  }
  reversed(): Curve {
    return new Curve([...this.pts].reverse());
  }
}

export function polygonPath(poly: Pt[]): Path2D {
  const p = new Path2D();
  poly.forEach((q, k) => (k ? p.lineTo(q[0], q[1]) : p.moveTo(q[0], q[1])));
  p.closePath();
  return p;
}

export function insidePoly(poly: Pt[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!, [xj, yj] = poly[j]!;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi) inside = !inside;
  }
  return inside;
}

export function bbox(poly: Pt[]): [number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of poly) {
    if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
}

/** Ellipse outline as a polygon (rotation in radians). */
export function ellipse(cx: number, cy: number, rx: number, ry: number, rot = 0, n = 72): Pt[] {
  const c = Math.cos(rot), s = Math.sin(rot);
  const out: Pt[] = [];
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    const ex = rx * Math.cos(a), ey = ry * Math.sin(a);
    out.push([cx + ex * c - ey * s, cy + ex * s + ey * c]);
  }
  return out;
}
