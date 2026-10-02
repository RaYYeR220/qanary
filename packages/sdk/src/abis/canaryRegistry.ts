/** ABI of the QuantumCanaryRegistry. Built by scripts/gen-abis.ts from the forge artifact; do not edit. */
export const canaryRegistryAbi = [
  {
    "type": "function",
    "name": "CLAIM_DOMAIN",
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
    "name": "bounty",
    "inputs": [
      {
        "name": "target",
        "type": "uint8"
      }
    ],
    "outputs": [
      {
        "name": "tokenAmount",
        "type": "uint256"
      },
      {
        "name": "ethAmount",
        "type": "uint256"
      }
    ],
    "stateMutability": "view"
  },
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
    "name": "claim",
    "inputs": [
      {
        "name": "target",
        "type": "uint8"
      },
      {
        "name": "proof",
        "type": "bytes"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "claimMessage",
    "inputs": [
      {
        "name": "target",
        "type": "uint8"
      },
      {
        "name": "claimant",
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
    "name": "claimed",
    "inputs": [
      {
        "name": "target",
        "type": "uint8"
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
    "name": "familyBroken",
    "inputs": [
      {
        "name": "family",
        "type": "uint8"
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
    "name": "fund",
    "inputs": [
      {
        "name": "target",
        "type": "uint8"
      },
      {
        "name": "amount",
        "type": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "fundETH",
    "inputs": [
      {
        "name": "target",
        "type": "uint8"
      }
    ],
    "outputs": [],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "isDrill",
    "inputs": [],
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
    "type": "function",
    "name": "ladderLevel",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint8"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "owedEth",
    "inputs": [
      {
        "name": "claimant",
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
    "name": "owedToken",
    "inputs": [
      {
        "name": "claimant",
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
    "name": "targets",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "components": [
          {
            "name": "l1x",
            "type": "bytes32"
          },
          {
            "name": "l1y",
            "type": "bytes32"
          },
          {
            "name": "l2x",
            "type": "bytes32"
          },
          {
            "name": "l2y",
            "type": "bytes32"
          },
          {
            "name": "l3x",
            "type": "bytes32"
          },
          {
            "name": "l3y",
            "type": "bytes32"
          },
          {
            "name": "k1",
            "type": "address"
          },
          {
            "name": "r1x",
            "type": "bytes32"
          },
          {
            "name": "r1y",
            "type": "bytes32"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "withdrawOwed",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "event",
    "name": "Claimed",
    "inputs": [
      {
        "name": "target",
        "type": "uint8",
        "indexed": true
      },
      {
        "name": "claimant",
        "type": "address",
        "indexed": true
      },
      {
        "name": "tokenBounty",
        "type": "uint256",
        "indexed": false
      },
      {
        "name": "ethBounty",
        "type": "uint256",
        "indexed": false
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "FamilyBroken",
    "inputs": [
      {
        "name": "family",
        "type": "uint8",
        "indexed": true
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Funded",
    "inputs": [
      {
        "name": "target",
        "type": "uint8",
        "indexed": true
      },
      {
        "name": "funder",
        "type": "address",
        "indexed": true
      },
      {
        "name": "tokenAmount",
        "type": "uint256",
        "indexed": false
      },
      {
        "name": "ethAmount",
        "type": "uint256",
        "indexed": false
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "LevelRaised",
    "inputs": [
      {
        "name": "previous",
        "type": "uint8",
        "indexed": false
      },
      {
        "name": "current",
        "type": "uint8",
        "indexed": false
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "OwedWithdrawn",
    "inputs": [
      {
        "name": "claimant",
        "type": "address",
        "indexed": true
      },
      {
        "name": "tokenAmount",
        "type": "uint256",
        "indexed": false
      },
      {
        "name": "ethAmount",
        "type": "uint256",
        "indexed": false
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "PayoutDeferred",
    "inputs": [
      {
        "name": "claimant",
        "type": "address",
        "indexed": true
      },
      {
        "name": "tokenAmount",
        "type": "uint256",
        "indexed": false
      },
      {
        "name": "ethAmount",
        "type": "uint256",
        "indexed": false
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "AlreadyClaimed",
    "inputs": [
      {
        "name": "target",
        "type": "uint8"
      }
    ]
  },
  {
    "type": "error",
    "name": "EthWithdrawFailed",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidProof",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidTarget",
    "inputs": [
      {
        "name": "target",
        "type": "uint8"
      }
    ]
  },
  {
    "type": "error",
    "name": "NonCanonicalTargets",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NothingOwed",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ReentrancyGuardReentrantCall",
    "inputs": []
  },
  {
    "type": "error",
    "name": "SafeERC20FailedOperation",
    "inputs": [
      {
        "name": "token",
        "type": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "TokenBountiesDisabled",
    "inputs": []
  }
] as const;
