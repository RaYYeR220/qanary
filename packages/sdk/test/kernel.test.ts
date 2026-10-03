import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ml_dsa44 } from '@noble/post-quantum/ml-dsa.js';
import { KernelFactoryStakerAbi, KernelV3_3AccountAbi } from '@zerodev/sdk';
import {
  concat,
  createPublicClient,
  decodeAbiParameters,
  decodeFunctionData,
  hashMessage,
  hexToBytes,
  numberToHex,
  pad,
  sliceHex,
  type Address,
  type Hex,
} from 'viem';
import { entryPoint07Abi, entryPoint07Address, getUserOperationHash } from 'viem/account-abstraction';
import { arbitrumSepolia } from 'viem/chains';
import {
  KERNEL_V3_3_ADDRESSES,
  NATIVE_ASSET,
  accountDigest,
  createQanaryAccount,
  encodeValidatorInstallData,
  hotTierInitData,
  kernelAccountAbi,
  kernelWrappedHash,
  keyBlob,
  parseDeployment,
  pqSignerFromSeed,
  predictKeyPointer,
  type HotSetup,
} from '../src/index.js';
import { mockTransport } from './rpc.js';

const vector = JSON.parse(readFileSync(new URL('./fixtures/hot-tier-vector.json', import.meta.url), 'utf8')) as {
  executorInitData: Hex;
};

const VALIDATOR: Address = '0x1111111111111111111111111111111111111111';
const VERIFIER: Address = '0x3333333333333333333333333333333333333333';
const KEY_STORE: Address = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const EXECUTOR: Address = '0x8888888888888888888888888888888888888888';
const REGISTRY: Address = '0x6666666666666666666666666666666666666666';
const ACCOUNT: Address = '0x2222222222222222222222222222222222222222';

const deployment = parseDeployment(421614, {
  stylus: { mldsa44Verifier: { address: VERIFIER } },
  evm: { keyStore: KEY_STORE, quantumValidator: VALIDATOR, hotTierExecutor: EXECUTOR },
});

