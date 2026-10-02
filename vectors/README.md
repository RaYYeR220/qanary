# Test vectors

Fixed inputs used by `crates/qanary-pq`'s test suite. Every file is hex-encoded
(one value per file, no surrounding whitespace beyond a trailing newline)
unless noted otherwise.

## `mldsa/sigver-44.json`, `mldsa/sigver-65.json`

ML-DSA-44 / ML-DSA-65 signature-verification test vectors, extracted from the
NIST ACVP `ML-DSA-sigVer-FIPS204` demo vector set
(`usnistgov/ACVP-Server`, `gen-val/json-files/ML-DSA-sigVer-FIPS204/internalProjection.json`).
Each file keeps only the `signatureInterface: "external"`, `preHash: "pure"`
test group for its parameter set, with the original `tcId`, `pk`, `message`,
`context`, `signature`, `testPassed` and `reason` fields untouched.

Verified through `mldsa44_verify_ctx` / `mldsa65_verify_ctx` with each vector's own context; every result must equal `testPassed`.

## `falcon-r3/falcon512-KAT.rsp`

The NIST PQC round-3 Falcon-512 known-answer test vectors (`falcon512-KAT.rsp`
from the round-3 submission package), 100 (message, public key, signed
message) triples.

## `fndsa/kat_512_vk.hex`, `fndsa/kat_512_sig.hex`

A verifying key and signature from `fn-dsa-vrfy` 0.4.0's own test suite,
covering FN-DSA-512 with the domain context `"context"` over the message `"message"`; verified through `fndsa512_verify_ctx`.

## `falcon512_compressed.{pk,msg,sig}`

Falcon-512 detached compressed signature (header 0x39, variable length) produced by `@noble/post-quantum` 0.7.1 `falcon512` (non-hedged signing, key from SHAKE256-expanded 32-byte seed `90290baa7b7633551de99dcbade926845ec04639d48c5f428c4db10238df56b6`, message `e7f44d3fbddc9cf1c0b0eddb3bee00ed60f47ff2c56d1a21b4080fb0b29d65d0`). The tests also verify its 666-byte zero-padded form.

## `mldsa44.{pk,msg,sig}`, `mldsa44_devsign.{pk,msg,sig}`, `mldsa65.{pk,msg,sig}`, `falcon512_devsign.{pk,msg,sig}`

Devsign fixtures: keypair and signature generated with the repository's
`scripts/devsign/devsign.mjs` (backed by `@noble/post-quantum`) for a random
32-byte seed and message, used to cross-check this crate's verifiers against
an independent implementation.
