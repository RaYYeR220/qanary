// The engraver's kit: lighting, turned metal, feathers, stipple and the op list
// a plate is built from. Shared by Plate XII and the small figures.

import { clamp, Curve, ellipse, polygonPath, readPath, smoothstep, type Pt } from './geom';
import { COVER, family, railPatch, revolutionPatch, type Coverage, type Dots, type Family, type Stroke, type ToneFn } from './hatch';
import { hash2 } from './noise';
import { dot3, norm3, type Vec3 } from './pillow';
import type { Op } from './render';

/** Light from the upper right, a little toward the viewer. */
export const LIGHT: Vec3 = norm3([0.5, -0.64, 0.58]);
const VIEW: Vec3 = norm3([0, -0.16, 1]);
const HALF: Vec3 = norm3([LIGHT[0] + VIEW[0], LIGHT[1] + VIEW[1], LIGHT[2] + VIEW[2]]);

export const lambert = (n: Vec3) => Math.max(0, dot3(n, LIGHT));
export const specular = (n: Vec3, shine: number) => Math.pow(Math.max(0, dot3(n, HALF)), shine);

export class Sheet {
  readonly ops: Op[] = [];
  erase(poly: Pt[] | Path2D, halo = 0): this {
    this.ops.push({ k: 'erase', path: poly instanceof Path2D ? poly : polygonPath(poly), ...(halo ? { halo } : {}) });
    return this;
  }
  ink(f: Family | Family[], clip?: Pt[] | Path2D, hardy = false): this {
    const fs = Array.isArray(f) ? f : [f];
    const strokes: Stroke[] = [], dots: Dots = [];
    for (const x of fs) { strokes.push(...x.strokes); dots.push(...x.dots); }
    this.ops.push({
      k: 'ink', strokes, dots, hardy,
      ...(clip ? { clip: clip instanceof Path2D ? clip : polygonPath(clip) } : {}),
    });
    return this;
  }
  cut(strokes: Stroke[], clip?: Pt[] | Path2D): this {
    this.ops.push({ k: 'ink', strokes, cut: true, ...(clip ? { clip: clip instanceof Path2D ? clip : polygonPath(clip) } : {}) });
    return this;
  }
  /** A single engraved line (outline, bead, rachis) with a width function. */
  line(pts: Pt[], width: (x: number, y: number, f: number) => number, clip?: Pt[] | Path2D, cut = false): this {
    const s: Stroke = [];
    pts.forEach(([x, y], i) => s.push(x, y, width(x, y, i / Math.max(1, pts.length - 1))));
    if (cut) return this.cut([s], clip);
    this.ops.push({ k: 'ink', strokes: [s], hardy: true, ...(clip ? { clip: clip instanceof Path2D ? clip : polygonPath(clip) } : {}) });
    return this;
  }
  dots(d: Dots, clip?: Pt[] | Path2D): this {
    this.ops.push({ k: 'ink', dots: d, ...(clip ? { clip: clip instanceof Path2D ? clip : polygonPath(clip) } : {}) });
    return this;
  }
}

/** Points of an SVG path, mapped. */
export function shape(d: string, map: (p: Pt) => Pt = (p) => p, step = 2): Pt[] {
  return readPath(d, step).flat().map(map);
}
export function rail(d: string, map: (p: Pt) => Pt = (p) => p): Curve {
  return new Curve(readPath(d, 1.5).flat().map(map));
}

// ---------- turned metal ----------

export interface Turned {
  cx: number;
  y0: number;
  y1: number;
  r: (y: number) => number;
  tilt: number;
  pitch: number;
  /** Surface tone from the normal and the angle across the front (radians). */
  tone?: (n: Vec3, th: number, y: number) => number;
  /** Draw the top face (seen from above) as concentric turned rings. */
  topFace?: boolean;
  topTone?: number;
  grooves?: number[];
  beads?: number[];
  meridians?: boolean;
  parallels?: boolean;
  halo?: number;
}

export const brassTone = (n: Vec3, th: number) =>
  clamp(0.1 + 0.48 * Math.pow(lambert(n), 1.2) + 0.9 * specular(n, 30) + 0.16 * smoothstep(0.82, 1.0, -Math.sin(th)));

/** Silhouette of a turned part: back of the top ellipse, profiles, front of the bottom ellipse. */
export function turnedOutline(t: Turned): Pt[] {
  const out: Pt[] = [];
  const N = 48;
  const r0 = t.r(t.y0), r1 = t.r(t.y1);
  // back half of the top ellipse, left to right, above the centre line
  for (let k = 0; k <= N; k++) {
    const a = (k / N) * Math.PI;
    out.push([t.cx - r0 * Math.cos(a), t.y0 - t.tilt * r0 * Math.sin(a)]);
  }
  for (let k = 1; k <= 24; k++) {
    const y = t.y0 + ((t.y1 - t.y0) * k) / 24;
    out.push([t.cx + t.r(y), y]);
  }
  for (let k = 0; k <= N; k++) {
    const a = (k / N) * Math.PI;
    out.push([t.cx + r1 * Math.cos(a), t.y1 + t.tilt * r1 * Math.sin(a)]);
  }
  for (let k = 23; k >= 1; k--) {
    const y = t.y0 + ((t.y1 - t.y0) * k) / 24;
    out.push([t.cx - t.r(y), y]);
  }
  return out;
}

