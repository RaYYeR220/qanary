/**
 * Prints the state of a Qanary deployment and, optionally, of one account.
 *
 *   npx tsx scripts/status.ts <arbitrum-one|apechain|apechain-curtis|arbitrum-sepolia> [account]
 *
 * Deployment: every contract with whether code is present; the canary registry's ladder level,
 * broken families, claims and bounties. Account: Kernel root validator, post-quantum root key and
 * guardians, hot-tier scale and availability; for an EOA, its quantum exposure.
 */
import { createPublicClient, formatEther, http, isAddress, zeroAddress, type Address, type PublicClient } from 'viem';
import {
  CANARY_TARGET,
  CORE_CONTRACTS,
  canary,
  hotTier,
  kernelAccountAbi,
  quantumValidatorAbi,
  scanExposure,
  type CanaryTarget,
} from '../src/index.js';
import { chainFor, deploymentPath, fail, readDeploymentFile, resolveNetwork, rpcUrl } from './lib.js';

const net = resolveNetwork(process.argv[2]);
const accountArg = process.argv[3];
if (accountArg !== undefined && !isAddress(accountArg)) fail(`not an address: ${accountArg}`);
const symbol = net.nativeSymbol;

const client = createPublicClient({ chain: chainFor(net), transport: http(rpcUrl(net)) }) as PublicClient;

async function hasCode(address: Address): Promise<boolean> {
  const code = await client.getCode({ address });
  return !!code && code !== '0x';
}

async function show(label: string, address: Address | undefined): Promise<void> {
  if (!address) return console.log(`  ${label.padEnd(22)} -`);
  console.log(`  ${label.padEnd(22)} ${address} ${(await hasCode(address)) ? '' : '(no code!)'}`);
}

async function main(): Promise<void> {
  const loaded = readDeploymentFile(net);
  if (!loaded) fail(`${deploymentPath(net)} not found: nothing deployed on ${net.label} yet`);
  const d = loaded.deployment;
  console.log(`${net.label} (chain ${d.chainId}), block ${await client.getBlockNumber()}`);

  console.log('verifiers');
  for (const [scheme, address] of Object.entries(d.verifiers)) await show(scheme, address);
  await show('ladderVerifier', d.ladderVerifier);
  console.log('contracts');
  for (const name of CORE_CONTRACTS) await show(name, d[name]);

  if (d.canaryRegistry && (await hasCode(d.canaryRegistry))) {
    const c = canary(client, d.canaryRegistry);
    const [level, k1Broken, r1Broken] = await Promise.all([c.level(), c.familyBroken(0), c.familyBroken(1)]);
    console.log(`canary: ladder level ${level}, secp256k1 broken ${k1Broken}, P-256 broken ${r1Broken}`);
    for (const [name, target] of Object.entries(CANARY_TARGET) as [string, CanaryTarget][]) {
      const [claimed, bounty] = await Promise.all([c.claimed(target), c.bounty(target)]);
      console.log(
        `  ${name}: ${claimed ? 'CLAIMED' : 'open'}, bounty ${bounty.tokenAmount} token units + ${formatEther(bounty.ethAmount)} ${symbol}`,
      );
    }
  }

  if (!accountArg) return;
  const account = accountArg as Address;
  console.log(`account ${account}`);
  if (!(await hasCode(account)) || (await client.getCode({ address: account }))?.startsWith('0xef0100')) {
    const report = await scanExposure(client, account);
    console.log(`  EOA: nonce ${report.nonce}, exposed ${report.exposed}${report.delegatedTo ? `, delegated to ${report.delegatedTo}` : ''}`);
    if (report.publicKey) console.log(`  public key ${report.publicKey} (from ${report.exposingTx})`);
    for (const b of report.balances) {
      console.log(`  balance ${b.token === zeroAddress ? symbol : b.token}: ${b.amount}`);
    }
    return;
  }
  const root = await client
    .readContract({ address: account, abi: kernelAccountAbi, functionName: 'rootValidator' })
    .catch(() => undefined);
  console.log(`  Kernel root validation ${root ?? '(not a Kernel v3 account)'}`);
  if (d.quantumValidator) {
    const [config, guardians] = await Promise.all([
      client.readContract({ address: d.quantumValidator, abi: quantumValidatorAbi, functionName: 'configOf', args: [account] }),
      client.readContract({ address: d.quantumValidator, abi: quantumValidatorAbi, functionName: 'guardiansOf', args: [account] }),
    ]);
    console.log(`  PQ root key: verifier ${config.verifier}, keyPtr ${config.keyPtr}`);
    console.log(`  guardians: ${guardians[0].length} (threshold ${guardians[1]}, delay ${guardians[2]} s)`);
  }
  if (d.hotTierExecutor) {
    const status = await hotTier(client, d.hotTierExecutor).status(account);
    if (!status.configured) console.log('  hot tier: not configured');
    else {
      console.log(`  hot tier: ${status.effectiveBps} bps${status.frozen ? ' (FROZEN)' : ''}, nonce ${status.nonce}`);
      for (const a of status.assets) console.log(`    ${a.asset}: ${a.available} available`);
    }
  }
  console.log(`  balance ${formatEther(await client.getBalance({ address: account }))} ${symbol}`);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
