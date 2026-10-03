'use client';

import Link from 'next/link';
import { useState } from 'react';
import { getAddress, isAddress, isHash, zeroAddress, type Address, type Hash } from 'viem';
import { useConnection } from 'wagmi';
import { publicClientFor, type ProductNetwork } from '@/lib/chain';
import { explainError, type Explained } from '@/lib/errors';
import { amount } from '@/lib/format';
import { ARBITRUM_ONE_TOKENS, scanExposure, type ExposureReport } from '@/lib/sdk';
import { Hex, Mark, NetworkPicker, Outcome, useSelectedNetwork } from './kit';
import ui from './ui.module.css';
import styles from './Scanner.module.css';

/** Display names and decimals of the tokens the scanner reads on Arbitrum One. */
const TOKENS: Record<string, { symbol: string; decimals: number }> = {
  [ARBITRUM_ONE_TOKENS.usdc.toLowerCase()]: { symbol: 'USDC', decimals: 6 },
  [ARBITRUM_ONE_TOKENS.usdg.toLowerCase()]: { symbol: 'USDG', decimals: 6 },
  [ARBITRUM_ONE_TOKENS.weth.toLowerCase()]: { symbol: 'WETH', decimals: 18 },
  [ARBITRUM_ONE_TOKENS.arb.toLowerCase()]: { symbol: 'ARB', decimals: 18 },
};

type Result = { state: 'idle' } | { state: 'running' } | { state: 'done'; report: ExposureReport; network: ProductNetwork; searched: boolean } | { state: 'error'; error: Explained };

export function Scanner({ networks }: { networks: ProductNetwork[] }) {
  const scanNets = networks.filter((n) => n.key === 'arbitrum-one' || n.key === 'apechain');
  const [network, setNetwork] = useSelectedNetwork(scanNets, 'arbitrum-one');
  const conn = useConnection();
  const [input, setInput] = useState('');
  const [hint, setHint] = useState('');
  const [result, setResult] = useState<Result>({ state: 'idle' });

  const valid = isAddress(input.trim(), { strict: false });
  const hintValid = !hint.trim() || isHash(hint.trim());

  const scan = async () => {
    const address = getAddress(input.trim()) as Address;
    setResult({ state: 'running' });
    const client = publicClientFor(network);
    try {
      const report = await scanExposure(client, address, {
        ...(hint.trim() ? { hintTx: hint.trim() as Hash } : {}),
      });
      setResult({ state: 'done', report, network, searched: true });
    } catch (e) {
      // the key search needs historical state; fall back to the exposure verdict alone
      try {
        const report = await scanExposure(client, address, { findPublicKey: false });
        setResult({ state: 'done', report, network, searched: false });
      } catch (e2) {
        setResult({ state: 'error', error: explainError(e2 ?? e) });
      }
    }
  };

  return (
    <div className={ui.body}>
      <section className={ui.panel} aria-labelledby="scan-h">
        <h2 id="scan-h" className={ui.h2}>
          Scan an address
        </h2>
        <NetworkPicker networks={scanNets} value={network} onChange={setNetwork} />
        <form
          className={styles.form}
          onSubmit={(e) => {
            e.preventDefault();
            if (valid && hintValid) void scan();
          }}
        >
          <label className={ui.field}>
            <span className={ui.label}>Address</span>
            <input
              className={ui.input}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="0x…"
              spellCheck={false}
              autoComplete="off"
              aria-invalid={input !== '' && !valid}
            />
          </label>
          <label className={ui.field}>
            <span className={ui.label}>A transaction it sent (optional, skips the search)</span>
            <input
              className={ui.input}
              value={hint}
              onChange={(e) => setHint(e.target.value)}
              placeholder="0x… transaction hash"
              spellCheck={false}
              autoComplete="off"
              aria-invalid={!hintValid}
            />
          </label>
          <div className={ui.row}>
            <button type="submit" className={ui.button} disabled={!valid || !hintValid || result.state === 'running'}>
              {result.state === 'running' ? 'Scanning…' : 'Scan'}
            </button>
            {conn.address && (
              <button type="button" className={ui.quiet} onClick={() => setInput(conn.address!)}>
                Use my wallet&rsquo;s address
              </button>
            )}
          </div>
          {input !== '' && !valid && <p className={ui.notice} data-tone="error">That is not an address.</p>}
        </form>
      </section>

      {result.state === 'error' && <Outcome error={result.error} />}
      {result.state === 'done' && <Report r={result.report} network={result.network} searched={result.searched} />}

      <section className={ui.panel} aria-labelledby="what-h">
        <h2 id="what-h" className={ui.h2}>
          What exposure means
        </h2>
        <p className={ui.text}>
          An Ethereum account signs with secp256k1. Its address is a hash of the public key, so the key stays out of
          sight until the account signs its first transaction: from then on anyone can recover the public key from the
          signature. A quantum computer able to solve the discrete logarithm on secp256k1 could turn that public key
          into the private key and spend from the account.
        </p>
        <p className={ui.text}>
          Contracts have no key to expose, but the keys that control them do. Under EIP-7702 a delegated account keeps
          its original key live, so it stays exposed. The remedy is to move the funds to an account whose root key is
          post-quantum.
        </p>
      </section>
    </div>
  );
}