export function turned(sheet: Sheet, t: Turned): Pt[] {
  const outline = turnedOutline(t);
  sheet.erase(outline, t.halo ?? t.pitch * 0.9);
  const P = revolutionPatch(t.cx, t.y0, t.y1, t.r, t.tilt);
  const dy = (t.y1 - t.y0) / 200;
  const toneAt: ToneFn = (_x, _y, u, v) => {
    const th = (u - 0.5) * Math.PI;
    const y = t.y0 + (t.y1 - t.y0) * v;
    const rp = (t.r(y + dy) - t.r(y - dy)) / (2 * dy);
    const n = norm3([Math.sin(th), -rp, Math.cos(th)]);
    return (t.tone ?? brassTone)(n, th, y);
  };
  const fams: Family[] = [];
  if (t.meridians !== false)
    fams.push(family(P, { pitch: t.pitch, constant: 'u', tone: toneAt, cover: COVER.primary, taper: 0.6, tremor: 0.03 }));
  if (t.parallels !== false && t.y1 - t.y0 > t.pitch * 2.5)
    fams.push(family(P, { pitch: t.pitch * 1.08, constant: 'v', tone: toneAt, cover: COVER.cross, taper: 1.2, tremor: 0.02, phase: 0.25 }));
  sheet.ink(fams, outline);
  // the top face, seen from above: concentric turning marks
  if (t.topFace) {
    const r0 = t.r(t.y0);
    const face = ellipse(t.cx, t.y0, r0, t.tilt * r0, 0, 96);
    sheet.erase(face, t.pitch * 0.5);
    const rings: Stroke[] = [];
    for (let rho = t.pitch * 0.9; rho < r0 - t.pitch * 0.3; rho += t.pitch) {
      const s: Stroke = [];
      const n = Math.max(24, Math.ceil((rho * 6.3) / (t.pitch * 0.5)));
      for (let k = 0; k <= n; k++) {
        const a = (k / n) * Math.PI * 2;
        const x = t.cx + rho * Math.cos(a), y = t.y0 + t.tilt * rho * Math.sin(a);
        // a turned face catches the light in two opposed sectors
        const sheen = 0.5 + 0.5 * Math.cos(a + 1.1);
        const tone = clamp((t.topTone ?? 0.55) * (0.75 + 0.35 * sheen) * (0.85 + 0.25 * (rho / r0)));
        // rings crowd where the face is foreshortened: thin them to keep the tone
        const crowd = 1 / Math.sqrt(Math.cos(a) ** 2 + (Math.sin(a) / t.tilt) ** 2);
        s.push(x, y, COVER.single(tone) * t.pitch * Math.max(0.12, crowd));
      }
      rings.push(s);
    }
    sheet.ink({ strokes: rings, dots: [] }, face);
  }
  // turned grooves are cut dark; beads catch a thin line of light
  for (const g of t.grooves ?? []) {
    const r = t.r(g);
    sheet.line(arc(t.cx, g, r, t.tilt), () => t.pitch * 0.55, outline, true);
  }
  for (const b of t.beads ?? []) {
    const r = t.r(b);
    sheet.line(arc(t.cx, b, r, t.tilt), (x) => t.pitch * (0.25 + 0.45 * smoothstep(t.cx - r, t.cx + r * 0.6, x)), outline);
  }
  return outline;
}

/** Front half of a horizontal circle seen from slightly above. */
export function arc(cx: number, y: number, r: number, tilt: number, n = 64): Pt[] {
  const out: Pt[] = [];
  for (let k = 0; k <= n; k++) {
    const a = Math.PI - (k / n) * Math.PI;
    out.push([cx + r * Math.cos(a), y + tilt * r * Math.sin(a)]);
  }
  return out;
}

// ---------- feathers ----------

export interface FeatherSpec {
  base: Pt;
  tip: Pt;
  width: number;
  /** Bow of the shaft, as a share of its length (positive bows to the left of base->tip). */
  bend?: number;
  /** Share of the width taken by the left vane. */
  asym?: number;
  /** 0 = round tip (coverts), 1 = pointed (primaries). */
  point?: number;
  /** Tone 0..1 at the tip end and how it falls toward the covered base. */
  tone: (x: number, y: number, along: number, across: number) => number;
}

