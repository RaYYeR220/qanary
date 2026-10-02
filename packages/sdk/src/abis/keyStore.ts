/** ABI of the content-addressed KeyStore (`contracts/evm/src/KeyStore.sol`). */
export const keyStoreAbi = [
  {
    type: 'function',
    name: 'store',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'blob', type: 'bytes' }],
    outputs: [{ name: 'pointer', type: 'address' }],
  },
  {
    type: 'function',
    name: 'pointerOf',
    stateMutability: 'view',
    inputs: [{ name: 'blob', type: 'bytes' }],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'read',
    stateMutability: 'view',
    inputs: [{ name: 'pointer', type: 'address' }],
    outputs: [{ name: 'blob', type: 'bytes' }],
  },
  {
    type: 'event',
    name: 'KeyStored',
    anonymous: false,
    inputs: [
      { name: 'pointer', type: 'address', indexed: true },
      { name: 'scheme', type: 'uint8', indexed: true },
      { name: 'blobHash', type: 'bytes32', indexed: true },
    ],
  },
  { type: 'error', name: 'EmptyBlob', inputs: [] },
  { type: 'error', name: 'DeployFailed', inputs: [] },
] as const;
