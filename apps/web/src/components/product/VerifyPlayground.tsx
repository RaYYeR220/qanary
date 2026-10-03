'use client';

import { useState } from 'react';
import { bytesToHex, decodeFunctionData, encodeFunctionData, keccak256, parseAbi, size, stringToBytes, type Address, type Hex } from 'viem';
import { entryPoint07Abi } from 'viem/account-abstraction';
import { publicClientFor, deploymentOf, type ProductNetwork } from '@/lib/chain';
import { explainError, type Explained } from '@/lib/errors';
import { gas } from '@/lib/format';
import { keyBlob, pqSignerFromSeed, PUBLIC_KEY_BYTES, SIGNATURE_BYTES, verifyOnChain, type Scheme } from '@/lib/sdk';
import { Hex as HexText, Mark, Outcome } from './kit';
import ui from './ui.module.css';
import styles from './VerifyPlayground.module.css';

const fallbackAbi = parseAbi([
  'function prepareKey(bytes key) returns (address)',
  'function isPrepared(bytes key) view returns (bool)',
]);

const SCHEME_LABEL: Record<Scheme, string> = { mldsa44: 'ML-DSA-44', mldsa65: 'ML-DSA-65', falcon512: 'Falcon-512' };

interface Signed {
  scheme: Scheme;
  key: Hex;
  hash: Hex;
  signature: Hex;
  publicKeyBytes: number;
}

type Check =
  | { state: 'idle' }
  | { state: 'running' }
  | { state: 'none'; reason: string }
  | { state: 'done'; valid: boolean; gas: bigint; ms: number; verifier: Address }
  | { state: 'error'; error: Explained; verifier: Address }
  | { state: 'unprepared'; cost: bigint | null; verifier: Address };

/** Flips every bit of one byte in the middle of the signature. */
function tamper(sig: Hex): Hex {
  const at = Math.floor(size(sig) / 2);
  const i = 2 + at * 2;
  const byte = (parseInt(sig.slice(i, i + 2), 16) ^ 0xff).toString(16).padStart(2, '0');
  return `${sig.slice(0, i)}${byte}${sig.slice(i + 2)}` as Hex;
}

function verifierFor(n: ProductNetwork, scheme: Scheme): { address?: Address; kind: string } {
  const d = deploymentOf(n);
  const address = d.verifiers[scheme];
  if (n.stylus === 'paused') return { address, kind: 'Solidity verifier' };
  return { address, kind: 'Stylus verifier' };
}

