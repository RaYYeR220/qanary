import { concat, createPublicClient, custom, decodeFunctionData, encodeErrorResult, parseAbi, parseEther, toFunctionSelector, zeroAddress, type Address, type Hex } from 'viem';
import { describe, expect, it } from 'vitest';
import { DEFAULT_LEVEL_BPS } from '@/lib/bucket';
import { createQanaryAccount, keyBlob, keyStoreAbi, NATIVE_ASSET, parseDeployment, pqSignerFromSeed, predictKeyPointer, SELF_BUNDLE_GAS } from '@/lib/sdk';
import {
  fallbackVerifierAbi,
  firstOperationCalls,
  fundRequest,
  hotSetupFor,
  hotTierValid,
  newTreasuryAccount,
  OPERATION_GAS,
  parseCap,
  prefundFor,
  prepareKeyRequest,
  storeKeyRequest,
} from '@/lib/treasury';

const KEY_STORE = '0x00000000000000000000000000000000000000a1' as Address;
const VERIFIER = '0x00000000000000000000000000000000000000b2' as Address;
const WALLET = '0x1843da7839e800b01241be694dA2AE7695D00AEb' as Address;
const signer = pqSignerFromSeed('mldsa44', new Uint8Array(32).fill(7));
const blob = keyBlob(signer);

describe('the transactions of "Open a treasury"', () => {
  it('stores the key blob in the key store', () => {
    const r = storeKeyRequest(KEY_STORE, blob);
    expect(r.to).toBe(KEY_STORE);
    expect(r.data!.slice(0, 10)).toBe(toFunctionSelector('store(bytes)'));
    const { functionName, args } = decodeFunctionData({ abi: keyStoreAbi, data: r.data! });
    expect(functionName).toBe('store');
    expect(args[0]).toBe(blob);
    // the blob is the scheme byte and the 1,312-byte ML-DSA-44 public key
    expect((blob.length - 2) / 2).toBe(1 + 1312);
  });

  it('prepares the key for the Solidity verifier by its 20-byte pointer', () => {
    const pointer = predictKeyPointer(KEY_STORE, blob);
    const r = prepareKeyRequest(VERIFIER, pointer);
    expect(r.to).toBe(VERIFIER);
    expect(r.data!.slice(0, 10)).toBe(toFunctionSelector('prepareKey(bytes)'));
    const { args } = decodeFunctionData({ abi: fallbackVerifierAbi, data: r.data! });
    expect((args[0] as Hex).toLowerCase()).toBe(pointer.toLowerCase());
  });

  it('reserves the whole operation gas at the max fee, with a fifth on top', () => {
    expect(OPERATION_GAS).toBe(SELF_BUNDLE_GAS.verificationGasLimit + SELF_BUNDLE_GAS.callGasLimit + SELF_BUNDLE_GAS.preVerificationGas);
    expect(OPERATION_GAS).toBe(4_100_000n);
    expect(prefundFor(10_000_000n)).toBe(49_200_000_000_000n);
  });

  it('tops the account up only by what it lacks', () => {
    const acct = '0x00000000000000000000000000000000000000c3' as Address;
    expect(fundRequest(acct, 100n, 0n)).toEqual({ to: acct, value: 100n });
    expect(fundRequest(acct, 100n, 40n)).toEqual({ to: acct, value: 60n });
    expect(fundRequest(acct, 100n, 100n)).toBeNull();
    expect(fundRequest(acct, 100n, 500n)).toBeNull();
  });

  it('moves nothing in the first operation', () => {
    expect(firstOperationCalls(WALLET)).toEqual([{ to: WALLET, value: 0n }]);
  });

  it('builds the hot tier from the form', () => {
    expect(parseCap('0.5')).toBe(parseEther('0.5'));
    expect(parseCap(' 2 ')).toBe(parseEther('2'));
    expect(parseCap('')).toBe(0n);
    expect(parseCap('1,5')).toBeNull();
    expect(hotTierValid(parseEther('0.5'), 24)).toBe(true);
    expect(hotTierValid(0n, 24)).toBe(false);
    expect(hotTierValid(null, 24)).toBe(false);
    expect(hotTierValid(1n, 0)).toBe(false);
    expect(hotTierValid(1n, 0.01)).toBe(false);
    expect(hotTierValid(1n, 24 * 91)).toBe(false);
    expect(hotTierValid(2n ** 128n, 24)).toBe(false);
    expect(hotSetupFor(WALLET, 5n, 1.5)).toEqual({
      window: 5400,
      levelBps: DEFAULT_LEVEL_BPS,
      signer: { family: 'secp256k1', eoa: WALLET },
      assets: [{ asset: NATIVE_ASSET, cap: 5n }],
    });
  });

  it('appends the hot tier install to the first operation of an undeployed account', async () => {
    const d = parseDeployment(33139, {
      network: 'apechain',
      chainId: 33139,
      stylus: { mldsa44Verifier: '0x00000000000000000000000000000000000000d4' },
      evm: {
        keyStore: KEY_STORE,
        quantumValidator: '0x00000000000000000000000000000000000000e5',
        hotTierExecutor: '0x00000000000000000000000000000000000000f6',
        canaryRegistry: '0x0000000000000000000000000000000000000107',
      },
    });
    // a node that knows nothing: the account is not deployed and its nonce is zero
    const client = createPublicClient({
      transport: custom({
        request: async ({ method }: { method: string }) => {
          if (method === 'eth_chainId') return '0x8173';
          if (method === 'eth_getCode') return '0x';
          if (method === 'eth_call') return `0x${'0'.repeat(64)}`;
          throw new Error(`unexpected ${method}`);
        },
      }),
    });
    const account = await createQanaryAccount(client, {
      signer,
      registry: d.canaryRegistry!,
      deployment: d,
      hot: hotSetupFor(WALLET, parseEther('0.5'), 24),
      address: '0x00000000000000000000000000000000000000c3',
    });
    const callData = (await account.encodeCalls(firstOperationCalls(WALLET).map((c) => ({ ...c, data: '0x' as Hex })))).toLowerCase();
    // the install of the executor (module type 2) and the wallet as the hot key both ride on it
    expect(callData).toContain(toFunctionSelector('installModule(uint256,address,bytes)').slice(2));
    expect(callData).toContain(d.hotTierExecutor!.slice(2).toLowerCase());
    expect(callData).toContain(WALLET.slice(2).toLowerCase());
    expect(callData).toContain(d.canaryRegistry!.slice(2).toLowerCase());
    // and an account without a hot tier sends the bare call
    const bare = await createQanaryAccount(client, { signer, registry: zeroAddress, deployment: d, address: account.address });
    const bareData = (await bare.encodeCalls(firstOperationCalls(WALLET).map((c) => ({ ...c, data: '0x' as Hex })))).toLowerCase();
    expect(bareData).not.toContain(d.hotTierExecutor!.slice(2).toLowerCase());
  });
});

