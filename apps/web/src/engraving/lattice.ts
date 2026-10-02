// The lamp's wire gauze is drawn on a real lattice: the q-ary lattice
// { (x, y) : y = h·x mod q } with Falcon's modulus q = 12289. Gauss reduction
// gives a short, nearly orthogonal basis; its two directions are the two wire
// families of the mesh.

export const FALCON_Q = 12289;
export const GAUZE_H = 451;

export type Basis = [[number, number], [number, number]];

/** Lagrange-Gauss reduction of a 2D basis. */
export function gaussReduce(b1: [number, number], b2: [number, number]): Basis {
  let a = b1, b = b2;
  for (let i = 0; i < 64; i++) {
    const na = a[0] * a[0] + a[1] * a[1];
    const nb = b[0] * b[0] + b[1] * b[1];
    if (nb < na) { [a, b] = [b, a]; continue; }
    const m = Math.round((a[0] * b[0] + a[1] * b[1]) / na);
    if (m === 0) break;
    b = [b[0] - m * a[0], b[1] - m * a[1]];
  }
  return [a, b];
}

/** Reduced basis of the gauze lattice: [[109, 3], [-27, 112]]. */
export const GAUZE_BASIS: Basis = gaussReduce([1, GAUZE_H], [0, FALCON_Q]);
