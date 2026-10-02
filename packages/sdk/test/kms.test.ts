import { afterEach, describe, expect, it, vi } from 'vitest';
import { GetPublicKeyCommand, KMSClient, SignCommand } from '@aws-sdk/client-kms';
import { ml_dsa44 } from '@noble/post-quantum/ml-dsa.js';
import { bytesToHex, concat, hexToBytes, type Hex } from 'viem';
import { keyBlob, kmsSigner, mldsa44PublicKeyFromSpki } from '../src/index.js';

// RFC 9881 SubjectPublicKeyInfo prefix for an ML-DSA-44 key (OID 2.16.840.1.101.3.4.3.17,
// absent parameters, BIT STRING of 1 + 1312 bytes with zero unused bits).
const SPKI_HEADER_44: Hex = '0x30820532300b06096086480165030403110382052100';

const keys = ml_dsa44.keygen(new Uint8Array(32).fill(7));
const spki = (pk: Uint8Array): Uint8Array => hexToBytes(concat([SPKI_HEADER_44, bytesToHex(pk)]));
const randomHash = (): Hex => bytesToHex(crypto.getRandomValues(new Uint8Array(32)));

describe('mldsa44PublicKeyFromSpki', () => {
  it('extracts the raw 1312-byte key from an RFC 9881 SPKI', () => {
    expect(mldsa44PublicKeyFromSpki(spki(keys.publicKey))).toEqual(keys.publicKey);
  });

  it('rejects a different algorithm OID', () => {
    const der = spki(keys.publicKey);
    der[16] = 0x12; // id-ml-dsa-65
    expect(() => mldsa44PublicKeyFromSpki(der)).toThrow(/ML-DSA-44/);
  });

  it('rejects non-zero unused bits in the BIT STRING', () => {
    const der = spki(keys.publicKey);
    der[21] = 0x01;
    expect(() => mldsa44PublicKeyFromSpki(der)).toThrow(/unused bits/);
  });

  it('rejects truncated input, trailing bytes and wrong key lengths', () => {
    const der = spki(keys.publicKey);
    expect(() => mldsa44PublicKeyFromSpki(der.slice(0, der.length - 1))).toThrow();
    expect(() => mldsa44PublicKeyFromSpki(hexToBytes(concat([bytesToHex(der), '0x00'])))).toThrow(/trailing/);
    expect(() => mldsa44PublicKeyFromSpki(new Uint8Array(0))).toThrow();
    // Well-formed DER whose BIT STRING carries 1311 key bytes.
    const short = hexToBytes(
      concat(['0x30820531300b06096086480165030403110382052000', bytesToHex(keys.publicKey.slice(0, 1311))]),
    );
    expect(() => mldsa44PublicKeyFromSpki(short)).toThrow(/1312/);
  });
});

describe('kmsSigner (mocked KMS client)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads the SPKI key and signs the raw 32-byte hash with ML_DSA_SHAKE_256 / RAW', async () => {
    const send = vi.spyOn(KMSClient.prototype, 'send').mockImplementation((async (cmd: unknown) => {
      if (cmd instanceof GetPublicKeyCommand) {
        expect(cmd.input.KeyId).toBe('alias/test');
        return {
          KeyId: 'arn:aws:kms:us-east-1:000000000000:key/test',
          KeySpec: 'ML_DSA_44',
          KeyUsage: 'SIGN_VERIFY',
          SigningAlgorithms: ['ML_DSA_SHAKE_256'],
          PublicKey: spki(keys.publicKey),
        };
      }
      if (cmd instanceof SignCommand) {
        expect(cmd.input).toMatchObject({
          KeyId: 'alias/test',
          MessageType: 'RAW',
          SigningAlgorithm: 'ML_DSA_SHAKE_256',
        });
        const message = cmd.input.Message as Uint8Array;
        expect(message.length).toBe(32);
        return { Signature: ml_dsa44.sign(message, keys.secretKey) };
      }
      throw new Error('unexpected command');
    }) as never);

    const signer = await kmsSigner({ keyId: 'alias/test', region: 'us-east-1' });
    expect(signer.scheme).toBe('mldsa44');
    expect(signer.publicKey).toEqual(keys.publicKey);
    expect(keyBlob(signer).slice(0, 4)).toBe('0x02');

    const hash = randomHash();
    const sig = hexToBytes(await signer.sign(hash));
    expect(sig.length).toBe(2420);
    expect(ml_dsa44.verify(sig, hexToBytes(hash), signer.publicKey)).toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('refuses keys that are not ML-DSA-44 signing keys', async () => {
    vi.spyOn(KMSClient.prototype, 'send').mockImplementation((async () => ({
      KeySpec: 'ECC_SECG_P256K1',
      KeyUsage: 'SIGN_VERIFY',
      SigningAlgorithms: ['ECDSA_SHA_256'],
      PublicKey: spki(keys.publicKey),
    })) as never);
    await expect(kmsSigner({ keyId: 'alias/test', region: 'us-east-1' })).rejects.toThrow(/ML_DSA_44/);
  });

  it('rejects messages that are not exactly 32 bytes before calling KMS', async () => {
    const send = vi.spyOn(KMSClient.prototype, 'send').mockImplementation((async () => ({
      KeySpec: 'ML_DSA_44',
      KeyUsage: 'SIGN_VERIFY',
      SigningAlgorithms: ['ML_DSA_SHAKE_256'],
      PublicKey: spki(keys.publicKey),
    })) as never);
    const signer = await kmsSigner({ keyId: 'alias/test', region: 'us-east-1' });
    await expect(signer.sign('0x1234')).rejects.toThrow(/32/);
    expect(send).toHaveBeenCalledTimes(1);
  });
});

// Live check against the real AWS KMS key; needs QANARY_KMS_KEY_ID and AWS credentials.
// Read-only: it signs one random hash and creates nothing.
const KMS_KEY_ID = process.env.QANARY_KMS_KEY_ID;

describe.skipIf(!KMS_KEY_ID)('kmsSigner (live AWS KMS)', () => {
  it('produces ML-DSA-44 signatures over a raw 32-byte hash that noble verifies', async () => {
    const signer = await kmsSigner({ keyId: KMS_KEY_ID as string, region: process.env.AWS_REGION });
    expect(signer.publicKey.length).toBe(1312);
    const hash = randomHash();
    const sig = hexToBytes(await signer.sign(hash));
    expect(sig.length).toBe(2420);
    expect(ml_dsa44.verify(sig, hexToBytes(hash), signer.publicKey)).toBe(true);
    expect(ml_dsa44.verify(sig, hexToBytes(randomHash()), signer.publicKey)).toBe(false);
  }, 60_000);
});
