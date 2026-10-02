import {
  parseEventLogs,
  type Account,
  type Address,
  type Chain,
  type Client,
  type Hash,
  type Hex,
  type TransactionReceipt,
  type Transport,
} from 'viem';
import { entryPoint07Abi, getUserOperationHash, toPackedUserOperation, type UserOperation } from 'viem/account-abstraction';
import { estimateFeesPerGas, getChainId, writeContract } from 'viem/actions';
import type { KernelSmartAccount } from './kernel.js';

/**
 * Gas limits of a self-bundled user operation. They are signed, so they are fixed up front:
 * the defaults cover account deployment plus a post-quantum verification (Stylus) with margin.
 * EntryPoint v0.7 refunds unused gas to the account (minus 10% of unused execution gas).
 */
export const SELF_BUNDLE_GAS = {
  verificationGasLimit: 3_000_000n,
  callGasLimit: 1_000_000n,
  /** Paid to the bundler, which is the sender of `handleOps` here; it only needs to be non-zero. */
  preVerificationGas: 100_000n,
} as const;

export type SelfBundleOptions = {
  calls: readonly { to: Address; value?: bigint; data?: Hex }[];
  verificationGasLimit?: bigint;
  callGasLimit?: bigint;
  preVerificationGas?: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
  /** Receives the gas refund paid by the account; default: the sender of `handleOps`. */
  beneficiary?: Address;
  /** Gas limit of the outer `handleOps` transaction (default: estimated). */
  gas?: bigint;
};

/**
 * Builds, signs and submits one user operation of `account` with `EntryPoint.handleOps` sent by
 * `wallet` (no bundler): the path for chains without a public ERC-4337 bundler and for budgeted
 * mainnet runs. Includes `initCode` while the account is not deployed and any pending module
 * installs `account.encodeCalls` adds. The account pays the gas (prefund) from its balance.
 *
 * `handleOps` does not revert when the operation's execution reverts; check the result with
 * `userOperationOutcome`.
 */
export async function selfBundleUserOperation(
  wallet: Client<Transport, Chain | undefined, Account>,
  account: KernelSmartAccount,
  opts: SelfBundleOptions,
): Promise<{ userOpHash: Hash; hash: Hash }> {
  const chainId = wallet.chain?.id ?? (await getChainId(wallet));
  const [factoryArgs, nonce, callData, fees] = await Promise.all([
    account.getFactoryArgs(),
    account.getNonce(),
    account.encodeCalls(opts.calls.map((c) => ({ to: c.to, value: c.value ?? 0n, data: c.data ?? '0x' }))),
    opts.maxFeePerGas !== undefined && opts.maxPriorityFeePerGas !== undefined
      ? { maxFeePerGas: opts.maxFeePerGas, maxPriorityFeePerGas: opts.maxPriorityFeePerGas }
      : estimateFeesPerGas(wallet),
  ]);
  const userOperation: UserOperation<'0.7'> = {
    sender: account.address,
    nonce,
    ...(factoryArgs.factory ? { factory: factoryArgs.factory, factoryData: factoryArgs.factoryData } : {}),
    callData,
    callGasLimit: opts.callGasLimit ?? SELF_BUNDLE_GAS.callGasLimit,
    verificationGasLimit: opts.verificationGasLimit ?? SELF_BUNDLE_GAS.verificationGasLimit,
    preVerificationGas: opts.preVerificationGas ?? SELF_BUNDLE_GAS.preVerificationGas,
    maxFeePerGas: opts.maxFeePerGas ?? fees.maxFeePerGas,
    maxPriorityFeePerGas: opts.maxPriorityFeePerGas ?? fees.maxPriorityFeePerGas,
    signature: '0x',
  };
  userOperation.signature = await account.signUserOperation({ ...userOperation, chainId });
  const userOpHash = getUserOperationHash({
    userOperation,
    entryPointAddress: account.entryPoint.address,
    entryPointVersion: '0.7',
    chainId,
  });
  const hash = await writeContract(wallet, {
    address: account.entryPoint.address,
    abi: entryPoint07Abi,
    functionName: 'handleOps',
    args: [[toPackedUserOperation(userOperation)], opts.beneficiary ?? wallet.account.address],
    account: wallet.account,
    chain: wallet.chain,
    gas: opts.gas,
  });
  return { userOpHash, hash };
}

/** Whether the user operation `userOpHash` executed successfully in `receipt` (its `UserOperationEvent`). */
export function userOperationOutcome(receipt: TransactionReceipt, userOpHash: Hash): boolean | undefined {
  const event = parseEventLogs({ abi: entryPoint07Abi, eventName: 'UserOperationEvent', logs: receipt.logs }).find(
    (e) => e.args.userOpHash.toLowerCase() === userOpHash.toLowerCase(),
  );
  return event?.args.success;
}
