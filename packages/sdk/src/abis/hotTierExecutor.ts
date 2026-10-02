/**
 * ABI of the HotTierExecutor ERC-7579 executor module, written from its interface. Replaced by
 * scripts/gen-abis.ts once the contract's forge artifact exists.
 */

const call = {
  name: 'calls',
  type: 'tuple[]',
  components: [
    { name: 'target', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'data', type: 'bytes' },
  ],
} as const;

const hotSigner = {
  name: 'signer',
  type: 'tuple',
  components: [
    { name: 'family', type: 'uint8' },
    { name: 'eoa', type: 'address' },
    { name: 'pubX', type: 'bytes32' },
    { name: 'pubY', type: 'bytes32' },
  ],
} as const;

const setup = {
  name: 's',
  type: 'tuple',
  components: [
    { name: 'kind', type: 'uint8' },
    { name: 'registry', type: 'address' },
    { name: 'window', type: 'uint32' },
    { name: 'levelBps', type: 'uint16[4]' },
    hotSigner,
    { name: 'assets', type: 'address[]' },
    { name: 'caps', type: 'uint128[]' },
    {
      name: 'allow',
      type: 'tuple[]',
      components: [
        { name: 'target', type: 'address' },
        { name: 'selector', type: 'bytes4' },
      ],
    },
  ],
} as const;

export const hotTierExecutorAbi = [
  { type: 'function', name: 'onInstall', stateMutability: 'nonpayable', inputs: [{ name: 'data', type: 'bytes' }], outputs: [] },
  { type: 'function', name: 'onUninstall', stateMutability: 'nonpayable', inputs: [{ name: '', type: 'bytes' }], outputs: [] },
  {
    type: 'function',
    name: 'isModuleType',
    stateMutability: 'pure',
    inputs: [{ name: 'moduleTypeId', type: 'uint256' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'isInitialized',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  { type: 'function', name: 'configure', stateMutability: 'nonpayable', inputs: [setup], outputs: [] },
  {
    type: 'function',
    name: 'setAllowed',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'target', type: 'address' },
      { name: 'selector', type: 'bytes4' },
      { name: 'allowed', type: 'bool' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'setCap',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'asset', type: 'address' },
      { name: 'cap', type: 'uint128' },
    ],
    outputs: [],
  },
  { type: 'function', name: 'setHotSigner', stateMutability: 'nonpayable', inputs: [hotSigner], outputs: [] },
  {
    type: 'function',
    name: 'execute',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'account', type: 'address' }, call],
    outputs: [],
  },
  {
    type: 'function',
    name: 'executeWithSig',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'account', type: 'address' },
      call,
      { name: 'deadline', type: 'uint256' },
      { name: 'sig', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'hotOpDigest',
    stateMutability: 'view',
    inputs: [
      { name: 'account', type: 'address' },
      call,
      { name: 'nonce', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bytes32' }],
  },
  {
    type: 'function',
    name: 'nonceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'available',
    stateMutability: 'view',
    inputs: [
      { name: 'account', type: 'address' },
      { name: 'asset', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'isAllowed',
    stateMutability: 'view',
    inputs: [
      { name: 'account', type: 'address' },
      { name: 'target', type: 'address' },
      { name: 'selector', type: 'bytes4' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'trackedAssets',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'address[]' }],
  },
  {
    type: 'function',
    name: 'effectiveBps',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint16' }],
  },
  { type: 'function', name: 'HOT_OP_TYPEHASH', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'bytes32' }] },
  { type: 'function', name: 'MAX_ASSETS', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  {
    type: 'event',
    name: 'Configured',
    anonymous: false,
    inputs: [
      { name: 'account', type: 'address', indexed: true },
      { name: 'kind', type: 'uint8', indexed: false },
      { name: 'registry', type: 'address', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'AllowSet',
    anonymous: false,
    inputs: [
      { name: 'account', type: 'address', indexed: true },
      { name: 'target', type: 'address', indexed: true },
      { name: 'selector', type: 'bytes4', indexed: true },
      { name: 'allowed', type: 'bool', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'CapSet',
    anonymous: false,
    inputs: [
      { name: 'account', type: 'address', indexed: true },
      { name: 'asset', type: 'address', indexed: true },
      { name: 'cap', type: 'uint128', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'HotSignerSet',
    anonymous: false,
    inputs: [
      { name: 'account', type: 'address', indexed: true },
      { name: 'family', type: 'uint8', indexed: false },
      { name: 'eoa', type: 'address', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'HotOpExecuted',
    anonymous: false,
    inputs: [
      { name: 'account', type: 'address', indexed: true },
      { name: 'callsHash', type: 'bytes32', indexed: true },
      { name: 'outflows', type: 'uint256[]', indexed: false },
    ],
  },
  { type: 'error', name: 'NotConfigured', inputs: [{ name: 'account', type: 'address' }] },
  { type: 'error', name: 'InvalidSetup', inputs: [] },
  { type: 'error', name: 'Unauthorized', inputs: [] },
  { type: 'error', name: 'Expired', inputs: [] },
  { type: 'error', name: 'ClassicalFamilyBroken', inputs: [{ name: 'family', type: 'uint8' }] },
  { type: 'error', name: 'HotTierFrozen', inputs: [{ name: 'level', type: 'uint8' }] },
  { type: 'error', name: 'ForbiddenTarget', inputs: [{ name: 'target', type: 'address' }] },
  {
    type: 'error',
    name: 'CallNotAllowed',
    inputs: [
      { name: 'target', type: 'address' },
      { name: 'selector', type: 'bytes4' },
    ],
  },
  { type: 'error', name: 'ValueNotTracked', inputs: [] },
  {
    type: 'error',
    name: 'CapExceeded',
    inputs: [
      { name: 'asset', type: 'address' },
      { name: 'outflow', type: 'uint256' },
      { name: 'available', type: 'uint256' },
    ],
  },
  { type: 'error', name: 'ModuleCallFailed', inputs: [{ name: 'index', type: 'uint256' }] },
] as const;
