/** ABI of the DrillRegistryFactory. Built by scripts/gen-abis.ts from the forge artifact; do not edit. */
export const drillRegistryFactoryAbi = [
  {
    "type": "function",
    "name": "bountyToken",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "create",
    "inputs": [],
    "outputs": [
      {
        "name": "registry",
        "type": "address"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "ladder",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "event",
    "name": "DrillCreated",
    "inputs": [
      {
        "name": "registry",
        "type": "address",
        "indexed": true
      },
      {
        "name": "creator",
        "type": "address",
        "indexed": true
      }
    ],
    "anonymous": false
  }
] as const;
