import { decodeFunctionResult, encodeFunctionData, type Address, type Hex, type PublicClient } from 'viem';
import { call, estimateGas, readContract } from 'viem/actions';
import { NODE_INTERFACE_ADDRESS, nodeInterfaceAbi } from './abis/nodeInterface.js';
import { pqVerifierAbi } from './abis/pqVerifier.js';
import { ERC7913_MAGIC } from './schemes.js';

/**
 * Calls `verify(key, hash, signature)` on an ERC-7913 post-quantum verifier.
 * `key` is either a 20-byte KeyStore pointer or an inline `scheme ‖ pk` blob.
 *
 * - `valid` is true iff the verifier returns the ERC-7913 magic `0x024ad318`.
 * - Malformed inputs make the verifier revert (`InvalidKey`, `InvalidKeyLength`,
 *   `InvalidSignatureLength`, `UnsupportedScheme`); that revert is thrown, decoded.
 * - `gas` is the gas of a standalone transaction calling `verify` (intrinsic + calldata +
 *   execution). On Arbitrum it is the L2 part only: NodeInterface `gasEstimateComponents`
 *   total minus its L1 data component; elsewhere it is `eth_estimateGas`.
 */
export async function verifyOnChain(
  client: PublicClient,
  verifier: Address,
  key: Hex,
  hash: Hex,
  sig: Hex,
): Promise<{ valid: boolean; gas: bigint }> {
  const result = await readContract(client, {
    address: verifier,
    abi: pqVerifierAbi,
    functionName: 'verify',
    args: [key, hash, sig],
  });
  const data = encodeFunctionData({ abi: pqVerifierAbi, functionName: 'verify', args: [key, hash, sig] });
  const gas = (await arbitrumL2Gas(client, verifier, data)) ?? (await estimateGas(client, { to: verifier, data }));
  return { valid: result.toLowerCase() === ERC7913_MAGIC, gas };
}

/**
 * L2 gas for calling `to` with `data` via the Arbitrum NodeInterface. Returns undefined on chains
 * without NodeInterface (an eth_call to its address returns empty data there).
 */
async function arbitrumL2Gas(client: PublicClient, to: Address, data: Hex): Promise<bigint | undefined> {
  const { data: ret } = await call(client, {
    to: NODE_INTERFACE_ADDRESS,
    data: encodeFunctionData({ abi: nodeInterfaceAbi, functionName: 'gasEstimateComponents', args: [to, false, data] }),
  });
  if (!ret || ret === '0x') return undefined;
  const [gasEstimate, gasEstimateForL1] = decodeFunctionResult({
    abi: nodeInterfaceAbi,
    functionName: 'gasEstimateComponents',
    data: ret,
  });
  return gasEstimate - gasEstimateForL1;
}
