import { describe, expect, it } from 'vitest';
import { ml_dsa44 } from '@noble/post-quantum/ml-dsa.js';
import {
  createPublicClient,
  decodeFunctionData,
  hashMessage,
  hexToBytes,
  keccak256,
  size,
  stringToHex,
  type Address,
  type Chain,
  type Hex,
} from 'viem';
import { entryPoint07Address, getUserOperationHash, type UserOperation } from 'viem/account-abstraction';
import { arbitrumSepolia, mainnet } from 'viem/chains';
import {
  SCHEMES,
  SIGNATURE_BYTES,
  accountDigest,
  encodeValidatorInstallData,
  kernelErc1271Signature,
  kernelWrappedHash,
  keyBlob,
  pqSignerFromSeed,
  predictKeyPointer,
  quantumValidatorAbi,
  setGuardiansCall,
  stubSignature,
  toQuantumValidator,
} from '../src/index.js';
import { mockTransport } from './rpc.js';

// Computed with forge against contracts/evm/src/QuantumValidator.sol: validator deployed at
// 0x1111…1111 on chain 421614, account 0x2222…2222, appHash = keccak256("qanary"); Kernel wrap
// computed in Solidity from the Kernel v3.3 EIP-712 domain {"Kernel","0.3.3",chainId,account}.
const VEC = {
  chainId: 421614,
  validator: '0x1111111111111111111111111111111111111111' as Address,
  account: '0x2222222222222222222222222222222222222222' as Address,
  appHash: '0xb2ca2e6a204f3978a2439f27f6bf5bb1317647a2356ee3db5504f5c6253a9a1b' as Hex,
  kernelWrapped: '0x20c76809b5323f83ee6d088f6cf062b0a362d806226066c00d3d413e0beb0ca8' as Hex,
  accountDigest: '0x885ec671dc160aca75746edfdba922d050880597a618b1444af650823378159c' as Hex,
  // abi.encode(InstallData{verifier: 0x3333…, keyPtr: 0x4444…, guardians: [], threshold: 0, delay: 0})
  installData: ('0x' +
    '0000000000000000000000000000000000000000000000000000000000000020' +
    '0000000000000000000000003333333333333333333333333333333333333333' +
    '0000000000000000000000004444444444444444444444444444444444444444' +
    '00000000000000000000000000000000000000000000000000000000000000a0' +
    '0000000000000000000000000000000000000000000000000000000000000000' +
    '0000000000000000000000000000000000000000000000000000000000000000' +
    '0000000000000000000000000000000000000000000000000000000000000000') as Hex,
};

const SEED = new Uint8Array(32).fill(7);
const VERIFIER: Address = '0x3333333333333333333333333333333333333333';
const KEY_STORE: Address = '0x5FbDB2315678afecb367f032d93F642f64180aa3';

function client(chain: Chain = arbitrumSepolia, handlers = {}) {
  const rpc = mockTransport({ eth_chainId: () => `0x${chain.id.toString(16)}`, ...handlers });
  return { client: createPublicClient({ chain, transport: rpc.transport }), calls: rpc.calls };
}

describe('encodings (forge vectors)', () => {
  it('encodes QuantumValidator InstallData like abi.encode', () => {
    expect(encodeValidatorInstallData({ verifier: VERIFIER, keyPtr: '0x4444444444444444444444444444444444444444' })).toBe(
      VEC.installData,
    );
  });

  it('computes the Kernel v3.3 ERC-1271 wrapped hash', () => {
    expect(keccak256(stringToHex('qanary'))).toBe(VEC.appHash);
    expect(kernelWrappedHash({ account: VEC.account, chainId: VEC.chainId, hash: VEC.appHash })).toBe(VEC.kernelWrapped);
  });

  it('computes QuantumValidator.accountDigest', () => {
    expect(
      accountDigest({ validator: VEC.validator, chainId: VEC.chainId, account: VEC.account, hash: VEC.kernelWrapped }),
    ).toBe(VEC.accountDigest);
  });

  it('builds the Kernel ERC-1271 signature 0x01 ‖ validator ‖ sig', () => {
    expect(kernelErc1271Signature(VEC.validator, '0xabcd')).toBe(`0x01${VEC.validator.slice(2)}abcd`);
  });

  it('rejects malformed install data', () => {
    expect(() => encodeValidatorInstallData({ verifier: VERIFIER, keyPtr: VERIFIER, threshold: 256 })).toThrow(/uint8/);
    expect(() => encodeValidatorInstallData({ verifier: '0x12' as Address, keyPtr: VERIFIER })).toThrow(/address/);
  });

  it('encodes setGuardians for the account to execute', () => {
    const call = setGuardiansCall(VEC.validator, ['0xaabbccddeeff00112233445566778899aabbccddee'], 1, 86_400);
    expect(call.to).toBe(VEC.validator);
    const decoded = decodeFunctionData({ abi: quantumValidatorAbi, data: call.data });
    expect(decoded.functionName).toBe('setGuardians');
    expect(decoded.args).toEqual([['0xaabbccddeeff00112233445566778899aabbccddee'], 1, 86_400]);
  });
});

