// Line fields. A hatch family is a set of iso-parametric curves on a patch: the
// engraver's lines run across or along a form, never across the picture. Each
// sample carries a width taken from the tone at that point, so a line swells in
// the light, thins in the shade and breaks into flicks and dots at the dark end
// (white-line logic: the gold is the cut, so more gold means more light).

import { clamp, type Curve, type Pt, smoothstep } from './geom';
import { valueNoise } from './noise';

/** Flat [x, y, w, x, y, w, ...] polyline with a width per point. */
export type Stroke = number[];
/** Flat [x, y, r, ...] dots. */
export type Dots = number[];

export type Patch = (u: number, v: number) => Pt;
export type ToneFn = (x: number, y: number, u: number, v: number) => number;
export type Coverage = (tone: number) => number;

/** Coverage curves: the share of the local line pitch a line may fill. */
export const COVER = {
  /** First family: carries the tone from the dark end to the upper mids. */
  primary: (t: number) => 0.66 * Math.pow(clamp(t / 0.78), 1.08),
  /** Crossing family: only enters in the lights and builds them up. */
  cross: (t: number) => 0.52 * smoothstep(0.58, 1.0, t),
  /** Single-family regions (feathers, wire): needs the whole range alone. */
  single: (t: number) => 0.8 * Math.pow(clamp(t), 1.15),
  /** Hairline: fine detail lines with limited swell. */
  hair: (t: number) => 0.34 * Math.pow(clamp(t), 0.8),
} satisfies Record<string, Coverage>;

export interface FamilyOpts {
  /** Line pitch in plate units. */
  pitch: number;
  /** Which parameter stays constant along a line. 'v' = lines run along u. */
  constant: 'u' | 'v';
  tone: ToneFn;
  cover?: Coverage;
  /** Parameter range of the constant coordinate (default 0..1). */
  range?: [number, number];
  /** Parameter range sampled along each line (default 0..1). */
  span?: [number, number];
  /** Offset of the first line, in pitches (0..1), to stagger crossing families. */
  phase?: number;
  /** Burin entry/exit taper, in pitches. */
  taper?: number;
  /** Hand tremor amplitude, in pitches. */
  tremor?: number;
  /** Tone below which a line dissolves into dots. */
  dotBelow?: number;
  /** Lines broken into short feather flicks: flick length in pitches (0 = continuous). */
  flick?: number;
  /** Width swells once per feather length (in pitches), staggered line to line. */
  scallop?: number;
  seed?: number;
}

export interface Family {
  strokes: Stroke[];
  dots: Dots;
}

const EPS = 1e-3;

/** Estimated on-screen length of a parameter line, used to pick a sample count. */
function lineLength(P: Patch, constant: 'u' | 'v', c: number, a: number, b: number): number {
  let L = 0;
  let prev = constant === 'v' ? P(a, c) : P(c, a);
  for (let k = 1; k <= 16; k++) {
    const s = a + ((b - a) * k) / 16;
    const p = constant === 'v' ? P(s, c) : P(c, s);
    L += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
    prev = p;
  }
  return L;
}

/** Distance between neighbouring lines, measured at the middle of the patch. */
function patchBreadth(P: Patch, constant: 'u' | 'v', r0: number, r1: number, s0: number, s1: number): number {
  let best = 0;
  for (let k = 0; k <= 8; k++) {
    const s = s0 + ((s1 - s0) * k) / 8;
    const L = lineLength(P, constant === 'v' ? 'u' : 'v', s, r0, r1);
    if (L > best) best = L;
  }
  return best;
}

