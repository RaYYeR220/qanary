import { generateMnemonic as bip39Generate, mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { assertScheme, type PqSigner, type Scheme } from '../schemes.js';
import { pqSignerFromSeed } from './noble.js';

/** A fresh 24-word (256-bit entropy) English BIP-39 mnemonic. */
export function generateMnemonic(): string {
  return bip39Generate(wordlist, 256);
}

/**
 * Derives a signer from a BIP-39 mnemonic (no passphrase):
 * seed32 = HKDF-SHA256(ikm = BIP-39 seed (64 B), salt = empty, info = "qanary/<scheme>/v1/<index>", 32),
 * then the same keygen as {@link pqSignerFromSeed}.
 */
export function pqSignerFromMnemonic(scheme: Scheme, mnemonic: string, index = 0): PqSigner {
  assertScheme(scheme);
  if (!Number.isSafeInteger(index) || index < 0) {
    throw new Error('index must be a non-negative safe integer');
  }
  const phrase = typeof mnemonic === 'string' ? mnemonic.trim().toLowerCase().split(/\s+/).join(' ') : '';
  if (!validateMnemonic(phrase, wordlist)) {
    throw new Error('invalid BIP-39 mnemonic');
  }
  const bip39Seed = mnemonicToSeedSync(phrase);
  const info = new TextEncoder().encode(`qanary/${scheme}/v1/${index}`);
  return pqSignerFromSeed(scheme, hkdf(sha256, bip39Seed, undefined, info, 32));
}
