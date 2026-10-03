// "Open a treasury" against the deployed contracts, end to end, with nothing broadcast.
//
// A wallet is an EIP-1193 provider; this one belongs to a fresh, empty address. It answers
// reads from the network's public RPC and records every transaction the flow asks it to send.
// The recorded transactions are then executed in order on top of the live chain state with
// eth_simulateV1, the empty address credited in the simulation only. Nothing is signed by a
// funded key and nothing reaches the chain.
//
// Run with QANARY_LIVE=1 (it reads the live networks).

import {
  createWalletClient,
  custom,
  decodeFunctionResult,
  encodeFunctionData,
  keccak256,
  parseEventLogs,
  toHex,
  type Address,
  type Hex,
  type Log,
} from 'viem';
import { entryPoint07Abi } from 'viem/account-abstraction';
import { generatePrivateKey, privateKeyToAddress } from 'viem/accounts';
import { describe, expect, it } from 'vitest';
import { deploymentOf, publicClientFor, viemChain } from '@/lib/chain';
import { productNetworks } from '@/lib/deployments';
import { explainRevertData } from '@/lib/errors';
import {
  generateMnemonic,
  hotTierExecutorAbi,
  keyBlob,
  keyStoreAbi,
  pqSignerFromMnemonic,
  predictKeyPointer,
  quantumValidatorAbi,
  selfBundleUserOperation,
} from '@/lib/sdk';
import {
  firstOperationCalls,
  fundRequest,
  hotSetupFor,
  newTreasuryAccount,
  parseCap,
  prefundFor,
  prepareKeyRequest,
  storeKeyRequest,
  type TxRequest,
} from '@/lib/treasury';

const live = !!process.env.QANARY_LIVE;
const networks = live ? productNetworks().filter((n) => n.key === 'apechain' || n.key === 'arbitrum-one') : [];

type SimCall = { status: Hex; returnData: Hex; gasUsed: Hex; logs: Log[]; error?: { message: string } };

