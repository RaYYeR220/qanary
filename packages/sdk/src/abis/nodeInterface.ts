/** Arbitrum NodeInterface precompile (virtual, eth_call only). */
export const NODE_INTERFACE_ADDRESS = '0x00000000000000000000000000000000000000C8' as const;

export const nodeInterfaceAbi = [
  {
    type: 'function',
    name: 'gasEstimateComponents',
    stateMutability: 'payable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'contractCreation', type: 'bool' },
      { name: 'data', type: 'bytes' },
    ],
    outputs: [
      { name: 'gasEstimate', type: 'uint64' },
      { name: 'gasEstimateForL1', type: 'uint64' },
      { name: 'baseFee', type: 'uint256' },
      { name: 'l1BaseFeeEstimate', type: 'uint256' },
    ],
  },
] as const;
