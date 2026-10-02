/**
 * ABI of the QuantumCanaryRegistry, written from `IQuantumCanaryRegistry`. Replaced by
 * scripts/gen-abis.ts once the contract's forge artifact exists.
 */
export const canaryRegistryAbi = [
  { type: 'function', name: 'ladderLevel', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint8' }] },
  {
    type: 'function',
    name: 'familyBroken',
    stateMutability: 'view',
    inputs: [{ name: 'family', type: 'uint8' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'claimed',
    stateMutability: 'view',
    inputs: [{ name: 'target', type: 'uint8' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'claimMessage',
    stateMutability: 'view',
    inputs: [
      { name: 'target', type: 'uint8' },
      { name: 'claimant', type: 'address' },
    ],
    outputs: [{ name: '', type: 'bytes32' }],
  },
  {
    type: 'function',
    name: 'claim',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'target', type: 'uint8' },
      { name: 'proof', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'fund',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'target', type: 'uint8' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
  { type: 'function', name: 'fundETH', stateMutability: 'payable', inputs: [{ name: 'target', type: 'uint8' }], outputs: [] },
  {
    type: 'function',
    name: 'bounty',
    stateMutability: 'view',
    inputs: [{ name: 'target', type: 'uint8' }],
    outputs: [
      { name: 'tokenAmount', type: 'uint256' },
      { name: 'ethAmount', type: 'uint256' },
    ],
  },
  { type: 'function', name: 'isDrill', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'bool' }] },
  {
    type: 'function',
    name: 'targets',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'l1x', type: 'bytes32' },
          { name: 'l1y', type: 'bytes32' },
          { name: 'l2x', type: 'bytes32' },
          { name: 'l2y', type: 'bytes32' },
          { name: 'l3x', type: 'bytes32' },
          { name: 'l3y', type: 'bytes32' },
          { name: 'k1', type: 'address' },
          { name: 'r1x', type: 'bytes32' },
          { name: 'r1y', type: 'bytes32' },
        ],
      },
    ],
  },
  {
    type: 'event',
    name: 'Claimed',
    anonymous: false,
    inputs: [
      { name: 'target', type: 'uint8', indexed: true },
      { name: 'claimant', type: 'address', indexed: true },
      { name: 'tokenBounty', type: 'uint256', indexed: false },
      { name: 'ethBounty', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'LevelRaised',
    anonymous: false,
    inputs: [
      { name: 'previous', type: 'uint8', indexed: false },
      { name: 'current', type: 'uint8', indexed: false },
    ],
  },
  { type: 'event', name: 'FamilyBroken', anonymous: false, inputs: [{ name: 'family', type: 'uint8', indexed: true }] },
  {
    type: 'event',
    name: 'Funded',
    anonymous: false,
    inputs: [
      { name: 'target', type: 'uint8', indexed: true },
      { name: 'funder', type: 'address', indexed: true },
      { name: 'tokenAmount', type: 'uint256', indexed: false },
      { name: 'ethAmount', type: 'uint256', indexed: false },
    ],
  },
  { type: 'error', name: 'InvalidTarget', inputs: [{ name: 'target', type: 'uint8' }] },
  { type: 'error', name: 'AlreadyClaimed', inputs: [{ name: 'target', type: 'uint8' }] },
  { type: 'error', name: 'InvalidProof', inputs: [] },
  { type: 'error', name: 'TokenBountiesDisabled', inputs: [] },
] as const;
