// The transactions behind "Open a treasury", built the same way for the page and its tests.

import {
  encodeFunctionData,
  isAddressEqual,
  parseAbi,
  parseEther,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem';
import { DEFAULT_LEVEL_BPS } from './bucket';
import {
  createQanaryAccount,
  keyStoreAbi,
  NATIVE_ASSET,
  SELF_BUNDLE_GAS,
  type Deployment,
  type HotSetup,
  type KernelSmartAccount,
  type PqSigner,
} from './sdk';

/** The Solidity ML-DSA-44 verifier's one-time key preparation. */
export const fallbackVerifierAbi = parseAbi([
  'function prepareKey(bytes key) returns (address)',
  'function isPrepared(bytes key) view returns (bool)',
  'error KeyNotPrepared(bytes32 pkHash)',
]);

/** A hot-key window may run from a minute to ninety days. */
export const MAX_WINDOW_HOURS = 24 * 90;

export type TxRequest = { to: Address; data?: Hex; value?: bigint };

/** The cap typed in the form, in wei; null when it does not parse. */
export function parseCap(text: string): bigint | null {
  try {
    return parseEther(text.trim() || '0');
  } catch {
    return null;
  }
}

/** The executor stores caps as uint128. */
const MAX_CAP = 2n ** 128n - 1n;

/** Whether a hot tier with this cap and window can be installed (a cap above zero, a window of a minute or more). */
export function hotTierValid(capWei: bigint | null, hours: number): boolean {
  return (
    capWei !== null && capWei > 0n && capWei <= MAX_CAP && Number.isFinite(hours) && hours * 60 >= 1 && hours <= MAX_WINDOW_HOURS
  );
}

/** The hot tier of a new treasury: the connected wallet, capped in the native currency, the default tripwire response. */
export function hotSetupFor(eoa: Address, capWei: bigint, hours: number): HotSetup {
  return {
    window: Math.round(hours * 3600),
    levelBps: DEFAULT_LEVEL_BPS,
    signer: { family: 'secp256k1', eoa },
    assets: [{ asset: NATIVE_ASSET, cap: capWei }],
  };
}

/** Stores the post-quantum key blob in the key store, as contract code at its pointer. */
export function storeKeyRequest(keyStore: Address, blob: Hex): TxRequest {
  return { to: keyStore, data: encodeFunctionData({ abi: keyStoreAbi, functionName: 'store', args: [blob] }) };
}

/** Expands a stored ML-DSA-44 key once for the Solidity verifier; the key is its 20-byte pointer. */
export function prepareKeyRequest(verifier: Address, pointer: Address): TxRequest {
  return { to: verifier, data: encodeFunctionData({ abi: fallbackVerifierAbi, functionName: 'prepareKey', args: [pointer] }) };
}

/** Gas the EntryPoint reserves for one self-bundled operation with the default limits. */
export const OPERATION_GAS = SELF_BUNDLE_GAS.verificationGasLimit + SELF_BUNDLE_GAS.callGasLimit + SELF_BUNDLE_GAS.preVerificationGas;

/**
 * What the account must hold before its first operation: the EntryPoint takes the whole gas
 * reservation at `maxFeePerGas` up front and refunds what is unused. A fifth on top, because the
 * fee can move between this estimate and the signature.
 */
export function prefundFor(maxFeePerGas: bigint): bigint {
  return (OPERATION_GAS * maxFeePerGas * 6n) / 5n;
}

/** The transfer that tops the account up to `prefund`; null when it already holds enough. */
export function fundRequest(account: Address, prefund: bigint, balance: bigint): TxRequest | null {
  if (isAddressEqual(account, zeroAddress)) throw new Error('The account address is not known yet.');
  const need = prefund - balance;
  return need > 0n ? { to: account, value: need } : null;
}

/**
 * The calls of the first operation. It moves nothing: a zero-value call to the wallet that sent
 * it. Its `initCode` deploys the account and the hot tier's install rides on it.
 */
export function firstOperationCalls(wallet: Address): { to: Address; value: bigint }[] {
  return [{ to: wallet, value: 0n }];
}

/**
 * A new treasury's account, at the address its first operation will deploy it to. The SDK works
 * the address out with the root key already in place, so it is right before the key is stored,
 * and it never answers the zero address; the check here is a second lock on the funding step.
 */
export async function newTreasuryAccount(
  client: PublicClient,
  opts: { signer: PqSigner; deployment: Deployment; registry: Address; hot?: HotSetup },
): Promise<KernelSmartAccount> {
  const account = await createQanaryAccount(client, {
    signer: opts.signer,
    registry: opts.registry,
    deployment: opts.deployment,
    ...(opts.hot ? { hot: opts.hot } : {}),
  });
  if (isAddressEqual(account.address, zeroAddress)) throw new Error('The EntryPoint could not work out the account address.');
  return account;
}
