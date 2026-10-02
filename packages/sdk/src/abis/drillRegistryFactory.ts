/**
 * ABI of the DrillRegistryFactory (deploys canary registries over the published drill keys),
 * written from its interface. Replaced by scripts/gen-abis.ts once the forge artifact exists.
 */
export const drillRegistryFactoryAbi = [
  { type: 'function', name: 'create', stateMutability: 'nonpayable', inputs: [], outputs: [{ name: '', type: 'address' }] },
  {
    type: 'event',
    name: 'DrillCreated',
    anonymous: false,
    inputs: [
      { name: 'registry', type: 'address', indexed: true },
      { name: 'creator', type: 'address', indexed: true },
    ],
  },
] as const;
