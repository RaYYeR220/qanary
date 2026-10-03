// The five canary targets from deployments/canary-targets.json, with their
// nothing-up-my-sleeve derivation re-checked at build time:
// x = SHA-256("QANARY-NUMS-V1/" ‖ name ‖ ctr as 4 bytes) mod p, y the even root.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Hex } from 'viem';

export const TARGETS = [
  { id: 0, code: 'L1', curve: 'secp160r1', label: 'secp160r1', bits: 160, role: 'Ladder rung 1' },
  { id: 1, code: 'L2', curve: 'p192', label: 'P-192', bits: 192, role: 'Ladder rung 2' },
  { id: 2, code: 'L3', curve: 'p224', label: 'P-224', bits: 224, role: 'Ladder rung 3' },
  { id: 3, code: 'K1', curve: 'secp256k1', label: 'secp256k1', bits: 256, role: 'Ethereum keys' },
  { id: 4, code: 'R1', curve: 'p256', label: 'P-256', bits: 256, role: 'Passkeys' },
] as const;

const CURVE = {
  secp160r1: { p: 0xffffffffffffffffffffffffffffffff7fffffffn, a: 0xffffffffffffffffffffffffffffffff7ffffffcn, b: 0x1c97befc54bd7a8b65acf89f81d4d4adc565fa45n },
  p192: { p: 0xfffffffffffffffffffffffffffffffeffffffffffffffffn, a: 0xfffffffffffffffffffffffffffffffefffffffffffffffcn, b: 0x64210519e59c80e70fa7e9ab72243049feb8deecc146b9b1n },
  p224: {
    p: 0xffffffffffffffffffffffffffffffff000000000000000000000001n,
    a: 0xfffffffffffffffffffffffffffffffefffffffffffffffffffffffen,
    b: 0xb4050a850c04b3abf54132565044b0b7d7bfd8ba270b39432355ffb4n,
  },
  secp256k1: { p: 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn, a: 0n, b: 7n },
  p256: {
    p: 0xffffffff00000001000000000000000000000000ffffffffffffffffffffffffn,
    a: 0xffffffff00000001000000000000000000000000fffffffffffffffffffffffcn,
    b: 0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604bn,
  },
} as const;

export interface TargetView {
  id: number;
  code: string;
  label: string;
  role: string;
  bits: number;
  nums: { tag: string; ctr: number; x: Hex; y: Hex; address?: Hex; derivationHolds: boolean };
  drill: { privateKey: Hex; x: Hex; y: Hex; address?: Hex };
}

const mod = (a: bigint, p: bigint) => ((a % p) + p) % p;

function derivationHolds(curve: keyof typeof CURVE, name: string, ctr: number, x: bigint, y: bigint): boolean {
  const { p, a, b } = CURVE[curve];
  const tag = Buffer.concat([Buffer.from(`QANARY-NUMS-V1/${name}`), Buffer.from([ctr >>> 24, (ctr >>> 16) & 255, (ctr >>> 8) & 255, ctr & 255])]);
  const hx = mod(BigInt(`0x${createHash('sha256').update(tag).digest('hex')}`), p);
  const onCurve = mod(y * y - (x * x * x + a * x + b), p) === 0n;
  return hx === x && onCurve && y % 2n === 0n;
}

export function readTargets(): TargetView[] {
  let dir = process.cwd();
  for (let i = 0; i < 4 && !fs.existsSync(path.join(dir, 'pnpm-workspace.yaml')); i++) dir = path.dirname(dir);
  const json = JSON.parse(fs.readFileSync(path.join(dir, 'deployments', 'canary-targets.json'), 'utf8')) as {
    nums: Record<string, { x: Hex; y: Hex; ctr: number; address?: Hex }>;
    drill: Record<string, { privateKey: Hex; x: Hex; y: Hex; address?: Hex }>;
  };
  return TARGETS.map((t) => {
    const n = json.nums[t.curve]!;
    const d = json.drill[t.curve]!;
    return {
      id: t.id,
      code: t.code,
      label: t.label,
      role: t.role,
      bits: t.bits,
      nums: {
        tag: `QANARY-NUMS-V1/${t.curve}`,
        ctr: n.ctr,
        x: n.x,
        y: n.y,
        ...(n.address ? { address: n.address } : {}),
        derivationHolds: derivationHolds(t.curve, t.curve, n.ctr, BigInt(n.x), BigInt(n.y)),
      },
      drill: { privateKey: d.privateKey, x: d.x, y: d.y, ...(d.address ? { address: d.address } : {}) },
    };
  });
}
