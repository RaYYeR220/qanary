/** ABI of the Stylus ERC-7913 post-quantum verifiers (ML-DSA-44, ML-DSA-65, Falcon-512). */
export const pqVerifierAbi = [
  {
    type: 'function',
    name: 'verify',
    stateMutability: 'view',
    inputs: [
      { name: 'key', type: 'bytes' },
      { name: 'hash', type: 'bytes32' },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [{ name: '', type: 'bytes4' }],
  },
  {
    type: 'function',
    name: 'schemes',
    stateMutability: 'pure',
    inputs: [],
    outputs: [{ name: '', type: 'uint8[]' }],
  },
  {
    type: 'error',
    name: 'InvalidKeyLength',
    inputs: [
      { name: 'expected', type: 'uint256' },
      { name: 'got', type: 'uint256' },
    ],
  },
  {
    type: 'error',
    name: 'InvalidSignatureLength',
    inputs: [
      { name: 'expected', type: 'uint256' },
      { name: 'got', type: 'uint256' },
    ],
  },
  { type: 'error', name: 'InvalidKey', inputs: [] },
  { type: 'error', name: 'UnsupportedScheme', inputs: [{ name: 'scheme', type: 'uint8' }] },
] as const;
