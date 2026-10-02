#!/usr/bin/env python3
"""Generate ECDSA test vectors for the canary ladder curves.

Writes ``vectors/ladder/<curve>.json`` for secp160r1, P-192 and P-224:

    { "curve": "...", "params": {p, a, b, n, gx, gy}, "vectors": [ {kind, qx, qy, digest, r, s, valid}, ... ] }

All values are 0x-prefixed, 32-byte left-padded big-endian hex. Digests are 32
bytes and truncated to the leftmost bitlen(n) bits (SEC1 4.1.3/4.1.4) by
python-ecdsa (``allow_truncate=True``). Every ``valid`` flag is the verdict of
python-ecdsa itself (keys that python-ecdsa cannot even load are invalid).

The ``claim_*`` vectors are signed by the drill key from
``deployments/canary-targets.json`` (run scripts/nums.py first) over registry
claim messages for two different claimants.

Usage: python scripts/gen_ladder_vectors.py
Requires: pip install ecdsa pycryptodome
"""

import json
import os
import random

from Crypto.Hash import keccak
from ecdsa import NIST192p, NIST224p, SECP160r1, SigningKey, VerifyingKey
from ecdsa.ellipticcurve import PointJacobi
from ecdsa.numbertheory import square_root_mod_prime
from ecdsa.util import sigencode_strings

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "vectors", "ladder")
TARGETS_JSON = os.path.join(ROOT, "deployments", "canary-targets.json")

# name -> (python-ecdsa curve, registry target index)
LADDER = {"secp160r1": (SECP160r1, 0), "p192": (NIST192p, 1), "p224": (NIST224p, 2)}

VALID_COUNT = 64
TAMPER_COUNT = 8

# Fixed claim context for the claimant-binding vectors.
CLAIM_CHAIN_ID = 421614  # Arbitrum Sepolia
CLAIM_REGISTRY = 0x00000000000000000000000000000000C0FFEE01
CLAIMANT_A = 0x000000000000000000000000000000000000A11CE
CLAIMANT_B = 0x0000000000000000000000000000000000000B0B

rng = random.Random(0x0A4A47)  # deterministic output


def h32(v: int) -> str:
    return "0x" + v.to_bytes(32, "big").hex()


def keccak256(data: bytes) -> bytes:
    k = keccak.new(digest_bits=256)
    k.update(data)
    return k.digest()


def word(v: int) -> bytes:
    return v.to_bytes(32, "big")


def claim_message(target: int, claimant: int) -> bytes:
    """keccak256(abi.encode(keccak256("QANARY_CLAIM_V1"), chainid, registry, target, claimant))."""
    return keccak256(
        keccak256(b"QANARY_CLAIM_V1")
        + word(CLAIM_CHAIN_ID)
        + word(CLAIM_REGISTRY)
        + word(target)
        + word(claimant)
    )


def py_verify(curve, qx: int, qy: int, digest: bytes, r: int, s: int) -> bool:
    """python-ecdsa's verdict; any key/encoding rejection counts as invalid."""
    try:
        if not (0 <= qx < 2**256 and 0 <= qy < 2**256 and 0 <= r < 2**256 and 0 <= s < 2**256):
            return False
        nlen = curve.baselen
        if r >= 1 << (8 * nlen) or s >= 1 << (8 * nlen):
            return False
        # SEC1 3.2.2.1: public key coordinates must be canonical field elements.
        p = curve.curve.p()
        if qx >= p or qy >= p:
            return False
        plen = (p.bit_length() + 7) // 8
        raw = qx.to_bytes(plen, "big") + qy.to_bytes(plen, "big")
        vk = VerifyingKey.from_string(raw, curve=curve, validate_point=True)
        sig = r.to_bytes(nlen, "big") + s.to_bytes(nlen, "big")
        return vk.verify_digest(sig, digest, allow_truncate=True)
    except Exception:  # any rejection (bad key, bad signature) is "invalid"
        return False


