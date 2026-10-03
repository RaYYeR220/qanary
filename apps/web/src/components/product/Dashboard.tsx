'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { getAddress, isAddress, parseEther, zeroAddress, type Address, type Hash, type PublicClient } from 'viem';
import { entryPoint07Abi } from 'viem/account-abstraction';
import { useConnection, useWalletClient } from 'wagmi';
import { bucketView, formatDuration } from '@/lib/bucket';
import { deploymentOf, explorerTx, publicClientFor, type ProductNetwork } from '@/lib/chain';
import { explainError, type Explained } from '@/lib/errors';
import { amount, gas } from '@/lib/format';
import {
  canary,
  createQanaryAccount,
  hotTier,
  hotTierExecutorAbi,
  NATIVE_ASSET,
  pqSignerFromMnemonic,
  quantumValidatorAbi,
  selfBundleUserOperation,
  userOperationOutcome,
  type Scheme,
} from '@/lib/sdk';
import { loadTreasuries, loadVault, openPhrase, type TreasuryRecord } from '@/lib/vault';
import { BucketGauge } from './BucketGauge';
import { Hex, Mark, Outcome, WalletBar } from './kit';
import { LadderReadout } from './LadderReadout';
import ui from './ui.module.css';
import styles from './Dashboard.module.css';

interface Op {
  kind: 'cold' | 'hot';
  hash: Hash;
  block: bigint;
  success: boolean;
  gasUsed?: bigint;
}

async function readTreasury(n: ProductNetwork, account: Address) {
  const client = publicClientFor(n);
  const d = deploymentOf(n);
  const [code, balance] = await Promise.all([client.getCode({ address: account }), client.getBalance({ address: account })]);
  const deployed = !!code && code !== '0x';
  const root = d.quantumValidator
    ? await client.readContract({ address: d.quantumValidator, abi: quantumValidatorAbi, functionName: 'configOf', args: [account] }).catch(() => null)
    : null;
  const hot = d.hotTierExecutor && deployed ? await hotTier(client, d.hotTierExecutor).status(account).catch(() => null) : null;
  let caps: Record<string, bigint> = {};
  if (d.hotTierExecutor && hot?.configured) {
    const logs = await client
      .getContractEvents({ address: d.hotTierExecutor, abi: hotTierExecutorAbi, eventName: 'CapSet', args: { account }, fromBlock: 'earliest' })
      .catch(() => []);
    caps = Object.fromEntries(logs.map((l) => [String(l.args.asset).toLowerCase(), l.args.cap as bigint]));
  }
  let registry: { level: number; claimed: boolean[]; families: [boolean, boolean] } | null = null;
  if (d.canaryRegistry) {
    const c = canary(client, d.canaryRegistry);
    const [level, claimed, k1, r1] = await Promise.all([
      c.level(),
      Promise.all(([0, 1, 2, 3, 4] as const).map((t) => c.claimed(t))),
      c.familyBroken(0),
      c.familyBroken(1),
    ]);
    registry = { level, claimed, families: [k1, r1] };
  }
  return { deployed, balance, root, hot, caps, registry };
}

async function readOps(client: PublicClient, n: ProductNetwork, account: Address): Promise<{ ops: Op[]; partial: boolean }> {
  const d = deploymentOf(n);
  const ops: Op[] = [];
  let partial = false;
  const range = async <T,>(fetch: (from: bigint | 'earliest') => Promise<T[]>): Promise<T[]> => {
    try {
      return await fetch('earliest');
    } catch {
      // public nodes cap the log range; fall back to the recent past
      partial = true;
      const head = await client.getBlockNumber();
      return fetch(head > 200_000n ? head - 200_000n : 0n).catch(() => []);
    }
  };
  const userOps = await range((fromBlock) =>
    client.getContractEvents({ address: d.entryPoint, abi: entryPoint07Abi, eventName: 'UserOperationEvent', args: { sender: account }, fromBlock }),
  );
  for (const l of userOps) {
    ops.push({ kind: 'cold', hash: l.transactionHash, block: l.blockNumber, success: l.args.success === true, gasUsed: l.args.actualGasUsed });
  }
  if (d.hotTierExecutor) {
    const hotOps = await range((fromBlock) =>
      client.getContractEvents({ address: d.hotTierExecutor!, abi: hotTierExecutorAbi, eventName: 'HotOpExecuted', args: { account }, fromBlock }),
    );
    const receipts = await Promise.all(hotOps.slice(-20).map((l) => client.getTransactionReceipt({ hash: l.transactionHash }).catch(() => null)));
    hotOps.slice(-20).forEach((l, i) => ops.push({ kind: 'hot', hash: l.transactionHash, block: l.blockNumber, success: true, gasUsed: receipts[i]?.gasUsed }));
  }
  ops.sort((a, b) => Number(b.block - a.block));
  return { ops: ops.slice(0, 30), partial };
}

