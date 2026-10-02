#!/usr/bin/env python3
"""Sign a 32-byte digest on a canary ladder curve (RFC 6979 deterministic ECDSA).

Usage: python scripts/ladder_sign.py <secp160r1|p192|p224> <privHex> <digestHex>

Prints r || s as 0x-prefixed hex, each 32 bytes left-padded (64 bytes total).
The digest is truncated to the leftmost bitlen(n) bits per SEC1 by python-ecdsa.
Hex arguments may carry a 0x prefix.
Requires: pip install ecdsa
"""

import hashlib
import sys

from ecdsa import NIST192p, NIST224p, SECP160r1, SigningKey
from ecdsa.util import sigencode_strings

CURVES = {"secp160r1": SECP160r1, "p192": NIST192p, "p224": NIST224p}


def parse_hex(s: str) -> bytes:
    s = s[2:] if s[:2] in ("0x", "0X") else s
    if len(s) % 2:
        s = "0" + s
    return bytes.fromhex(s)


def main(argv) -> int:
    if len(argv) != 4 or argv[1] not in CURVES:
        print(__doc__.strip().splitlines()[2], file=sys.stderr)
        return 2
    curve = CURVES[argv[1]]
    try:
        d = int.from_bytes(parse_hex(argv[2]), "big")
        digest = parse_hex(argv[3])
    except ValueError as e:
        print(f"bad hex: {e}", file=sys.stderr)
        return 2
    if not 1 <= d < curve.order:
        print("private key out of range [1, n-1]", file=sys.stderr)
        return 2
    if len(digest) != 32:
        print("digest must be 32 bytes", file=sys.stderr)
        return 2
    sk = SigningKey.from_secret_exponent(d, curve=curve, hashfunc=hashlib.sha256)
    rb, sb = sk.sign_digest_deterministic(digest, sigencode=sigencode_strings, allow_truncate=True)
    r, s = int.from_bytes(rb, "big"), int.from_bytes(sb, "big")
    sys.stdout.write("0x" + r.to_bytes(32, "big").hex() + s.to_bytes(32, "big").hex())
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
