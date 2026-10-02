// Plate XIV, figures 1 to 3: the cold key, the hot key's leaking cap, and the
// tripwire ladder. Each figure is 400 x 480 plate units.

import { clamp, Curve, ellipse, smoothstep, type Pt } from './geom';
import { COVER, family, railPatch, type Stroke } from './hatch';
import { lambert, Sheet, specular, turned } from './kit';
import { GAUZE_BASIS } from './lattice';
import { valueNoise } from './noise';
import { norm3 } from './pillow';
import type { PlateArt } from './render';

const TILT = 0.2;

/** A tube along a curve, hatched along its length and shaded round its section. */
function tube(s: Sheet, c: Curve, r: number, p: number, o: { tone?: number; cross?: boolean; halo?: number } = {}): Pt[] {
  const N = 60;
  const L: Pt[] = [], R: Pt[] = [];
  for (let k = 0; k <= N; k++) {
    const t = k / N, q = c.at(t), n = c.normal(t);
    L.push([q[0] + n[0] * r, q[1] + n[1] * r]);
    R.push([q[0] - n[0] * r, q[1] - n[1] * r]);
  }
  const outline = [...L, ...[...R].reverse()];
  s.erase(outline, o.halo ?? p * 0.8);
  const A = new Curve(L), B = new Curve(R);
  const P = railPatch(A, B);
  const k = o.tone ?? 1;
  const tone = (_x: number, _y: number, u: number, v: number) => {
    const f = 1 - 2 * v;
    const n2 = c.normal(u);
    const n = norm3([n2[0] * f, n2[1] * f, Math.sqrt(Math.max(0, 1 - f * f)) + 0.04]);
    return clamp((0.1 + 0.55 * lambert(n) + 0.8 * specular(n, 22)) * k);
  };
  const fams = [family(P, { pitch: p * 0.7, constant: 'v', tone, cover: COVER.primary, taper: 1, tremor: 0.04 })];
  if (o.cross !== false) fams.push(family(P, { pitch: p * 0.85, constant: 'u', tone, cover: COVER.cross, taper: 0.4, tremor: 0.02 }));
  s.ink(fams, outline, true);
  return outline;
}

/** A ring seen face-on: concentric lines shaded round the section. */
function torus(s: Sheet, cx: number, cy: number, R: number, t: number, p: number) {
  const outer = ellipse(cx, cy, R + t, R + t, 0, 120);
  s.erase(outer, p * 0.8);
  const rings: Stroke[] = [];
  for (let rho = R - t + p * 0.35; rho < R + t; rho += p * 0.62) {
    const st: Stroke = [];
    const n = Math.ceil((rho * 6.3) / (p * 0.4));
    for (let k = 0; k <= n; k++) {
      const a = (k / n) * Math.PI * 2;
      const f = (rho - R) / t;
      const nrm = norm3([Math.cos(a) * f, Math.sin(a) * f, Math.sqrt(Math.max(0, 1 - f * f))]);
      const tone = clamp(0.1 + 0.55 * lambert(nrm) + 0.85 * specular(nrm, 24));
      st.push(cx + rho * Math.cos(a), cy + rho * Math.sin(a), COVER.primary(tone) * p * 0.62);
    }
    rings.push(st);
  }
  s.ink({ strokes: rings, dots: [] }, undefined, true);
  // the hole: clear it again so the ring reads as a ring
  s.erase(ellipse(cx, cy, R - t, R - t, 0, 120), 0);
}

function shadow(s: Sheet, cx: number, cy: number, rx: number, p: number) {
  const P = (u: number, v: number): Pt => [cx - rx * 1.5 + rx * 3 * u, cy - 12 + 34 * v];
  s.ink(
    family(P, {
      pitch: p * 1.2,
      constant: 'v',
      tone: (x, y) => {
        const ex = (x - cx) / (rx * 1.5), ey = (y - cy - 4) / 16;
        const fall = clamp(1 - ex * ex - ey * ey);
        const sx = (x - (cx - rx * 0.3)) / (rx * 1.1), sy = (y - cy) / 10;
        return fall * (0.36 - 0.32 * smoothstep(1, 0.3, sx * sx + sy * sy));
      },
      cover: COVER.primary,
      taper: 3,
      tremor: 0.1,
      dotBelow: 0.06,
    }),
  );
}

// ---------- Fig. 1, the cold key ----------

