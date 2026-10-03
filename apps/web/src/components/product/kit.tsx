'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useConnect, useConnection, useConnectors, useDisconnect, useSwitchChain } from 'wagmi';
import { explorerAddress, explorerTx, type ProductNetwork } from '@/lib/chain';
import type { Explained } from '@/lib/errors';
import { shortHex } from '@/lib/format';
import ui from './ui.module.css';

export type MarkState = 'live' | 'ok' | 'paused' | 'refused' | 'broken' | 'pending' | 'deploying' | 'idle';

/** A state in words, with a lozenge that never carries the meaning alone. */
export function Mark({ state, children }: { state: MarkState; children: ReactNode }) {
  return (
    <span className={ui.mark} data-state={state}>
      {children}
    </span>
  );
}

/** An address or hash: shortened, linked to the explorer, copyable. */
export function Hex({ value, network, kind = 'address', full = false }: { value: string; network?: ProductNetwork; kind?: 'address' | 'tx' | 'none'; full?: boolean }) {
  const [copied, setCopied] = useState(false);
  const text = full ? value : shortHex(value);
  const href = network && kind !== 'none' ? (kind === 'tx' ? explorerTx(network, value) : explorerAddress(network, value)) : undefined;
  return (
    <span className={ui.hex}>
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" title={value}>
          {text}
        </a>
      ) : (
        <span title={value}>{text}</span>
      )}
      <button
        type="button"
        className={ui.copy}
        onClick={() => {
          void navigator.clipboard?.writeText(value).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          });
        }}
        aria-label={`Copy ${value}`}
      >
        {copied ? 'copied' : 'copy'}
      </button>
    </span>
  );
}

/** A refusal or failure, explained. Refusals are pressed into the page as a stamp. */
export function Outcome({ error }: { error: Explained }) {
  if (error.refusal) {
    return (
      <div className={ui.stamp} role="alert">
        <span className={ui.stampWord}>Refused</span>
        <span>{error.message}</span>
        <span className={ui.stampName}>{error.name}</span>
      </div>
    );
  }
  return (
    <p className={ui.notice} data-tone="error" role="alert">
      {error.message}
    </p>
  );
}

/** The network the page reads, kept in the address bar as ?network=. */
export function useSelectedNetwork(networks: ProductNetwork[], initial = 'apechain') {
  const [key, setKey] = useState(initial);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('network');
    if (q && networks.some((n) => n.key === q)) setKey(q);
  }, [networks]);
  const select = (k: string) => {
    setKey(k);
    const url = new URL(window.location.href);
    url.searchParams.set('network', k);
    window.history.replaceState(null, '', url);
  };
  const network = networks.find((n) => n.key === key) ?? networks[0]!;
  return [network, select] as const;
}

export function NetworkPicker({
  networks,
  value,
  onChange,
  legend = 'Network',
  note,
}: {
  networks: ProductNetwork[];
  value: ProductNetwork;
  onChange: (key: string) => void;
  legend?: string;
  note?: (n: ProductNetwork) => string | undefined;
}) {
  return (
    <fieldset className={ui.picker}>
      <legend className={ui.label}>{legend}</legend>
      {networks.map((n) => (
        <label key={n.key} className={ui.pick}>
          <input type="radio" name="network" value={n.key} checked={n.key === value.key} onChange={() => onChange(n.key)} />
          <span>
            {n.name}
            {note?.(n) ? <em className={ui.muted}>{note(n)}</em> : null}
          </span>
        </label>
      ))}
    </fieldset>
  );
}

/** Connect an injected wallet and keep it on the page's network. */
export function WalletBar({ network }: { network: ProductNetwork }) {
  const conn = useConnection();
  const connectors = useConnectors();
  const connect = useConnect();
  const disconnect = useDisconnect();
  const switchChain = useSwitchChain();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <div className={ui.walletBar} aria-hidden="true" />;

  const injected = connectors[0];
  if (conn.status !== 'connected' || !conn.address) {
    return (
      <div className={ui.walletBar}>
        <p className={ui.small}>
          {injected
            ? 'Transactions are sent from your own wallet. Nothing else leaves this page.'
            : 'No browser wallet found. Reading works without one; sending needs an injected wallet.'}
        </p>
        <button
          type="button"
          className={ui.quiet}
          disabled={!injected || connect.isPending}
          onClick={() => injected && connect.mutate({ connector: injected, chainId: network.chainId })}
        >
          {connect.isPending ? 'Connecting…' : 'Connect wallet'}
        </button>
      </div>
    );
  }
  const wrongChain = conn.chainId !== network.chainId;
  return (
    <div className={ui.walletBar}>
      <p className={ui.small}>
        <Mark state={wrongChain ? 'pending' : 'ok'}>{wrongChain ? 'Wallet on another network' : `Wallet on ${network.name}`}</Mark>{' '}
        <Hex value={conn.address} network={network} />
      </p>
      <div className={ui.row}>
        {wrongChain && (
          <button type="button" className={ui.quiet} disabled={switchChain.isPending} onClick={() => switchChain.mutate({ chainId: network.chainId })}>
            {switchChain.isPending ? 'Switching…' : `Switch to ${network.name}`}
          </button>
        )}
        <button type="button" className={ui.quiet} onClick={() => disconnect.mutate()}>
          Disconnect
        </button>
      </div>
    </div>
  );
}
