/** ABI of the content-addressed KeyStore. Built by scripts/gen-abis.ts from the forge artifact; do not edit. */
export const keyStoreAbi = [
  {
    "type": "function",
    "name": "pointerOf",
    "inputs": [
      {
        "name": "blob",
        "type": "bytes"
      }
    ],
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
    "name": "read",
    "inputs": [
      {
        "name": "pointer",
        "type": "address"
      }
    ],
    "outputs": [
      {
        "name": "blob",
        "type": "bytes"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "store",
    "inputs": [
      {
        "name": "blob",
        "type": "bytes"
      }
    ],
    "outputs": [
      {
        "name": "pointer",
        "type": "address"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "event",
    "name": "KeyStored",
    "inputs": [
      {
        "name": "pointer",
        "type": "address",
        "indexed": true
      },
      {
        "name": "scheme",
        "type": "uint8",
        "indexed": true
      },
      {
        "name": "blobHash",
        "type": "bytes32",
        "indexed": true
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "DeployFailed",
    "inputs": []
  },
  {
    "type": "error",
    "name": "EmptyBlob",
    "inputs": []
  }
] as const;
