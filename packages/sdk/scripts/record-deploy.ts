/**
 * Adds deployment transactions and gas to the `evm` entries of deployments/<network>.json from the
 * receipts of the last `forge script script/Deploy.s.sol --broadcast` run on that network.
 *
 *   npx tsx scripts/record-deploy.ts --network <arbitrum-one|apechain|…>
 *
 * Every entry whose address a broadcast transaction created gets `deployTx`, `gasUsed` and
 * `costWei` (gas used × effective gas price, the parent-chain data fee included). Nonce-alignment
 * transactions (empty self-transfers) are listed under `nonceAlignment`. Fails if a receipt failed or
 * a recorded address has no code on-chain.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createPublicClient, getAddress, http, type Address } from 'viem';
import { chainFor, deploymentPath, fail, flag, REPO_ROOT, resolveNetwork, rpcUrl } from './lib.js';

type Receipt = { transactionHash: string; contractAddress?: string | null; gasUsed: string; effectiveGasPrice: string; status: string };
type BroadcastTx = { hash: string; transactionType: string; contractAddress?: string | null; transaction: { to?: string | null } };

const net = resolveNetwork(flag('network'));
const broadcast = resolve(REPO_ROOT, 'contracts/evm/broadcast/Deploy.s.sol', String(net.chainId), 'run-latest.json');
if (!existsSync(broadcast)) fail(`${broadcast} not found: run Deploy.s.sol with --broadcast first`);
const run = JSON.parse(readFileSync(broadcast, 'utf8')) as { transactions: BroadcastTx[]; receipts: Receipt[] };
const path = deploymentPath(net);
const json = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
const evm = (json.evm ?? {}) as Record<string, Record<string, unknown>>;

const receipts = new Map(run.receipts.map((r) => [r.transactionHash.toLowerCase(), r]));
const byAddress = new Map<string, Receipt>();
const alignment: string[] = [];
for (const tx of run.transactions) {
  const r = receipts.get(tx.hash.toLowerCase());
  if (!r) fail(`no receipt for ${tx.hash} (pending?)`);
  if (BigInt(r.status) !== 1n) fail(`transaction ${tx.hash} failed`);
  if (tx.contractAddress) byAddress.set(tx.contractAddress.toLowerCase(), r);
  else if (tx.transactionType === 'CALL') alignment.push(tx.hash);
}

const client = createPublicClient({ chain: chainFor(net), transport: http(rpcUrl(net)) });
let total = 0n;
for (const [key, entry] of Object.entries(evm)) {
  if (typeof entry !== 'object' || typeof entry.address !== 'string') continue;
  const address = getAddress(entry.address) as Address;
  const code = await client.getCode({ address });
  if (!code || code === '0x') fail(`evm.${key} ${address} has no code on ${net.label}`);
  const r = byAddress.get(address.toLowerCase());
  if (!r) continue;
  const gasUsed = BigInt(r.gasUsed);
  const cost = gasUsed * BigInt(r.effectiveGasPrice);
  total += cost;
  evm[key] = { ...entry, deployTx: r.transactionHash, gasUsed: Number(gasUsed), costWei: cost.toString() };
  console.log(`${key.padEnd(24)} ${address} ${r.transactionHash} gas ${gasUsed}`);
}
if (alignment.length) {
  const prev = (json.nonceAlignment ?? {}) as { txs?: string[] };
  const txs = [...new Set([...(prev.txs ?? []), ...alignment])];
  json.nonceAlignment = { note: 'empty self-transfers that align the deployer nonce with ApeChain', txs };
}
json.evm = evm;
writeFileSync(path, `${JSON.stringify(json, null, 2)}\n`);
console.log(`recorded in ${path}; this run's deployments cost ${total} wei`);
