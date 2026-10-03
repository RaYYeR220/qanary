'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { encodeFunctionData, keccak256, parseAbi, parseEventLogs, stringToBytes, type Address, type Hex } from 'viem';
import { useConnection, useWalletClient } from 'wagmi';
import { RUNGS } from '@/content/facts';
import { deploymentOf, explorerTx, publicClientFor, type ProductNetwork } from '@/lib/chain';
import { explainError, type Explained } from '@/lib/errors';
import { amount, gas } from '@/lib/format';
import { LADDER_CURVE_ID, signLadder, signTarget, tamperWord, type LadderCurve } from '@/lib/ladder';
import { canary, canaryRegistryAbi, drillRegistryFactoryAbi, encodeClaimProof } from '@/lib/sdk';
import type { TargetView } from '@/lib/targets';
import { Hex as HexText, Mark, NetworkPicker, Outcome, useSelectedNetwork, WalletBar } from './kit';
import { LadderReadout } from './LadderReadout';
import ui from './ui.module.css';
import styles from './TripwireView.module.css';

/** A 32-byte word without its leading zero bytes, for display. */
const trimWord = (w: Hex): Hex => `0x${BigInt(w).toString(16)}`;

const ladderAbi = parseAbi(['function verify(uint8 curve, bytes32 qx, bytes32 qy, bytes32 digest, bytes32 r, bytes32 s) view returns (bool)']);
const CURVES: LadderCurve[] = ['secp160r1', 'p192', 'p224'];

interface RegistryState {
  level: number;
  families: [boolean, boolean];
  claimed: boolean[];
  bounties: { tokenAmount: bigint; ethAmount: bigint }[];
  drill: boolean;
}

async function readRegistry(n: ProductNetwork, registry: Address): Promise<RegistryState> {
  const c = canary(publicClientFor(n), registry);
  const ids = [0, 1, 2, 3, 4] as const;
  const [level, k1, r1, claimed, bounties, drill] = await Promise.all([
    c.level(),
    c.familyBroken(0),
    c.familyBroken(1),
    Promise.all(ids.map((t) => c.claimed(t))),
    Promise.all(ids.map((t) => c.bounty(t))),
    c.isDrill(),
  ]);
  return { level, families: [k1, r1], claimed, bounties, drill };
}

/** The status sentence for a registry, in the landing's words. */
function statusOf(s: RegistryState): { event: string; response: string } {
  if (s.families[1]) return RUNGS[5]!;
  if (s.families[0]) return RUNGS[4]!;
  return RUNGS[Math.min(3, s.level)]!;
}

function RegistryReading({ network, registry, title }: { network: ProductNetwork; registry: Address; title: string }) {
  const q = useQuery({ queryKey: ['registry', network.chainId, registry], queryFn: () => readRegistry(network, registry), refetchInterval: 20_000 });
  if (q.isPending) return <Mark state="pending">Reading {title.toLowerCase()}…</Mark>;
  if (q.isError) return <Outcome error={explainError(q.error, network.nativeSymbol)} />;
  const s = q.data;
  const status = statusOf(s);
  return (
    <div className={styles.reading}>
      <LadderReadout claimed={s.claimed} label={`${title}: ladder level ${s.level} of 3`} />
      <p className={ui.text}>
        <em>{status.event}</em> {status.response}
      </p>
      <dl className={ui.ledger}>
        <dt>Ladder level</dt>
        <dd>{s.level} of 3</dd>
        <dt>secp256k1 family</dt>
        <dd>{s.families[0] ? <Mark state="broken">Broken for good</Mark> : <Mark state="ok">Holding</Mark>}</dd>
        <dt>P-256 family</dt>
        <dd>{s.families[1] ? <Mark state="broken">Broken for good</Mark> : <Mark state="ok">Holding</Mark>}</dd>
        <dt>Bounties</dt>
        <dd>
          {s.bounties.map((b, i) => (
            <span key={i} className={styles.bounty}>
              {['L1', 'L2', 'L3', 'K1', 'R1'][i]}: {amount(b.ethAmount)} {network.nativeSymbol}
              {b.tokenAmount > 0n ? ` + ${amount(b.tokenAmount, 6)} USDG` : ''}
              {s.claimed[i] ? ' (claimed)' : ''}
            </span>
          ))}
        </dd>
      </dl>
    </div>
  );
}

