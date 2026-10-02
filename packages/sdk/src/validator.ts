import type { EntryPointType, GetKernelVersion, KernelValidator } from '@zerodev/sdk/types';
import {
  bytesToHex,
  concat,
  encodeAbiParameters,
  encodeFunctionData,
  hashTypedData,
  isAddress,
  isHex,
  size,
  zeroAddress,
  type Address,
  type Client,
  type Hex,
  type TypedDataDefinition,
} from 'viem';
import { getUserOperationHash, type EntryPointVersion, type UserOperation } from 'viem/account-abstraction';
import { toAccount } from 'viem/accounts';
import { getChainId, readContract } from 'viem/actions';
import { quantumValidatorAbi } from './abis/quantumValidator.js';
import { getDeployment, requireContract, requireVerifier } from './deployments.js';
import { keyBlob, predictKeyPointer } from './keystore.js';
import { SIGNATURE_BYTES, type PqSigner, type Scheme } from './schemes.js';
import { pqSignerFromSeed } from './signers/noble.js';

/** EIP-712 domain name and version of the QuantumValidator (`accountDigest`). */
export const QUANTUM_VALIDATOR_DOMAIN = { name: 'QanaryValidator', version: '1' } as const;

/** Kernel's ERC-1271 signature prefix for a signature checked by a (non-root-shortcut) validator. */
export const KERNEL_VALIDATOR_SIG_PREFIX: Hex = '0x01';

const installDataParams = [
  {
    type: 'tuple',
    components: [
      { name: 'verifier', type: 'address' },
      { name: 'keyPtr', type: 'address' },
      { name: 'guardians', type: 'bytes[]' },
      { name: 'threshold', type: 'uint8' },
      { name: 'delay', type: 'uint32' },
    ],
  },
] as const;

/** `QuantumValidator.InstallData`. Guardians default to none (`threshold = 0`). */
export type ValidatorInstallData = {
  verifier: Address;
  keyPtr: Address;
  guardians?: readonly Hex[];
  threshold?: number;
  delay?: number;
};

/**
 * `abi.encode(InstallData)`, the QuantumValidator `onInstall` payload.
 *
 * Install without guardians when the install runs inside ERC-4337 validation (account creation
 * through `initCode`, enable mode): guardian storage is not associated with the account under
 * ERC-7562 and bundlers reject it. Add guardians afterwards with `setGuardians` in a user
 * operation's execution phase.
 */
export function encodeValidatorInstallData(d: ValidatorInstallData): Hex {
  const guardians = d.guardians ?? [];
  const threshold = d.threshold ?? 0;
  const delay = d.delay ?? 0;
  if (!isAddress(d.verifier) || !isAddress(d.keyPtr)) throw new Error('install data: verifier and keyPtr must be addresses');
  if (!Number.isInteger(threshold) || threshold < 0 || threshold > 255) throw new Error('install data: threshold must be a uint8');
  if (!Number.isInteger(delay) || delay < 0 || delay > 0xffffffff) throw new Error('install data: delay must be a uint32');
  return encodeAbiParameters(installDataParams, [
    { verifier: d.verifier, keyPtr: d.keyPtr, guardians: [...guardians], threshold, delay },
  ]);
}

/**
 * The hash Kernel v3 hands its validator for an ERC-1271 check of `hash`: the EIP-712 digest of
 * `Kernel(bytes32 hash)` under the account's domain `{ name: "Kernel", version, chainId, account }`.
 */
export function kernelWrappedHash(p: { account: Address; chainId: number; hash: Hex; kernelVersion?: string }): Hex {
  return hashTypedData({
    domain: { name: 'Kernel', version: p.kernelVersion ?? '0.3.3', chainId: p.chainId, verifyingContract: p.account },
    types: { Kernel: [{ name: 'hash', type: 'bytes32' }] },
    primaryType: 'Kernel',
    message: { hash: p.hash },
  });
}

/**
 * `QuantumValidator.accountDigest(account, hash)`: the EIP-712 digest of
 * `AccountMessage(address account, bytes32 hash)` under the validator's domain. This is what the
 * account's post-quantum key signs for ERC-1271, binding the signature to one account.
 */
