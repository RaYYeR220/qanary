import { encodeAbiParameters, hashTypedData, isAddress, keccak256, type Address, type Hex } from 'viem';

/** EIP-712 domain name and version of `PQSafeOwner` (`safeMessageDigest`). */
export const PQ_SAFE_OWNER_DOMAIN = { name: 'QanaryPQSafeOwner', version: '1' } as const;

/**
 * `PQSafeOwner.safeMessageDigest(safe, hash)`: the EIP-712 digest of
 * `SafeMessage(address safe, bytes32 hash)` under the owner contract's domain
 * `{ name: "QanaryPQSafeOwner", version: "1", chainId, verifyingContract: owner }`. This is what the
 * owner's post-quantum key signs; it binds the approval to one Safe, one chain and one owner contract.
 *
 * `hash` is what the Safe asks the owner about:
 * - `execTransaction` (Safe 1.3.0, 1.4.1, 1.5.0): the Safe transaction hash (`getTransactionHash`).
 * - ERC-1271 on a Safe 1.3.0 (`CompatibilityFallbackHandler` 1.3.0): `safe130Erc1271Hash(appHash)`.
 * - ERC-1271 on a Safe 1.4.1 / 1.5.0: the Safe's message hash, `getMessageHashForSafe(safe, abi.encode(appHash))`.
 */
export function pqSafeOwnerDigest(p: { owner: Address; chainId: number; safe: Address; hash: Hex }): Hex {
  if (!isAddress(p.owner) || !isAddress(p.safe)) throw new Error('pqSafeOwnerDigest: owner and safe must be addresses');
  return hashTypedData({
    domain: { ...PQ_SAFE_OWNER_DOMAIN, chainId: p.chainId, verifyingContract: p.owner },
    types: {
      SafeMessage: [
        { name: 'safe', type: 'address' },
        { name: 'hash', type: 'bytes32' },
      ],
    },
    primaryType: 'SafeMessage',
    message: { safe: p.safe, hash: p.hash },
  });
}

/**
 * The `hash` a Safe 1.3.0 hands its contract owners for an ERC-1271 check of `appHash`: its
 * fallback handler forwards `data = abi.encode(appHash)`, and `PQSafeOwner` hashes `data`.
 */
export function safe130Erc1271Hash(appHash: Hex): Hex {
  return keccak256(encodeAbiParameters([{ type: 'bytes32' }], [appHash]));
}
