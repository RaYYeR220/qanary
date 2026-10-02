/** ABI of the HotTierExecutor ERC-7579 executor module. Built by scripts/gen-abis.ts from the forge artifact; do not edit. */
export const hotTierExecutorAbi = [
  {
    "type": "function",
    "name": "HOT_OP_TYPEHASH",
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
    "name": "MAX_ASSETS",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "available",
    "inputs": [
      {
        "name": "account",
        "type": "address"
      },
      {
        "name": "asset",
        "type": "address"
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
    "type": "function",
    "name": "configure",
    "inputs": [
      {
        "name": "s",
        "type": "tuple",
        "components": [
          {
            "name": "kind",
            "type": "uint8"
          },
          {
            "name": "registry",
            "type": "address"
          },
          {
            "name": "window",
            "type": "uint32"
          },
          {
            "name": "levelBps",
            "type": "uint16[4]"
          },
          {
            "name": "signer",
            "type": "tuple",
            "components": [
              {
                "name": "family",
                "type": "uint8"
              },
              {
                "name": "eoa",
                "type": "address"
              },
              {
                "name": "pubX",
                "type": "bytes32"
              },
              {
                "name": "pubY",
                "type": "bytes32"
              }
            ]
          },
          {
            "name": "assets",
            "type": "address[]"
          },
          {
            "name": "caps",
            "type": "uint128[]"
          },
          {
            "name": "allow",
            "type": "tuple[]",
            "components": [
              {
                "name": "target",
                "type": "address"
              },
              {
                "name": "selector",
                "type": "bytes4"
              }
            ]
          }
        ]
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "effectiveBps",
    "inputs": [
      {
        "name": "account",
        "type": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint16"
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
    "name": "execute",
    "inputs": [
      {
        "name": "account",
        "type": "address"
      },
      {
        "name": "calls",
        "type": "tuple[]",
        "components": [
          {
            "name": "target",
            "type": "address"
          },
          {
            "name": "value",
            "type": "uint256"
          },
          {
            "name": "data",
            "type": "bytes"
          }
        ]
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "executeWithSig",
    "inputs": [
      {
        "name": "account",
        "type": "address"
      },
      {
        "name": "calls",
        "type": "tuple[]",
        "components": [
          {
            "name": "target",
            "type": "address"
          },
          {
            "name": "value",
            "type": "uint256"
          },
          {
            "name": "data",
            "type": "bytes"
          }
        ]
      },
      {
        "name": "deadline",
        "type": "uint256"
      },
      {
        "name": "sig",
        "type": "bytes"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "hotOpDigest",
    "inputs": [
      {
        "name": "account",
        "type": "address"
      },
      {
        "name": "calls",
        "type": "tuple[]",
        "components": [
          {
            "name": "target",
            "type": "address"
          },
          {
            "name": "value",
            "type": "uint256"
          },
          {
            "name": "data",
            "type": "bytes"
          }
        ]
      },
      {
        "name": "nonce",
        "type": "uint256"
      },
      {
        "name": "deadline",
        "type": "uint256"
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
    "name": "isAllowed",
    "inputs": [
      {
        "name": "account",
        "type": "address"
      },
      {
        "name": "target",
        "type": "address"
      },
      {
        "name": "selector",
        "type": "bytes4"
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
    "name": "nonceOf",
    "inputs": [
      {
        "name": "account",
        "type": "address"
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
    "name": "setAllowed",
    "inputs": [
      {
        "name": "target",
        "type": "address"
      },
      {
        "name": "selector",
        "type": "bytes4"
      },
      {
        "name": "allowed",
        "type": "bool"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setCap",
    "inputs": [
      {
        "name": "asset",
        "type": "address"
      },
      {
        "name": "cap",
        "type": "uint128"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setHotSigner",
    "inputs": [
      {
        "name": "signer",
        "type": "tuple",
        "components": [
          {
            "name": "family",
            "type": "uint8"
          },
          {
            "name": "eoa",
            "type": "address"
          },
          {
            "name": "pubX",
            "type": "bytes32"
          },
          {
            "name": "pubY",
            "type": "bytes32"
          }
        ]
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "trackedAssets",
    "inputs": [
      {
        "name": "account",
        "type": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "address[]"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "event",
    "name": "AllowSet",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "indexed": true
      },
      {
        "name": "target",
        "type": "address",
        "indexed": true
      },
      {
        "name": "selector",
        "type": "bytes4",
        "indexed": true
      },
      {
        "name": "allowed",
        "type": "bool",
        "indexed": false
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "CapSet",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "indexed": true
      },
      {
        "name": "asset",
        "type": "address",
        "indexed": true
      },
      {
        "name": "cap",
        "type": "uint128",
        "indexed": false
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Configured",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "indexed": true
      },
      {
        "name": "kind",
        "type": "uint8",
        "indexed": false
      },
      {
        "name": "registry",
        "type": "address",
        "indexed": false
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "EIP712DomainChanged",
    "inputs": [],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "HotOpExecuted",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "indexed": true
      },
      {
        "name": "callsHash",
        "type": "bytes32",
        "indexed": true
      },
      {
        "name": "outflows",
        "type": "uint256[]",
        "indexed": false
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "HotSignerSet",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "indexed": true
      },
      {
        "name": "family",
        "type": "uint8",
        "indexed": false
      },
      {
        "name": "eoa",
        "type": "address",
        "indexed": false
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "CallNotAllowed",
    "inputs": [
      {
        "name": "target",
        "type": "address"
      },
      {
        "name": "selector",
        "type": "bytes4"
      }
    ]
  },
  {
    "type": "error",
    "name": "CapExceeded",
    "inputs": [
      {
        "name": "asset",
        "type": "address"
      },
      {
        "name": "outflow",
        "type": "uint256"
      },
      {
        "name": "available",
        "type": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "ClassicalFamilyBroken",
    "inputs": [
      {
        "name": "family",
        "type": "uint8"
      }
    ]
  },
  {
    "type": "error",
    "name": "Expired",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ForbiddenTarget",
    "inputs": [
      {
        "name": "target",
        "type": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "HotTierFrozen",
    "inputs": [
      {
        "name": "level",
        "type": "uint8"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidSetup",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidShortString",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ModuleCallFailed",
    "inputs": [
      {
        "name": "index",
        "type": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "NotConfigured",
    "inputs": [
      {
        "name": "account",
        "type": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "ReentrancyGuardReentrantCall",
    "inputs": []
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
  },
  {
    "type": "error",
    "name": "Unauthorized",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ValueNotTracked",
    "inputs": []
  }
] as const;
