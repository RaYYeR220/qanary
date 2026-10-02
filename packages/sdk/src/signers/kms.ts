import { bytesToHex } from 'viem';
import { PUBLIC_KEY_BYTES, SIGNATURE_BYTES, messageBytes, type PqSigner } from '../schemes.js';

// DER of the AlgorithmIdentifier OID id-ml-dsa-44 (2.16.840.1.101.3.4.3.17), RFC 9881.
const MLDSA44_OID = Uint8Array.of(0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x03, 0x11);

type Tlv = { tag: number; start: number; end: number };

/** Reads one DER TLV at `offset`, bounded by `limit`; `start`/`end` delimit the contents. */
function readTlv(der: Uint8Array, offset: number, limit: number): Tlv {
  if (offset + 2 > limit) throw new Error('SPKI: truncated DER');
  const tag = der[offset] as number;
  let length = der[offset + 1] as number;
  let start = offset + 2;
  if (length & 0x80) {
    const n = length & 0x7f;
    if (n === 0 || n > 4) throw new Error('SPKI: unsupported DER length encoding');
    if (start + n > limit) throw new Error('SPKI: truncated DER');
    length = 0;
    for (let i = 0; i < n; i++) length = length * 256 + (der[start + i] as number);
    start += n;
  }
  const end = start + length;
  if (end > limit) throw new Error('SPKI: truncated DER');
  return { tag, start, end };
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * Extracts the raw 1312-byte ML-DSA-44 public key from a DER SubjectPublicKeyInfo
 * (as returned by AWS KMS `GetPublicKey`):
 * `SEQUENCE { SEQUENCE { OID id-ml-dsa-44 }, BIT STRING { 0x00, pk } }`.
 */
export function mldsa44PublicKeyFromSpki(der: Uint8Array): Uint8Array {
  const spki = readTlv(der, 0, der.length);
  if (spki.tag !== 0x30) throw new Error('SPKI: expected an outer SEQUENCE');
  if (spki.end !== der.length) throw new Error('SPKI: trailing bytes after SubjectPublicKeyInfo');

  const algorithm = readTlv(der, spki.start, spki.end);
  if (algorithm.tag !== 0x30) throw new Error('SPKI: expected an AlgorithmIdentifier SEQUENCE');
  const oid = readTlv(der, algorithm.start, algorithm.end);
  if (oid.tag !== 0x06 || !equalBytes(der.subarray(algorithm.start, oid.end), MLDSA44_OID)) {
    throw new Error('SPKI: algorithm is not ML-DSA-44 (OID 2.16.840.1.101.3.4.3.17)');
  }
  // RFC 9881 requires absent parameters; tolerate an explicit NULL.
  const params = der.subarray(oid.end, algorithm.end);
  if (params.length !== 0 && !equalBytes(params, Uint8Array.of(0x05, 0x00))) {
    throw new Error('SPKI: unexpected ML-DSA-44 algorithm parameters');
  }

  const bits = readTlv(der, algorithm.end, spki.end);
  if (bits.tag !== 0x03) throw new Error('SPKI: expected a BIT STRING subjectPublicKey');
  if (bits.end !== spki.end) throw new Error('SPKI: trailing bytes after subjectPublicKey');
  if (bits.end === bits.start || der[bits.start] !== 0x00) {
    throw new Error('SPKI: subjectPublicKey BIT STRING must have zero unused bits');
  }
  const publicKey = der.slice(bits.start + 1, bits.end);
  if (publicKey.length !== PUBLIC_KEY_BYTES.mldsa44) {
    throw new Error(`SPKI: ML-DSA-44 public key must be ${PUBLIC_KEY_BYTES.mldsa44} bytes, got ${publicKey.length}`);
  }
  return publicKey;
}

/**
 * ML-DSA-44 signer backed by an AWS KMS `ML_DSA_44` / `SIGN_VERIFY` key. Signs the raw 32-byte
 * hash with `ML_DSA_SHAKE_256` and `MessageType: RAW` (pure ML-DSA, empty context). Credentials
 * and the default region come from the standard AWS SDK provider chain.
 */
export async function kmsSigner(opts: { keyId: string; region?: string }): Promise<PqSigner> {
  // Loaded lazily so browser bundles that never use KMS do not pull in the AWS SDK.
  const { KMSClient, GetPublicKeyCommand, SignCommand } = await import('@aws-sdk/client-kms');
  const client = new KMSClient(opts.region ? { region: opts.region } : {});
  const { keyId } = opts;

  const info = await client.send(new GetPublicKeyCommand({ KeyId: keyId }));
  if (
    info.KeySpec !== 'ML_DSA_44' ||
    info.KeyUsage !== 'SIGN_VERIFY' ||
    !info.SigningAlgorithms?.includes('ML_DSA_SHAKE_256')
  ) {
    throw new Error(`KMS key ${keyId} must be an ML_DSA_44 SIGN_VERIFY key (got ${info.KeySpec} ${info.KeyUsage})`);
  }
  if (!info.PublicKey) throw new Error(`KMS key ${keyId}: GetPublicKey returned no public key`);
  const publicKey = mldsa44PublicKeyFromSpki(info.PublicKey);

  return {
    scheme: 'mldsa44',
    publicKey,
    async sign(message32) {
      const message = messageBytes(message32);
      const out = await client.send(
        new SignCommand({
          KeyId: keyId,
          Message: message,
          MessageType: 'RAW',
          SigningAlgorithm: 'ML_DSA_SHAKE_256',
        }),
      );
      if (!out.Signature || out.Signature.length !== SIGNATURE_BYTES.mldsa44) {
        throw new Error(`KMS key ${keyId}: expected a ${SIGNATURE_BYTES.mldsa44}-byte ML-DSA-44 signature`);
      }
      return bytesToHex(out.Signature);
    },
  };
}
