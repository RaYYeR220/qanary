// Prints a list of engraving operations onto a canvas: lines are cut as
// variable-width ribbons, occluding forms clear what lies behind them, and the
// finished impression is gradient-mapped from bistre to canary by its own local
// density. Plate wear is applied at print time, so one engraving yields every
// state of the plate.

import { smoothstep } from './geom';
import type { Dots, Stroke } from './hatch';
import { fbm, rng, valueNoise } from './noise';

export type Op =
  /** Clear a region (and a halo around it) so the form in front reads cleanly. */
  | { k: 'erase'; path: Path2D; halo?: number }
  /** Cut lines in gold; `cut` cuts them out of the gold instead (a dark line). */
  | { k: 'ink'; strokes?: Stroke[]; dots?: Dots; clip?: Path2D; cut?: boolean; hardy?: boolean };

export interface PlateArt {
  width: number;
  height: number;
  /** Top-left of the plate in drawing units (the plate may crop the drawing). */
  origin?: [number, number];
  /** Engraving for a given line pitch (plate units) and plate state. */
  ops: (pitch: number, level: number) => Op[];
}

export interface PrintOptions {
  cssWidth: number;
  cssHeight: number;
  dpr: number;
  level: number;
  /** Line pitch on screen, CSS px. */
  pitchPx: number;
  /** Gradient map, sparse to dense (7 colours), and the foxing colour. */
  ink?: { ramp: string[]; foxing: string };
}

// Wear by plate state (0 = proof, 5 = worn through)
const THIN = [1, 0.95, 0.89, 0.83, 0.77, 0.71];
/** Gaps opening along single lines. */
const BREAK = [0, 0.07, 0.13, 0.19, 0.26, 0.33];
/** Regions where the plate has worn shallow and lines fade out. */
const SOFT = [0, 0.18, 0.3, 0.42, 0.54, 0.64];
/** Worn through: the plate no longer holds ink at all. */
const BLOTCH = [0, 0, 0, 0.16, 0.24, 0.3];
const FADE = [0, 0.1, 0.18, 0.26, 0.34, 0.42];
const FOX = [0, 5, 9, 14, 19, 26];

/** Where each gradient-map colour sits on the density axis. */
const STOPS = [0, 0.12, 0.3, 0.5, 0.66, 0.82, 1];
/** Fallback ink when the page's tokens are not available. */
const DEFAULT_INK = { ramp: ['#4a3a22', '#6f5c1c', '#a2851c', '#d3a70a', '#e9b300', '#ffd754', '#fff0c4'], foxing: '#703a1a' };

const hex = (h: string) => {
  const m = h.trim().replace('#', '');
  const v = m.length === 3 ? m.split('').map((c) => c + c).join('') : m;
  return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) || 0) as [number, number, number];
};

const lutCache = new Map<string, Uint8ClampedArray>();
function rampLUT(ramp: string[]): Uint8ClampedArray {
  const key = ramp.join();
  const hit = lutCache.get(key);
  if (hit) return hit;
  const lut = new Uint8ClampedArray(256 * 3);
  const stops = STOPS.map((t, i) => [t, hex(ramp[i] ?? ramp[ramp.length - 1]!)] as const);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let k = 0;
    while (k < stops.length - 2 && t > stops[k + 1]![0]) k++;
    const [t0, c0] = stops[k]!, [t1, c1] = stops[k + 1]!;
    const f = Math.max(0, Math.min(1, (t - t0) / (t1 - t0)));
    for (let c = 0; c < 3; c++) lut[i * 3 + c] = c0[c]! + (c1[c]! - c0[c]!) * f;
  }
  lutCache.set(key, lut);
  return lut;
}

function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  return c;
}

/** Foxing spots: a fixed list, so later states keep the earlier stains. */
function foxSpots(W: number, H: number): [number, number, number][] {
  const r = rng(1813);
  const out: [number, number, number][] = [];
  for (let i = 0; i < 26; i++) {
    const big = r() < 0.2;
    out.push([W * (0.04 + 0.92 * r()), H * (0.04 + 0.92 * r()), (big ? 22 : 5) + r() * (big ? 30 : 14)]);
  }
  return out;
}