export function accountDigest(p: { validator: Address; chainId: number; account: Address; hash: Hex }): Hex {
  return hashTypedData({
    domain: { ...QUANTUM_VALIDATOR_DOMAIN, chainId: p.chainId, verifyingContract: p.validator },
    types: {
      AccountMessage: [
        { name: 'account', type: 'address' },
        { name: 'hash', type: 'bytes32' },
      ],
    },
    primaryType: 'AccountMessage',
    message: { account: p.account, hash: p.hash },
  });
}

/** Kernel ERC-1271 signature for a QuantumValidator signature: `0x01 ‖ validator ‖ pqSignature`. */
export function kernelErc1271Signature(validator: Address, pqSignature: Hex): Hex {
  return concat([KERNEL_VALIDATOR_SIG_PREFIX, validator, pqSignature]);
}

/** `QuantumValidator.MIN_RECOVERY_DELAY`: at least 24 hours between a recovery proposal and its execution. */
export const MIN_RECOVERY_DELAY_SECONDS = 86_400;

/**
 * The call that sets the account's recovery guardians (`QuantumValidator.setGuardians`), executed
 * by the account in a user operation's execution phase. Guardians are ERC-7913 signers
 * (`verifier ‖ key`); `threshold = 0` with no guardians disables recovery.
 *
 * Every guardian's verifier must be a post-quantum verifier: the validator calls its `schemes()`
 * and rejects classical ones (P-256, WebAuthn, RSA). Prefer guardians on a different verifier than
 * the root key (e.g. the Solidity ML-DSA-44 fallback), so recovery still works if the root's
 * Stylus program expires or cannot be reactivated.
 */
export function setGuardiansCall(
  validator: Address,
  guardians: readonly Hex[],
  threshold: number,
  delaySeconds: number,
): { to: Address; value: bigint; data: Hex } {
  if (threshold > 0 && delaySeconds < MIN_RECOVERY_DELAY_SECONDS) {
    throw new Error(`setGuardians: delay must be at least ${MIN_RECOVERY_DELAY_SECONDS} seconds`);
  }
  return {
    to: validator,
    value: 0n,
    data: encodeFunctionData({
      abi: quantumValidatorAbi,
      functionName: 'setGuardians',
      args: [[...guardians], threshold, delaySeconds],
    }),
  };
}

/** Inputs of the `Rotation` and `Recovery` digests: the account, the new root key and the nonce. */
export type KeyChangeDigestParams = {
  /** QuantumValidator module. */
  validator: Address;
  chainId: number;
  account: Address;
  /** New ERC-7913 verifier. */
  verifier: Address;
  /** New KeyStore pointer. */
  keyPtr: Address;
  /** `QuantumValidator.recoveryNonce(account)` when the rotation or proposal executes (`readRecoveryNonce`). */
  nonce: bigint;
};

function keyChangeDigest(primaryType: 'Rotation' | 'Recovery', p: KeyChangeDigestParams): Hex {
  return hashTypedData({
    domain: { ...QUANTUM_VALIDATOR_DOMAIN, chainId: p.chainId, verifyingContract: p.validator },
    types: {
      [primaryType]: [
        { name: 'account', type: 'address' },
        { name: 'verifier', type: 'address' },
        { name: 'keyPtr', type: 'address' },
        { name: 'nonce', type: 'uint256' },
      ],
    },
    primaryType,
    message: { account: p.account, verifier: p.verifier, keyPtr: p.keyPtr, nonce: p.nonce },
  });
}

/**
 * `QuantumValidator.rotationDigest(account, verifier, keyPtr)`: the EIP-712 digest of
 * `Rotation(address account,address verifier,address keyPtr,uint256 nonce)`. The NEW key signs it
 * as proof of possession for `rotateKeyCall` and `proposeRecoveryCall`; `nonce` is the account's
 * recovery nonce at execution time (anything earlier in the same batch that bumps it, such as
 * `setGuardians`, invalidates the proof).
 */
export function rotationDigest(p: KeyChangeDigestParams): Hex {
  return keyChangeDigest('Rotation', p);
}

/**
 * `QuantumValidator.recoveryDigest(account, verifier, keyPtr)`: the EIP-712 digest of
 * `Recovery(address account,address verifier,address keyPtr,uint256 nonce)` that guardians sign.
 */
export function recoveryDigest(p: KeyChangeDigestParams): Hex {
  return keyChangeDigest('Recovery', p);
}

