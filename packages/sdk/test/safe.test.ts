import { describe, expect, it } from 'vitest';
import { encodeAbiParameters, keccak256, stringToHex, type Address, type Hex } from 'viem';
import { PQ_SAFE_OWNER_DOMAIN, pqSafeOwnerDigest, safe130Erc1271Hash } from '../src/index.js';

// Computed with forge against contracts/evm/src/safe/PQSafeOwner.sol: owner contract at 0x5555…5555 on
// chain 421614, safe 0x6666…6666, hash = keccak256("qanary").
const VEC = {
  chainId: 421614,
  owner: '0x5555555555555555555555555555555555555555' as Address,
  safe: '0x6666666666666666666666666666666666666666' as Address,
  hash: keccak256(stringToHex('qanary')),
  digest: '0xef862673e30de435d1ca007f71f365ad319eb88261cdacbe00648fefa364f57a' as Hex,
};

describe('PQSafeOwner digest (forge vector)', () => {
  it('computes safeMessageDigest(safe, hash)', () => {
    expect(PQ_SAFE_OWNER_DOMAIN).toEqual({ name: 'QanaryPQSafeOwner', version: '1' });
    expect(pqSafeOwnerDigest({ owner: VEC.owner, chainId: VEC.chainId, safe: VEC.safe, hash: VEC.hash })).toBe(VEC.digest);
  });

  it('binds the Safe, the chain and the owner contract', () => {
    const base = { owner: VEC.owner, chainId: VEC.chainId, safe: VEC.safe, hash: VEC.hash };
    expect(pqSafeOwnerDigest({ ...base, safe: '0x7777777777777777777777777777777777777777' })).not.toBe(VEC.digest);
    expect(pqSafeOwnerDigest({ ...base, chainId: 42161 })).not.toBe(VEC.digest);
    expect(pqSafeOwnerDigest({ ...base, owner: '0x8888888888888888888888888888888888888888' })).not.toBe(VEC.digest);
    expect(() => pqSafeOwnerDigest({ ...base, safe: '0x12' as Address })).toThrow(/address/);
  });

  it('derives the Safe 1.3.0 ERC-1271 hash keccak256(abi.encode(appHash))', () => {
    expect(safe130Erc1271Hash(VEC.hash)).toBe(keccak256(encodeAbiParameters([{ type: 'bytes32' }], [VEC.hash])));
  });
});