def sign(sk: SigningKey, digest: bytes):
    rb, sb = sk.sign_digest(digest, entropy=rng.randbytes, sigencode=sigencode_strings, allow_truncate=True)
    return int.from_bytes(rb, "big"), int.from_bytes(sb, "big")


def vec(curve, kind, qx, qy, digest, r, s, expect=None):
    valid = py_verify(curve, qx, qy, digest, r, s)
    if expect is not None:
        assert valid == expect, f"{curve.name} {kind}: python-ecdsa says {valid}, expected {expect}"
    return {
        "kind": kind,
        "qx": h32(qx),
        "qy": h32(qy),
        "digest": "0x" + digest.hex(),
        "r": h32(r),
        "s": h32(s),
        "valid": valid,
    }


def flip_top_bit(digest: bytes) -> bytes:
    return bytes([digest[0] ^ 0x80]) + digest[1:]


def x_ge_n_vectors(curve):
    """Signatures whose R point has x >= n, so verification must reduce x mod n.

    For a point R with R.x in [n, p) pick s, e and set r = R.x - n and
    Q = r^-1 (sR - eG); then (r, s) is a valid signature on e under Q.
    Only possible where p > n (P-192, P-224).
    """
    p, a, b, n = curve.curve.p(), curve.curve.a(), curve.curve.b(), curve.order
    if p <= n:
        return []
    G = curve.generator
    x = n + 1  # r = x - n must be non-zero
    while True:
        rhs = (x * x * x + a * x + b) % p
        if pow(rhs, (p - 1) // 2, p) == 1:
            break
        x += 1
    assert n <= x < p
    y = square_root_mod_prime(rhs, p)
    R = PointJacobi(curve.curve, x, y, 1, n)
    digest = rng.randbytes(32)
    e = int.from_bytes(digest, "big") >> (256 - n.bit_length())
    r = x - n
    s = rng.randrange(1, n)
    Q = (R * s + G * ((-e) % n)) * pow(r, -1, n)
    qx, qy = Q.x(), Q.y()
    return [
        vec(curve, "x_ge_n", qx, qy, digest, r, s, expect=True),
        vec(curve, "x_ge_n_unreduced_r", qx, qy, digest, x, s, expect=False),
    ]


def gen_curve(name: str, curve, target: int, drill: dict):
    p, n = curve.curve.p(), curve.order
    out = []
    valid = []
    for _ in range(VALID_COUNT):
        sk = SigningKey.generate(curve=curve, entropy=rng.randbytes)
        pt = sk.get_verifying_key().pubkey.point
        digest = rng.randbytes(32)
        r, s = sign(sk, digest)
        valid.append((pt.x(), pt.y(), digest, r, s))
        out.append(vec(curve, "valid", pt.x(), pt.y(), digest, r, s, expect=True))

    qx, qy, digest, r, s = valid[0]
    # SEC1 truncation: bits below the leftmost bitlen(n) are ignored.
    out.append(vec(curve, "truncated_bits_changed", qx, qy, digest[:-1] + bytes([digest[-1] ^ 0xFF]), r, s, expect=True))
    # ECDSA (without a low-s rule) accepts the negated s.
    out.append(vec(curve, "malleated_s", qx, qy, digest, r, n - s, expect=True))

    for qx, qy, digest, r, s in valid[:TAMPER_COUNT]:
        out.append(vec(curve, "tampered_digest", qx, qy, flip_top_bit(digest), r, s, expect=False))
        out.append(vec(curve, "tampered_r", qx, qy, digest, r ^ 1, s, expect=False))
        out.append(vec(curve, "tampered_s", qx, qy, digest, r, s ^ 1, expect=False))

    qx, qy, digest, r, s = valid[1]
    out.append(vec(curve, "r_zero", qx, qy, digest, 0, s, expect=False))
    out.append(vec(curve, "s_zero", qx, qy, digest, r, 0, expect=False))
    out.append(vec(curve, "r_eq_n", qx, qy, digest, n, s, expect=False))
    out.append(vec(curve, "s_eq_n", qx, qy, digest, r, n, expect=False))
    out.append(vec(curve, "r_plus_n", qx, qy, digest, r + n, s, expect=False))
    out.append(vec(curve, "s_plus_n", qx, qy, digest, r, s + n, expect=False))
    out.append(vec(curve, "r_max", qx, qy, digest, 2**256 - 1, s, expect=False))
    out.append(vec(curve, "off_curve", qx, (qy + 1) % p, digest, r, s, expect=False))
    out.append(vec(curve, "infinity", 0, 0, digest, r, s, expect=False))
    out.append(vec(curve, "negated_q", qx, p - qy, digest, r, s, expect=False))
    out.append(vec(curve, "qx_plus_p", qx + p, qy, digest, r, s, expect=False))
    out.append(vec(curve, "qy_plus_p", qx, qy + p, digest, r, s, expect=False))
    out.append(vec(curve, "all_ff", 2**256 - 1, 2**256 - 1, b"\xff" * 32, 2**256 - 1, 2**256 - 1, expect=False))

    out.extend(x_ge_n_vectors(curve))

    # Claimant binding with the published drill key.
    d = int(drill["privateKey"], 16)
    dx, dy = int(drill["x"], 16), int(drill["y"], 16)
    sk = SigningKey.from_secret_exponent(d, curve=curve)
    pt = sk.get_verifying_key().pubkey.point
    assert (pt.x(), pt.y()) == (dx, dy), f"{name}: drill key mismatch"
    msg_a, msg_b = claim_message(target, CLAIMANT_A), claim_message(target, CLAIMANT_B)
    ra, sa = sign(sk, msg_a)
    rb, sb = sign(sk, msg_b)
    out.append(vec(curve, "claim_a", dx, dy, msg_a, ra, sa, expect=True))
    out.append(vec(curve, "claim_a_for_b", dx, dy, msg_b, ra, sa, expect=False))
    out.append(vec(curve, "claim_b", dx, dy, msg_b, rb, sb, expect=True))
    out.append(vec(curve, "claim_b_for_a", dx, dy, msg_a, rb, sb, expect=False))
    return out


def main():
    with open(TARGETS_JSON, encoding="utf-8") as f:
        drill = json.load(f)["drill"]
    os.makedirs(OUT_DIR, exist_ok=True)
    for name, (curve, target) in LADDER.items():
        cf = curve.curve
        g = curve.generator
        doc = {
            "curve": name,
            "params": {
                "p": h32(cf.p()),
                "a": h32(cf.a() % cf.p()),
                "b": h32(cf.b()),
                "n": h32(curve.order),
                "gx": h32(g.x()),
                "gy": h32(g.y()),
            },
            "claim": {
                "chainId": CLAIM_CHAIN_ID,
                "registry": h32(CLAIM_REGISTRY)[:2] + h32(CLAIM_REGISTRY)[26:],
                "target": target,
                "claimantA": h32(CLAIMANT_A)[:2] + h32(CLAIMANT_A)[26:],
                "claimantB": h32(CLAIMANT_B)[:2] + h32(CLAIMANT_B)[26:],
            },
            "vectors": gen_curve(name, curve, target, drill[name]),
        }
        path = os.path.join(OUT_DIR, f"{name}.json")
        with open(path, "w", encoding="utf-8", newline="\n") as f:
            json.dump(doc, f, indent=1)
            f.write("\n")
        nv = sum(v["valid"] for v in doc["vectors"])
        print(f"{name:<10} {len(doc['vectors'])} vectors ({nv} valid, {len(doc['vectors']) - nv} invalid) -> {os.path.relpath(path, ROOT)}")


if __name__ == "__main__":
    main()
