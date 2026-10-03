'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { formatEther, isAddress, zeroAddress, type Address, type Hash, type Hex } from 'viem';
import { useConnection, useWalletClient } from 'wagmi';
import { DEFAULT_LEVEL_BPS, effectiveCap, formatDuration } from '@/lib/bucket';
import { deploymentOf, explorerTx, publicClientFor, type ProductNetwork } from '@/lib/chain';
import { explainError, type Explained } from '@/lib/errors';
import { amount, gas } from '@/lib/format';
import {
  generateMnemonic,
  keyBlob,
  pqSignerFromMnemonic,
  predictKeyPointer,
  selfBundleUserOperation,
  userOperationOutcome,
  type HotSetup,
  type KernelSmartAccount,
  type PqSigner,
  type Scheme,
} from '@/lib/sdk';
import {
  fallbackVerifierAbi,
  firstOperationCalls,
  fundRequest,
  hotSetupFor,
  hotTierValid,
  newTreasuryAccount,
  parseCap,
  prefundFor,
  prepareKeyRequest,
  storeKeyRequest,
} from '@/lib/treasury';
import { forgetVault, loadVault, openPhrase, rememberTreasury, saveVault, sealPhrase, type VaultRecord } from '@/lib/vault';
import { BucketGauge } from './BucketGauge';
import { Hex as HexText, Mark, NetworkPicker, Outcome, useSelectedNetwork, WalletBar } from './kit';
import ui from './ui.module.css';
import styles from './OpenTreasury.module.css';

const SCHEMES: { id: Scheme; label: string; note: string }[] = [
  { id: 'mldsa44', label: 'ML-DSA-44', note: 'FIPS 204. Works on every network, and in AWS KMS.' },
  { id: 'falcon512', label: 'Falcon-512', note: 'Smallest signatures. Needs a Stylus verifier.' },
];

type StepState = 'done' | 'active' | 'waiting' | 'deploying';

function Step({ title, state, children }: { title: string; state: StepState; children: ReactNode }) {
  return (
    <li className={ui.step} data-state={state}>
      <div className={ui.stepBody}>
        <div className={ui.panelHead}>
          <h2 className={ui.h3}>{title}</h2>
          {state === 'done' && <Mark state="ok">Done</Mark>}
          {state === 'deploying' && <Mark state="deploying">Waiting for deployment</Mark>}
        </div>
        {children}
      </div>
    </li>
  );
}