export function TripwireView({ networks, targets, repoUrl }: { networks: ProductNetwork[]; targets: TargetView[]; repoUrl: string | null }) {
  const [network, setNetwork] = useSelectedNetwork(networks);
  return (
    <div className={ui.body}>
      <section className={ui.panel} aria-labelledby="reg-h">
        <h2 id="reg-h" className={ui.h2}>
          The registries, live
        </h2>
        <p className={ui.small}>
          Each network has its live registry, read below as it stands, and the drill registry the recorded run tripped on
          purpose: the first ladder rung where a ladder verifier runs, then secp256k1. The run&rsquo;s treasuries follow
          the drill, so their hot keys are shut.
        </p>
        <div className={styles.registries}>
          {networks
            .filter((n) => deploymentOf(n).canaryRegistry || n.run?.drillRegistry)
            .map((n) => {
              const dn = deploymentOf(n);
              return (
                <article key={n.key} className={styles.registry}>
                  <h3 className={ui.h3}>{n.name}</h3>
                  {dn.canaryRegistry ? (
                    <>
                      <p className={ui.small}>
                        Live registry <HexText value={dn.canaryRegistry} network={n} />
                      </p>
                      <RegistryReading network={n} registry={dn.canaryRegistry} title="The live registry" />
                    </>
                  ) : (
                    <Mark state="deploying">The live registry is deploying</Mark>
                  )}
                  {n.run?.drillRegistry && (
                    <>
                      <p className={ui.small}>
                        Drill registry of the live run <HexText value={n.run.drillRegistry} network={n} />
                      </p>
                      <RegistryReading network={n} registry={n.run.drillRegistry} title="The run's drill" />
                    </>
                  )}
                </article>
              );
            })}
        </div>
      </section>

      <section className={ui.panel} aria-labelledby="targets-h">
        <h2 id="targets-h" className={ui.h2}>
          Five keys nobody holds
        </h2>
        <p className={ui.text}>
          Each target is a point found by hashing a public tag onto the curve: x = SHA-256(tag ‖ counter) mod p, taking
          the first counter that lands on the curve and the even y. Nobody chose the point, so nobody knows its private
          key; a valid signature by one of them proves the discrete logarithm was computed.{' '}
          {repoUrl ? (
            <a href={`${repoUrl}/blob/main/scripts/nums.py`} target="_blank" rel="noreferrer">
              scripts/nums.py
            </a>
          ) : (
            <span className={ui.italic}>scripts/nums.py</span>
          )}{' '}
          in the repository writes them, and this page re-derived each one when it was built.
        </p>
        <div className={styles.targets}>
          {targets.map((t) => (
            <article key={t.id} className={styles.target}>
              <h3 className={ui.h3}>
                {t.code}, {t.label}
              </h3>
              <p className={`${ui.small} ${ui.muted}`}>{t.role}</p>
              <dl className={ui.ledger}>
                <dt>Tag</dt>
                <dd className={ui.mono}>
                  {t.nums.tag}, counter {t.nums.ctr}
                </dd>
                <dt>x</dt>
                <dd>
                  <HexText value={trimWord(t.nums.x)} kind="none" />
                </dd>
                <dt>y</dt>
                <dd>
                  <HexText value={trimWord(t.nums.y)} kind="none" />
                </dd>
                {t.nums.address && (
                  <>
                    <dt>As an address</dt>
                    <dd>
                      <HexText value={t.nums.address} kind="none" />
                    </dd>
                  </>
                )}
                <dt>Re-derived</dt>
                <dd>{t.nums.derivationHolds ? <Mark state="ok">Holds: on the curve, from the tag</Mark> : <Mark state="broken">Does not match</Mark>}</dd>
              </dl>
            </article>
          ))}
        </div>
      </section>

      <LadderCheck networks={networks} targets={targets} />
      <section className={ui.panel} aria-labelledby="drill-net-h">
        <h2 id="drill-net-h" className="visually-hidden">
          Network for your drill
        </h2>
        <NetworkPicker networks={networks} value={network} onChange={setNetwork} legend="Network for your drill" />
      </section>
      <Drill network={network} targets={targets} />
    </div>
  );
}

