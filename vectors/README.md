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

`qanary_pq::mldsa44_verify` / `mldsa65_verify` take no context argument (the
context is fixed to the empty string), so a vector only exercises the
positive path when its `context` field is also empty; a vector signed under
a non-empty context is expected to fail verification through this crate's
API regardless of its original `testPassed` value. The test suite accounts
for this when deriving the expected result per vector.

## `falcon-r3/falcon512-KAT.rsp`

The NIST PQC round-3 Falcon-512 known-answer test vectors (`falcon512-KAT.rsp`
from the round-3 submission package), 100 (message, public key, signed
message) triples.

## `fndsa/kat_512_vk.hex`, `fndsa/kat_512_sig.hex`

A verifying key and signature from `fn-dsa-vrfy` 0.4.0's own test suite,
covering FN-DSA-512 with a non-empty domain context (`"context"`) over the
message `"message"`. Used to confirm that this crate's context handling
rejects a signature produced under a context other than the empty one it
hardcodes.

## `mldsa44.{pk,msg,sig}`, `mldsa44_devsign.{pk,msg,sig}`, `mldsa65.{pk,msg,sig}`, `falcon512_devsign.{pk,msg,sig}`

Devsign fixtures: keypair and signature generated with the repository's
`scripts/devsign/devsign.mjs` (backed by `@noble/post-quantum`) for a random
32-byte seed and message, used to cross-check this crate's verifiers against
an independent implementation.