function coldKey(p: number): Sheet {
  const s = new Sheet();
  const cx = 196;
  shadow(s, 214, 452, 70, p);
  // bit: a flat plate cut with wards, its face hatched on the lattice
  const bit: Pt[] = [[cx + 8, 322], [cx + 98, 322], [cx + 98, 414], [cx + 8, 414]];
  s.erase(bit, p);
  const [b1, b2] = GAUZE_BASIS;
  const sc = (p * 1.15) / Math.hypot(b1[0], b1[1]);
  const lat: Stroke[] = [];
  for (const [dir, step] of [[b1, b2], [b2, b1]] as const) {
    const d: Pt = [dir[0] * sc, dir[1] * sc], st: Pt = [step[0] * sc, step[1] * sc];
    for (let k = -60; k <= 60; k++) {
      const ox = cx + 50 + k * st[0], oy = 368 + k * st[1];
      const line: Stroke = [];
      for (let j = -80; j <= 80; j++) {
        const x = ox + d[0] * j * 0.5, y = oy + d[1] * j * 0.5;
        if (x < cx + 6 || x > cx + 100 || y < 320 || y > 416) continue;
        const tone = clamp(0.32 + 0.4 * smoothstep(cx + 10, cx + 98, x) - 0.15 * smoothstep(330, 410, y));
        line.push(x, y, COVER.single(tone) * p * 0.55);
      }
      if (line.length > 6) lat.push(line);
    }
  }
  s.ink({ strokes: lat, dots: [] }, bit, true);
  // the wards: notches cut clean through the bit
  for (const w of [[cx + 34, 322, 14, 26], [cx + 70, 352, 28, 13], [cx + 8, 388, 22, 12], [cx + 56, 394, 12, 20]] as const) {
    const [x, y, ww, hh] = w;
    s.erase([[x, y], [x + ww, y], [x + ww, y + hh], [x, y + hh]], 0);
    s.line([[x, y + hh], [x + ww, y + hh], [x + ww, y]], () => p * 0.4);
  }
  s.line([[cx + 98, 322], [cx + 98, 414], [cx + 8, 414]], () => p * 0.45);
  // shank and collars, turned
  turned(s, { cx, y0: 196, y1: 432, r: (y) => 13 - 3 * smoothstep(400, 432, y), tilt: TILT, pitch: p * 0.7, parallels: false, beads: [214, 300] });
  turned(s, { cx, y0: 168, y1: 198, r: (y) => 19 + 3 * Math.sin(((y - 168) / 30) * Math.PI), tilt: TILT, pitch: p * 0.7, topFace: true, topTone: 0.55, grooves: [183] });
  // the bow
  torus(s, cx, 104, 54, 15, p);
  return s;
}

// ---------- Fig. 2, the hot key's cap: a leaking bucket ----------

function bucket(p: number): Sheet {
  const s = new Sheet();
  const cx = 196, y0 = 170, y1 = 404;
  const r = (y: number) => 104 - 20 * ((y - y0) / (y1 - y0));
  shadow(s, 206, y1 + 26, 104, p);
  // the bail: an iron handle over the top
  const bail = new Curve(
    Array.from({ length: 50 }, (_, k) => {
      const a = Math.PI + (k / 49) * Math.PI;
      return [cx + 112 * Math.cos(a), y0 + 18 + 120 * Math.sin(a)] as Pt;
    }),
  );
  tube(s, bail, 3.4, p, { cross: false, tone: 0.9 });
  turned(s, {
    cx, y0, y1, r, tilt: TILT, pitch: p, topFace: true, topTone: 0.3,
    beads: [y0 + 6], grooves: [y0 + 58, y0 + 64, y1 - 46, y1 - 40],
    tone: (n, th) => clamp(0.12 + 0.5 * Math.pow(lambert(n), 1.1) + 0.35 * specular(n, 10) + 0.08 * Math.sin(th * 23)),
  });
  // staves: dark joints running down the turned side
  for (let k = -4; k <= 4; k++) {
    const th = (k / 9.3) * Math.PI;
    const pts: Pt[] = Array.from({ length: 30 }, (_, j) => {
      const y = y0 + 4 + ((y1 - y0 - 4) * j) / 29;
      return [cx + r(y) * Math.sin(th), y + TILT * r(y) * Math.cos(th)] as Pt;
    });
    s.line(pts, () => p * 0.42 * Math.cos(th), undefined, true);
  }
  // ripples on the water
  s.line(ellipse(cx + 18, y0 + 2, 34, 34 * TILT, 0, 64).concat([[cx + 52, y0 + 2]]), () => p * 0.4);
  s.line(ellipse(cx + 18, y0 + 2, 58, 58 * TILT, 0, 80).concat([[cx + 76, y0 + 2]]), () => p * 0.28);
  // the leak: a hole near the foot, and the drops it lets go
  const hx = cx + r(y1 - 28) * Math.sin(0.55), hy = y1 - 28 + TILT * r(y1 - 28) * Math.cos(0.55);
  s.erase(ellipse(hx, hy, 3.2, 2.4), 0);
  const drops: [number, number, number][] = [[hx + 3, hy + 16, 7], [hx + 6, hy + 40, 9], [hx + 8, hy + 66, 10]];
  for (const [x, y, h] of drops) {
    const out: Pt[] = [];
    for (let k = 0; k <= 32; k++) {
      const a = (k / 32) * Math.PI * 2, t = (1 - Math.cos(a)) / 2;
      out.push([x + h * 0.55 * Math.sin(a) * Math.pow(1 - t, 0.7) * (0.3 + Math.sqrt(t)), y + h * 0.5 - h * 1.5 * t]);
    }
    s.erase(out, p * 0.4);
    s.line(out, (_x, yy) => p * (0.25 + 0.3 * smoothstep(y - h, y + h * 0.5, yy)));
    s.dots([x + 1.2, y - h * 0.1, 1.1]);
  }
  // puddle
  s.line(ellipse(hx + 10, y1 + 30, 26, 4.5, 0, 48).concat([[hx + 36, y1 + 30]]), () => p * 0.35);
  s.line(ellipse(hx + 10, y1 + 30, 14, 2.4, 0, 40).concat([[hx + 24, y1 + 30]]), () => p * 0.3);
  return s;
}