describe('stubSignature', () => {
  it.each(SCHEMES)('%s: real signature length, cached per scheme', async (scheme) => {
    const stub = await stubSignature(scheme);
    expect(size(stub)).toBe(SIGNATURE_BYTES[scheme]);
    expect(await stubSignature(scheme)).toBe(stub);
    // a real signature's entropy (calldata / L1 pricing see a realistic payload); ML-DSA's hint
    // section is mostly zero padding, so a few percent of zero bytes is expected
    const zeros = hexToBytes(stub).filter((b) => b === 0).length;
    expect(zeros / SIGNATURE_BYTES[scheme]).toBeLessThan(0.1);
  });

  it('never verifies against an account key', async () => {
    const signer = pqSignerFromSeed('mldsa44', SEED);
    const stub = await stubSignature('mldsa44');
    expect(ml_dsa44.verify(hexToBytes(stub), new Uint8Array(32), signer.publicKey)).toBe(false);
  });
});

describe('toQuantumValidator', () => {
  const signer = pqSignerFromSeed('mldsa44', SEED);
  const opts = {
    signer,
    entryPoint: { address: entryPoint07Address, version: '0.7' as const },
    kernelVersion: '0.3.3' as const,
    validatorAddress: VEC.validator,
    verifier: VERIFIER,
    keyStore: KEY_STORE,
  };

  it('describes the root validator: identifier, enable data, nonce key, stub', async () => {
    const { client: c } = client();
    const v = await toQuantumValidator(c, opts);
    const keyPtr = predictKeyPointer(KEY_STORE, keyBlob(signer));
    expect(v.address).toBe(VEC.validator);
    expect(v.getIdentifier()).toBe(VEC.validator);
    expect(v.validatorType).toBe('SECONDARY');
    expect(v.supportedKernelVersions).toBe('0.3.3');
    expect(v.source).toBe('QuantumValidator');
    expect(v.keyPtr).toBe(keyPtr);
    expect(v.keyBlob).toBe(keyBlob(signer));
    expect(await v.getEnableData()).toBe(encodeValidatorInstallData({ verifier: VERIFIER, keyPtr }));
    expect(await v.getNonceKey()).toBe(0n);
    expect(await v.getNonceKey(VEC.account, 5n)).toBe(5n);
    expect(size(await v.getStubSignature({} as UserOperation))).toBe(2420);
  });

  it('signs userOpHash with the raw post-quantum key', async () => {
    const { client: c } = client();
    const v = await toQuantumValidator(c, opts);
    const userOp = {
      sender: VEC.account,
      nonce: 0n,
      callData: '0x' as Hex,
      callGasLimit: 100_000n,
      verificationGasLimit: 1_000_000n,
      preVerificationGas: 50_000n,
      maxFeePerGas: 10n,
      maxPriorityFeePerGas: 1n,
      signature: '0xdead' as Hex,
    };
    const sig = await v.signUserOperation(userOp);
    const hash = getUserOperationHash({
      userOperation: { ...userOp, signature: '0x' },
      entryPointAddress: entryPoint07Address,
      entryPointVersion: '0.7',
      chainId: arbitrumSepolia.id,
    });
    expect(size(sig)).toBe(2420);
    expect(ml_dsa44.verify(hexToBytes(sig), hexToBytes(hash), signer.publicKey)).toBe(true);
  });

  it('signs ERC-1271 typed data over accountDigest(verifyingContract, typedDataHash)', async () => {
    const { client: c } = client();
    const v = await toQuantumValidator(c, opts);
    const sig = await v.signTypedData({
      domain: { name: 'Kernel', version: '0.3.3', chainId: VEC.chainId, verifyingContract: VEC.account },
      types: { Kernel: [{ name: 'hash', type: 'bytes32' }] },
      primaryType: 'Kernel',
      message: { hash: VEC.appHash },
    });
    expect(ml_dsa44.verify(hexToBytes(sig), hexToBytes(VEC.accountDigest), signer.publicKey)).toBe(true);
  });

  it('signMessage signs a raw 32-byte hash only', async () => {
    const { client: c } = client();
    const v = await toQuantumValidator(c, opts);
    const hash = hashMessage('x');
    const sig = await v.signMessage({ message: { raw: hash } });
    expect(ml_dsa44.verify(hexToBytes(sig), hexToBytes(hash), signer.publicKey)).toBe(true);
    await expect(v.signMessage({ message: 'hello' })).rejects.toThrow(/raw 32-byte/);
  });

  it('reads isInitialized for isEnabled', async () => {
    const { client: c, calls } = client(arbitrumSepolia, {
      eth_call: () => `0x${'00'.repeat(31)}01`,
    });
    const v = await toQuantumValidator(c, opts);
    expect(await v.isEnabled(VEC.account, '0x00000000')).toBe(true);
    const call = calls.find((x) => x.method === 'eth_call')!.params[0] as { to: string; data: Hex };
    expect(call.to.toLowerCase()).toBe(VEC.validator);
    expect(decodeFunctionData({ abi: quantumValidatorAbi, data: call.data }).functionName).toBe('isInitialized');
  });

  it('requires addresses when the chain has no deployment', async () => {
    const { client: c } = client(mainnet);
    await expect(
      toQuantumValidator(c, { ...opts, validatorAddress: undefined }),
    ).rejects.toThrow(/no Qanary deployment for chain 1/);
  });

  it('names the missing contract when the deployment lacks it', async () => {
    const { client: c } = client();
    await expect(toQuantumValidator(c, { ...opts, validatorAddress: undefined })).rejects.toThrow(
      /quantumValidator is not deployed on arbitrum-sepolia/,
    );
  });
});
