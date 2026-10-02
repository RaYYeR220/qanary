/** The Kernel v3.3 account functions the SDK encodes directly (module management). */
export const kernelModuleAbi = [
  {
    type: 'function',
    name: 'installModule',
    stateMutability: 'payable',
    inputs: [
      { name: 'moduleType', type: 'uint256' },
      { name: 'module', type: 'address' },
      { name: 'initData', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'isModuleInstalled',
    stateMutability: 'view',
    inputs: [
      { name: 'moduleType', type: 'uint256' },
      { name: 'module', type: 'address' },
      { name: 'additionalContext', type: 'bytes' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'rootValidator',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'bytes21' }],
  },
] as const;
