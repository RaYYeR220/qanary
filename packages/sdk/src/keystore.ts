import {
  bytesToHex,
  concat,
  getContractAddress,
  isHex,
  keccak256,
  numberToHex,
  size,
  type Address,
  type Hex,
  type WalletClient,
} from 'viem';
import { getCode, waitForTransactionReceipt, writeContract } from 'viem/actions';
import { keyStoreAbi } from './abis/keyStore.js';
import { PUBLIC_KEY_BYTES, SCHEME_ID, assertScheme, type PqSigner } from './schemes.js';

// KeyStore creation code between the PUSH4 size and the payload:
// DUP1 PUSH1 0x0E PUSH1 0x00 CODECOPY PUSH1 0x00 RETURN.
const CREATION_CODE_SUFFIX: Hex = '0x80600E6000396000F3';

/** The on-chain key blob: scheme id byte ‖ raw public key. */
export function keyBlob(signer: PqSigner): Hex {
  assertScheme(signer.scheme);
  const expected = PUBLIC_KEY_BYTES[signer.scheme];
  if (signer.publicKey.length !== expected) {
    throw new Error(`${signer.scheme} public key must be ${expected} bytes, got ${signer.publicKey.length}`);
  }
  return concat([numberToHex(SCHEME_ID[signer.scheme], { size: 1 }), bytesToHex(signer.publicKey)]);
}

/**
 * The address `KeyStore.store(blob)` deploys to (identical to `KeyStore.pointerOf(blob)`):
 * CREATE2(keyStore, salt = keccak256(blob), initCode = 0x63 ‖ uint32(len + 1) ‖ 0x80600E6000396000F3 ‖ 0x00 ‖ blob).
 */
export function predictKeyPointer(keyStore: Address, blob: Hex): Address {
  if (!isHex(blob, { strict: true }) || blob.length % 2 !== 0) throw new Error('blob must be 0x-prefixed hex bytes');
  const length = size(blob);
  if (length === 0) throw new Error('blob must not be empty');
  const initCode = concat(['0x63', numberToHex(length + 1, { size: 4 }), CREATION_CODE_SUFFIX, '0x00', blob]);
  return getContractAddress({ opcode: 'CREATE2', from: keyStore, salt: keccak256(blob), bytecode: initCode });
}

/**
 * Stores `blob` in the KeyStore and returns its pointer. Idempotent: if the pointer already holds
 * the key, no transaction is sent. Waits for the receipt and throws if the transaction reverted.
 */
export async function storeKey(wallet: WalletClient, keyStore: Address, blob: Hex): Promise<Address> {
  if (!wallet.account) throw new Error('storeKey: wallet client has no account');
  const pointer = predictKeyPointer(keyStore, blob);

  const existing = await getCode(wallet, { address: pointer });
  if (existing && existing !== '0x') return pointer;

  const hash = await writeContract(wallet, {
    address: keyStore,
    abi: keyStoreAbi,
    functionName: 'store',
    args: [blob],
    account: wallet.account,
    chain: wallet.chain,
  });
  const receipt = await waitForTransactionReceipt(wallet, { hash });
  if (receipt.status !== 'success') throw new Error(`KeyStore.store reverted (tx ${hash})`);
  return pointer;
}