/** Sign with a published drill key and ask the live ladder verifier. */
function LadderCheck({ networks, targets }: { networks: ProductNetwork[]; targets: TargetView[] }) {
  const ape = networks.find((n) => n.key === 'apechain')!;
  const verifier = deploymentOf(ape).ladderVerifier;
  const [curve, setCurve] = useState<LadderCurve>('p224');
  const [text, setText] = useState('Rehearse a claim on the tripwire');
  const [tampered, setTampered] = useState(false);
  const [state, setState] = useState<
    { s: 'idle' } | { s: 'running' } | { s: 'done'; valid: boolean; gas: bigint; r: Hex; sig: Hex } | { s: 'error'; e: Explained }
  >({ s: 'idle' });

  const check = async () => {
    if (!verifier) return;
    setState({ s: 'running' });
    const t = targets[CURVES.indexOf(curve)]!;
    const digest = keccak256(stringToBytes(text));
    const sig = signLadder(curve, t.drill.privateKey, digest);
    const asked = tampered ? tamperWord(digest) : digest;
    const args = [LADDER_CURVE_ID[curve], t.drill.x, t.drill.y, asked, sig.r, sig.s] as const;
    try {
      const client = publicClientFor(ape);
      const [valid, g] = await Promise.all([
        client.readContract({ address: verifier, abi: ladderAbi, functionName: 'verify', args }),
        client.estimateGas({ to: verifier, data: encodeFunctionData({ abi: ladderAbi, functionName: 'verify', args }) }),
      ]);
      setState({ s: 'done', valid, gas: g, r: sig.r, sig: sig.s });
    } catch (e) {
      setState({ s: 'error', e: explainError(e) });
    }
  };

  return (
    <section className={ui.panel} aria-labelledby="ladder-h">
      <h2 id="ladder-h" className={ui.h2}>
        Ask the ladder verifier
      </h2>
      <p className={ui.text}>
        The ladder curves are too short for Ethereum&rsquo;s precompiles, so a Stylus program checks them. It is live on
        ApeChain. Sign a message here with a published drill key (python-ecdsa&rsquo;s RFC 6979 signing, reproduced in
        the browser) and the verifier answers.
      </p>
      {verifier ? (
        <>
          <fieldset className={ui.picker}>
            <legend className={ui.label}>Curve</legend>
            {CURVES.map((c, i) => (
              <label key={c} className={ui.pick}>
                <input type="radio" name="ladder-curve" checked={curve === c} onChange={() => setCurve(c)} />
                <span>{targets[i]!.label}</span>
              </label>
            ))}
          </fieldset>
          <label className={ui.field}>
            <span className={ui.label}>Message</span>
            <input className={ui.input} value={text} maxLength={160} onChange={(e) => setText(e.target.value)} />
          </label>
          <div className={ui.row}>
            <button type="button" className={ui.button} onClick={() => void check()} disabled={state.s === 'running' || !text}>
              {state.s === 'running' ? 'Asking…' : 'Sign and verify'}
            </button>
            <label className={ui.check}>
              <input type="checkbox" checked={tampered} onChange={(e) => setTampered(e.target.checked)} />
              Change one bit of the message after signing
            </label>
          </div>
          <div aria-live="polite">
            {state.s === 'done' &&
              (state.valid ? (
                <p className={ui.text}>
                  <Mark state="ok">The ladder verifier accepts the signature</Mark> <span className={styles.gasInline}>{gas(state.gas)}</span>
                </p>
              ) : (
                <div className={ui.stamp}>
                  <span className={ui.stampWord}>Refused</span>
                  <span>The signature does not match the changed message.</span>
                  <span className={ui.stampName}>{gas(state.gas)}</span>
                </div>
              ))}
            {state.s === 'error' && <Outcome error={state.e} />}
          </div>
        </>
      ) : (
        <Mark state="deploying">The ladder verifier is deploying</Mark>
      )}
    </section>
  );
}

const drillKey = (chainId: number) => `qanary.drills.${chainId}`;

function savedDrills(chainId: number): Address[] {
  try {
    return JSON.parse(localStorage.getItem(drillKey(chainId)) ?? '[]') as Address[];
  } catch {
    return [];
  }
}

