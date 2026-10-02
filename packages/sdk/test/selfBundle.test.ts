import { describe, expect, it } from 'vitest';
import { ml_dsa44 } from '@noble/post-quantum/ml-dsa.js';
import {
  concat,
  createPublicClient,
  createWalletClient,
  decodeFunctionData,
  encodeAbiParameters,
  encodeEventTopics,
  hexToBytes,
  numberToHex,
  pad,
  parseTransaction,
  type Address,
  type Hex,
  type TransactionReceipt,
  type TransactionSerialized,
} from 'viem';
import { entryPoint07Abi, entryPoint07Address, getUserOperationHash } from 'viem/account-abstraction';
import { privateKeyToAccount } from 'viem/accounts';
import { curtis } from 'viem/chains';
import {
  KERNEL_V3_3_ADDRESSES,
  SELF_BUNDLE_GAS,
  createQanaryAccount,
  parseDeployment,
  pqSignerFromSeed,
  selfBundleUserOperation,
  userOperationOutcome,
} from '../src/index.js';
import { mockTransport } from './rpc.js';

const VALIDATOR: Address = '0x1111111111111111111111111111111111111111';
const ACCOUNT: Address = '0x2222222222222222222222222222222222222222';
const SINK: Address = '0x4444444444444444444444444444444444444444';
const TX = `0x${'ab'.repeat(32)}` as Hex;

const deployment = parseDeployment(curtis.id, {
  stylus: { mldsa44Verifier: { address: '0x3333333333333333333333333333333333333333' } },
  evm: { keyStore: '0x5FbDB2315678afecb367f032d93F642f64180aa3', quantumValidator: VALIDATOR },
});
const signer = pqSignerFromSeed('mldsa44', new Uint8Array(32).fill(3));
const bundlerKey = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');

function chain(deployed: boolean) {
  const rpc = mockTransport({
    eth_chainId: () => numberToHex(curtis.id),
    eth_getCode: () => (deployed ? '0x6080' : '0x'),
    eth_call: (params) => {
      const { to, data } = params[0] as { to: Address; data: Hex };
      if (to.toLowerCase() === entryPoint07Address.toLowerCase()) {
        const { functionName } = decodeFunctionData({ abi: entryPoint07Abi, data });
        if (functionName === 'getNonce') return pad('0x05');
        throw Object.assign(new Error('execution reverted'), { code: 3, data: concat(['0x6ca7b806', pad(ACCOUNT)]) });
      }
      return '0x';
    },
    eth_getBlockByNumber: () => ({
      number: '0x1',
      hash: `0x${'11'.repeat(32)}`,
      parentHash: `0x${'00'.repeat(32)}`,
      timestamp: '0x1',
      baseFeePerGas: '0x17acc3c940',
      gasLimit: '0x4000000000000',
      gasUsed: '0x0',
      transactions: [],
    }),
    eth_maxPriorityFeePerGas: () => '0x0',
    eth_getTransactionCount: () => '0x0',
    eth_estimateGas: () => '0x989680',
    eth_sendRawTransaction: () => TX,
  });
  return {
    publicClient: createPublicClient({ chain: curtis, transport: rpc.transport }),
    wallet: createWalletClient({ account: bundlerKey, chain: curtis, transport: rpc.transport }),
    calls: rpc.calls,
  };
}

function sentHandleOps(calls: { method: string; params: unknown[] }[]) {
  const raw = calls.find((c) => c.method === 'eth_sendRawTransaction')!.params[0] as TransactionSerialized;
  const tx = parseTransaction(raw);
  expect(tx.to?.toLowerCase()).toBe(entryPoint07Address.toLowerCase());
  const { functionName, args } = decodeFunctionData({ abi: entryPoint07Abi, data: tx.data! });
  expect(functionName).toBe('handleOps');
  const [ops, beneficiary] = args as unknown as [
    { sender: Address; nonce: bigint; initCode: Hex; callData: Hex; preVerificationGas: bigint; signature: Hex }[],
    Address,
  ];
  return { tx, op: ops[0]!, beneficiary };
}

