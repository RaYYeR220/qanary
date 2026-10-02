import {
  bytesToHex,
  encodeAbiParameters,
  isHex,
  numberToHex,
  size,
  type Account,
  type Address,
  type Chain,
  type Client,
  type Hash,
  type Hex,
  type Transport,
} from 'viem';
import { sha256 } from '@noble/hashes/sha2.js';
import { readContract, writeContract } from 'viem/actions';
import { canaryRegistryAbi } from './abis/canaryRegistry.js';

/**
 * Canary targets: three ladder curves of increasing size, then the production curves.
 * L1 secp160r1, L2 P-192, L3 P-224, K1 secp256k1, R1 P-256.
 */
export const CANARY_TARGET = { L1: 0, L2: 1, L3: 2, K1: 3, R1: 4 } as const;
export type CanaryTarget = (typeof CANARY_TARGET)[keyof typeof CANARY_TARGET];

/** Classical signature families the registry can mark as broken. */
export const CLASSICAL_FAMILY = { secp256k1: 0, p256: 1 } as const;
export type ClassicalFamily = (typeof CLASSICAL_FAMILY)[keyof typeof CLASSICAL_FAMILY];

/** An ECDSA signature. K1 claims need the recovery id (`v` 27/28 or 0/1, or `yParity`). */
export type EcdsaSignature = { r: Hex | bigint; s: Hex | bigint; v?: number | bigint; yParity?: number };

function word(x: Hex | bigint, name: string): Hex {
  if (typeof x === 'bigint') {
    if (x < 0n) throw new Error(`claim proof: ${name} must be non-negative`);
    return numberToHex(x, { size: 32 });
  }
  if (!isHex(x, { strict: true }) || size(x) > 32) throw new Error(`claim proof: ${name} must be at most 32 bytes of hex`);
  return numberToHex(BigInt(x), { size: 32 });
}

function assertTarget(target: number): asserts target is CanaryTarget {
  if (!Number.isInteger(target) || target < 0 || target > 4) throw new Error(`invalid canary target ${target} (0..4)`);
}

/**
 * The `claim` proof for `target`: `abi.encode(uint8 v, bytes32 r, bytes32 s)` for K1 (secp256k1,
 * checked with ecrecover, so `v` is 27 or 28), `abi.encode(bytes32 r, bytes32 s)` otherwise.
 * The signature must be over `claimMessage(target, claimant)` (the raw 32-byte digest).
 */
export function encodeClaimProof(target: number, sig: EcdsaSignature): Hex {
  assertTarget(target);
  const r = word(sig.r, 'r');
  const s = word(sig.s, 's');
  if (target !== CANARY_TARGET.K1) {
    return encodeAbiParameters([{ type: 'bytes32' }, { type: 'bytes32' }], [r, s]);
  }
  let v: number;
  if (sig.v !== undefined) v = Number(sig.v);
  else if (sig.yParity !== undefined) v = sig.yParity;
  else throw new Error('claim proof: K1 needs v or yParity');
  if (v === 0 || v === 1) v += 27;
  if (v !== 27 && v !== 28) throw new Error(`claim proof: invalid v ${v}`);
  return encodeAbiParameters([{ type: 'uint8' }, { type: 'bytes32' }, { type: 'bytes32' }], [v, r, s]);
}

const SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

/**
 * Private key of the drill K1 (secp256k1) target: `sha256("QANARY-DRILL-V1/secp256k1") mod n`.
 * Public by design: drill registries use the published drill keys so anyone can rehearse a trip
 * (sign `claimMessage(3, claimant)` with it) without touching the real NUMS registry.
 */
export function drillK1PrivateKey(): Hex {
  const digest = sha256(new TextEncoder().encode('QANARY-DRILL-V1/secp256k1'));
  return numberToHex(BigInt(bytesToHex(digest)) % SECP256K1_N, { size: 32 });
}