describe.skipIf(!live)('opening a treasury on the deployed contracts (simulated)', () => {
  for (const n of networks) {
    it(
      n.name,
      async () => {
        const client = publicClientFor(n);
        const d = deploymentOf(n);
        const solidity = n.stylus === 'paused';
        const wallet = privateKeyToAddress(generatePrivateKey());

        // the injected wallet: reads go to the RPC, transactions are recorded
        const sent: { label: string; request: TxRequest }[] = [];
        let label = '';
        const provider = {
          async request({ method, params }: { method: string; params?: unknown[] }) {
            if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [wallet];
            if (method === 'eth_chainId') return toHex(n.chainId);
            if (method === 'eth_sendTransaction') {
              const t = (params as { to: Address; data?: Hex; value?: Hex }[])[0]!;
              sent.push({ label, request: { to: t.to, data: t.data, value: t.value ? BigInt(t.value) : 0n } });
              return keccak256(toHex(`recorded ${sent.length}`));
            }
            return client.request({ method, params } as never);
          },
        };
        const walletClient = createWalletClient({ account: wallet, chain: viemChain(n), transport: custom(provider) });

        // I. the key, from a fresh recovery phrase
        const signer = pqSignerFromMnemonic('mldsa44', generateMnemonic());
        const blob = keyBlob(signer);
        const pointer = predictKeyPointer(d.keyStore!, blob);
        const verifier = d.verifiers.mldsa44!;

        // II. the hot tier and the address
        const cap = parseCap(n.key === 'arbitrum-one' ? '0.0001' : '0.5')!;
        const account = await newTreasuryAccount(client, {
          signer,
          registry: d.canaryRegistry!,
          deployment: d,
          hot: hotSetupFor(wallet, cap, 24),
        });

        // III-VI. the transactions the page sends, in its order
        label = 'store';
        await walletClient.sendTransaction(storeKeyRequest(d.keyStore!, blob));
        if (solidity) {
          label = 'prepare';
          await walletClient.sendTransaction(prepareKeyRequest(verifier, pointer));
        }
        const fees = await client.estimateFeesPerGas();
        const prefund = prefundFor(fees.maxFeePerGas);
        label = 'fund';
        await walletClient.sendTransaction(fundRequest(account.address, prefund, 0n)!);
        label = 'open';
        const { userOpHash } = await selfBundleUserOperation(walletClient, account, { calls: firstOperationCalls(wallet) });
        expect(sent.map((s) => s.label)).toEqual(solidity ? ['store', 'prepare', 'fund', 'open'] : ['store', 'fund', 'open']);

        // what the page reads afterwards
        const reads = [
          { to: d.quantumValidator!, data: encodeFunctionData({ abi: quantumValidatorAbi, functionName: 'configOf', args: [account.address] }) },
          { to: d.hotTierExecutor!, data: encodeFunctionData({ abi: hotTierExecutorAbi, functionName: 'isInitialized', args: [account.address] }) },
          { to: d.hotTierExecutor!, data: encodeFunctionData({ abi: hotTierExecutorAbi, functionName: 'effectiveBps', args: [account.address] }) },
        ];
        const [block] = (await client.request({
          method: 'eth_simulateV1',
          params: [
            {
              blockStateCalls: [
                {
                  // the empty wallet is credited here, in the simulation, and nowhere else
                  stateOverrides: { [wallet]: { balance: toHex(10n ** 24n) } },
                  calls: [
                    ...sent.map((s) => ({ from: wallet, to: s.request.to, data: s.request.data ?? '0x', value: toHex(s.request.value ?? 0n) })),
                    ...reads.map((r) => ({ from: wallet, ...r })),
                  ],
                },
              ],
              validation: false,
            },
            'latest',
          ],
        } as never)) as { calls: SimCall[] }[];
        const calls = block!.calls;
        const byLabel = Object.fromEntries(sent.map((s, i) => [s.label, calls[i]!]));
        for (const [k, c] of Object.entries(byLabel)) expect(c.status, `${k}: ${c.error?.message ?? ''} ${explainRevertData(c.returnData)?.name ?? ''} ${c.returnData.slice(0, 300)}`).toBe('0x1');

        // the key landed at its pointer
        const stored = decodeFunctionResult({ abi: keyStoreAbi, functionName: 'store', data: byLabel.store!.returnData });
        expect((stored as Address).toLowerCase()).toBe(pointer.toLowerCase());

        // the first operation executed: the account is deployed, rooted in the key, with its hot tier
        const event = parseEventLogs({ abi: entryPoint07Abi, eventName: 'UserOperationEvent', logs: byLabel.open!.logs }).find(
          (e) => e.args.userOpHash === userOpHash,
        );
        expect(event?.args.success).toBe(true);
        expect(event!.args.sender.toLowerCase()).toBe(account.address.toLowerCase());
        expect(event!.args.actualGasCost).toBeLessThanOrEqual(prefund);
        const [config, initialized, bps] = calls.slice(sent.length);
        const root = decodeFunctionResult({ abi: quantumValidatorAbi, functionName: 'configOf', data: config!.returnData }) as {
          verifier: Address;
          keyPtr: Address;
        };
        expect(root.keyPtr.toLowerCase()).toBe(pointer.toLowerCase());
        expect(root.verifier.toLowerCase()).toBe(verifier.toLowerCase());
        expect(decodeFunctionResult({ abi: hotTierExecutorAbi, functionName: 'isInitialized', data: initialized!.returnData })).toBe(true);
        const effective = decodeFunctionResult({ abi: hotTierExecutorAbi, functionName: 'effectiveBps', data: bps!.returnData });

        console.log(
          [
            `${n.name}: account ${account.address}, key ${pointer}`,
            ...sent.map((s, i) => `  ${s.label}: ${BigInt(calls[i]!.gasUsed).toLocaleString('en-US')} gas`),
            `  first operation: ${event!.args.actualGasUsed.toLocaleString('en-US')} gas inside the EntryPoint, prefund ${prefund} wei, cost ${event!.args.actualGasCost} wei`,
            `  hot tier effective scale ${effective} bps`,
          ].join('\n'),
        );
      },
      240_000,
    );
  }
});