function Report({ r, network, searched }: { r: ExposureReport; network: ProductNetwork; searched: boolean }) {
  const verdict = r.isContract
    ? { state: 'ok' as const, word: 'A contract', line: 'Contract code has no private key to expose. Check the keys that control it.' }
    : r.exposed
      ? {
          state: 'broken' as const,
          word: 'Exposed',
          line: `This address has sent ${r.nonce.toLocaleString('en-US')} transaction${r.nonce === 1 ? '' : 's'}, so its public key is on-chain.`,
        }
      : { state: 'ok' as const, word: 'Not exposed yet', line: 'This address has never signed a transaction here, so its public key is not on this chain.' };
  return (
    <section className={ui.panel} aria-labelledby="report-h" aria-live="polite">
      <div className={ui.panelHead}>
        <h2 id="report-h" className={ui.h2}>
          {verdict.word}
        </h2>
        <Mark state={verdict.state}>{network.name}</Mark>
      </div>
      <p className={ui.text}>{verdict.line}</p>
      {r.delegatedTo && (
        <p className={ui.notice}>
          Delegated under EIP-7702 to <Hex value={r.delegatedTo} network={network} />. The account&rsquo;s own key still
          signs, so delegation does not hide it.
        </p>
      )}
      <dl className={ui.ledger}>
        <dt>Address</dt>
        <dd>
          <Hex value={r.address} network={network} full />
        </dd>
        <dt>Transactions sent</dt>
        <dd>{r.nonce.toLocaleString('en-US')}</dd>
        {r.exposed && (
          <>
            <dt>Public key</dt>
            <dd>
              {r.publicKey ? (
                <Hex value={r.publicKey} kind="none" />
              ) : (
                <span className={ui.muted}>
                  {searched ? 'Not found by the search.' : 'Not searched: this network’s public node keeps no history for it.'}
                </span>
              )}
            </dd>
            <dt>Revealed in</dt>
            <dd>{r.exposingTx ? <Hex value={r.exposingTx} network={network} kind="tx" /> : <span className={ui.muted}>Unknown</span>}</dd>
          </>
        )}
      </dl>
      <h3 className={ui.h3}>At stake</h3>
      <table className={styles.balances}>
        <thead>
          <tr>
            <th scope="col">Asset</th>
            <th scope="col">Balance</th>
          </tr>
        </thead>
        <tbody>
          {r.balances.map((b) => {
            const meta = b.token === zeroAddress ? { symbol: r.nativeSymbol, decimals: 18 } : (TOKENS[b.token.toLowerCase()] ?? { symbol: b.token, decimals: 18 });
            return (
              <tr key={b.token}>
                <th scope="row">{meta.symbol}</th>
                <td>{amount(b.amount, meta.decimals)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {r.exposed && (
        <p className={ui.small}>
          <Link href="/app">Open a treasury</Link> with a post-quantum root key and move these funds in one batch.
        </p>
      )}
    </section>
  );
}