export function Dashboard({ network, account }: { network: ProductNetwork; account: Address }) {
  const d = deploymentOf(network);
  const client = publicClientFor(network);
  const q = useQuery({ queryKey: ['treasury', network.chainId, account], queryFn: () => readTreasury(network, account), refetchInterval: 20_000 });
  const ops = useQuery({ queryKey: ['ops', network.chainId, account], queryFn: () => readOps(client, network, account) });
  const [record, setRecord] = useState<TreasuryRecord | null>(null);
  useEffect(() => {
    setRecord(loadTreasuries().find((t) => t.network === network.key && t.address.toLowerCase() === account.toLowerCase()) ?? null);
  }, [network.key, account]);

  const t = q.data;
  const missing = [!d.quantumValidator && 'quantum validator', !d.hotTierExecutor && 'hot-tier executor', !d.canaryRegistry && 'tripwire registry'].filter(Boolean) as string[];

  return (
    <div className={ui.body}>
      {missing.length > 0 && (
        <p className={ui.notice}>
          On {network.name} the {new Intl.ListFormat('en', { type: 'conjunction' }).format(missing)} {missing.length === 1 ? 'is' : 'are'} still
          deploying, so parts of this dashboard read &ldquo;deploying&rdquo; until then.
        </p>
      )}

      <section className={ui.panel} aria-labelledby="tiers-h">
        <div className={ui.panelHead}>
          <h2 id="tiers-h" className={ui.h2}>
            The two keys
          </h2>
          {t && (t.deployed ? <Mark state="ok">Account deployed</Mark> : <Mark state="pending">No account code at this address yet</Mark>)}
        </div>
        {q.isPending && <Mark state="pending">Reading the account…</Mark>}
        {q.isError && <Outcome error={explainError(q.error, network.nativeSymbol)} />}
        {t && (
          <div className={styles.tiers}>
            <article className={styles.tier}>
              <h3 className={ui.h3}>Cold: the post-quantum key</h3>
              <dl className={ui.ledger}>
                <dt>Balance</dt>
                <dd>
                  {amount(t.balance)} {network.nativeSymbol}
                </dd>
                <dt>Verifier</dt>
                <dd>
                  {!d.quantumValidator ? (
                    <Mark state="deploying">Deploying</Mark>
                  ) : t.root && t.root.verifier !== zeroAddress ? (
                    <Hex value={t.root.verifier} network={network} />
                  ) : (
                    <span className={ui.muted}>No post-quantum key installed</span>
                  )}
                </dd>
                <dt>Key pointer</dt>
                <dd>{t.root && t.root.keyPtr !== zeroAddress ? <Hex value={t.root.keyPtr} network={network} /> : <span className={ui.muted}>None</span>}</dd>
                <dt>Moves</dt>
                <dd>Everything: above the cap, modules, key rotation, ERC-1271 signatures</dd>
              </dl>
            </article>
            <article className={styles.tier}>
              <h3 className={ui.h3}>Hot: the capped classical key</h3>
              {!d.hotTierExecutor ? (
                <Mark state="deploying">The hot-tier executor is deploying</Mark>
              ) : !t.hot || !t.hot.configured ? (
                <p className={ui.small}>This account has no hot tier.</p>
              ) : (
                <>
                  <dl className={ui.ledger}>
                    <dt>Scale now</dt>
                    <dd>
                      {t.hot.frozen ? <Mark state="broken">Frozen</Mark> : `${(t.hot.effectiveBps / 100).toLocaleString('en-US')}% of each cap`}
                    </dd>
                    <dt>Operations</dt>
                    <dd>{t.hot.nonce.toString()}</dd>
                  </dl>
                  {t.hot.assets.map((a) => {
                    const cap = t.caps[a.asset.toLowerCase()];
                    const window = record?.hot?.window;
                    const symbol = a.asset === NATIVE_ASSET ? network.nativeSymbol : a.asset;
                    if (cap === undefined) {
                      return (
                        <p key={a.asset} className={ui.small}>
                          {amount(a.available)} {symbol} available now.
                        </p>
                      );
                    }
                    const v = bucketView({ cap, available: a.available, effectiveBps: t.hot!.configured ? t.hot!.effectiveBps : 0, window: window ?? 86_400 });
                    return (
                      <figure key={a.asset} className={styles.bucket}>
                        <BucketGauge
                          scale={v.scale}
                          available={cap === 0n ? 0 : Number((a.available * 10_000n) / cap) / 10_000}
                          label={`${symbol}: ${amount(a.available)} available of a ${amount(v.effectiveCap)} cap`}
                        />
                        <figcaption>
                          <p className={styles.big}>
                            {amount(a.available)} {symbol}
                          </p>
                          <p className={ui.small}>
                            available now, of a cap of {amount(v.effectiveCap)}
                            {v.scale < 1 ? ` (scaled from ${amount(cap)} by the tripwire)` : ''}.
                          </p>
                          <p className={`${ui.small} ${ui.muted}`}>
                            {v.frozen
                              ? 'Frozen: nothing refills while the tripwire holds this level.'
                              : window
                                ? `Refills ${amount(v.refillPerHour)} ${symbol} an hour; full again in ${formatDuration(v.secondsToFull)}. Window ${formatDuration(window)}.`
                                : 'Refills continuously over the window set at creation.'}
                          </p>
                        </figcaption>
                      </figure>
                    );
                  })}
                </>
              )}
            </article>
          </div>
        )}
      </section>

      <section className={ui.panel} aria-labelledby="threat-h">
        <h2 id="threat-h" className={ui.h2}>
          Threat level
        </h2>
        {!d.canaryRegistry ? (
          <Mark state="deploying">The tripwire registry is deploying on {network.name}</Mark>
        ) : t?.registry ? (
          <>
            <LadderReadout claimed={t.registry.claimed} label={`Ladder level ${t.registry.level} of 3`} />
            <p className={ui.small}>
              Level {t.registry.level} of 3. secp256k1 {t.registry.families[0] ? 'broken' : 'holding'}; P-256{' '}
              {t.registry.families[1] ? 'broken' : 'holding'}.
            </p>
          </>
        ) : (
          <Mark state="pending">Reading the registry…</Mark>
        )}
      </section>

      <section className={ui.panel} aria-labelledby="send-h">
        <h2 id="send-h" className={ui.h2}>
          Send
        </h2>
        <WalletBar network={network} />
        <div className={ui.grid2}>
          <ColdSend network={network} account={account} deployed={!!t?.deployed} defaultScheme={(record?.scheme as Scheme) ?? 'mldsa44'} />
          <HotSend network={network} account={account} enabled={!!t?.hot?.configured} />
        </div>
      </section>

      <section className={ui.panel} aria-labelledby="ops-h">
        <h2 id="ops-h" className={ui.h2}>
          Operations
        </h2>
        {ops.isPending && <Mark state="pending">Reading the logs…</Mark>}
        {ops.data && ops.data.ops.length === 0 && <p className={ui.small}>No operations yet.</p>}
        {ops.data && ops.data.ops.length > 0 && (
          <table className={styles.ops}>
            <thead>
              <tr>
                <th scope="col">Key</th>
                <th scope="col">Result</th>
                <th scope="col">Gas</th>
                <th scope="col">Block</th>
                <th scope="col">Transaction</th>
              </tr>
            </thead>
            <tbody>
              {ops.data.ops.map((o) => (
                <tr key={o.hash + o.kind}>
                  <td>{o.kind === 'cold' ? 'Post-quantum' : 'Hot'}</td>
                  <td>{o.success ? <Mark state="ok">Executed</Mark> : <Mark state="refused">Reverted</Mark>}</td>
                  <td>{o.gasUsed !== undefined ? gas(o.gasUsed) : '—'}</td>
                  <td>{o.block.toString()}</td>
                  <td>
                    <a href={explorerTx(network, o.hash)} target="_blank" rel="noreferrer">
                      {o.hash.slice(0, 10)}…
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {ops.data?.partial && <p className={`${ui.small} ${ui.muted}`}>The public node limits log searches; showing recent blocks only.</p>}
      </section>
    </div>
  );
}

function SendForm({
  onSend,
  busy,
  disabled,
  symbol,
  cta,
}: {
  onSend: (to: Address, value: bigint) => void;
  busy: boolean;
  disabled: boolean;
  symbol: string;
  cta: string;
}) {
  const [to, setTo] = useState('');
  const [value, setValue] = useState('');
  let wei: bigint | null = null;
  try {
    wei = value ? parseEther(value) : null;
  } catch {
    wei = null;
  }
  const ok = isAddress(to.trim()) && wei !== null && wei > 0n;
  return (
    <form
      className={styles.form}
      onSubmit={(e) => {
        e.preventDefault();
        if (ok) onSend(getAddress(to.trim()), wei!);
      }}
    >
      <label className={ui.field}>
        <span className={ui.label}>To</span>
        <input className={ui.input} value={to} onChange={(e) => setTo(e.target.value)} placeholder="0x…" spellCheck={false} />
      </label>
      <label className={ui.field}>
        <span className={ui.label}>Amount, {symbol}</span>
        <input className={ui.input} value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" />
      </label>
      <div>
        <button type="submit" className={ui.button} disabled={!ok || busy || disabled}>
          {busy ? 'Sending…' : cta}
        </button>
      </div>
    </form>
  );
}

function ColdSend({ network, account, deployed, defaultScheme }: { network: ProductNetwork; account: Address; deployed: boolean; defaultScheme: Scheme }) {
  const d = deploymentOf(network);
  const conn = useConnection();
  const wallet = useWalletClient({ chainId: network.chainId });
  const qc = useQueryClient();
  const [phrase, setPhrase] = useState('');
  const [pass, setPass] = useState('');
  const [scheme, setScheme] = useState<Scheme>(defaultScheme);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Explained | null>(null);
  const [done, setDone] = useState<{ hash: Hash; ok: boolean } | null>(null);
  const vault = typeof window === 'undefined' ? null : loadVault();
  const ready = conn.status === 'connected' && conn.chainId === network.chainId && !!wallet.data;

  const send = async (to: Address, value: bigint) => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const words = phrase.trim() ? phrase.trim() : vault ? await openPhrase(vault, pass) : '';
      if (!words) throw new Error('Enter the recovery phrase, or unlock the copy saved in this browser.');
      const s = vault && !phrase.trim() ? (vault.scheme as Scheme) : scheme;
      const signer = pqSignerFromMnemonic(s, words);
      const acct = await createQanaryAccount(publicClientFor(network), {
        signer,
        registry: d.canaryRegistry ?? zeroAddress,
        deployment: d,
        address: account,
        installHotTier: false,
      });
      if (acct.address.toLowerCase() !== account.toLowerCase()) throw new Error('That key does not control this account.');
      const { userOpHash, hash } = await selfBundleUserOperation(wallet.data!, acct, { calls: [{ to, value }] });
      const receipt = await publicClientFor(network).waitForTransactionReceipt({ hash });
      setDone({ hash, ok: userOperationOutcome(receipt, userOpHash) === true });
      await qc.invalidateQueries({ queryKey: ['treasury', network.chainId, account] });
      await qc.invalidateQueries({ queryKey: ['ops', network.chainId, account] });
    } catch (e) {
      setError(explainError(e, network.nativeSymbol));
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className={styles.send}>
      <h3 className={ui.h3}>With the post-quantum key</h3>
      <p className={ui.small}>
        Signed in this page with the key from your phrase, submitted by your wallet. No cap applies. The account pays
        the operation&rsquo;s gas from its balance.
      </p>
      {vault ? (
        <label className={ui.field}>
          <span className={ui.label}>Passphrase of the copy saved in this browser</span>
          <input className={ui.input} type="password" value={pass} onChange={(e) => setPass(e.target.value)} />
        </label>
      ) : (
        <>
          <label className={ui.field}>
            <span className={ui.label}>Recovery phrase</span>
            <textarea className={ui.textarea} value={phrase} onChange={(e) => setPhrase(e.target.value)} spellCheck={false} autoComplete="off" />
          </label>
          <label className={ui.field}>
            <span className={ui.label}>Scheme</span>
            <select className={ui.select} value={scheme} onChange={(e) => setScheme(e.target.value as Scheme)}>
              <option value="mldsa44">ML-DSA-44</option>
              <option value="falcon512">Falcon-512</option>
            </select>
          </label>
        </>
      )}
      <SendForm onSend={(to, v) => void send(to, v)} busy={busy} disabled={!ready || !deployed || !d.quantumValidator} symbol={network.nativeSymbol} cta="Sign and send" />
      {done &&
        (done.ok ? (
          <p className={ui.notice} data-tone="ok">
            Sent.{' '}
            <a href={explorerTx(network, done.hash)} target="_blank" rel="noreferrer">
              See the transaction
            </a>
            .
          </p>
        ) : (
          <p className={ui.notice} data-tone="error">
            The operation was included but its call reverted.{' '}
            <a href={explorerTx(network, done.hash)} target="_blank" rel="noreferrer">
              See the transaction
            </a>
            .
          </p>
        ))}
      {error && <Outcome error={error} />}
    </article>
  );
}

function HotSend({ network, account, enabled }: { network: ProductNetwork; account: Address; enabled: boolean }) {
  const d = deploymentOf(network);
  const conn = useConnection();
  const wallet = useWalletClient({ chainId: network.chainId });
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Explained | null>(null);
  const [done, setDone] = useState<Hash | null>(null);
  const ready = conn.status === 'connected' && conn.chainId === network.chainId && !!wallet.data;

  const send = async (to: Address, value: bigint) => {
    if (!d.hotTierExecutor || !conn.address) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const client = publicClientFor(network);
      const calls = [{ target: to, value, data: '0x' as const }];
      // a refusal is explained here, before the wallet asks for gas
      await client.simulateContract({ address: d.hotTierExecutor, abi: hotTierExecutorAbi, functionName: 'execute', args: [account, calls], account: conn.address });
      const hash = await hotTier(wallet.data!, d.hotTierExecutor).execute(account, calls);
      await client.waitForTransactionReceipt({ hash });
      setDone(hash);
      await qc.invalidateQueries({ queryKey: ['treasury', network.chainId, account] });
      await qc.invalidateQueries({ queryKey: ['ops', network.chainId, account] });
    } catch (e) {
      setError(explainError(e, network.nativeSymbol));
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className={styles.send}>
      <h3 className={ui.h3}>With the hot key</h3>
      <p className={ui.small}>
        Your wallet must be the account&rsquo;s hot key. The executor checks the cap, the allowlist and the tripwire before
        anything moves, and refuses what falls outside them.
      </p>
      {!d.hotTierExecutor ? (
        <Mark state="deploying">The hot-tier executor is deploying</Mark>
      ) : !enabled ? (
        <p className={`${ui.small} ${ui.muted}`}>This account has no hot tier.</p>
      ) : null}
      <SendForm onSend={(to, v) => void send(to, v)} busy={busy} disabled={!ready || !enabled || !d.hotTierExecutor} symbol={network.nativeSymbol} cta="Send with the hot key" />
      {done && (
        <p className={ui.notice} data-tone="ok">
          Sent.{' '}
          <a href={explorerTx(network, done)} target="_blank" rel="noreferrer">
            See the transaction
          </a>
          .
        </p>
      )}
      {error && <Outcome error={error} />}
    </article>
  );
}