export function VerifyPlayground({ networks }: { networks: ProductNetwork[] }) {
  const columns = networks.filter((n) => n.key === 'apechain' || n.key === 'arbitrum-one');
  const [scheme, setScheme] = useState<Scheme>('mldsa44');
  const [message, setMessage] = useState('Pay 1,000 USDG to the payroll account, October run');
  const [signed, setSigned] = useState<Signed | null>(null);
  const [busy, setBusy] = useState(false);
  const [tampered, setTampered] = useState(false);
  const [checks, setChecks] = useState<Record<string, Check>>({});

  const sign = async () => {
    setBusy(true);
    setChecks({});
    // let the button paint before the key generation takes the thread
    await new Promise((r) => setTimeout(r, 30));
    try {
      const seed = crypto.getRandomValues(new Uint8Array(32));
      const signer = pqSignerFromSeed(scheme, seed);
      const hash = keccak256(stringToBytes(message));
      const signature = await signer.sign(hash);
      setSigned({ scheme, key: keyBlob(signer), hash, signature, publicKeyBytes: signer.publicKey.length });
      seed.fill(0);
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    if (!signed) return;
    const sig = tampered ? tamper(signed.signature) : signed.signature;
    const next: Record<string, Check> = {};
    for (const n of columns) {
      const v = verifierFor(n, signed.scheme);
      if (!v.address) {
        next[n.key] = {
          state: 'none',
          reason:
            n.stylus === 'paused'
              ? signed.scheme === 'mldsa44'
                ? 'The Solidity ML-DSA-44 verifier is deploying.'
                : `There is no Solidity verifier for ${SCHEME_LABEL[signed.scheme]}; on this network only ML-DSA-44 runs, in Solidity.`
              : 'This verifier is deploying.',
        };
      } else next[n.key] = { state: 'running' };
    }
    setChecks({ ...next });
    await Promise.all(
      columns.map(async (n) => {
        const v = verifierFor(n, signed.scheme);
        if (!v.address) return;
        if (n.stylus === 'paused') {
          // the Solidity verifier only checks keys prepared on-chain once; a key made a moment ago is not
          const client = publicClientFor(n);
          const prepared = await client
            .readContract({ address: v.address, abi: fallbackAbi, functionName: 'isPrepared', args: [signed.key] })
            .catch(() => false);
          if (!prepared) {
            const cost = await client
              .estimateGas({ to: v.address, data: encodeFunctionData({ abi: fallbackAbi, functionName: 'prepareKey', args: [signed.key] }) })
              .catch(() => null);
            next[n.key] = { state: 'unprepared', cost, verifier: v.address };
            setChecks({ ...next });
            return;
          }
        }
        const t0 = performance.now();
        try {
          const r = await verifyOnChain(publicClientFor(n), v.address, signed.key, signed.hash, sig);
          next[n.key] = { state: 'done', valid: r.valid, gas: r.gas, ms: Math.round(performance.now() - t0), verifier: v.address };
        } catch (e) {
          next[n.key] = { state: 'error', error: explainError(e, n.nativeSymbol), verifier: v.address };
        }
        setChecks({ ...next });
      }),
    );
  };

  return (
    <div className={ui.body}>
      <KmsReplay networks={networks} />
      <section className={ui.panel} aria-labelledby="sign-h">
        <h2 id="sign-h" className={ui.h2}>
          Or sign in this page
        </h2>
        <p className={ui.small}>
          A fresh key is generated in your browser from 32 random bytes and thrown away when you leave. The message
          is hashed with keccak-256; the verifier receives the 32-byte hash, as an account would.
        </p>
        <fieldset className={ui.picker}>
          <legend className={ui.label}>Scheme</legend>
          {(Object.keys(SCHEME_LABEL) as Scheme[]).map((s) => (
            <label key={s} className={ui.pick}>
              <input type="radio" name="scheme" checked={scheme === s} onChange={() => setScheme(s)} />
              <span>{SCHEME_LABEL[s]}</span>
            </label>
          ))}
        </fieldset>
        <label className={ui.field}>
          <span className={ui.label}>Message</span>
          <input className={ui.input} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={200} />
        </label>
        <div className={ui.row}>
          <button type="button" className={ui.button} onClick={() => void sign()} disabled={busy || !message}>
            {busy ? 'Generating the key…' : signed ? 'New key, sign again' : 'Generate a key and sign'}
          </button>
          {scheme === 'falcon512' && <span className={`${ui.small} ${ui.muted}`}>Falcon key generation takes a few seconds.</span>}
        </div>
        {signed && (
          <dl className={ui.ledger}>
            <dt>Scheme</dt>
            <dd>{SCHEME_LABEL[signed.scheme]}</dd>
            <dt>Public key</dt>
            <dd>
              {signed.publicKeyBytes.toLocaleString('en-US')} bytes (expected {PUBLIC_KEY_BYTES[signed.scheme].toLocaleString('en-US')})
            </dd>
            <dt>Signature</dt>
            <dd>
              {size(signed.signature).toLocaleString('en-US')} bytes (expected {SIGNATURE_BYTES[signed.scheme].toLocaleString('en-US')}),{' '}
              <HexText value={signed.signature} kind="none" />
            </dd>
            <dt>Hash</dt>
            <dd>
              <HexText value={signed.hash} kind="none" />
            </dd>
          </dl>
        )}
      </section>

      {signed && (
        <section className={ui.panel} aria-labelledby="check-h">
          <div className={ui.panelHead}>
            <h2 id="check-h" className={ui.h2}>
              Ask the verifiers
            </h2>
            <label className={ui.check}>
              <input type="checkbox" checked={tampered} onChange={(e) => setTampered(e.target.checked)} />
              Tamper with one byte of the signature
            </label>
          </div>
          <p className={ui.small}>
            A read-only <span className={ui.italic}>eth_call</span> to each verifier: no wallet, no gas paid. The gas
            shown is the L2 gas the same call would use as a transaction on that chain (execution and calldata,
            without the parent-chain data fee).
          </p>
          <div>
            <button type="button" className={ui.button} onClick={() => void verify()}>
              {tampered ? 'Verify the tampered signature' : 'Verify on-chain'}
            </button>
          </div>
          <div className={styles.columns}>
            {columns.map((n) => {
              const c = checks[n.key] ?? { state: 'idle' };
              const v = verifierFor(n, signed.scheme);
              return (
                <article key={n.key} className={styles.column} aria-live="polite">
                  <h3 className={ui.h3}>{n.name}</h3>
                  <p className={`${ui.small} ${ui.muted}`}>
                    {n.stylus === 'paused' ? 'Solidity verifier (Stylus activations paused)' : 'Arbitrum Stylus verifier'}
                  </p>
                  {v.address && (
                    <p className={ui.small}>
                      <HexText value={v.address} network={n} />
                    </p>
                  )}
                  {c.state === 'idle' && <Mark state="idle">Not asked yet</Mark>}
                  {c.state === 'running' && <Mark state="pending">Asking…</Mark>}
                  {c.state === 'none' && <Mark state="deploying">{c.reason}</Mark>}
                  {c.state === 'done' &&
                    (c.valid ? (
                      <div className={styles.verdict}>
                        <Mark state="ok">Valid: returned the ERC-7913 magic 0x024ad318</Mark>
                        <span className={styles.gas}>{gas(c.gas)}</span>
                        <span className={`${ui.small} ${ui.muted}`}>answered in {c.ms} ms</span>
                      </div>
                    ) : (
                      <div className={ui.stamp}>
                        <span className={ui.stampWord}>Refused</span>
                        <span>The signature does not verify against this key.</span>
                        <span className={ui.stampName}>{gas(c.gas)}</span>
                      </div>
                    ))}
                  {c.state === 'error' && <Outcome error={c.error} />}
                  {c.state === 'unprepared' && (
                    <p className={ui.small}>
                      <Mark state="pending">Not called.</Mark> The Solidity verifier checks a key only after it has been
                      prepared on-chain once: <span className={ui.italic}>prepareKey</span> expands it and stores the
                      result, {c.cost !== null ? <>about {gas(c.cost)}, </> : null}paid once per key by whoever submits it. A
                      key made a moment ago is not prepared, so the call would revert with KeyNotPrepared. The AWS KMS
                      key above is prepared; replay it to compare the two verifiers on one signature.
                    </p>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      )}
      <p className={`${ui.small} ${ui.muted}`}>
        Key format: inline <span className={ui.italic}>scheme id ‖ public key</span>, {bytesToHex(new Uint8Array([2]))} for
        ML-DSA-44, 0x03 for ML-DSA-65, 0x04 for Falcon-512. Accounts store the same bytes once in the key store and pass a
        20-byte pointer instead.
      </p>
    </div>
  );
}

type Replay = Record<string, Check>;

/**
 * Replays a signature AWS KMS produced for a live treasury: the post-quantum
 * signature of its first user operation, read from the transaction that carried
 * it, checked against its stored key on both networks.
 */
function KmsReplay({ networks }: { networks: ProductNetwork[] }) {
  const arb = networks.find((n) => n.key === 'arbitrum-one');
  const ape = networks.find((n) => n.key === 'apechain');
  const [tampered, setTampered] = useState(false);
  const [checks, setChecks] = useState<Replay>({});
  // whether the signature last sent to the verifiers was the tampered one
  const [sentTampered, setSentTampered] = useState(false);
  const [sig, setSig] = useState<Hex | null>(null);
  const [error, setError] = useState<Explained | null>(null);
  const run = arb?.run;
  if (!arb || !ape || !run?.rootKeyPointer || !run.pqUserOpHash || !run.pqUserOpTx) return null;
  const columns = [ape, arb];
  const key = run.rootKeyPointer;
  const hash = run.pqUserOpHash;
  const txHash = run.pqUserOpTx;
  const account = arb.heroes[0]?.address;

  const replay = async () => {
    setError(null);
    try {
      let signature = sig;
      if (!signature) {
        const tx = await publicClientFor(arb).getTransaction({ hash: txHash });
        const { args } = decodeFunctionData({ abi: entryPoint07Abi, data: tx.input });
        const ops = args[0] as readonly { signature: Hex }[];
        signature = ops[0]!.signature;
        setSig(signature);
      }
      const used = tampered ? tamper(signature) : signature;
      setSentTampered(tampered);
      const next: Replay = Object.fromEntries(columns.map((n) => [n.key, { state: 'running' } as Check]));
      setChecks({ ...next });
      await Promise.all(
        columns.map(async (n) => {
          const v = verifierFor(n, 'mldsa44').address;
          if (!v) {
            next[n.key] = { state: 'none', reason: 'This verifier is deploying.' };
            setChecks({ ...next });
            return;
          }
          const t0 = performance.now();
          try {
            const r = await verifyOnChain(publicClientFor(n), v, key, hash, used);
            next[n.key] = { state: 'done', valid: r.valid, gas: r.gas, ms: Math.round(performance.now() - t0), verifier: v };
          } catch (e) {
            next[n.key] = { state: 'error', error: explainError(e, n.nativeSymbol), verifier: v };
          }
          setChecks({ ...next });
        }),
      );
    } catch (e) {
      setError(explainError(e));
    }
  };

  // the comparison is about one valid signature checked twice; a refused run has nothing to compare
  const valid = (c: Check | undefined) => (c?.state === 'done' && c.valid ? c.gas : null);
  const apeGas = sentTampered ? null : valid(checks.apechain);
  const arbGas = sentTampered ? null : valid(checks['arbitrum-one']);

  return (
    <section className={ui.panel} aria-labelledby="kms-h">
      <div className={ui.panelHead}>
        <h2 id="kms-h" className={ui.h2}>
          Replay a signature from AWS KMS
        </h2>
        <label className={ui.check}>
          <input type="checkbox" checked={tampered} onChange={(e) => setTampered(e.target.checked)} />
          Tamper with one byte
        </label>
      </div>
      <p className={ui.small}>
        A live treasury{account ? <> (<HexText value={account} network={arb} />)</> : null} keeps its root key in an AWS KMS
        HSM. Its first operation on {arb.name} carried an ML-DSA-44 signature by that key over the operation&rsquo;s hash.
        This reads the signature from{' '}
        <a href={`${arb.explorer}/tx/${txHash}`} target="_blank" rel="noreferrer">
          that transaction
        </a>{' '}
        and asks both verifiers about the same key, hash and signature: the Stylus program on ApeChain and the Solidity
        verifier on Arbitrum One.
      </p>
      <dl className={ui.ledger}>
        <dt>Key pointer</dt>
        <dd>
          <HexText value={key} kind="none" />
        </dd>
        <dt>Signed hash</dt>
        <dd>
          <HexText value={hash} kind="none" />
        </dd>
        {sig && (
          <>
            <dt>Signature</dt>
            <dd>
              {size(sig).toLocaleString('en-US')} bytes, <HexText value={sig} kind="none" />
            </dd>
          </>
        )}
      </dl>
      <div>
        <button type="button" className={ui.button} onClick={() => void replay()}>
          {tampered ? 'Replay the tampered signature' : 'Replay on both networks'}
        </button>
      </div>
      {error && <Outcome error={error} />}
      <div className={styles.columns}>
        {columns.map((n) => {
          const c = checks[n.key] ?? { state: 'idle' };
          return (
            <article key={n.key} className={styles.column} aria-live="polite">
              <h3 className={ui.h3}>{n.name}</h3>
              <p className={`${ui.small} ${ui.muted}`}>{n.stylus === 'paused' ? 'Solidity verifier' : 'Arbitrum Stylus verifier'}</p>
              {c.state === 'idle' && <Mark state="idle">Not asked yet</Mark>}
              {c.state === 'running' && <Mark state="pending">Asking…</Mark>}
              {c.state === 'none' && <Mark state="deploying">{c.reason}</Mark>}
              {c.state === 'done' &&
                (c.valid ? (
                  <div className={styles.verdict}>
                    <Mark state="ok">Valid</Mark>
                    <span className={styles.gas}>{gas(c.gas)}</span>
                    <span className={`${ui.small} ${ui.muted}`}>
                      <HexText value={c.verifier} network={n} />
                    </span>
                  </div>
                ) : (
                  <div className={ui.stamp}>
                    <span className={ui.stampWord}>Refused</span>
                    <span>{sentTampered ? 'The tampered signature does not verify.' : 'The signature does not verify.'}</span>
                    <span className={ui.stampName}>{gas(c.gas)}</span>
                  </div>
                ))}
              {c.state === 'error' && <Outcome error={c.error} />}
            </article>
          );
        })}
      </div>
      {apeGas !== null && arbGas !== null && (
        <p className={ui.text}>
          Same key, same hash, same signature: Stylus checks it for {gas(apeGas)}, Solidity for {gas(arbGas)}.
        </p>
      )}
    </section>
  );
}
