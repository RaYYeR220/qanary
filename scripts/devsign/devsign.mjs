// Deterministic dev/test signer. NOT for production keys.
//
// Verified against the installed @noble/post-quantum@0.7.1 API before writing this file:
// - ml_dsa44 / ml_dsa65 (from ml-dsa.js): keygen(seed) takes a 32-byte seed
//   (lengths.seed === 32) and is deterministic. sign(msg, secretKey, opts) is HEDGED
//   (randomized) by default -- opts = { extraEntropy: false } is required to get a
//   reproducible signature for the same inputs.
// - Falcon (from falcon.js) exports falcon512 and falcon512padded (plus *1024 variants).
//   falcon512 produces round-3 COMPRESSED (variable-length) signatures; falcon512padded
//   produces the fixed-length round-3 PADDED format (666 bytes for Falcon-512), which is
//   what this task's CLI contract specifies ("falcon512 (round-3, padded 666-byte
//   format)") -- so the CLI scheme name "falcon512" is wired to noble's falcon512padded
//   export.
// - Falcon's keygen(seed) requires a 48-byte seed (lengths.seed === 48), not 32.
//   Since the CLI contract fixes the input as a 32-byte hex seed, the 32-byte seed is
//   expanded to 48 bytes with SHAKE256 (dkLen: 48) before being passed to
//   falcon512padded.keygen(). SHAKE256 expansion is itself deterministic, so
//   keygen/sign output stays fully reproducible from the original seedHex. Falcon's
//   sign() is also hedged by default, so extraEntropy:false is passed there too.
// - Lengths observed at the installed version match this task's expected byte counts:
//   ml_dsa44 publicKey=1312B signature=2420B; ml_dsa65 publicKey=1952B;
//   falcon512padded publicKey=897B signature=666B.
import { ml_dsa44, ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
import { falcon512padded } from '@noble/post-quantum/falcon.js';
import { shake256 } from '@noble/hashes/sha3.js';

const [,, cmd, scheme, seedHex, msgHex] = process.argv;
const hex = (u8) => Buffer.from(u8).toString('hex');
const un = (h) => Uint8Array.from(Buffer.from(h.replace(/^0x/, ''), 'hex'));

// Disable hedged/randomized signing so `sign` is reproducible for the same inputs.
const DETERMINISTIC = { extraEntropy: false };

const schemes = {
  mldsa44: { alg: ml_dsa44, expandSeed: (seed32) => seed32 },
  mldsa65: { alg: ml_dsa65, expandSeed: (seed32) => seed32 },
  // Falcon needs a 48-byte seed; deterministically expand the 32-byte CLI seed.
  falcon512: { alg: falcon512padded, expandSeed: (seed32) => shake256(seed32, { dkLen: 48 }) },
};

const entry = schemes[scheme];
if (!entry) { console.error('unknown scheme'); process.exit(2); }

const seed = entry.expandSeed(un(seedHex));
const kp = entry.alg.keygen(seed);

if (cmd === 'keygen') process.stdout.write(hex(kp.publicKey));
else if (cmd === 'sign') process.stdout.write(hex(entry.alg.sign(un(msgHex), kp.secretKey, DETERMINISTIC)));
else { console.error('usage: keygen|sign'); process.exit(2); }