/** Reads `QuantumValidator.recoveryNonce(account)`, the nonce of `rotationDigest` / `recoveryDigest`. */
export function readRecoveryNonce(client: Client, validator: Address, account: Address): Promise<bigint> {
  return readContract(client, {
    address: validator,
    abi: quantumValidatorAbi,
    functionName: 'recoveryNonce',
    args: [account],
  });
}

/**
 * The call that replaces the account's root key (`QuantumValidator.rotateKey`), executed by the
 * account. `proof` is the new key's signature over `rotationDigest` for this account; the
 * validator rejects the rotation without it, and rejects a verifier that is not post-quantum.
 */
export function rotateKeyCall(
  validator: Address,
  verifier: Address,
  keyPtr: Address,
  proof: Hex,
): { to: Address; value: bigint; data: Hex } {
  if (!isAddress(verifier) || !isAddress(keyPtr)) throw new Error('rotateKey: verifier and keyPtr must be addresses');
  return {
    to: validator,
    value: 0n,
    data: encodeFunctionData({ abi: quantumValidatorAbi, functionName: 'rotateKey', args: [verifier, keyPtr, proof] }),
  };
}

/**
 * The call that proposes a guardian recovery of `account` (`QuantumValidator.proposeRecovery`);
 * anyone may send it. `guardianSignatures[i]` is guardian `i`'s signature over `recoveryDigest`
 * (`'0x'` abstains) and `newKeyProof` is the proposed key's signature over `rotationDigest`, both
 * at the same nonce. The key can be installed with `executeRecovery` after the guardians' delay.
 */
export function proposeRecoveryCall(
  validator: Address,
  p: { account: Address; verifier: Address; keyPtr: Address; guardianSignatures: readonly Hex[]; newKeyProof: Hex },
): { to: Address; value: bigint; data: Hex } {
  if (!isAddress(p.account) || !isAddress(p.verifier) || !isAddress(p.keyPtr)) {
    throw new Error('proposeRecovery: account, verifier and keyPtr must be addresses');
  }
  return {
    to: validator,
    value: 0n,
    data: encodeFunctionData({
      abi: quantumValidatorAbi,
      functionName: 'proposeRecovery',
      args: [p.account, p.verifier, p.keyPtr, [...p.guardianSignatures], p.newKeyProof],
    }),
  };
}

const stubs = new Map<Scheme, Promise<Hex>>();

/**
 * A stub user-operation signature for `scheme`: a genuine signature by a throwaway random key over
 * a random hash. It has the real length (2420 / 3309 / 666 bytes) and full entropy, so calldata
 * gas and Arbitrum's L1-inclusive `preVerificationGas` are estimated as for the real signature,
 * and it passes the verifier's format checks, so gas estimation runs the full verification path
 * (an arbitrary byte string would be rejected early and under-estimate `verificationGasLimit`).
 * It never verifies against the account key. Created once per scheme and process.
 */
export function stubSignature(scheme: Scheme): Promise<Hex> {
  let stub = stubs.get(scheme);
  if (!stub) {
    stub = (async () => {
      const throwaway = pqSignerFromSeed(scheme, crypto.getRandomValues(new Uint8Array(32)));
      const sig = await throwaway.sign(bytesToHex(crypto.getRandomValues(new Uint8Array(32))));
      if (size(sig) !== SIGNATURE_BYTES[scheme]) throw new Error(`stub ${scheme} signature has unexpected length`);
      return sig;
    })();
    stubs.set(scheme, stub);
    stub.catch(() => stubs.delete(scheme)); // retry on the next call instead of caching a failure
  }
  return stub;
}

export type QuantumValidatorOptions<entryPointVersion extends EntryPointVersion> = {
  signer: PqSigner;
  entryPoint: EntryPointType<entryPointVersion>;
  kernelVersion: GetKernelVersion<entryPointVersion>;
  /** QuantumValidator module; default: the deployment for the client's chain. */
  validatorAddress?: Address;
  /** ERC-7913 verifier for `signer.scheme`; default: the deployment for the client's chain. */
  verifier?: Address;
  /** KeyStore pointer holding the signer's key; default: predicted from `keyStore` and the key. */
  keyPtr?: Address;
  /** KeyStore used to predict `keyPtr`; default: the deployment for the client's chain. */
  keyStore?: Address;
};