export function OpenTreasury({ networks }: { networks: ProductNetwork[] }) {
  const [network, setNetwork] = useSelectedNetwork(networks);
  const d = deploymentOf(network);
  const conn = useConnection();
  const wallet = useWalletClient({ chainId: network.chainId });
  const client = publicClientFor(network);

  // ---------- I. the key ----------
  const [scheme, setScheme] = useState<Scheme>('mldsa44');
  const [phrase, setPhrase] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [draft, setDraft] = useState('');
  const [backedUp, setBackedUp] = useState(false);
  const [vault, setVault] = useState<VaultRecord | null>(null);
  const [passphrase, setPassphrase] = useState('');
  const [vaultMsg, setVaultMsg] = useState<string | null>(null);
  const [signer, setSigner] = useState<PqSigner | null>(null);
  const [deriving, setDeriving] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);

  useEffect(() => setVault(loadVault()), []);

  useEffect(() => {
    if (!phrase) {
      setSigner(null);
      return;
    }
    setDeriving(true);
    setKeyError(null);
    // let the page paint first: Falcon key generation takes a moment
    const t = window.setTimeout(() => {
      try {
        setSigner(pqSignerFromMnemonic(scheme, phrase));
      } catch (e) {
        setKeyError(e instanceof Error ? e.message : String(e));
        setSigner(null);
      } finally {
        setDeriving(false);
      }
    }, 30);
    return () => window.clearTimeout(t);
  }, [phrase, scheme]);

  const words = phrase?.split(' ') ?? [];
  const verifier = d.verifiers[scheme];
  const blob = useMemo(() => (signer ? keyBlob(signer) : null), [signer]);
  const pointer = blob && d.keyStore ? predictKeyPointer(d.keyStore, blob) : null;
  const solidity = network.stylus === 'paused';

  // ---------- hot tier ----------
  const [hotOn, setHotOn] = useState(true);
  const [hotCap, setHotCap] = useState('0.5');
  const [hotHours, setHotHours] = useState('24');
  const hotCapWei = parseCap(hotCap);
  const hours = Number(hotHours);
  const hotValid = !hotOn || hotTierValid(hotCapWei, hours);
  const hot: HotSetup | undefined = hotOn && conn.address && hotCapWei && hotValid ? hotSetupFor(conn.address, hotCapWei, hours) : undefined;

  // ---------- II. the address ----------
  const [account, setAccount] = useState<KernelSmartAccount | null>(null);
  const [predictError, setPredictError] = useState<Explained | null>(null);
  const missing = [
    !d.keyStore && 'key store',
    !d.quantumValidator && 'quantum validator',
    !verifier && (solidity ? 'Solidity ML-DSA-44 verifier' : `${scheme === 'mldsa44' ? 'ML-DSA-44' : 'Falcon-512'} verifier`),
    hotOn && !d.hotTierExecutor && 'hot-tier executor',
    hotOn && !d.canaryRegistry && 'tripwire registry',
  ].filter(Boolean) as string[];
  const deployed = missing.length === 0;

  useEffect(() => {
    setAccount(null);
    setPredictError(null);
    if (!signer || !deployed) return;
    let live = true;
    newTreasuryAccount(client, {
      signer,
      registry: d.canaryRegistry ?? zeroAddress,
      deployment: d,
      ...(hot ? { hot } : {}),
    })
      .then((a) => live && setAccount(a))
      .catch((e) => live && setPredictError(explainError(e)));
    return () => {
      live = false;
    };
    // the hot setup does not move the address; it rides on the first operation
  }, [signer, deployed, network.chainId, hot?.window, hot?.assets[0]?.cap, hot?.signer.family === 'secp256k1' ? hot.signer.eoa : '']);

  // ---------- chain state ----------
  const [stored, setStored] = useState<boolean | null>(null);
  const [prepared, setPrepared] = useState<boolean | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [live, setLive] = useState<boolean | null>(null);
  const [prefund, setPrefund] = useState<bigint | null>(null);
  const [prepareGas, setPrepareGas] = useState<bigint | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!pointer) return;
    let on = true;
    void (async () => {
      const code = await client.getCode({ address: pointer }).catch(() => undefined);
      if (!on) return;
      setStored(!!code && code !== '0x');
      if (solidity && verifier) {
        const ok = await client.readContract({ address: verifier, abi: fallbackVerifierAbi, functionName: 'isPrepared', args: [pointer] }).catch(() => null);
        if (on) setPrepared(ok);
        if (on && ok === false && conn.address) {
          const g = await client.estimateGas({ account: conn.address, ...prepareKeyRequest(verifier, pointer) }).catch(() => null);
          if (on) setPrepareGas(g);
        }
      }
    })();
    return () => {
      on = false;
    };
  }, [pointer, client, solidity, verifier, conn.address, tick]);

  useEffect(() => {
    if (!account) return;
    let on = true;
    void (async () => {
      const [bal, code, fees] = await Promise.all([
        client.getBalance({ address: account.address }),
        client.getCode({ address: account.address }),
        client.estimateFeesPerGas().catch(() => null),
      ]);
      if (!on) return;
      setBalance(bal);
      setLive(!!code && code !== '0x');
      if (fees?.maxFeePerGas) setPrefund(prefundFor(fees.maxFeePerGas));
    })();
    return () => {
      on = false;
    };
  }, [account, client, tick]);

  // ---------- actions ----------
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ step: string; e: Explained } | null>(null);
  const [txs, setTxs] = useState<{ label: string; hash: Hash }[]>([]);
  const [created, setCreated] = useState<{ address: Address; ok: boolean; hash: Hash } | null>(null);
  const ready = conn.status === 'connected' && conn.chainId === network.chainId && !!wallet.data;

  const run = async (step: string, fn: () => Promise<void>) => {
    setBusy(step);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError({ step, e: explainError(e, network.nativeSymbol) });
    } finally {
      setBusy(null);
      setTick((t) => t + 1);
    }
  };

  /** Sends one transaction from the wallet, lists it, and waits until it is mined and succeeded. */
  const send = async (label: string, request: { to: Address; data?: Hex; value?: bigint }) => {
    if (!wallet.data) return;
    const hash = await wallet.data.sendTransaction(request);
    setTxs((t) => [...t, { label, hash }]);
    const receipt = await client.waitForTransactionReceipt({ hash });
    if (receipt.status !== 'success') throw new Error(`The transaction reverted: ${explorerTx(network, hash)}`);
  };

  const doStore = () =>
    run('store', async () => {
      if (!d.keyStore || !blob) return;
      await send('Key stored in the key store', storeKeyRequest(d.keyStore, blob));
    });

  const doPrepare = () =>
    run('prepare', async () => {
      if (!verifier || !pointer) return;
      await send('Key prepared for the Solidity verifier', prepareKeyRequest(verifier, pointer));
    });

  const doFund = () =>
    run('fund', async () => {
      if (!account || prefund === null) return;
      const request = fundRequest(account.address, prefund, balance ?? 0n);
      if (request) await send('Account funded for its first operation', request);
    });

  const doCreate = () =>
    run('create', async () => {
      if (!wallet.data || !account || !conn.address) return;
      // the first operation deploys the account; the hot tier's install rides on it
      const { userOpHash, hash } = await selfBundleUserOperation(wallet.data, account, { calls: firstOperationCalls(conn.address) });
      const receipt = await client.waitForTransactionReceipt({ hash });
      const ok = userOperationOutcome(receipt, userOpHash) === true;
      setTxs((t) => [...t, { label: 'Account deployed by its first post-quantum operation', hash }]);
      setCreated({ address: account.address, ok, hash });
      if (ok) {
        rememberTreasury({
          network: network.key,
          address: account.address,
          scheme,
          ...(hot ? { hot: { window: hot.window, cap: hot.assets[0]!.cap.toString(), eoa: conn.address } } : {}),
          createdAt: Date.now(),
        });
      }
    });

  const saveCopy = async () => {
    if (!phrase) return;
    if (passphrase.length < 12) {
      setVaultMsg('Use a passphrase of at least 12 characters.');
      return;
    }
    const rec = await sealPhrase(phrase, passphrase, scheme);
    saveVault(rec);
    setVault(rec);
    setPassphrase('');
    setVaultMsg('Saved. The phrase is encrypted in this browser with your passphrase; it is not sent anywhere.');
  };

  const unlock = async () => {
    if (!vault) return;
    try {
      const p = await openPhrase(vault, passphrase);
      setScheme((vault.scheme as Scheme) ?? 'mldsa44');
      setPhrase(p);
      setBackedUp(true);
      setPassphrase('');
      setVaultMsg(null);
    } catch (e) {
      setVaultMsg(e instanceof Error ? e.message : String(e));
    }
  };

  const keyDone = !!signer && backedUp;
  const needsPrepare = solidity && scheme === 'mldsa44';
  const funded = prefund !== null && balance !== null && balance >= prefund;
  const stateOf = (done: boolean, can: boolean, needsDeploy = true): StepState =>
    done ? 'done' : needsDeploy && !deployed ? 'deploying' : can ? 'active' : 'waiting';

  return (
    <div className={ui.body}>
      <LiveTreasuries networks={networks} />
      <NetworkPicker networks={networks} value={network} onChange={setNetwork} legend="Network for your treasury" />
      {!deployed && (
        <p className={ui.notice}>
          On {network.name} the {new Intl.ListFormat('en', { type: 'conjunction' }).format(missing)}{' '}
          {missing.length === 1 ? 'is' : 'are'} still deploying. You can
          make and back up your key now; the steps that need the contracts open once they are on-chain.
        </p>
      )}
      <WalletBar network={network} />

      <ol className={ui.steps}>
        <Step title="Make your post-quantum key" state={keyDone ? 'done' : 'active'}>
          <fieldset className={ui.picker}>
            <legend className={ui.label}>Scheme</legend>
            {SCHEMES.map((s) => (
              <label key={s.id} className={ui.pick}>
                <input type="radio" name="scheme" checked={scheme === s.id} onChange={() => setScheme(s.id)} />
                <span>{s.label}</span>
              </label>
            ))}
          </fieldset>
          <p className={`${ui.small} ${ui.muted}`}>{SCHEMES.find((s) => s.id === scheme)!.note}</p>
          {solidity && scheme === 'falcon512' && (
            <p className={ui.notice} data-tone="error">
              On {network.name} only ML-DSA-44 runs, in Solidity: new Stylus programs cannot be activated there for now.
            </p>
          )}

          {!phrase && !restoring && (
            <div className={ui.row}>
              <button type="button" className={ui.button} onClick={() => setPhrase(generateMnemonic())}>
                Make a recovery phrase
              </button>
              <button type="button" className={ui.quiet} onClick={() => setRestoring(true)}>
                I have a phrase
              </button>
            </div>
          )}
          {!phrase && restoring && (
            <div className={styles.restore}>
              <label className={ui.field}>
                <span className={ui.label}>Recovery phrase, 24 words</span>
                <textarea className={ui.textarea} value={draft} onChange={(e) => setDraft(e.target.value)} spellCheck={false} autoComplete="off" />
              </label>
              <div className={ui.row}>
                <button
                  type="button"
                  className={ui.button}
                  onClick={() => {
                    setPhrase(draft.trim().toLowerCase().split(/\s+/).join(' '));
                    setDraft('');
                    setBackedUp(true);
                  }}
                  disabled={draft.trim().split(/\s+/).length < 12}
                >
                  Use this phrase
                </button>
                <button type="button" className={ui.quiet} onClick={() => setRestoring(false)}>
                  Back
                </button>
              </div>
            </div>
          )}
          {!phrase && vault && (
            <div className={styles.restore}>
              <p className={ui.small}>A phrase saved in this browser is encrypted here. Unlock it with its passphrase.</p>
              <div className={ui.row}>
                <input className={ui.input} type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} aria-label="Passphrase" placeholder="Passphrase" style={{ maxWidth: '22rem' }} />
                <button type="button" className={ui.quiet} onClick={() => void unlock()} disabled={!passphrase}>
                  Unlock
                </button>
              </div>
              {vaultMsg && <p className={ui.notice}>{vaultMsg}</p>}
            </div>
          )}

          {phrase && (
            <>
              {!backedUp && (
                <>
                  <p className={ui.small}>
                    Write these words down, in order, and keep them offline. They are the key: anyone with them controls
                    the treasury, and nobody can recover them for you. They were made in this page and are not sent
                    anywhere.
                  </p>
                  <ol className={styles.words} aria-label="Recovery phrase">
                    {words.map((w, i) => (
                      <li key={i}>
                        <span className={styles.n}>{i + 1}</span> {w}
                      </li>
                    ))}
                  </ol>
                  <label className={ui.check}>
                    <input type="checkbox" checked={backedUp} onChange={(e) => setBackedUp(e.target.checked)} />I have
                    written the phrase down
                  </label>
                </>
              )}
              {deriving && <Mark state="pending">Deriving the key…</Mark>}
              {keyError && <p className={ui.notice} data-tone="error">{keyError}</p>}
              {signer && (
                <dl className={ui.ledger}>
                  <dt>Public key</dt>
                  <dd>
                    {signer.publicKey.length.toLocaleString('en-US')} bytes, derived from the phrase with HKDF-SHA-256
                  </dd>
                  {pointer && (
                    <>
                      <dt>Key pointer</dt>
                      <dd>
                        <HexText value={pointer} network={network} />
                      </dd>
                    </>
                  )}
                </dl>
              )}
              {backedUp && !vault && (
                <div className={styles.restore}>
                  <p className={ui.small}>Optional: keep an encrypted copy in this browser, so you can sign later without typing the phrase.</p>
                  <div className={ui.row}>
                    <input className={ui.input} type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} aria-label="New passphrase" placeholder="Passphrase, 12 characters or more" style={{ maxWidth: '22rem' }} />
                    <button type="button" className={ui.quiet} onClick={() => void saveCopy()} disabled={!passphrase}>
                      Save encrypted copy
                    </button>
                  </div>
                  {vaultMsg && <p className={ui.notice}>{vaultMsg}</p>}
                </div>
              )}
              {vault && (
                <p className={`${ui.small} ${ui.muted}`}>
                  An encrypted copy is saved in this browser.{' '}
                  <button
                    type="button"
                    className={ui.copy}
                    onClick={() => {
                      forgetVault();
                      setVault(null);
                    }}
                  >
                    Forget it
                  </button>
                </p>
              )}
            </>
          )}
        </Step>

        <Step title="Choose a hot key and its cap" state={keyDone ? (hotValid ? 'active' : 'waiting') : 'waiting'}>
          <p className={ui.small}>
            The hot key is your connected wallet. It can send the native currency up to the cap, refilled continuously
            over the window. The tripwire scales the cap down by default: halved at the first rung, a tenth at the
            second, frozen at the third.
          </p>
          <label className={ui.check}>
            <input type="checkbox" checked={hotOn} onChange={(e) => setHotOn(e.target.checked)} />
            Add a hot key
          </label>
          {hotOn && (
            <div className={styles.hot}>
              <label className={ui.field}>
                <span className={ui.label}>Cap, {network.nativeSymbol}</span>
                <input className={ui.input} inputMode="decimal" value={hotCap} onChange={(e) => setHotCap(e.target.value)} aria-invalid={hotCapWei === null} />
              </label>
              <label className={ui.field}>
                <span className={ui.label}>Window, hours</span>
                <input className={ui.input} inputMode="numeric" value={hotHours} onChange={(e) => setHotHours(e.target.value)} />
              </label>
              <p className={`${ui.small} ${ui.muted}`}>
                Hot key: {conn.address ? <HexText value={conn.address} network={network} /> : 'connect a wallet'}
              </p>
            </div>
          )}
          {hotOn && hotCapWei !== null && hotCapWei > 0n && (
            <figure className={styles.preview}>
              <BucketGauge scale={1} available={1} label={`Your cap: ${hotCap} ${network.nativeSymbol}, full`} />
              <figcaption className={ui.small}>
                Full at {amount(hotCapWei)} {network.nativeSymbol}, refilling over {Number.isFinite(hours) && hours > 0 ? formatDuration(hours * 3600) : '…'}.
                By default the tripwire takes it to {amount(effectiveCap(hotCapWei, DEFAULT_LEVEL_BPS[1]))} at the first
                rung, {amount(effectiveCap(hotCapWei, DEFAULT_LEVEL_BPS[2]))} at the second, and freezes it at the third.
              </figcaption>
            </figure>
          )}
        </Step>

        <Step title="Find the account's address" state={stateOf(!!account, keyDone)}>
          {account ? (
            <dl className={ui.ledger}>
              <dt>Account</dt>
              <dd>
                <HexText value={account.address} network={network} full />
              </dd>
              <dt>On-chain</dt>
              <dd>{live ? <Mark state="ok">Deployed</Mark> : <Mark state="pending">Not yet: its first operation deploys it</Mark>}</dd>
            </dl>
          ) : predictError ? (
            <Outcome error={predictError} />
          ) : (
            <p className={ui.small}>
              A Kernel v3.3 account with the post-quantum key as its root validator. Its address follows from the key, so
              it is known before anything is sent.
            </p>
          )}
        </Step>

        <Step title="Store the key on-chain" state={stateOf(!!stored, keyDone && !!account)}>
          <p className={ui.small}>
            The key ({blob ? `${(blob.length / 2 - 1).toLocaleString('en-US')} bytes with its scheme byte` : 'a few kilobytes'})
            goes into the key store once, as contract code; the account keeps a 20-byte pointer to it. Your wallet pays.
          </p>
          {stored ? (
            <Mark state="ok">Stored</Mark>
          ) : (
            <button type="button" className={ui.button} disabled={!ready || !account || busy !== null} onClick={() => void doStore()}>
              {busy === 'store' ? 'Storing…' : 'Store the key'}
            </button>
          )}
          {error?.step === 'store' && <Outcome error={error.e} />}
        </Step>

        {needsPrepare && (
          <Step title="Prepare the key for the Solidity verifier" state={stateOf(!!prepared, !!stored)}>
            <p className={ui.small}>
              The Solidity ML-DSA-44 verifier works from an expanded form of the key, computed and checked on-chain once.
              {prepareGas !== null && <> This costs about {gas(prepareGas)}.</>}
            </p>
            {prepared ? (
              <Mark state="ok">Prepared</Mark>
            ) : (
              <button type="button" className={ui.button} disabled={!ready || !stored || busy !== null} onClick={() => void doPrepare()}>
                {busy === 'prepare' ? 'Preparing…' : 'Prepare the key'}
              </button>
            )}
            {error?.step === 'prepare' && <Outcome error={error.e} />}
          </Step>
        )}

        <Step title="Fund its first operation" state={stateOf(funded || !!live, !!stored && !!account)}>
          <p className={ui.small}>
            There is no bundler in between: your wallet submits the operation to the EntryPoint itself, and the
            account pays for its own execution from its balance.
            {prefund !== null && (
              <>
                {' '}
                It needs about {amount(prefund, 18, 6)} {network.nativeSymbol}; unused gas is refunded to it.
              </>
            )}
          </p>
          {balance !== null && (
            <p className={ui.small}>
              Balance now: {formatEther(balance)} {network.nativeSymbol}
            </p>
          )}
          {!funded && !live && (
            <button type="button" className={ui.button} disabled={!ready || !account || !stored || prefund === null || busy !== null} onClick={() => void doFund()}>
              {busy === 'fund' ? 'Sending…' : 'Send it from my wallet'}
            </button>
          )}
          {error?.step === 'fund' && <Outcome error={error.e} />}
        </Step>

        <Step
          title="Open the treasury"
          state={stateOf(!!live || !!created?.ok, !!stored && funded && (!needsPrepare || !!prepared) && hotValid)}
        >
          <p className={ui.small}>
            The post-quantum key signs the first operation in this page. It deploys the account{hotOn ? ' and installs the hot tier' : ''}.
          </p>
          {created ? (
            created.ok ? (
              <p className={ui.notice} data-tone="ok">
                The treasury is open. <Link href={`/app/treasury/${network.key}/${created.address}`}>Go to its dashboard</Link>.
              </p>
            ) : (
              <p className={ui.notice} data-tone="error">
                The operation was included but did not execute.{' '}
                <a href={explorerTx(network, created.hash)} target="_blank" rel="noreferrer">
                  See the transaction
                </a>
                .
              </p>
            )
          ) : live ? (
            <p className={ui.small}>
              This account is already deployed. <Link href={`/app/treasury/${network.key}/${account!.address}`}>Open its dashboard</Link>.
            </p>
          ) : (
            <button
              type="button"
              className={ui.button}
              disabled={!ready || !stored || !funded || (needsPrepare && !prepared) || !hotValid || busy !== null}
              onClick={() => void doCreate()}
            >
              {busy === 'create' ? 'Signing and sending…' : 'Sign and open the treasury'}
            </button>
          )}
          {error?.step === 'create' && <Outcome error={error.e} />}
        </Step>
      </ol>

      {txs.length > 0 && (
        <section className={ui.panel} aria-labelledby="tx-h">
          <h2 id="tx-h" className={ui.h3}>
            Transactions
          </h2>
          <ul className={styles.txs}>
            {txs.map((t) => (
              <li key={t.hash}>
                {t.label}:{' '}
                <a href={explorerTx(network, t.hash)} target="_blank" rel="noreferrer">
                  {t.hash.slice(0, 10)}…
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      <OpenExisting network={network} />
    </div>
  );
}

function OpenExisting({ network }: { network: ProductNetwork }) {
  const [addr, setAddr] = useState('');
  const valid = isAddress(addr.trim());
  return (
    <section className={ui.panel} aria-labelledby="existing-h">
      <h2 id="existing-h" className={ui.h3}>
        Already have a treasury?
      </h2>
      <form
        className={ui.row}
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) window.location.href = `/app/treasury/${network.key}/${addr.trim() as Hex}`;
        }}
      >
        <input className={ui.input} value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="Account address, 0x…" aria-label="Account address" style={{ maxWidth: '28rem' }} spellCheck={false} />
        <button type="submit" className={ui.quiet} disabled={!valid}>
          Open its dashboard
        </button>
      </form>
    </section>
  );
}

/** The treasuries the recorded run opened, each a read-only dashboard. */
function LiveTreasuries({ networks }: { networks: ProductNetwork[] }) {
  const rows = networks.flatMap((n) => n.heroes.map((h) => ({ n, h })));
  if (!rows.length) return null;
  return (
    <section className={ui.panel} aria-labelledby="live-h">
      <h2 id="live-h" className={ui.h2}>
        Live treasuries
      </h2>
      <p className={ui.small}>
        Opened by the recorded run and left on-chain. Their dashboards read everything live: the two keys, the cap, the
        tripwire level and every operation. The run then tripped their drill registry, so their hot keys now refuse.
      </p>
      <ul className={styles.live}>
        {rows.map(({ n, h }) => (
          <li key={n.key + h.address}>
            <Link href={`/app/treasury/${n.key}/${h.address}`}>{h.label}</Link>
            <span className={ui.muted}>
              {n.name}, {h.key}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