export function print(target: HTMLCanvasElement, art: PlateArt, ops: Op[], o: PrintOptions): void {
  const level = Math.max(0, Math.min(5, Math.round(o.level)));
  const ink = o.ink ?? DEFAULT_INK;
  const LUT = rampLUT(ink.ramp);
  const FOXING = hex(ink.foxing);
  const W = Math.round(o.cssWidth * o.dpr), H = Math.round(o.cssHeight * o.dpr);
  const k = (o.cssWidth / art.width) * o.dpr; // device px per plate unit
  const minW = 0.42 / k; // narrower than this, a worn line no longer prints

  // 1. the cut: white ribbons on transparent
  const cov = canvas(W, H);
  const g = cov.getContext('2d')!;
  const [ox, oy] = art.origin ?? [0, 0];
  g.setTransform(k, 0, 0, k, -ox * k, -oy * k);

  const wearAt = (x: number, y: number, hardy: boolean, line = -1, along = 0): number => {
    if (!level) return 1;
    const h = hardy ? 0.5 : 1;
    let f = THIN[level]! + (1 - THIN[level]!) * (1 - h);
    const b = fbm(x / 130, y / 130, 11);
    const bl = BLOTCH[level]! * h;
    if (b < bl) return 0;
    f *= 1 - SOFT[level]! * h * smoothstep(0.62, 0.3, b);
    // a worn line breaks along its own length, not across its neighbours
    const nb = line >= 0 ? valueNoise(along / 3.2, line * 7.31, 23) : valueNoise(x / 4, y / 4, 23);
    if (nb < BREAK[level]! * h) return 0;
    return f;
  };

  for (const op of ops) {
    if (op.k === 'erase') {
      g.globalCompositeOperation = 'destination-out';
      g.fillStyle = '#000';
      g.fill(op.path);
      if (op.halo) {
        g.lineWidth = op.halo;
        g.lineJoin = 'round';
        g.strokeStyle = '#000';
        g.stroke(op.path);
      }
      g.globalCompositeOperation = 'source-over';
      continue;
    }
    g.save();
    if (op.clip) g.clip(op.clip);
    g.globalCompositeOperation = op.cut ? 'destination-out' : 'source-over';
    g.fillStyle = '#fff';
    const path = new Path2D();
    const hardy = !!op.hardy || !!op.cut;
    for (const s of op.strokes ?? []) {
      const id = Math.floor(Math.abs(s[0]! * 13.7 + s[1]! * 7.9)) % 9973;
      ribbon(path, s, op.cut ? () => 1 : (x, y, a) => wearAt(x, y, hardy, id, a), minW);
    }
    const d = op.dots ?? [];
    for (let i = 0; i < d.length; i += 3) {
      const x = d[i]!, y = d[i + 1]!;
      const r = d[i + 2]! * (op.cut ? 1 : wearAt(x, y, hardy));
      if (r * 2 < minW) continue;
      path.moveTo(x + r, y);
      path.arc(x, y, r, 0, Math.PI * 2);
    }
    g.fill(path);
    g.restore();
  }

  // 2. density field at low resolution: halve until small (a box blur for free)
  let src: HTMLCanvasElement = cov;
  while (src.width > 260) {
    const half = canvas(Math.ceil(src.width / 2), Math.ceil(src.height / 2));
    const hg = half.getContext('2d')!;
    hg.imageSmoothingEnabled = true;
    hg.imageSmoothingQuality = 'high';
    hg.drawImage(src, 0, 0, half.width, half.height);
    src = half;
  }
  const lw = src.width, lh = src.height;
  const sg = src.getContext('2d', { willReadFrequently: true })!;
  const img = sg.getImageData(0, 0, lw, lh);
  const px = img.data;
  const stain = new ImageData(lw, lh);
  const sp = stain.data;
  const spots = foxSpots(art.width, art.height)
    .slice(0, FOX[level])
    .map(([x, y, r]) => [x + ox, y + oy, r] as [number, number, number]);
  for (let j = 0; j < lh; j++) {
    for (let i = 0; i < lw; i++) {
      const q = (j * lw + i) * 4;
      const ux = ox + ((i + 0.5) / lw) * art.width, uy = oy + ((j + 0.5) / lh) * art.height;
      const dens = px[q + 3]! / 255;
      // the plate prints a little more contrast than it holds
      const t = Math.min(1, Math.pow(dens * 1.32, 0.86));
      const li = Math.round(t * 255) * 3;
      let r = LUT[li]!, gg = LUT[li + 1]!, b = LUT[li + 2]!;
      let a = 255;
      if (level) {
        a *= 1 - FADE[level]! * smoothstep(0.32, 0.72, fbm(ux / 260, uy / 260, 31));
      }
      let fox = 0;
      for (const [fx, fy, fr] of spots) {
        const dd = Math.hypot(ux - fx, uy - fy) / fr;
        if (dd > 1.6) continue;
        // a lumpy edge, a little darker at the rim and at the seed in the middle
        const edge = 1 + 0.55 * (fbm(ux / (fr * 0.35), uy / (fr * 0.35), 5) - 0.5);
        const body = smoothstep(edge, edge * 0.78, dd);
        const seed = smoothstep(0.22, 0.0, dd);
        fox = Math.max(fox, Math.min(1, body * (0.55 + 0.35 * smoothstep(edge * 0.55, edge * 0.9, dd)) + seed * 0.5));
      }
      if (fox > 0) {
        r += (FOXING[0] - r) * fox * 0.85;
        gg += (FOXING[1] - gg) * fox * 0.85;
        b += (FOXING[2] - b) * fox * 0.85;
        a *= 1 - 0.4 * fox;
        sp[q] = FOXING[0]; sp[q + 1] = FOXING[1]; sp[q + 2] = FOXING[2];
        sp[q + 3] = Math.round(fox * 52);
      }
      px[q] = r; px[q + 1] = gg; px[q + 2] = b; px[q + 3] = a;
    }
  }
  sg.putImageData(img, 0, 0);

  // 3. impression: colour field masked by the cut, over the stains
  const out = target.getContext('2d')!;
  if (target.width !== W || target.height !== H) {
    target.width = W;
    target.height = H;
  }
  out.setTransform(1, 0, 0, 1, 0, 0);
  out.clearRect(0, 0, W, H);
  out.imageSmoothingEnabled = true;
  out.imageSmoothingQuality = 'high';
  if (spots.length) {
    const st = canvas(lw, lh);
    st.getContext('2d')!.putImageData(stain, 0, 0);
    out.drawImage(st, 0, 0, W, H);
  }
  const inked = canvas(W, H);
  const ig = inked.getContext('2d')!;
  ig.imageSmoothingEnabled = true;
  ig.imageSmoothingQuality = 'high';
  ig.drawImage(src, 0, 0, W, H);
  ig.globalCompositeOperation = 'destination-in';
  ig.drawImage(cov, 0, 0);
  out.drawImage(inked, 0, 0);
}

