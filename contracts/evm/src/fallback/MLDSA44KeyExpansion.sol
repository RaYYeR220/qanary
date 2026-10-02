// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {f1600Fast170, shake256Batch170} from "evm-ml-dsa-verifier/FastKeccak170.sol";

/// @title MLDSA44KeyExpansion
/// @notice Expands a FIPS 204 ML-DSA-44 public key on-chain into the 20,544-byte payload the
///         `MLDSA44Verifier` core (lib/evm-ml-dsa-verifier) reads with EXTCODECOPY:
///           [    0,    64)  tr    = SHAKE256(pk, 64)
///           [   64,  4160)  t1hat = NTT(2^13 * t1), 4 polynomials
///           [ 4160, 20544)  Ahat  = ExpandA(rho), 16 polynomials, row-major (i * 4 + j)
///         Each polynomial is 32 words; word w holds coefficients 8w..8w+7, coefficient 8w+s in
///         bits [32s, 32s + 32). Every coefficient is canonical (< q). This is byte-for-byte the
///         payload of the upstream `prepare/prepare.py` (pinned in `vectors/mldsa/prepared-44.json`).
/// @dev Runs once per key, at registration, never during verification. SHAKE-128/256 use the
///      Keccak-f[1600] helper the core is bound to (`f1600Fast170`: 25 clean 64-bit lanes in, the
///      permuted lanes out). Every loop has a constant bound; RejNTTPoly gives up after
///      `MAX_SQUEEZE_BLOCKS` SHAKE-128 blocks (any rho needs 5 or 6 except with negligible
///      probability).
library MLDSA44KeyExpansion {
    /// @dev The ML-DSA modulus q = 2^23 - 2^13 + 1.
    uint256 internal constant Q = 8380417;
    /// @dev Encoded ML-DSA-44 public key: rho (32 bytes) || t1 (4 x 320 bytes).
    uint256 internal constant PK_LENGTH = 1312;
    /// @dev Expanded payload length (without the 0x00 code prefix).
    uint256 internal constant PAYLOAD_LENGTH = 20544;
    uint256 internal constant T1_OFFSET = 64;
    uint256 internal constant A_OFFSET = 4160;
    /// @dev SHAKE-128 blocks one RejNTTPoly may squeeze: 32 x 56 = 1,792 three-byte draws for 256
    ///      coefficients that are each accepted with probability q / 2^23 > 0.999.
    uint256 internal constant MAX_SQUEEZE_BLOCKS = 32;

    /// @notice RejNTTPoly did not find 256 coefficients within `MAX_SQUEEZE_BLOCKS` blocks.
    error ExpansionFailed();

    /// @notice Computes tr || t1hat || Ahat for `pk`.
    /// @param pk The 1312-byte encoded public key (length checked by the caller).
    /// @param f1600 The Keccak-f[1600] helper (code hash checked by the caller).
    /// @return payload The 20,544-byte expanded key.
    function expand(bytes memory pk, address f1600) internal view returns (bytes memory payload) {
        payload = new bytes(PAYLOAD_LENGTH);
        bytes memory tr = shake256Batch170(pk, 64, f1600);
        assembly ("memory-safe") {
            mcopy(add(payload, 32), add(tr, 32), 64)
        }
        _expandT1(pk, payload);
        _expandA(pk, payload, f1600);
    }

    // ---------------------------------------------------------------- t1hat

    /// @dev t1hat[i] = NTT(2^13 * t1[i]). t1 coefficients are 10-bit, so 2^13 * t1 <= 2^13 * 1023
    ///      = q - 1 is already canonical.
    function _expandT1(bytes memory pk, bytes memory payload) private pure {
        uint256[] memory zetas = _zetas();
        uint256[] memory a = new uint256[](256);
        for (uint256 i = 0; i < 4; ++i) {
            assembly ("memory-safe") {
                // t1[i] starts at pk byte 32 + 320 i; 5 bytes hold 4 little-endian 10-bit values
                let src := add(add(pk, 64), mul(i, 320))
                let dst := add(a, 32)
                for { let g := 0 } lt(g, 64) { g := add(g, 1) } {
                    let w := mload(add(src, mul(g, 5)))
                    let x :=
                        or(
                            or(or(byte(0, w), shl(8, byte(1, w))), or(shl(16, byte(2, w)), shl(24, byte(3, w)))),
                            shl(32, byte(4, w))
                        )
                    let p := add(dst, shl(7, g))
                    mstore(p, shl(13, and(x, 0x3ff)))
                    mstore(add(p, 32), shl(13, and(shr(10, x), 0x3ff)))
                    mstore(add(p, 64), shl(13, and(shr(20, x), 0x3ff)))
                    mstore(add(p, 96), shl(13, shr(30, x)))
                }
            }
            _ntt(a, zetas);
            uint256 dst;
            assembly ("memory-safe") {
                dst := add(add(payload, 32), add(T1_OFFSET, shl(10, i)))
            }
            _pack(a, dst);
        }
    }

    /// @dev zetas[m] = 1753^BitRev8(m) mod q (FIPS 204 Algorithm 41's table).
    function _zetas() private pure returns (uint256[] memory z) {
        z = new uint256[](256);
        assembly ("memory-safe") {
            let base := add(z, 32)
            let pw := 1
            for { let k := 0 } lt(k, 256) { k := add(k, 1) } {
                // BitRev8 is an involution: zetas[BitRev8(k)] = 1753^k
                let r := or(shr(4, and(k, 0xf0)), shl(4, and(k, 0x0f)))
                r := or(shr(2, and(r, 0xcc)), shl(2, and(r, 0x33)))
                r := or(shr(1, and(r, 0xaa)), shl(1, and(r, 0x55)))
                mstore(add(base, shl(5, r)), pw)
                pw := mulmod(pw, 1753, Q)
            }
        }
    }

    /// @dev FIPS 204 Algorithm 41 (NTT) in place on 256 canonical coefficients, canonical output.
    function _ntt(uint256[] memory a, uint256[] memory zetas) private pure {
        assembly ("memory-safe") {
            let base := add(a, 32)
            let end := add(base, 8192)
            let zt := add(zetas, 32)
            let m := 0
            for { let len := 128 } len { len := shr(1, len) } {
                let off := shl(5, len)
                for { let start := base } lt(start, end) { start := add(start, shl(1, off)) } {
                    m := add(m, 1)
                    let z := mload(add(zt, shl(5, m)))
                    let last := add(start, off)
                    for { let p := start } lt(p, last) { p := add(p, 32) } {
                        let t := mulmod(z, mload(add(p, off)), Q)
                        let x := mload(p)
                        mstore(add(p, off), addmod(x, sub(Q, t), Q))
                        mstore(p, addmod(x, t, Q))
                    }
                }
            }
        }
    }

    /// @dev Packs 256 one-per-word coefficients into 32 words of eight 32-bit fields at `dst`.
    function _pack(uint256[] memory a, uint256 dst) private pure {
        assembly ("memory-safe") {
            let src := add(a, 32)
            for { let w := 0 } lt(w, 32) { w := add(w, 1) } {
                let p := add(src, shl(8, w))
                let lo :=
                    or(
                        or(mload(p), shl(32, mload(add(p, 32)))),
                        or(shl(64, mload(add(p, 64))), shl(96, mload(add(p, 96))))
                    )
                let hi :=
                    or(
                        or(shl(128, mload(add(p, 128))), shl(160, mload(add(p, 160)))),
                        or(shl(192, mload(add(p, 192))), shl(224, mload(add(p, 224))))
                    )
                mstore(add(dst, shl(5, w)), or(lo, hi))
            }
        }
    }

    // ---------------------------------------------------------------- Ahat

    /// @dev Ahat[i][j] = RejNTTPoly(rho || j || i) (FIPS 204 Algorithms 30 and 32).
    function _expandA(bytes memory pk, bytes memory payload, address f1600) private view {
        uint256[25] memory st;
        uint256 rhoWord;
        assembly ("memory-safe") {
            rhoWord := mload(add(pk, 32))
        }
        // rho as four little-endian 64-bit lanes: reverse the bytes inside each 8-byte group
        rhoWord = _grev(rhoWord);
        uint256 dst;
        assembly ("memory-safe") {
            dst := add(add(payload, 32), A_OFFSET)
        }
        for (uint256 i = 0; i < 4; ++i) {
            for (uint256 j = 0; j < 4; ++j) {
                assembly ("memory-safe") {
                    for { let k := 0 } lt(k, 25) { k := add(k, 1) } {
                        mstore(add(st, shl(5, k)), 0)
                    }
                    mstore(st, shr(192, rhoWord))
                    mstore(add(st, 32), and(shr(128, rhoWord), 0xffffffffffffffff))
                    mstore(add(st, 64), and(shr(64, rhoWord), 0xffffffffffffffff))
                    mstore(add(st, 96), and(rhoWord, 0xffffffffffffffff))
                    // bytes 32, 33, 34 of the padded block: j, i, then the 0x1f SHAKE domain byte
                    mstore(add(st, 128), or(or(j, shl(8, i)), 0x1f0000))
                    // byte 167, the last of the 168-byte SHAKE-128 rate block: the final 0x80 bit
                    mstore(add(st, 640), 0x8000000000000000)
                }
                _rejNttPoly(st, dst, f1600);
                dst += 1024;
            }
        }
    }

    /// @dev Squeezes SHAKE-128 blocks from the absorbed state `st` and writes the first 256
    ///      accepted coefficients, packed, to `dst`. One block is 21 lanes = 7 groups of 3 lanes;
    ///      a group read as a 192-bit little-endian integer holds eight 3-byte draws, draw u being
    ///      bits [24u, 24u + 23) once the top bit of its third byte is cleared.
    function _rejNttPoly(uint256[25] memory st, uint256 dst, address f1600) private view {
        uint256 cnt = 0;
        uint256 acc = 0;
        for (uint256 b = 0; b < MAX_SQUEEZE_BLOCKS && cnt < 256; ++b) {
            f1600Fast170(st, f1600);
            assembly ("memory-safe") {
                for { let g := 0 } lt(g, 7) { g := add(g, 1) } {
                    let lp := add(st, mul(g, 96))
                    let w := or(or(mload(lp), shl(64, mload(add(lp, 32)))), shl(128, mload(add(lp, 64))))
                    for { let u := 0 } lt(u, 192) { u := add(u, 24) } {
                        let v := and(shr(u, w), 0x7fffff)
                        if lt(v, Q) {
                            acc := or(acc, shl(shl(5, and(cnt, 7)), v))
                            if eq(and(cnt, 7), 7) {
                                mstore(add(dst, shl(2, and(cnt, not(7)))), acc)
                                acc := 0
                            }
                            cnt := add(cnt, 1)
                            if eq(cnt, 256) { break }
                        }
                    }
                    if eq(cnt, 256) { break }
                }
            }
        }
        // runs once, after the loop (the lint trips over the Yul loops above)
        // forge-lint: disable-next-line(require-revert-in-loop)
        if (cnt != 256) revert ExpansionFailed();
    }

    /// @dev Reverses the byte order inside each 8-byte group of `w`.
    function _grev(uint256 w) private pure returns (uint256 v) {
        assembly ("memory-safe") {
            let a := and(w, 0xff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00)
            v := or(shr(8, a), shl(8, xor(w, a)))
            a := and(v, 0xffff0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff0000)
            v := or(shr(16, a), shl(16, xor(v, a)))
            a := and(v, 0xffffffff00000000ffffffff00000000ffffffff00000000ffffffff00000000)
            v := or(shr(32, a), shl(32, xor(v, a)))
        }
    }
}