/** Create a drill registry and claim its targets with the published drill keys. */
function Drill({ network, targets }: { network: ProductNetwork; targets: TargetView[] }) {
  const d = deploymentOf(network);
  const conn = useConnection();
  const wallet = useWalletClient({ chainId: network.chainId });
  const qc = useQueryClient();
  const [drills, setDrills] = useState<Address[]>([]);
  const [active, setActive] = useState<Address | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<Explained | null>(null);
  const [lastTx, setLastTx] = useState<Hex | null>(null);

  useEffect(() => {
    const list = savedDrills(network.chainId);
    setDrills(list);
    setActive(list[0] ?? null);
  }, [network.chainId]);

  const ready = conn.status === 'connected' && conn.chainId === network.chainId && wallet.data;

  const start = async () => {
    if (!d.drillRegistryFactory || !wallet.data) return;
    setBusy('start');
    setError(null);
    try {
      const client = publicClientFor(network);
      const hash = await wallet.data.writeContract({ address: d.drillRegistryFactory, abi: drillRegistryFactoryAbi, functionName: 'create', args: [] });
      setLastTx(hash);
      const receipt = await client.waitForTransactionReceipt({ hash });
      const ev = parseEventLogs({ abi: drillRegistryFactoryAbi, eventName: 'DrillCreated', logs: receipt.logs })[0];
      if (!ev) throw new Error('The factory did not report a new drill registry.');
      const next = [ev.args.registry, ...drills].slice(0, 5);
      localStorage.setItem(drillKey(network.chainId), JSON.stringify(next));
      setDrills(next);
      setActive(ev.args.registry);
    } catch (e) {
      setError(explainError(e, network.nativeSymbol));
    } finally {
      setBusy(null);
    }
  };

  const claim = async (target: number) => {
    if (!active || !wallet.data || !conn.address) return;
    setBusy(`claim-${target}`);
    setError(null);
    try {
      const client = publicClientFor(network);
      const m = await canary(client, active).claimMessage(target as 0 | 1 | 2 | 3 | 4, conn.address);
      const sig = signTarget(target, targets[target]!.drill.privateKey, m);
      const proof = encodeClaimProof(target, sig);
      // simulate first so a refusal is explained before the wallet asks for gas
      await client.simulateContract({ address: active, abi: canaryRegistryAbi, functionName: 'claim', args: [target, proof], account: conn.address });
      const hash = await wallet.data.writeContract({ address: active, abi: canaryRegistryAbi, functionName: 'claim', args: [target, proof] });
      setLastTx(hash);
      await client.waitForTransactionReceipt({ hash });
      await qc.invalidateQueries({ queryKey: ['registry', network.chainId, active] });
    } catch (e) {
      setError(explainError(e, network.nativeSymbol));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className={ui.panel} aria-labelledby="drill-h">
      <h2 id="drill-h" className={ui.h2}>
        Run a drill
      </h2>
      <p className={ui.text}>
        A drill is a fresh registry over the drill keys, whose private keys are published. Claim its targets one by one
        and watch the level rise and the families break, exactly as the live registry would, without touching it.
        Claims are signed in this page and sent from your wallet.
      </p>
      {!d.drillRegistryFactory ? (
        <Mark state="deploying">The drill registry factory is deploying on {network.name}</Mark>
      ) : (
        <>
          <WalletBar network={network} />
          <div className={ui.row}>
            <button type="button" className={ui.button} disabled={!ready || busy !== null} onClick={() => void start()}>
              {busy === 'start' ? 'Creating the drill…' : 'Start a drill'}
            </button>
            {drills.length > 0 && (
              <label className={ui.field}>
                <span className={ui.label}>Drill registry</span>
                <select className={ui.select} value={active ?? ''} onChange={(e) => setActive(e.target.value as Address)}>
                  {drills.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          {active && (
            <>
              <RegistryReading network={network} registry={active} title="The drill" />
              <ol className={styles.claims}>
                {targets.map((t) => (
                  <li key={t.id}>
                    <button type="button" className={ui.quiet} disabled={!ready || busy !== null} onClick={() => void claim(t.id)}>
                      {busy === `claim-${t.id}` ? `Claiming ${t.code}…` : `Claim ${t.code}, ${t.label}`}
                    </button>
                  </li>
                ))}
              </ol>
            </>
          )}
          {lastTx && (
            <p className={ui.small}>
              Last transaction:{' '}
              <a href={explorerTx(network, lastTx)} target="_blank" rel="noreferrer">
                {lastTx.slice(0, 10)}…
              </a>
            </p>
          )}
          {error && <Outcome error={error} />}
        </>
      )}
    </section>
  );
}
