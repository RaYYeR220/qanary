// Contents of deployments/<network>.json, embedded by scripts/gen-deployments.ts; do not edit.
export const deploymentFiles: Record<string, unknown> = {
  "arbitrum-one": {
    "network": "arbitrum-one",
    "chainId": 42161,
    "rpc": "https://arb1.arbitrum.io/rpc",
    "deployer": "0xe46b3a14790f6fb24B0067475FC4C5875d1233cA",
    "stylusActivations": "paused (Security Council, 2026-10-02): ML-DSA-44 runs on the Solidity verifier, the ladder is unavailable",
    "evm": {
      "keyStore": {
        "address": "0x12cF4EE4073d5F3E5DE8bFE6e34522cEb46854f6",
        "deployTx": "0x1657bf58ef5b7d94216f0740ccebaf1848165ce2ab3e3e0789e19cc1bd75b2ec",
        "gasUsed": 453804,
        "costWei": "9153227133804",
        "verified": "sourcify exact_match"
      },
      "quantumValidator": {
        "address": "0x0057Fcac28c7094910D563Ad31E437d78a92036a",
        "deployTx": "0x7cd5248e26f893620a1c3786d8dd458d9ba29825591e0d8ac4b3d61f1e8a8c2a",
        "gasUsed": 2434735,
        "costWei": "48787222364735",
        "verified": "sourcify exact_match"
      },
      "hotTierExecutor": {
        "address": "0xE5A6EFCEAcdBFe96593f01F7770C1163B0C631f3",
        "deployTx": "0x5762ff05a3e7be175d666fce3feddfafcbde59e4fa886256facee11295c9b94e",
        "gasUsed": 4954756,
        "costWei": "99105034466756",
        "verified": "sourcify exact_match"
      },
      "pqSafeOwnerFactory": {
        "address": "0x4Ce066c253d38bFF3012607B0D3B1B4b8E29ABA3",
        "deployTx": "0x248003b7299f22858a5567c6d4c96dcb7fea2d10a5b790a3b0aad88eb2acf5e9",
        "gasUsed": 1250913,
        "costWei": "25045781336913",
        "verified": "sourcify exact_match"
      },
      "qanaryAccountFactory": {
        "address": "0xdbEEAA8CC79A925b42A5F42f3F1bA81afC132609",
        "deployTx": "0x853da640345e70ffbbed1a9361bcade614695357fd932812e4b2ff70fa11f398",
        "gasUsed": 5743154,
        "costWei": "115150243443154",
        "verified": "sourcify exact_match"
      },
      "canaryRegistry": {
        "address": "0x4848512a663F59fA23708C1Fa2f1cEA21B888A95",
        "ladder": "0xBf33F4FE6D73fEcDE03E388f4FE985fe1d88b9D6",
        "bountyToken": "0x004B506865409877C9fA29bfb1ebA929984B9bbC",
        "deployTx": "0xa06ff3f26b825011c495d1c7966de5262e796c7a84ebeb99e49863e991c6a317",
        "gasUsed": 2125134,
        "costWei": "42557935609134",
        "verified": "sourcify exact_match"
      },
      "drillRegistryFactory": {
        "address": "0xA523899D17954a5BeE0Ee102124C458942878032",
        "ladder": "0xBf33F4FE6D73fEcDE03E388f4FE985fe1d88b9D6",
        "bountyToken": "0x004B506865409877C9fA29bfb1ebA929984B9bbC",
        "deployTx": "0xf13fdc9f34544eaf4f9a28d23cde66bf3fa5f9774a9b8665a8db3d4fde581981",
        "gasUsed": 2635092,
        "costWei": "52701842635092",
        "verified": "sourcify exact_match"
      },
      "ladderUnavailable": {
        "address": "0xBf33F4FE6D73fEcDE03E388f4FE985fe1d88b9D6",
        "deployTx": "0xb37e0ef2feec4e4def108acf0cd8ce80f4e0319c68a65f89d0269f6a7056aad0",
        "gasUsed": 108987,
        "costWei": "2179740108987",
        "verified": "sourcify exact_match"
      },
      "keccakF1600Helper": {
        "address": "0x68b5C1b28707AC3201880d59f27cFc6583D4FF8D",
        "deployTx": "0x1397a42d94b7037343b6651bffb64e9e8a6d2c7de1dd13ee20a2451a868abec2",
        "gasUsed": 4719182,
        "costWei": "94751740915182",
        "codehash": "0x4afb4435879cdf8e50474c7aab2bc3a679caed432550ad6dba64f509309a817b",
        "verified": "raw runtime (vendor/f1600_170.hex), checked by code hash"
      },
      "mldsa44VerifierCore": {
        "address": "0xf2d5c07ae3817B8bbDf57970369a6604377e588E",
        "deployTx": "0x17118eb2a6351c0bfd960d4b7675442b2bbb5384e74f5181c3e6c7c313e395ab",
        "gasUsed": 5209232,
        "costWei": "104455525273232",
        "verified": "sourcify exact_match"
      },
      "mldsa44ExpandedKeyStore": {
        "address": "0x49fdfaCaf748cbe2F9adb4cAeE50F87582CEf8f5",
        "deployTx": "0x671ac654e13d58762241f27eadafb38821325421de65bcc8d4b00b73b1ce4a02",
        "gasUsed": 1122350,
        "costWei": "22469448122350",
        "verified": "sourcify exact_match"
      },
      "mldsa44SolidityVerifier": {
        "address": "0xc9C7B3B71f4A3451adeb29604bd8eA789F3F2EfE",
        "deployTx": "0xe9aedfd48a270a5b90bd12e0ec3e93ab8083c4dd46b6a2ae4d2ba4bde617cc75",
        "gasUsed": 840339,
        "costWei": "16815184230339",
        "verified": "sourcify exact_match"
      }
    },
    "nonceAlignment": {
      "note": "empty self-transfers that align the deployer nonce with ApeChain, so the shared contracts have the same addresses",
      "txs": [
        "0x4b073b25c181da490e208163cc8bcea1d6ee4758bed1cec263af16a66244eaa1",
        "0xc532fafaac46868c6e62a77bc6c5ff99ff8b297f26bf4f88e3641411a89efd58",
        "0xa495df5f25739834d1bfafb4fcd1f16664313725767518d77da80f578699e5c4",
        "0x5e70f8e11e012ae895f4b107b37e4d2cce13bab22fe251428d47ba542efb89f1",
        "0xd20c1a5681a1f51cf400082d8b7de4cd5c91f00fe0168fe6da8bed758ebc619a",
        "0x4c67e59f79b578609073c75674ffc2885abc69577e4dc42c9feb65b9b3baf0ff",
        "0x2a60f282972b7118517bc1948ba0a7fc21281392eefdfc4034dd3214338585a3",
        "0x2699d1cb3db254968fef80225beb05d25acca72d83a4db28ba0e8bf0125cabbb"
      ]
    },
    "e2e": {
      "sdk": {
        "rootKey": "aws-kms-ml-dsa-44",
        "rootKeyPointer": "0xdb5CE807C92901e2a08ad2Eb6f231e3123889B5C",
        "storeKeyTx": "0xc523e78ac3248664fc5d89dc215f3942851df258552b856ef4d4d2e07f33f5b8",
        "prepareKeyTx": "0x0fb1bbaae742df92c9b2428ff07fdad036a5dd4be7bd3144794ed6b3244d20bd",
        "kernelIndex": "1791025745689",
        "kernelAccount": "0xA3d2E874C2643B53b166DCB94073A7AD621BEbEe",
        "fundAccountTx": "0x1e4c75a813e8de0e7511961c7b1222e7e1ee0ee90d7bde34bac0d6eccf934ece",
        "pqUserOpHash": "0x70bdc7168839dca3068aa6f86168d7ee8ec6eb4f5229aa704145022714caa364",
        "pqUserOpTx": "0x0b989fed5457af04e827e254f9afae443d411efeb80baa575c89360fb95d6d0c",
        "pqTransferUserOpHash": "0xee112444979fb4f15ad6f3f5842551f4c322a5447b2781de6e37db5008da481b",
        "pqTransferTx": "0xa1f717c83ee25aad554aac6b33fc4e5a868c8e8386d594ec464c9ab6182cd821",
        "hotKey": "0x6af103367E898049c59BE75b336eE04Bb7CEDdeC",
        "hotCapWei": "2000000000000",
        "installHotTierUserOpHash": "0x92e67f3ea4607a40443e9b66a221a9120b8cd398bd0071ff04361f3b1d41fd93",
        "installHotTierTx": "0xb6c838feb81a0d98f8d746909b4835491b4bc65b9464f88debc53d1ab3defc60",
        "hotTransferTx": "0x8e9069521f3cdf405b59ad37aaab0d442ce0c61c8ba5575e6b0c141697910a82",
        "hotOverCapError": "CapExceeded(0x0000000000000000000000000000000000000000, 2000000000001, 1000555555555)",
        "hotOverCapRevertTx": "0xe2b477f0c523117b83aababbd3cc2d1688105bc1cc5a138428774bee975fd1dd",
        "tamperedSigError": "FailedOp(0, AA24 signature error)",
        "tamperedSigRevertTx": "0x601c02aaa9be012cd633c44ac7da30a151febe337f7b22461946b19f9e0ba41b",
        "drillRegistry": "0xd73Eb697C4762AC8a8ED01dFb6db0C2b8e80B0C0",
        "drillRegistryTx": "0xbc2fd75b891fc886042b304cdaa70ce8d632fe380ed6812708c2c4e5fbda01fd",
        "repointHotTierUserOpHash": "0xb55471a43af73f46193c9553876cf8676e8374fb2f196545195cad3d81d7668a",
        "repointHotTierTx": "0x082ff00cd140d6355058b439cd3f77203e3939502a33c5b7a5d18f51a79a9cd6",
        "effectiveBpsBeforeTrip": 10000,
        "ladderL1Error": "LadderUnavailable()",
        "ladderL1RevertTx": "0x7d453419b345b764ab3d58b8a02f50a9ec2bf4c75493a6bcc6aff6e89e4bf7c4",
        "drillClaimTx": "0x08f2ff7868afa9b8dd6c04ed91640867b18214e8696a3dd0d2c62b322bd75ceb",
        "ladderLevelAfterTrip": 3,
        "effectiveBpsAfterTrip": 0,
        "postTripError": "ClassicalFamilyBroken(0)",
        "postTripHotRevertTx": "0xab822abc17b0c02edc4b1396a1b3e2c726fbecede7670d8c6068d48bb8bf0bd6",
        "erc1271Hash": "0x3f32e8dc1b744dd4630f93ae154d6dd9788ac061922e8fd29c2b44d64c6e1367",
        "erc1271Result": "0x1626ba7e",
        "erc1271OtherHashResult": "0xffffffff",
        "ranAt": "2026-10-03T11:09:43.569Z"
      }
    }
  },
  "apechain": {
    "network": "apechain",
    "chainId": 33139,
    "rpc": "https://rpc.apechain.com/http",
    "deployer": "0xe46b3a14790f6fb24B0067475FC4C5875d1233cA",
    "arbos": 51,
    "stylusVersion": 2,
    "toolchain": {
      "image": "qanary/stylus:0.10.9",
      "cargoStylus": "0.10.9",
      "rust": "1.95.0"
    },
    "stylus": {
      "mldsa44Verifier": {
        "address": "0x38Fc3687363F1A69cc7B07b79F54DeBF885f23e1",
        "deployTx": "0xa0dc679c19606a321b767e0d258dd8a8564ac8475827d6baf5f335ac82d5069a",
        "activationTx": "0x2c5e12291ba8f81d2972754479724cebffbc864cacc55a98da7e1c6667743993",
        "sizeBytes": 15933,
        "dataFeeWei": "86780773239342",
        "codehash": "0x201ad0bf7a8e7600a3acd5e074da07d95ce979292043611bb2740a2941f61259",
        "programVersion": 2,
        "deployGasUsed": 3498864,
        "activationGasUsed": 3350590,
        "costWei": "696558167986279342",
        "verifyCallGas": 207646,
        "verify": {
          "fixture": "vectors/mldsa44.{pk,msg,sig}, key 0x02||pk",
          "result": "0x024ad318",
          "wrongHashResult": "0xffffffff",
          "gas": 207646
        }
      },
      "mldsa65Verifier": {
        "address": "0x187551ed28f6a105953aABb163AF6cd53f75C197",
        "deployTx": "0x977c491e9b2053c376743f84ef3b483c0a505c06b52e592191be4643d9ddda50",
        "activationTx": "0x4b4ed446e226f5858913de2798c9b608ae99f15467c291f3b90df29cbddf2951",
        "sizeBytes": 15885,
        "dataFeeWei": "87732466153637",
        "codehash": "0xbfc9508ef9d9ac8d474043cab7a957ac9438270a15f2b0e85d5cea40e4eb2078",
        "programVersion": 2,
        "deployGasUsed": 3488627,
        "activationGasUsed": 3413450,
        "costWei": "701909971558673637",
        "verifyCallGas": 289315,
        "verify": {
          "fixture": "vectors/mldsa65.{pk,msg,sig}, key 0x03||pk",
          "result": "0x024ad318",
          "wrongHashResult": "0xffffffff",
          "gas": 289315
        }
      },
      "falcon512Verifier": {
        "address": "0x051736a3cD6AC6eA5Bc062E0B964eA6279f7cbA3",
        "deployTx": "0x6d5a795272dac75956373f19b3218bd2872557994c9706e2a5f9458dbff0be15",
        "activationTx": "0x777566fb63116846c3fa3d41aa6462c3ab94515175325a2cc0ef2ebe5efb4b70",
        "sizeBytes": 17166,
        "dataFeeWei": "78626391170676",
        "codehash": "0xc7fbdd88082c4af3d953a95a0dd9262ea9f5a73565c3f9c689d900c53048e4e8",
        "programVersion": 2,
        "deployGasUsed": 3765640,
        "activationGasUsed": 2919558,
        "costWei": "679848010177650676",
        "verifyCallGas": 97541,
        "verify": {
          "fixture": "vectors/falcon512_devsign.{pk,msg,sig}, key 0x04||pk",
          "result": "0x024ad318",
          "wrongHashResult": "0xffffffff",
          "gas": 97541,
          "fndsa512": {
            "fixture": "vectors/fndsa512.{pk,msg,sig}, key 0x01||pk",
            "result": "0x024ad318",
            "gas": 98662
          }
        }
      },
      "ladderVerifier": {
        "address": "0x7DEAe8711B07004017CcAFd71b64F3b944E8DC4F",
        "deployTx": "0x18cec8d5827132b51d012764caf8e53e79b19487186f110cd2aad92a03218934",
        "activationTx": "0x8c267e1b446938252bbb194de47b19c0be419bf0f0fb2453890e7d3be9c42916",
        "sizeBytes": 16546,
        "dataFeeWei": "80320249732800",
        "codehash": "0x02e2af64dbea10201ef6918b0540dfcb9baa88c6c22a818c7daffe314ee48e32",
        "programVersion": 2,
        "deployGasUsed": 3631511,
        "activationGasUsed": 3011498,
        "costWei": "675559810074572800",
        "verifyCallGas": 828518,
        "verify": {
          "fixture": "vectors/ladder/{secp160r1,p192,p224}.json (first valid vector)",
          "result": true,
          "tamperedResult": false,
          "gasByCurve": {
            "secp160r1": 828518,
            "p192": 959401,
            "p224": 1152888
          }
        }
      }
    },
    "evm": {
      "keyStore": {
        "address": "0x12cF4EE4073d5F3E5DE8bFE6e34522cEb46854f6",
        "deployTx": "0x4611a987cc91ade2b43f003ecfd183cb4ecf44cf18cfe8092d78ec075515c352",
        "gasUsed": 452984,
        "costWei": "46060663355840000",
        "verified": "sourcify exact_match"
      },
      "quantumValidator": {
        "address": "0x0057Fcac28c7094910D563Ad31E437d78a92036a",
        "deployTx": "0x83a662a96d012536fccc04e10fc3b6c42a627edf82508e39a3a5fad080737844",
        "gasUsed": 2430228,
        "costWei": "247112290469280000",
        "verified": "sourcify exact_match"
      },
      "hotTierExecutor": {
        "address": "0xE5A6EFCEAcdBFe96593f01F7770C1163B0C631f3",
        "deployTx": "0xb4e1bbb147a1a4311fc1aa3d693f33be2ef8120c39c89995bf684170a15b326a",
        "gasUsed": 4946452,
        "costWei": "502968891567520000",
        "verified": "sourcify exact_match"
      },
      "pqSafeOwnerFactory": {
        "address": "0x4Ce066c253d38bFF3012607B0D3B1B4b8E29ABA3",
        "deployTx": "0x0e5bba76af71954f43de042f53ff2078c94e60df3a79776b1035a73449977362",
        "gasUsed": 1248718,
        "costWei": "126973092701680000",
        "verified": "sourcify exact_match"
      },
      "qanaryAccountFactory": {
        "address": "0xdbEEAA8CC79A925b42A5F42f3F1bA81afC132609",
        "deployTx": "0xff925afb3b695beb2117c4100982af3d1b18b62e61636efd4383c182be5c68fe",
        "gasUsed": 5734781,
        "costWei": "583128360075560000",
        "verified": "sourcify exact_match"
      },
      "canaryRegistry": {
        "address": "0x4848512a663F59fA23708C1Fa2f1cEA21B888A95",
        "ladder": "0x7DEAe8711B07004017CcAFd71b64F3b944E8DC4F",
        "bountyToken": "0x0000000000000000000000000000000000000000",
        "deployTx": "0xe9f18e0a017f13a122ba54cc70a4db001eaf3cbbd1cffe6d50df7a1e5bd37aa8",
        "gasUsed": 2120751,
        "costWei": "215643814952760000",
        "verified": "sourcify exact_match"
      },
      "drillRegistryFactory": {
        "address": "0xA523899D17954a5BeE0Ee102124C458942878032",
        "ladder": "0x7DEAe8711B07004017CcAFd71b64F3b944E8DC4F",
        "bountyToken": "0x0000000000000000000000000000000000000000",
        "deployTx": "0x527999314b7514692ada5c45ee3a6bed93bbdae59b9c8d9a6de9cf82f4d34bd7",
        "gasUsed": 2630247,
        "costWei": "267450774441720000",
        "verified": "sourcify exact_match"
      }
    },
    "e2e": {
      "sdk": {
        "rootKey": "aws-kms-ml-dsa-44",
        "rootKeyPointer": "0xdb5CE807C92901e2a08ad2Eb6f231e3123889B5C",
        "storeKeyTx": "0x3e144806b0d5807e34cbb2b1a2591b0c0f59d2fb686ea96564a5b7e7cb1886e8",
        "kernelIndex": "1791025446486",
        "kernelAccount": "0x32D09d174725388116C3fB997262AA0D3944A958",
        "fundAccountTx": "0x38a4e788bbe2814d28c5e2fb4adcef19b2d880b816a992980d925a229ec3eb0a",
        "pqUserOpHash": "0xb81912c38d65c3a902e431f9a900a86f7fee9e1e9487855668dda9c90d52251a",
        "pqUserOpTx": "0x819119f9af3b4f684fd46be95f7b32b4f435285a53f0cf29d79d0c6910015801",
        "pqTransferUserOpHash": "0xe77d4bf404592529b7b980d48d1d56544a21dcdb1edaefa36d579dffede933a5",
        "pqTransferTx": "0xc60a9ac330f5417e156d5c75e2754aad7bc573bedc0e5c42a41b27542a614f2e",
        "hotKey": "0x1843da7839e800b01241be694dA2AE7695D00AEb",
        "hotCapWei": "2000000000000000",
        "installHotTierUserOpHash": "0x7b3efc1ae15c9adeeac86e908426c8f77ecbabae424cffc54b74a6cb71f1b3ed",
        "installHotTierTx": "0xb732c41ac6fcf17e22cf39ea5d371dd9a20b7debe236b998666ad78a16740a9c",
        "hotTransferTx": "0x16b86ab6745cbfd03e0dfc6fdfc26f54e0434a9741fb5af5bfcbc17ee8b368f3",
        "hotOverCapError": "CapExceeded(0x0000000000000000000000000000000000000000, 2000000000000001, 1000000000000000)",
        "hotOverCapRevertTx": "0x95f55ce2439bba0f8c20696874a71893c855bc46dd4da6f1958c208930545db4",
        "tamperedSigError": "FailedOp(0, AA24 signature error)",
        "tamperedSigRevertTx": "0x28bfb6b686a638660a23fea20e7267dcc03c4ee36e0a7fac022cdd4d546351db",
        "drillRegistry": "0xd73Eb697C4762AC8a8ED01dFb6db0C2b8e80B0C0",
        "drillRegistryTx": "0x448be332520746d968ce427044340ebf3c3127df9ef0071b8bfd7710abbb222a",
        "repointHotTierUserOpHash": "0x203a979534f51994f47c83f8d1e5267d2a43e7284ea0311f53784884727c87af",
        "repointHotTierTx": "0xf0d476e1ee7d109c11af52bd94b7ed4e7c4e02af961cd60b79b1fd9ff46d7bfe",
        "effectiveBpsBeforeTrip": 10000,
        "ladderL1ClaimTx": "0x5eb595c6f188135e43c0d914c96a7e9d2708d8d4ce0ae33b92afa9bd210a8b83",
        "ladderLevelAfterL1": 1,
        "effectiveBpsAfterL1": 5000,
        "drillClaimTx": "0x417d49ae8e07749155f85003995adf34282d47c62aede8cdb91d99cb923813bd",
        "ladderLevelAfterTrip": 3,
        "effectiveBpsAfterTrip": 0,
        "postTripError": "ClassicalFamilyBroken(0)",
        "postTripHotRevertTx": "0x45404f06fc5c1a284f332d517760dcec0bd09fdc0f72ca7a319a4d68fe8ad3ad",
        "erc1271Hash": "0x6625d9660fd3d7c9d1122aefd96b751ac0493a956cb8a6045ef74fb70fac0ffd",
        "erc1271Result": "0x1626ba7e",
        "erc1271OtherHashResult": "0xffffffff",
        "mnemonicKeyPointer": "0xE913AaC996B4A14049D37a1C652470877917F985",
        "mnemonicStoreKeyTx": "0x5c78b4344dfffa12e25de67b0a5d42af12dc9c7b54263e34e0523c816d38209d",
        "mnemonicKernelIndex": "1791025478366",
        "mnemonicKernelAccount": "0x399Cc157a748E0a48fDabFCc176fB818e8b32B6c",
        "mnemonicFundTx": "0xe30537bf1c37b9b83f0d823da3af0bc30d51cff977bc38b8dfedd53f8eafdb3d",
        "mnemonicUserOpHash": "0x4b9d518196963e12dc76d48c27f50caddfc3d8f7defc2c176ee6b2377633f2f7",
        "mnemonicUserOpTx": "0xa9e7a1f8535315c006c7223b96363a6363d8fec13e3257407f03f2da727e903b",
        "falconKeyPointer": "0xD8e7227Fca1F866f29Eed1D36cbc265BBd69e341",
        "falconStoreKeyTx": "0xa81905474d181a09a65541cb8329fca4d68844483818e35c19cad71a25fe1685",
        "falconKernelIndex": "1791025485018",
        "falconKernelAccount": "0xcF36878841001225392edcbe1d2d18f5d0b90AC4",
        "falconFundTx": "0xb0b871cd5c64b4e84029f527e379672fc037df5167b12d7a16e271303f68da52",
        "falconUserOpHash": "0x6805a708dc98d8dbf4d79658ce75055f9812f8ac5278390e38c7c5016e8d748e",
        "falconUserOpTx": "0xbfc7de527f0bcd019e7a4655db34decd6870473a4756dca52d5c464fa63f1fba",
        "ranAt": "2026-10-03T11:04:49.284Z"
      }
    }
  },
  "apechain-curtis": {
    "network": "apechain-curtis",
    "chainId": 33111,
    "rpc": "https://curtis.rpc.caldera.xyz/http",
    "deployer": "0xe46b3a14790f6fb24B0067475FC4C5875d1233cA",
    "arbos": 32,
    "stylusVersion": 2,
    "toolchain": {
      "image": "qanary/stylus:0.10.9",
      "cargoStylus": "0.10.9",
      "rust": "1.95.0"
    },
    "stylus": {
      "mldsa44Verifier": {
        "address": "0x38Fc3687363F1A69cc7B07b79F54DeBF885f23e1",
        "deployTx": "0xee215e4aedea7eff1c3e800302cde17fa900fd8319557b06d2ba899d5860d236",
        "activationTx": "0x307713de90d035c5a141e0bdb13b0e985e1a5fdfaaf342728d7859f51eace8f5",
        "sizeBytes": 15933,
        "dataFeeWei": "86780773239342",
        "codehash": "0x201ad0bf7a8e7600a3acd5e074da07d95ce979292043611bb2740a2941f61259",
        "programVersion": 2,
        "deployGasUsed": 3498410,
        "activationGasUsed": 3350586,
        "costWei": "696511597282199342",
        "verifyCallGas": 207519,
        "verify": {
          "fixture": "vectors/mldsa44.{pk,msg,sig}, key 0x02||pk",
          "result": "0x024ad318",
          "wrongHashResult": "0xffffffff",
          "gas": 207519
        }
      }
    }
  },
  "arbitrum-sepolia": null
};