describe('the address of a new treasury', () => {
  const d = parseDeployment(33139, {
    network: 'apechain',
    chainId: 33139,
    stylus: { mldsa44Verifier: '0x00000000000000000000000000000000000000d4' },
    evm: {
      keyStore: KEY_STORE,
      quantumValidator: '0x00000000000000000000000000000000000000e5',
      hotTierExecutor: '0x00000000000000000000000000000000000000f6',
      canaryRegistry: '0x0000000000000000000000000000000000000107',
    },
  });
  const SENDER = '0x2a36F839a8fEe69758609952F3e24cB9B30A08AE' as Address;
  const senderResult = encodeErrorResult({ abi: parseAbi(['error SenderAddressResult(address sender)']), errorName: 'SenderAddressResult', args: [SENDER] });
  const pointer = predictKeyPointer(KEY_STORE, blob);

  const node = (answer: (override: Record<string, { code?: Hex }> | undefined) => Address) =>
    createPublicClient({
      transport: custom({
        request: async ({ method, params }: { method: string; params?: unknown[] }) => {
          if (method === 'eth_chainId') return '0x8173';
          if (method === 'eth_getCode') return '0x';
          if (method === 'eth_call') {
            const override = (params as unknown[])[2] as Record<string, { code?: Hex }> | undefined;
            // the EntryPoint reports the address by reverting with it
            throw Object.assign(new Error('execution reverted'), {
              code: 3,
              data: encodeErrorResult({ abi: parseAbi(['error SenderAddressResult(address sender)']), errorName: 'SenderAddressResult', args: [answer(override)] }),
            });
          }
          throw new Error(`unexpected ${method}`);
        },
      }),
    });

  it('asks the EntryPoint with the key already in the key store', async () => {
    let seen: Hex | undefined;
    const client = node((override) => {
      const entry = override && Object.entries(override).find(([a]) => a.toLowerCase() === pointer.toLowerCase());
      seen = entry?.[1].code;
      // without the key the deployment fails and the EntryPoint answers zero
      return seen ? SENDER : zeroAddress;
    });
    const account = await newTreasuryAccount(client, { signer, deployment: d, registry: d.canaryRegistry! });
    expect(seen?.toLowerCase()).toBe(concat(['0x00', blob]).toLowerCase());
    expect(account.address).toBe(SENDER);
    expect(senderResult.slice(0, 10)).toBe(toFunctionSelector('SenderAddressResult(address)'));
  });

  it('refuses a zero answer instead of funding the zero address', async () => {
    const client = node(() => zeroAddress);
    await expect(newTreasuryAccount(client, { signer, deployment: d, registry: d.canaryRegistry! })).rejects.toThrow(/could not work out/);
    expect(() => fundRequest(zeroAddress, 100n, 0n)).toThrow(/not known/);
  });
});
