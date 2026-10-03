// Turns a failed call into words. Every custom error of the Qanary contracts,
// the verifiers and EntryPoint v0.7 is decoded; the four refusals of the hot
// tier are marked so the interface can show them as refusals, not failures.

import { BaseError, decodeErrorResult, formatUnits, parseAbi, type Abi, type Hex } from 'viem';
import { entryPoint07Abi } from 'viem/account-abstraction';
import {
  canaryRegistryAbi,
  hotTierExecutorAbi,
  keyStoreAbi,
  pqVerifierAbi,
  quantumValidatorAbi,
} from './sdk';

/** Errors of the Solidity ML-DSA-44 verifier that the Stylus verifiers do not have. */
const fallbackVerifierAbi = parseAbi(['error KeyNotPrepared(bytes32 pkHash)']);

const onlyErrors = (abi: Abi) => abi.filter((x) => x.type === 'error');

export const ERRORS_ABI: Abi = [
  ...onlyErrors(hotTierExecutorAbi as Abi),
  ...onlyErrors(canaryRegistryAbi as Abi),
  ...onlyErrors(quantumValidatorAbi as Abi),
  ...onlyErrors(keyStoreAbi as Abi),
  ...onlyErrors(pqVerifierAbi as Abi),
  ...onlyErrors(entryPoint07Abi as Abi),
  ...fallbackVerifierAbi,
];

/** The hot tier's refusals: the account is working as designed when these fire. */
export const REFUSALS = ['CapExceeded', 'ClassicalFamilyBroken', 'HotTierFrozen', 'CallNotAllowed'] as const;
export type Refusal = (typeof REFUSALS)[number];

export interface Explained {
  /** Error name, or a short kind for errors without one. */
  name: string;
  /** One sentence for the person using the app. */
  message: string;
  refusal: boolean;
  args?: readonly unknown[];
}

const FAMILIES = ['secp256k1', 'P-256'];

const fmtAmount = (v: unknown, symbol?: string) =>
  typeof v === 'bigint' ? `${formatUnits(v, 18)}${symbol ? ` ${symbol}` : ''}` : String(v);

/** Words for a decoded custom error. */
export function describeError(name: string, args: readonly unknown[] = [], symbol?: string): Explained {
  const refusal = (REFUSALS as readonly string[]).includes(name);
  const say = (message: string): Explained => ({ name, message, refusal, args });
  switch (name) {
    case 'CapExceeded':
      return say(
        `Refused: over the hot-key cap. This transfer needs ${fmtAmount(args[1], symbol)}, and ${fmtAmount(args[2], symbol)} is available right now.`,
      );
    case 'ClassicalFamilyBroken':
      return say(`Refused: ${FAMILIES[Number(args[0])] ?? 'this'} keys are disabled for good, because the tripwire proved the curve broken.`);
    case 'HotTierFrozen':
      return say(`Refused: the hot tier is frozen at tripwire level ${String(args[0])}. Only the post-quantum key can move funds.`);
    case 'CallNotAllowed':
      return say(`Refused: the hot key may not make this call (target ${String(args[0])}, selector ${String(args[1])}).`);
    case 'ForbiddenTarget':
      return say(`The hot key may not call ${String(args[0])}.`);
    case 'ValueNotTracked':
      return say('The hot key may only send assets the hot tier tracks.');
    case 'Unauthorized':
      return say('This wallet is not the hot key of the account.');
    case 'NotConfigured':
      return say('The account has no hot tier.');
    case 'Expired':
      return say('The signed hot operation has expired.');
    case 'InvalidSetup':
      return say('The hot-tier settings are invalid.');
    case 'ModuleCallFailed':
      return say(`Call ${String(args[0])} of the hot operation reverted inside the account.`);
    case 'AlreadyClaimed':
      return say(`That target has already been claimed.`);
    case 'InvalidProof':
      return say('The registry rejected the signature: it does not verify against the target key.');
    case 'InvalidTarget':
      return say(`There is no target ${String(args[0])}.`);
    case 'TokenBountiesDisabled':
      return say('This registry pays bounties in the native currency only.');
    case 'NothingOwed':
      return say('Nothing is owed to this wallet.');
    case 'AlreadyInitialized':
      return say('The account already has a post-quantum key.');
    case 'NotInitialized':
      return say('The account has no post-quantum key yet.');
    case 'InvalidKeyConfig':
      return say('The verifier or key pointer is not valid.');
    case 'InvalidKey':
      return say('The key pointer holds no key.');
    case 'InvalidKeyLength':
      return say(`The key has the wrong length: expected ${String(args[0])} bytes, got ${String(args[1])}.`);
    case 'InvalidSignatureLength':
      return say(`The signature has the wrong length: expected ${String(args[0])} bytes, got ${String(args[1])}.`);
    case 'UnsupportedScheme':
      return say(`This verifier does not take scheme ${String(args[0])}.`);
    case 'KeyNotPrepared':
      return say('The Solidity verifier needs this key prepared once before it can check signatures (prepareKey).');
    case 'EmptyBlob':
      return say('Nothing to store: the key is empty.');
    case 'FailedOp':
    case 'FailedOpWithRevert':
      return say(`EntryPoint refused the operation: ${String(args[1])}.`);
    default:
      return say(`The call reverted with ${name}.`);
  }
}

/** Finds revert data in a viem error (or nested cause) and explains it. */
export function explainError(err: unknown, symbol?: string): Explained {
  if (err instanceof BaseError) {
    const withData = err.walk((e) => typeof (e as { data?: unknown }).data === 'string' || isDecoded(e));
    const decoded = withData && (withData as { data?: unknown }).data;
    if (decoded && typeof decoded === 'object' && 'errorName' in decoded) {
      const d = decoded as { errorName: string; args?: readonly unknown[] };
      return describeError(d.errorName, d.args ?? [], symbol);
    }
    if (typeof decoded === 'string') {
      const fromData = explainRevertData(decoded as Hex, symbol);
      if (fromData) return fromData;
    }
    const rejected = err.walk((e) => (e as { code?: number }).code === 4001 || /rejected/i.test((e as Error).message));
    if (rejected) return { name: 'Rejected', message: 'You rejected the request in your wallet.', refusal: false };
    return { name: err.name, message: err.shortMessage || err.message, refusal: false };
  }
  return { name: 'Error', message: err instanceof Error ? err.message : String(err), refusal: false };
}

function isDecoded(e: unknown): boolean {
  const d = (e as { data?: unknown }).data;
  return !!d && typeof d === 'object' && 'errorName' in (d as object);
}

/** Explains raw revert data, or undefined if no known error matches. */
export function explainRevertData(data: Hex, symbol?: string): Explained | undefined {
  if (!data || data === '0x') return undefined;
  try {
    const d = decodeErrorResult({ abi: ERRORS_ABI, data });
    const out = describeError(d.errorName, d.args ?? [], symbol);
    // EntryPoint wraps the account's own revert: explain the inner one when it is ours
    if (d.errorName === 'FailedOpWithRevert') {
      const inner = explainRevertData(d.args?.[2] as Hex, symbol);
      if (inner) return inner;
    }
    return out;
  } catch {
    if (data.startsWith('0x08c379a0')) return { name: 'Error', message: 'The call reverted with a message.', refusal: false };
    return undefined;
  }
}