// ---------- Fig. 3, the tripwire: a ladder of five curves ----------

/** Rung heights along the stiles (0 = foot), weakest at the bottom. */
export const LADDER_RUNGS = [0.14, 0.31, 0.48, 0.65, 0.82];
const STILE_L: [Pt, Pt] = [[128, 466], [158, 40]];
const STILE_R: [Pt, Pt] = [[290, 466], [262, 40]];
const lerp2 = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/** Where rung i meets each stile, in figure units. */
export function rungEnds(i: number): [Pt, Pt] {
  const t = LADDER_RUNGS[i]!;
  return [lerp2(STILE_L[0], STILE_L[1], t), lerp2(STILE_R[0], STILE_R[1], t)];
}

function ladder(p: number): Sheet {
  const s = new Sheet();
  shadow(s, 196, 470, 110, p);
  // rungs first: the stiles cover their ends
  LADDER_RUNGS.forEach((_, i) => {
    const [a, b] = rungEnds(i);
    const family4 = i >= 3;
    const rr = family4 ? 7.5 : 6;
    if (i === 0) {
      // the first rung, claimed: snapped in two, the halves hanging
      const m1: Pt = [a[0] + (b[0] - a[0]) * 0.44, a[1] + 16];
      const m2: Pt = [a[0] + (b[0] - a[0]) * 0.58, b[1] + 13];
      tube(s, new Curve([a, [(a[0] + m1[0]) / 2, a[1] + 5], m1]), rr, p, { tone: 0.8 });
      tube(s, new Curve([b, [(b[0] + m2[0]) / 2, b[1] + 4], m2]), rr, p, { tone: 0.8 });
      // splinters at the break
      for (const [m, dir] of [[m1, 1], [m2, -1]] as const) {
        for (let k = 0; k < 4; k++) {
          const len = 6 + k * 2.5;
          s.line([[m[0], m[1] - 4 + k * 2.6], [m[0] + dir * len, m[1] - 3 + k * 2.2 + (k % 2 ? 2 : -1)]], (_x, _y, f) => p * 0.32 * (1 - f));
        }
      }
      return;
    }
    tube(s, new Curve([a, b]), rr, p, { tone: family4 ? 1 : 0.9 });
  });
  tube(s, new Curve([STILE_L[0], STILE_L[1]]), 10, p, { tone: 0.95 });
  tube(s, new Curve([STILE_R[0], STILE_R[1]]), 10, p, { tone: 0.95 });
  // wood grain: a few long cut lines along each stile
  for (const [A, B] of [STILE_L, STILE_R]) {
    for (const off of [-3.5, 2.5]) {
      const pts: Pt[] = Array.from({ length: 40 }, (_, k) => {
        const q = lerp2(A, B, 0.04 + (k / 39) * 0.92);
        return [q[0] + off + 1.2 * Math.sin(k * 0.7 + off), q[1]] as Pt;
      });
      s.line(pts, (x, y) => p * 0.22 * (0.4 + valueNoise(x / 9, y / 9, 3)), undefined, true);
    }
  }
  return s;
}

const fig = (draw: (p: number) => Sheet): PlateArt => {
  let cache: { p: number; ops: ReturnType<Sheet['ops']['slice']> } | null = null;
  return {
    width: 400,
    height: 480,
    ops: (p) => {
      if (!cache || cache.p !== p) cache = { p, ops: draw(p).ops };
      return cache.ops;
    },
  };
};

export const figColdKey = fig(coldKey);
export const figBucket = fig(bucket);
export const figLadder = fig(ladder);
