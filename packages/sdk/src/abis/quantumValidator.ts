/** ABI of the QuantumValidator ERC-7579 validator module. Built by scripts/gen-abis.ts from the forge artifact; do not edit. */
export const quantumValidatorAbi = [
  {
    "type": "function",
    "name": "ACCOUNT_MESSAGE_TYPEHASH",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "MIN_RECOVERY_DELAY",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "RECOVERY_TYPEHASH",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "accountDigest",
    "inputs": [
      {
        "name": "account",
        "type": "address"
      },
      {
        "name": "hash",
        "type": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "cancelRecovery",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "configOf",
    "inputs": [
      {
        "name": "account",
        "type": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "components": [
          {
            "name": "verifier",
            "type": "address"
          },
          {
            "name": "keyPtr",
            "type": "address"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "eip712Domain",
    "inputs": [],
    "outputs": [
      {
        "name": "fields",
        "type": "bytes1"
      },
      {
        "name": "name",
        "type": "string"
      },
      {
        "name": "version",
        "type": "string"
      },
      {
        "name": "chainId",
        "type": "uint256"
      },
      {
        "name": "verifyingContract",
        "type": "address"
      },
      {
        "name": "salt",
        "type": "bytes32"
      },
      {
        "name": "extensions",
        "type": "uint256[]"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "executeRecovery",
    "inputs": [
      {
        "name": "account",
        "type": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "guardiansOf",
    "inputs": [
      {
        "name": "account",
        "type": "address"
      }
    ],
    "outputs": [
      {
        "name": "guardians",
        "type": "bytes[]"
      },
      {
        "name": "threshold",
        "type": "uint8"
      },
      {
        "name": "delay",
        "type": "uint32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "isInitialized",
    "inputs": [
      {
        "name": "account",
        "type": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "isModuleType",
    "inputs": [
      {
        "name": "moduleTypeId",
        "type": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "pure"
  },
  {
    "type": "function",
    "name": "isValidSignatureWithSender",
    "inputs": [
      {
        "name": "",
        "type": "address"
      },
      {
        "name": "hash",
        "type": "bytes32"
      },
      {
        "name": "signature",
        "type": "bytes"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bytes4"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "onInstall",
    "inputs": [
      {
        "name": "data",
        "type": "bytes"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "onUninstall",
    "inputs": [
      {
        "name": "",
        "type": "bytes"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "pendingRecoveryOf",
    "inputs": [
      {
        "name": "account",
        "type": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "components": [
          {
            "name": "verifier",
            "type": "address"
          },
          {
            "name": "keyPtr",
            "type": "address"
          },
          {
            "name": "eta",
            "type": "uint48"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "proposeRecovery",
    "inputs": [
      {
        "name": "account",
        "type": "address"
      },
      {
        "name": "verifier",
        "type": "address"
      },
      {
        "name": "keyPtr",
        "type": "address"
      },
      {
        "name": "guardianSigs",
        "type": "bytes[]"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "recoveryDigest",
    "inputs": [
      {
        "name": "account",
        "type": "address"
      },
      {
        "name": "verifier",
        "type": "address"
      },
      {
        "name": "keyPtr",
        "type": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "rotateKey",
    "inputs": [
      {
        "name": "verifier",
        "type": "address"
      },
      {
        "name": "keyPtr",
        "type": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setGuardians",
    "inputs": [
      {
        "name": "guardians",
        "type": "bytes[]"
      },
      {
        "name": "threshold",
        "type": "uint8"
      },
      {
        "name": "delay",
        "type": "uint32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "validateUserOp",
    "inputs": [
      {
        "name": "userOp",
        "type": "tuple",
        "components": [
          {
            "name": "sender",
            "type": "address"
          },
          {
            "name": "nonce",
            "type": "uint256"
          },
          {
            "name": "initCode",
            "type": "bytes"
          },
          {
            "name": "callData",
            "type": "bytes"
          },
          {
            "name": "accountGasLimits",
            "type": "bytes32"
          },
          {
            "name": "preVerificationGas",
            "type": "uint256"
          },
          {
            "name": "gasFees",
            "type": "bytes32"
          },
          {
            "name": "paymasterAndData",
            "type": "bytes"
          },
          {
            "name": "signature",
            "type": "bytes"
          }
        ]
      },
      {
        "name": "userOpHash",
        "type": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "event",
    "name": "EIP712DomainChanged",
    "inputs": [],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "GuardiansSet",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "indexed": true
      },
      {
        "name": "count",
        "type": "uint256",
        "indexed": false
      },
      {
        "name": "threshold",
        "type": "uint8",
        "indexed": false
      },
      {
        "name": "delay",
        "type": "uint32",
        "indexed": false
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "KeyConfigured",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "indexed": true
      },
      {
        "name": "verifier",
        "type": "address",
        "indexed": false
      },
      {
        "name": "keyPtr",
        "type": "address",
        "indexed": false
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "RecoveryCancelled",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "indexed": true
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "RecoveryProposed",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "indexed": true
      },
      {
        "name": "verifier",
        "type": "address",
        "indexed": false
      },
      {
        "name": "keyPtr",
        "type": "address",
        "indexed": false
      },
      {
        "name": "eta",
        "type": "uint48",
        "indexed": false
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "AlreadyInitialized",
    "inputs": [
      {
        "name": "account",
        "type": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "InsufficientGuardianSignatures",
    "inputs": [
      {
        "name": "valid",
        "type": "uint256"
      },
      {
        "name": "threshold",
        "type": "uint8"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidGuardianConfig",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidKeyConfig",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidShortString",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NoPendingRecovery",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotInitialized",
    "inputs": [
      {
        "name": "account",
        "type": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "RecoveryNotReady",
    "inputs": [
      {
        "name": "eta",
        "type": "uint48"
      }
    ]
  },
  {
    "type": "error",
    "name": "StringTooLong",
    "inputs": [
      {
        "name": "str",
        "type": "string"
      }
    ]
  }
] as const;