/** Same policy as the forge executor-initData vector. */
const HOT: HotSetup = {
  window: 86_400,
  levelBps: [10_000, 5_000, 2_500, 0],
  signer: { family: 'secp256k1', eoa: '0x7777777777777777777777777777777777777777' },
  assets: [
    { asset: NATIVE_ASSET, cap: 10n ** 15n },
    { asset: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', cap: 100_000_000n },
  ],
  allow: [{ target: '0x5555555555555555555555555555555555555555', selector: '0xa9059cbb' }],
};

const SENDER_ADDRESS_RESULT = '0x6ca7b806'; // SenderAddressResult(address)

/**
 * RPC for an account that is not deployed yet: the EntryPoint reports `ACCOUNT` as sender,
 * account calls return no data, `getNonce` returns 0.
 */
function chain(opts: { deployed?: boolean } = {}) {
  const rpc = mockTransport({
    eth_chainId: () => numberToHex(arbitrumSepolia.id),
    eth_getCode: () => (opts.deployed ? '0x6080' : '0x'),
    eth_call: (params) => {
      const { to, data } = params[0] as { to: Address; data: Hex };
      if (to.toLowerCase() === entryPoint07Address.toLowerCase()) {
        const { functionName } = decodeFunctionData({ abi: entryPoint07Abi, data });
        if (functionName === 'getNonce') return pad('0x00');
        // getSenderAddress always reverts with the counterfactual address
        throw Object.assign(new Error('execution reverted'), {
          code: 3,
          data: concat([SENDER_ADDRESS_RESULT, pad(ACCOUNT)]),
        });
      }
      return '0x'; // undeployed account: isModuleInstalled / eip712Domain have no code to run
    },
  });
  return { client: createPublicClient({ chain: arbitrumSepolia, transport: rpc.transport }), calls: rpc.calls };
}

const signer = pqSignerFromSeed('mldsa44', new Uint8Array(32).fill(9));
const keyPtr = predictKeyPointer(KEY_STORE, keyBlob(signer));

function decodeInitCode(factoryData: Hex) {
  const outer = decodeFunctionData({ abi: KernelFactoryStakerAbi, data: factoryData });
  expect(outer.functionName).toBe('deployWithFactory');
  const [factory, createData, salt] = outer.args as [Address, Hex, Hex];
  const init = decodeFunctionData({ abi: KernelV3_3AccountAbi, data: createData });
  expect(init.functionName).toBe('initialize');
  const [rootValidator, hook, validatorData, hookData, initConfig] = init.args as [Hex, Address, Hex, Hex, Hex[]];
  return { factory, salt, rootValidator, hook, validatorData, hookData, initConfig };
}

/** Decodes Kernel `execute(mode, executionCalldata)` into its calls (single or batch). */
function decodeExecute(callData: Hex) {
  const { functionName, args } = decodeFunctionData({ abi: KernelV3_3AccountAbi, data: callData });
  expect(functionName).toBe('execute');
  const [mode, exec] = args as [Hex, Hex];
  if (sliceHex(mode, 0, 1) === '0x01') {
    const [calls] = decodeAbiParameters(
      [{ type: 'tuple[]', components: [{ type: 'address' }, { type: 'uint256' }, { type: 'bytes' }] }],
      exec,
    );
    return calls.map(([to, value, data]) => ({ to, value, data }));
  }
  const data = (exec.length - 2) / 2 > 52 ? sliceHex(exec, 52) : '0x';
  return [{ to: sliceHex(exec, 0, 20), value: BigInt(sliceHex(exec, 20, 52)), data }];
}

describe('createQanaryAccount', () => {
  it('works the address out with the root key in place, before the key is stored', async () => {
    // the EntryPoint reports the account only when the key's code is at its pointer, zero otherwise
    let override: Hex | undefined;
    const rpc = mockTransport({
      eth_chainId: () => numberToHex(arbitrumSepolia.id),
      eth_getCode: () => '0x',
      eth_call: (params) => {
        const state = params[2] as Record<string, { code?: Hex }> | undefined;
        override = state && Object.entries(state).find(([a]) => a.toLowerCase() === keyPtr.toLowerCase())?.[1].code;
        throw Object.assign(new Error('execution reverted'), {
          code: 3,
          data: concat([SENDER_ADDRESS_RESULT, pad(override ? ACCOUNT : '0x00')]),
        });
      },
    });
    const client = createPublicClient({ chain: arbitrumSepolia, transport: rpc.transport });
    const account = await createQanaryAccount(client, { signer, registry: REGISTRY, deployment });
    expect(account.address).toBe(ACCOUNT);
    expect(override).toBe(concat(['0x00', keyBlob(signer)]));
  });

  it('never returns the zero address', async () => {
    const rpc = mockTransport({
      eth_chainId: () => numberToHex(arbitrumSepolia.id),
      eth_getCode: () => '0x',
      eth_call: () => {
        throw Object.assign(new Error('execution reverted'), { code: 3, data: concat([SENDER_ADDRESS_RESULT, pad('0x00')]) });
      },
    });
    const client = createPublicClient({ chain: arbitrumSepolia, transport: rpc.transport });
    await expect(createQanaryAccount(client, { signer, registry: REGISTRY, deployment })).rejects.toThrow(/zero address/);
    await expect(
      createQanaryAccount(client, { signer, registry: REGISTRY, deployment, address: '0x0000000000000000000000000000000000000000' }),
    ).rejects.toThrow(/zero address/);
  });

  it('builds Kernel v3.3 initCode with the QuantumValidator as root and no guardians', async () => {
    const { client } = chain();
    const account = await createQanaryAccount(client, { signer, registry: REGISTRY, deployment, index: 7n });
    expect(await account.getAddress()).toBe(ACCOUNT);
    const { factory, factoryData } = await account.getFactoryArgs();
    expect(factory).toBe(KERNEL_V3_3_ADDRESSES.metaFactory);
    const init = decodeInitCode(factoryData!);
    expect(init.factory).toBe(KERNEL_V3_3_ADDRESSES.factory);
    expect(init.salt).toBe(pad('0x07'));
    expect(init.rootValidator).toBe(concat(['0x01', VALIDATOR]));
    expect(init.hook).toBe('0x0000000000000000000000000000000000000000');
    expect(init.validatorData).toBe(encodeValidatorInstallData({ verifier: VERIFIER, keyPtr }));
    expect(init.hookData).toBe('0x');
    expect(init.initConfig).toEqual([]);
  });

  it('uses the root validation nonce key (mode 0x00, type 0x00 = root, validator, key 0)', async () => {
    const { client, calls } = chain();
    const account = await createQanaryAccount(client, { signer, registry: REGISTRY, deployment });
    await account.getNonce();
    const getNonce = calls
      .map((c) => c.params[0] as { to: Address; data: Hex })
      .filter((p) => p.to?.toLowerCase() === entryPoint07Address.toLowerCase())
      .map((p) => decodeFunctionData({ abi: entryPoint07Abi, data: p.data }))
      .find((d) => d.functionName === 'getNonce');
    expect(getNonce?.args).toEqual([ACCOUNT, BigInt(concat(['0x0000', VALIDATOR, '0x0000']))]);
  });

  it('appends the hot-tier install to the first user operation (ERC-7562-safe default)', async () => {
    const { client } = chain();
    const account = await createQanaryAccount(client, { signer, registry: REGISTRY, deployment, hot: HOT });
    // the hot tier does not change the initCode
    expect(decodeInitCode((await account.getFactoryArgs()).factoryData!).initConfig).toEqual([]);
    const calls = decodeExecute(await account.encodeCalls([{ to: REGISTRY, value: 1n, data: '0x' }]));
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual({ to: REGISTRY, value: 1n, data: '0x' });
    expect(calls[1]!.to).toBe(ACCOUNT);
    const install = decodeFunctionData({ abi: kernelAccountAbi, data: calls[1]!.data });
    expect(install.functionName).toBe('installModule');
    expect(install.args).toEqual([2n, EXECUTOR, vector.executorInitData]);
  });

  it('does not arm the hot-tier install for an already deployed account (no silent reinstall)', async () => {
    // e.g. the owner uninstalled the executor after a hot-key leak: isModuleInstalled is false again
    const { client } = chain({ deployed: true });
    const account = await createQanaryAccount(client, { signer, registry: REGISTRY, deployment, hot: HOT });
    const calls = decodeExecute(await account.encodeCalls([{ to: REGISTRY, value: 1n, data: '0x' }]));
    expect(calls).toEqual([{ to: REGISTRY, value: 1n, data: '0x' }]);
  });

  it('installHotTier: true installs on a deployed account; false never installs', async () => {
    const deployed = chain({ deployed: true });
    const explicit = await createQanaryAccount(deployed.client, {
      signer,
      registry: REGISTRY,
      deployment,
      hot: HOT,
      installHotTier: true,
    });
    const calls = decodeExecute(await explicit.encodeCalls([{ to: REGISTRY, value: 1n, data: '0x' }]));
    expect(calls).toHaveLength(2);
    expect(decodeFunctionData({ abi: kernelAccountAbi, data: calls[1]!.data }).args).toEqual([
      2n,
      EXECUTOR,
      vector.executorInitData,
    ]);

    const fresh = chain();
    const never = await createQanaryAccount(fresh.client, {
      signer,
      registry: REGISTRY,
      deployment,
      hot: HOT,
      installHotTier: false,
    });
    expect(decodeExecute(await never.encodeCalls([{ to: REGISTRY, value: 1n, data: '0x' }]))).toHaveLength(1);
  });

  it('rejects a deployment for another chain', async () => {
    const { client } = chain();
    await expect(
      createQanaryAccount(client, { signer, registry: REGISTRY, deployment: { ...deployment, chainId: 33111, network: 'apechain-curtis' } }),
    ).rejects.toThrow('deployment is for chain 33111 (apechain-curtis) but the client is on chain 421614');
  });

  it("hotInstall: 'initCode' installs the hot tier through Kernel initConfig", async () => {
    const { client } = chain();
    const account = await createQanaryAccount(client, {
      signer,
      registry: REGISTRY,
      deployment,
      hot: HOT,
      hotInstall: 'initCode',
    });
    const { initConfig } = decodeInitCode((await account.getFactoryArgs()).factoryData!);
    expect(initConfig).toHaveLength(1);
    const install = decodeFunctionData({ abi: kernelAccountAbi, data: initConfig[0]! });
    expect(install.args).toEqual([2n, EXECUTOR, hotTierInitData({ ...HOT, registry: REGISTRY })]);
    // and no extra call in the first user operation
    expect(decodeExecute(await account.encodeCalls([{ to: REGISTRY, value: 1n, data: '0x' }]))).toHaveLength(1);
  });

  it('signs user operations with the raw PQ signature over userOpHash', async () => {
    const { client } = chain();
    const account = await createQanaryAccount(client, { signer, registry: REGISTRY, deployment });
    const userOp = {
      sender: ACCOUNT,
      nonce: BigInt(concat(['0x0000', VALIDATOR, '0x0000'])) << 64n,
      callData: '0x' as Hex,
      callGasLimit: 100_000n,
      verificationGasLimit: 2_000_000n,
      preVerificationGas: 60_000n,
      maxFeePerGas: 10n,
      maxPriorityFeePerGas: 1n,
      signature: '0x' as Hex,
    };
    const signature = await account.signUserOperation(userOp);
    const hash = getUserOperationHash({
      userOperation: userOp,
      entryPointAddress: entryPoint07Address,
      entryPointVersion: '0.7',
      chainId: arbitrumSepolia.id,
    });
    expect(ml_dsa44.verify(hexToBytes(signature), hexToBytes(hash), signer.publicKey)).toBe(true);
    expect((signature.length - 2) / 2).toBe(2420);
    expect((await account.getStubSignature(userOp)).length).toBe(signature.length);
  });

  it('ERC-1271: 0x01 ‖ validator ‖ PQ signature over accountDigest(account, Kernel-wrapped hash)', async () => {
    const { client } = chain({ deployed: true });
    const account = await createQanaryAccount(client, { signer, registry: REGISTRY, deployment });
    const sig = await account.signMessage({ message: 'qanary' });
    expect(sliceHex(sig, 0, 21)).toBe(concat(['0x01', VALIDATOR]));
    const wrapped = kernelWrappedHash({ account: ACCOUNT, chainId: arbitrumSepolia.id, hash: hashMessage('qanary') });
    const digest = accountDigest({ validator: VALIDATOR, chainId: arbitrumSepolia.id, account: ACCOUNT, hash: wrapped });
    expect(ml_dsa44.verify(hexToBytes(sliceHex(sig, 21)), hexToBytes(digest), signer.publicKey)).toBe(true);
  });

  it('ERC-1271 before deployment is wrapped for ERC-6492 (factory, initCode, signature)', async () => {
    const { client } = chain();
    const account = await createQanaryAccount(client, { signer, registry: REGISTRY, deployment });
    const sig = await account.signMessage({ message: 'qanary' });
    expect(sliceHex(sig, -32)).toBe(`0x${'6492'.repeat(16)}`);
    const [factory, factoryData, inner] = decodeAbiParameters(
      [{ type: 'address' }, { type: 'bytes' }, { type: 'bytes' }],
      sliceHex(sig, 0, -32),
    );
    expect(factory).toBe(KERNEL_V3_3_ADDRESSES.metaFactory);
    expect(factoryData).toBe((await account.getFactoryArgs()).factoryData);
    expect(sliceHex(inner, 0, 21)).toBe(concat(['0x01', VALIDATOR]));
  });

  it('needs the core contracts in the deployment', async () => {
    const { client } = chain();
    await expect(
      createQanaryAccount(client, { signer, registry: REGISTRY, deployment: parseDeployment(421614, null) }),
    ).rejects.toThrow(/quantumValidator is not deployed on arbitrum-sepolia/);
    const noExecutor = parseDeployment(421614, {
      stylus: { mldsa44Verifier: { address: VERIFIER } },
      evm: { keyStore: KEY_STORE, quantumValidator: VALIDATOR },
    });
    await expect(
      createQanaryAccount(client, { signer, registry: REGISTRY, deployment: noExecutor, hot: HOT }),
    ).rejects.toThrow(/hotTierExecutor is not deployed/);
    const noVerifier = parseDeployment(421614, { evm: { keyStore: KEY_STORE, quantumValidator: VALIDATOR } });
    await expect(createQanaryAccount(client, { signer, registry: REGISTRY, deployment: noVerifier })).rejects.toThrow(
      /no mldsa44 verifier/,
    );
  });
});