export type QuantumKernelValidator = KernelValidator<'QuantumValidator'> & {
  /** ERC-7913 verifier of the root key. */
  verifier: Address;
  /** KeyStore pointer of the root key (must hold `keyBlob` before the account is created). */
  keyPtr: Address;
  /** `scheme ‖ publicKey`, the blob stored at `keyPtr`. */
  keyBlob: Hex;
  signer: PqSigner;
};

/**
 * ZeroDev Kernel validator plugin whose root key is a post-quantum key verified on-chain by the
 * QuantumValidator module (use it as the `sudo` plugin).
 *
 * - User operations: the raw PQ signature over `userOpHash`.
 * - ERC-1271 (`signTypedData`, called by the Kernel account with its `Kernel(bytes32 hash)`
 *   wrapper): the PQ signature over `accountDigest(account, wrappedHash)`, where `account` is the
 *   typed data's `verifyingContract`. The account adds the `0x01 ‖ validator` prefix.
 * - `signMessage` only signs a raw 32-byte hash (`{ raw: hash }`) directly; it is a low-level
 *   primitive, not an ERC-1271 signature.
 */
export async function toQuantumValidator<entryPointVersion extends EntryPointVersion>(
  client: Client,
  opts: QuantumValidatorOptions<entryPointVersion>,
): Promise<QuantumKernelValidator> {
  const { signer, entryPoint } = opts;
  const chainId = client.chain?.id ?? (await getChainId(client));
  const deployment = () => getDeployment(chainId);

  const validatorAddress = opts.validatorAddress ?? requireContract(deployment(), 'quantumValidator');
  const verifier = opts.verifier ?? requireVerifier(deployment(), signer.scheme);
  const blob = keyBlob(signer);
  const keyPtr = opts.keyPtr ?? predictKeyPointer(opts.keyStore ?? requireContract(deployment(), 'keyStore'), blob);

  const signHash = (hash: Hex) => signer.sign(hash);

  const account = toAccount({
    // Replaced by the Kernel account address; the validator itself has no address of its own.
    address: zeroAddress,
    async signMessage({ message }) {
      const raw0 = typeof message === 'object' && 'raw' in message ? message.raw : undefined;
      const raw = raw0 instanceof Uint8Array ? bytesToHex(raw0) : raw0;
      if (typeof raw !== 'string' || !isHex(raw) || size(raw) !== 32) {
        throw new Error(
          'QuantumValidator.signMessage signs a raw 32-byte hash only; use the Kernel account to produce ERC-1271 signatures',
        );
      }
      return signHash(raw);
    },
    async signTransaction() {
      throw new Error('a smart-account validator does not sign transactions');
    },
    async signTypedData(typedData) {
      const definition = typedData as TypedDataDefinition;
      const verifyingContract = definition.domain?.verifyingContract;
      if (!verifyingContract || !isAddress(verifyingContract)) {
        throw new Error('QuantumValidator.signTypedData needs domain.verifyingContract (the account)');
      }
      // hashTypedData validates the typed data (types, ranges, addresses) before hashing.
      const hash = hashTypedData(definition);
      return signHash(accountDigest({ validator: validatorAddress, chainId, account: verifyingContract, hash }));
    },
  });

  return {
    ...account,
    source: 'QuantumValidator',
    validatorType: 'SECONDARY',
    supportedKernelVersions: '0.3.3',
    address: validatorAddress,
    verifier,
    keyPtr,
    keyBlob: blob,
    signer,
    getIdentifier: () => validatorAddress,
    async getEnableData() {
      return encodeValidatorInstallData({ verifier, keyPtr });
    },
    async getNonceKey(_accountAddress?: Address, customNonceKey?: bigint) {
      return customNonceKey ?? 0n;
    },
    async signUserOperation(userOperation) {
      const { chainId: opChainId, ...op } = userOperation;
      const hash = getUserOperationHash({
        userOperation: { ...op, signature: '0x' } as UserOperation<entryPointVersion>,
        entryPointAddress: entryPoint.address,
        entryPointVersion: entryPoint.version,
        chainId: opChainId ?? chainId,
      });
      return signHash(hash);
    },
    async getStubSignature() {
      return stubSignature(signer.scheme);
    },
    async isEnabled(accountAddress: Address) {
      return readContract(client, {
        address: validatorAddress,
        abi: quantumValidatorAbi,
        functionName: 'isInitialized',
        args: [accountAddress],
      });
    },
  };
}