describe('selfBundleUserOperation', () => {
  it('submits a signed user operation with initCode through EntryPoint.handleOps', async () => {
    const { publicClient, wallet, calls } = chain(false);
    const account = await createQanaryAccount(publicClient, { signer, registry: SINK, deployment });
    const { userOpHash, hash } = await selfBundleUserOperation(wallet, account, { calls: [{ to: SINK, value: 7n }] });
    expect(hash).toBe(TX);

    const { op, beneficiary } = sentHandleOps(calls);
    expect(beneficiary).toBe(bundlerKey.address);
    expect(op.sender).toBe(ACCOUNT);
    const { factory, factoryData } = await account.getFactoryArgs();
    expect(factory).toBe(KERNEL_V3_3_ADDRESSES.metaFactory);
    expect(op.initCode).toBe(concat([factory!, factoryData!]).toLowerCase());
    expect(op.preVerificationGas).toBe(SELF_BUNDLE_GAS.preVerificationGas);

    // the signature is the raw ML-DSA-44 signature over the EntryPoint v0.7 userOpHash
    expect((op.signature.length - 2) / 2).toBe(2420);
    expect(ml_dsa44.verify(hexToBytes(op.signature), hexToBytes(userOpHash), signer.publicKey)).toBe(true);
    const nonceCall = calls.find(
      (c) => c.method === 'eth_call' && (c.params[0] as { data: Hex }).data.startsWith('0x35567e1a'),
    );
    expect(nonceCall).toBeDefined();
  });

  it('omits initCode once the account is deployed and recomputes the same hash', async () => {
    const { publicClient, wallet, calls } = chain(true);
    const account = await createQanaryAccount(publicClient, { signer, registry: SINK, deployment, address: ACCOUNT });
    const { userOpHash } = await selfBundleUserOperation(wallet, account, {
      calls: [{ to: SINK }],
      maxFeePerGas: 10n,
      maxPriorityFeePerGas: 1n,
      gas: 9_000_000n,
    });
    const { tx, op } = sentHandleOps(calls);
    expect(op.initCode).toBe('0x');
    expect(tx.gas).toBe(9_000_000n);
    const recomputed = getUserOperationHash({
      userOperation: {
        sender: ACCOUNT,
        nonce: 5n,
        callData: op.callData,
        callGasLimit: SELF_BUNDLE_GAS.callGasLimit,
        verificationGasLimit: SELF_BUNDLE_GAS.verificationGasLimit,
        preVerificationGas: SELF_BUNDLE_GAS.preVerificationGas,
        maxFeePerGas: 10n,
        maxPriorityFeePerGas: 1n,
        signature: '0x',
      },
      entryPointAddress: entryPoint07Address,
      entryPointVersion: '0.7',
      chainId: curtis.id,
    });
    expect(userOpHash).toBe(recomputed);
  });
});

describe('userOperationOutcome', () => {
  const event = entryPoint07Abi.find((x) => x.type === 'event' && x.name === 'UserOperationEvent')!;
  const log = (userOpHash: Hex, success: boolean) => ({
    address: entryPoint07Address,
    topics: encodeEventTopics({
      abi: [event],
      eventName: 'UserOperationEvent',
      args: { userOpHash, sender: ACCOUNT, paymaster: '0x0000000000000000000000000000000000000000' },
    }),
    data: encodeAbiParameters(
      [{ type: 'uint256' }, { type: 'bool' }, { type: 'uint256' }, { type: 'uint256' }],
      [5n, success, 1n, 1n],
    ),
  });
  const receipt = (logs: ReturnType<typeof log>[]) => ({ logs }) as unknown as TransactionReceipt;
  const H1 = `0x${'01'.repeat(32)}` as Hex;
  const H2 = `0x${'02'.repeat(32)}` as Hex;

  it('reads the success flag of the matching UserOperationEvent', () => {
    expect(userOperationOutcome(receipt([log(H1, true), log(H2, false)]), H1)).toBe(true);
    expect(userOperationOutcome(receipt([log(H1, true), log(H2, false)]), H2)).toBe(false);
    expect(userOperationOutcome(receipt([log(H1, true)]), H2)).toBeUndefined();
  });
});