export interface Feather {
  outline: Pt[];
  shaft: Curve;
  left: Curve;
  right: Curve;
}

export function featherShape(f: FeatherSpec): Feather {
  const N = 40;
  const [bx, by] = f.base, [tx, ty] = f.tip;
  const len = Math.hypot(tx - bx, ty - by);
  const nx = (ty - by) / len, ny = -(tx - bx) / len;
  const bend = (f.bend ?? 0) * len;
  const cx = (bx + tx) / 2 + nx * bend, cy = (by + ty) / 2 + ny * bend;
  const sh: Pt[] = [], L: Pt[] = [], R: Pt[] = [];
  const asym = f.asym ?? 0.5;
  const point = f.point ?? 0.3;
  for (let k = 0; k <= N; k++) {
    const s = k / N;
    const u = 1 - s;
    const x = u * u * bx + 2 * u * s * cx + s * s * tx;
    const y = u * u * by + 2 * u * s * cy + s * s * ty;
    sh.push([x, y]);
    // tangent and normal of the shaft
    const dx = 2 * u * (cx - bx) + 2 * s * (tx - cx), dy = 2 * u * (cy - by) + 2 * s * (ty - cy);
    const dl = Math.hypot(dx, dy) || 1;
    const qx = dy / dl, qy = -dx / dl;
    // half-width profile: narrow quill, full vane, then a round or pointed tip
    const rise = 0.62 + 0.38 * smoothstep(0, 0.45, s);
    const tipStart = 0.72 - point * 0.18;
    const fall = s < tipStart ? 1 : Math.pow(Math.max(0, 1 - Math.pow((s - tipStart) / (1 - tipStart), 2 - point * 0.9)), 0.5 + point * 0.4);
    const w = (f.width / 2) * rise * fall;
    L.push([x + qx * w * asym * 2, y + qy * w * asym * 2]);
    R.push([x - qx * w * (1 - asym) * 2, y - qy * w * (1 - asym) * 2]);
  }
  return { outline: [...L, ...[...R].reverse()], shaft: new Curve(sh), left: new Curve(L), right: new Curve(R) };
}

/** Engrave one feather: clear it, hatch both vanes along the shaft, edge it. */
export function feather(sheet: Sheet, f: FeatherSpec, pitch: number, opts: { halo?: number; shaft?: boolean; flick?: number; fringe?: number } = {}): Feather {
  const F = featherShape(f);
  sheet.erase(F.outline, opts.halo ?? pitch * 0.75);
  const fams: Family[] = [];
  for (const [edge, side] of [[F.left, 1], [F.right, -1]] as const) {
    const P = railPatch(F.shaft, edge);
    fams.push(
      family(P, {
        pitch: pitch * 0.92,
        constant: 'v',
        range: [0.14, 1],
        tone: (x, y, u, v) => f.tone(x, y, u, side * v),
        cover: COVER.single,
        taper: 1.4,
        tremor: 0.04,
        dotBelow: 0.1,
        ...(opts.flick ? { flick: opts.flick } : {}),
      }),
    );
  }
  sheet.ink(fams, F.outline);
  if (opts.shaft !== false) {
    const pts = F.shaft.pts.slice(4, -3);
    sheet.line(pts, (x, y, s) => pitch * 0.36 * clamp(f.tone(x, y, s, 0) + 0.15) * (1 - 0.6 * s));
  }
  // the pale fringe: a fine line round the free end of the feather
  const fr = opts.fringe ?? 0.34;
  if (fr > 0) {
    const n = F.left.pts.length;
    const from = Math.floor(n * 0.5);
    const edge = [...F.left.pts.slice(from), ...[...F.right.pts.slice(from)].reverse()];
    sheet.line(edge, (x, y, s) => pitch * fr * clamp(0.35 + f.tone(x, y, 1, 0)) * Math.sin(Math.PI * Math.min(1, 0.08 + s * 0.92)));
  }
  return F;
}

// ---------- stipple ----------

/** Jittered-grid stipple; a dot survives with probability and size by tone. */
export function stipple(poly: Pt[], tone: (x: number, y: number) => number, pitch: number, seed = 3): Dots {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of poly) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const step = pitch * 0.9;
  const d: Dots = [];
  for (let j = 0, y = y0; y <= y1; j++, y += step) {
    for (let i = 0, x = x0; x <= x1; i++, x += step) {
      const jx = x + (hash2(i, j, seed) - 0.5) * step * 0.9;
      const jy = y + (hash2(i, j, seed + 1) - 0.5) * step * 0.9;
      const t = tone(jx, jy);
      if (t <= 0.02) continue;
      if (hash2(i, j, seed + 2) > Math.min(1, t * 1.6)) continue;
      d.push(jx, jy, pitch * (0.12 + 0.2 * t));
    }
  }
  return d;
}

export const coverage = COVER as Record<keyof typeof COVER, Coverage>;