export function family(P: Patch, o: FamilyOpts): Family {
  const [r0, r1] = o.range ?? [0, 1];
  const [s0, s1] = o.span ?? [0, 1];
  const cover = o.cover ?? COVER.primary;
  const taper = (o.taper ?? 1.6) * o.pitch;
  const tremor = (o.tremor ?? 0.06) * o.pitch;
  const dotBelow = o.dotBelow ?? 0.14;
  const seed = o.seed ?? 7;
  const breadth = patchBreadth(P, o.constant, r0, r1, s0, s1);
  const count = Math.max(1, Math.round(breadth / o.pitch));
  const dc = (r1 - r0) / count;
  const strokes: Stroke[] = [];
  const dots: Dots = [];
  const at = (c: number, s: number) => (o.constant === 'v' ? P(s, c) : P(c, s));

  for (let k = 0; k < count; k++) {
    const c = r0 + dc * (k + (o.phase ?? 0.5));
    const L = lineLength(P, o.constant, c, s0, s1);
    const n = Math.max(4, Math.ceil(L / (o.pitch * 0.45)));
    let run: Stroke = [];
    let runLen = 0;
    const flickLen = (o.flick ?? 0) * o.pitch;
    // stagger the flick breaks between neighbouring lines (brick bond)
    let flickPos = flickLen ? ((k * 0.618) % 1) * flickLen : 0;
    let prevX = NaN, prevY = NaN;
    let dotAcc = ((k * 0.37) % 1) * o.pitch * 1.7;
    let arcPos = 0;
    const flush = () => {
      if (run.length >= 6) strokes.push(taperEnds(run, taper));
      run = [];
      runLen = 0;
    };
    for (let j = 0; j <= n; j++) {
      const s = s0 + ((s1 - s0) * j) / n;
      const p = at(c, s);
      // local pitch: distance to the neighbouring line through the same sample
      const q = at(Math.min(r1, c + dc * 0.5), s), q2 = at(Math.max(r0, c - dc * 0.5), s);
      const local = Math.max(EPS, Math.hypot(q[0] - q2[0], q[1] - q2[1]));
      let x = p[0], y = p[1];
      if (tremor) {
        // a hand-cut line wanders a little across its own direction
        const w1 = valueNoise(x * 0.05 + k * 3.1, y * 0.05, seed) - 0.5;
        const dx = Number.isNaN(prevX) ? 0 : x - prevX, dy = Number.isNaN(prevY) ? 0 : y - prevY;
        const dl = Math.hypot(dx, dy) || 1;
        x += (-dy / dl) * w1 * tremor * 2;
        y += (dx / dl) * w1 * tremor * 2;
      }
      const step = Number.isNaN(prevX) ? 0 : Math.hypot(x - prevX, y - prevY);
      prevX = x; prevY = y;
      const t = clamp(o.tone(x, y, o.constant === 'v' ? s : c, o.constant === 'v' ? c : s));
      const cov = cover(t);
      let w = cov * Math.min(local, o.pitch * 1.25);
      if (o.scallop) {
        arcPos += step;
        const ph = (arcPos / (o.scallop * o.pitch) + k * 0.5) * Math.PI * 2;
        w *= 0.62 + 0.38 * (0.5 + 0.5 * Math.cos(ph));
      }

      if (t < dotBelow) {
        flush();
        // dark end: the line survives only as dots on a staggered beat
        dotAcc += step;
        const beat = o.pitch * 1.7;
        if (t > 0.025 && dotAcc >= beat) {
          dotAcc -= beat;
          const r = Math.sqrt((cov * o.pitch * beat) / Math.PI) * 0.9;
          if (r > 0.12) dots.push(x, y, r);
        }
        continue;
      }
      if (flickLen) {
        flickPos += step;
        if (flickPos > flickLen) {
          flickPos -= flickLen * (1.15 + 0.2 * Math.sin(k * 12.9 + j));
          flush();
          continue; // the gap between two flicks
        }
      }
      run.push(x, y, w);
      runLen += step;
    }
    flush();
  }
  return { strokes, dots };
}

/** Burin entry and exit: the line starts and ends on a point. */
export function taperEnds(s: Stroke, len: number): Stroke {
  const n = s.length / 3;
  if (n < 2 || len <= 0) return s;
  const cum = new Float32Array(n);
  for (let k = 1; k < n; k++) {
    cum[k] = cum[k - 1]! + Math.hypot(s[k * 3]! - s[k * 3 - 3]!, s[k * 3 + 1]! - s[k * 3 - 2]!);
  }
  const total = cum[n - 1]!;
  const L = Math.min(len, total * 0.42);
  const out = s.slice();
  for (let k = 0; k < n; k++) {
    const a = cum[k]!, b = total - cum[k]!;
    const f = Math.min(smoothstep(0, L, a), smoothstep(0, L, b));
    out[k * 3 + 2] = out[k * 3 + 2]! * (0.08 + 0.92 * f);
  }
  return out;
}

/** Two rails become a patch: v=0 on A, v=1 on B, u runs along both. */
export function railPatch(A: Curve, B: Curve, bulge = 0): Patch {
  return (u, v) => {
    const a = A.at(u), b = B.at(u);
    let x = a[0] + (b[0] - a[0]) * v, y = a[1] + (b[1] - a[1]) * v;
    if (bulge) {
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const l = Math.hypot(dx, dy) || 1;
      const k = bulge * Math.sin(Math.PI * v) * l;
      x += (dy / l) * k;
      y += (-dx / l) * k;
    }
    return [x, y];
  };
}

/**
 * A turned surface seen slightly from above. u is the angle across the front
 * half (0 = left limb, 1 = right limb), v runs down the profile from y0 to y1.
 */
export function revolutionPatch(cx: number, y0: number, y1: number, radius: (y: number) => number, tilt: number): Patch {
  return (u, v) => {
    const th = (u - 0.5) * Math.PI;
    const y = y0 + (y1 - y0) * v;
    const r = radius(y);
    return [cx + r * Math.sin(th), y + tilt * r * Math.cos(th)];
  };
}

/** Lines along a closed outline (a contour cut), width given per point. */
export function contourStroke(poly: Pt[], width: (x: number, y: number, i: number) => number, closed = true): Stroke {
  const s: Stroke = [];
  const pts = closed ? [...poly, poly[0]!] : poly;
  pts.forEach(([x, y], i) => s.push(x, y, width(x, y, i)));
  return s;
}