type AnyClient = Client<Transport, Chain | undefined, Account | undefined>;

/**
 * Client for a QuantumCanaryRegistry (or a drill registry). Reads work with any client; `claim`
 * and `fundETH` send from the client's account.
 */
export function canary(client: AnyClient, registry: Address) {
  const contract = { address: registry, abi: canaryRegistryAbi } as const;
  const sender = (what: string): Account => {
    if (!client.account) throw new Error(`canary.${what}: the client has no account to send from`);
    return client.account;
  };

  return {
    address: registry,

    /** Ladder level 0..3: how many ladder rungs have fallen (K1/R1 claims set it to 3). */
    async level(): Promise<number> {
      return readContract(client, { ...contract, functionName: 'ladderLevel' });
    },

    /** Whether `family` (0 secp256k1, 1 P-256) has been proven broken by a K1/R1 claim. */
    async familyBroken(family: ClassicalFamily): Promise<boolean> {
      return readContract(client, { ...contract, functionName: 'familyBroken', args: [family] });
    },

    async claimed(target: CanaryTarget): Promise<boolean> {
      assertTarget(target);
      return readContract(client, { ...contract, functionName: 'claimed', args: [target] });
    },

    /** The target public keys (`l1x…r1y`, `k1` as an address). */
    async targets() {
      return readContract(client, { ...contract, functionName: 'targets' });
    },

    /** The digest a claimant signs with the target key; bound to chain, registry, target and claimant. */
    async claimMessage(target: CanaryTarget, claimant: Address): Promise<Hex> {
      assertTarget(target);
      return readContract(client, { ...contract, functionName: 'claimMessage', args: [target, claimant] });
    },

    async bounty(target: CanaryTarget): Promise<{ tokenAmount: bigint; ethAmount: bigint }> {
      assertTarget(target);
      const [tokenAmount, ethAmount] = await readContract(client, { ...contract, functionName: 'bounty', args: [target] });
      return { tokenAmount, ethAmount };
    },

    async isDrill(): Promise<boolean> {
      return readContract(client, { ...contract, functionName: 'isDrill' });
    },

    /** Bounty credited to `claimant` after a payout push failed (pull it with `withdrawOwed`). */
    async owed(claimant: Address): Promise<{ tokenAmount: bigint; ethAmount: bigint }> {
      const [tokenAmount, ethAmount] = await Promise.all([
        readContract(client, { ...contract, functionName: 'owedToken', args: [claimant] }),
        readContract(client, { ...contract, functionName: 'owedEth', args: [claimant] }),
      ]);
      return { tokenAmount, ethAmount };
    },

    /** Pulls everything credited to the client's account (`withdrawOwed`). */
    async withdrawOwed(): Promise<Hash> {
      return writeContract(client, {
        ...contract,
        functionName: 'withdrawOwed',
        account: sender('withdrawOwed'),
        chain: client.chain,
      });
    },

    /**
     * Claims `target`. `proof` is either the encoded proof or the ECDSA signature over
     * `claimMessage(target, sender)`, encoded with `encodeClaimProof`.
     */
    async claim(target: CanaryTarget, proof: Hex | EcdsaSignature, opts: { gas?: bigint } = {}): Promise<Hash> {
      const encoded = typeof proof === 'string' ? proof : encodeClaimProof(target, proof);
      assertTarget(target);
      return writeContract(client, {
        ...contract,
        functionName: 'claim',
        args: [target, encoded],
        account: sender('claim'),
        chain: client.chain,
        gas: opts.gas,
      });
    },

    /** Adds `value` wei to the ETH bounty of `target`. */
    async fundETH(target: CanaryTarget, value: bigint): Promise<Hash> {
      assertTarget(target);
      return writeContract(client, {
        ...contract,
        functionName: 'fundETH',
        args: [target],
        value,
        account: sender('fundETH'),
        chain: client.chain,
      });
    },
  };
}