/** Adds one stroke to a path as a filled ribbon, split wherever wear opens a gap. */
function ribbon(path: Path2D, s: Stroke, wear: (x: number, y: number, along: number) => number, minW: number) {
  const n = s.length / 3;
  let start = -1;
  const ws = new Float32Array(n);
  let along = 0;
  for (let i = 0; i < n; i++) {
    if (i) along += Math.hypot(s[i * 3]! - s[i * 3 - 3]!, s[i * 3 + 1]! - s[i * 3 - 2]!);
    const w = s[i * 3 + 2]! * wear(s[i * 3]!, s[i * 3 + 1]!, along);
    ws[i] = w >= minW ? w : 0;
  }
  for (let i = 0; i <= n; i++) {
    const on = i < n && ws[i]! > 0;
    if (on && start < 0) start = i;
    if (!on && start >= 0) {
      if (i - start >= 2) emit(path, s, ws, start, i);
      start = -1;
    }
  }
}

function emit(path: Path2D, s: Stroke, ws: Float32Array, a: number, b: number) {
  const L: number[] = [], R: number[] = [];
  for (let i = a; i < b; i++) {
    const i0 = Math.max(a, i - 1), i1 = Math.min(b - 1, i + 1);
    let tx = s[i1 * 3]! - s[i0 * 3]!, ty = s[i1 * 3 + 1]! - s[i0 * 3 + 1]!;
    const l = Math.hypot(tx, ty) || 1;
    tx /= l; ty /= l;
    // the burin's ends: the ribbon closes to a point at each end of a run
    const endF = i === a || i === b - 1 ? 0.15 : 1;
    const h = (ws[i]! * endF) / 2;
    const x = s[i * 3]!, y = s[i * 3 + 1]!;
    L.push(x + ty * h, y - tx * h);
    R.push(x - ty * h, y + tx * h);
  }
  // keep every ribbon wound the same way, so overlaps add instead of cancel
  let area = 0;
  const m = L.length / 2;
  const P = (i: number): [number, number] =>
    i < m ? [L[i * 2]!, L[i * 2 + 1]!] : [R[(2 * m - 1 - i) * 2]!, R[(2 * m - 1 - i) * 2 + 1]!];
  for (let i = 0; i < 2 * m; i++) {
    const [x0, y0] = P(i), [x1, y1] = P((i + 1) % (2 * m));
    area += x0 * y1 - x1 * y0;
  }
  const order = area >= 0 ? [...Array(2 * m).keys()] : [...Array(2 * m).keys()].reverse();
  order.forEach((i, j) => {
    const [x, y] = P(i);
    if (j === 0) path.moveTo(x, y);
    else path.lineTo(x, y);
  });
  path.closePath();
}
