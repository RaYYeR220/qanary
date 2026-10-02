import {
  NETWORKS,
  STYLUS_KEYS,
  STYLUS_LABELS,
  shortHex,
  type Contract,
  type NetworkRecord,
  type StylusKey,
} from '@/lib/deployments';
import styles from './Register.module.css';

const fmt = (n: number) => n.toLocaleString('en-US');
const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;

function stylusDetail(key: StylusKey, records: NetworkRecord[]): string {
  const any = records.map((r) => r.stylus[key]).find(Boolean);
  const parts = ['Stylus'];
  if (any?.sizeBytes) parts.push(kb(any.sizeBytes));
  if (any?.gasByCurve) {
    const g = Object.values(any.gasByCurve);
    parts.push(`${(Math.min(...g) / 1e6).toFixed(2)} to ${(Math.max(...g) / 1e6).toFixed(2)}M gas per check`);
  } else if (any?.verifyCallGas) {
    parts.push(`${fmt(any.verifyCallGas)} gas per call`);
  }
  return parts.join(', ');
}

function Cell({ c }: { c: Contract }) {
  return (
    <>
      <a href={c.href} className={styles.addr} target="_blank" rel="noreferrer">
        {shortHex(c.address)}
      </a>
      {c.txs.length > 0 && (
        <span className={styles.txs}>
          {c.txs.map((t) => (
            <a key={t.hash} href={t.href} target="_blank" rel="noreferrer">
              {t.label}
            </a>
          ))}
        </span>
      )}
    </>
  );
}

/**
 * The register of deployments: one row per contract, one column per network,
 * filled from deployments/*.json. A slot without a record reads "deploying";
 * Stylus slots on Arbitrum One read "activations paused".
 */
export function Register({ records }: { records: NetworkRecord[] }) {
  const byNet = new Map(records.map((r) => [r.network.key, r]));
  const evmKeys = [...new Set(records.flatMap((r) => r.evm.map((c) => c.key)))];
  const e2e = records.flatMap((r) => r.e2e.map((t) => ({ ...t, net: r.network.name })));
  return (
    <div className={styles.register}>
      <table className={styles.table}>
        <caption className={styles.caption}>Register of deployments</caption>
        <thead>
          <tr>
            <th scope="col">Contract</th>
            {NETWORKS.map((n) => (
              <th key={n.key} scope="col">
                {n.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {STYLUS_KEYS.map((key) => (
            <tr key={key}>
              <th scope="row">
                <span className={styles.name}>{STYLUS_LABELS[key]}</span>
                <span className={styles.detail}>{stylusDetail(key, records)}</span>
              </th>
              {NETWORKS.map((n) => {
                const c = byNet.get(n.key)?.stylus[key];
                return (
                  <td key={n.key} data-network={n.name}>
                    {c ? (
                      <Cell c={c} />
                    ) : n.stylus === 'paused' ? (
                      <a href="#note-8" className={styles.pending}>
                        activations paused
                      </a>
                    ) : (
                      <span className={styles.pending}>deploying</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
          {evmKeys.length === 0 ? (
            <tr>
              <th scope="row">
                <span className={styles.name}>Account modules</span>
                <span className={styles.detail}>Solidity: key store, validator, hot-tier executor, tripwire registry</span>
              </th>
              {NETWORKS.map((n) => (
                <td key={n.key} data-network={n.name}>
                  <span className={styles.pending}>deploying</span>
                </td>
              ))}
            </tr>
          ) : (
            evmKeys.map((key) => {
              const label = records.flatMap((r) => r.evm).find((c) => c.key === key)!.label;
              return (
                <tr key={key}>
                  <th scope="row">
                    <span className={styles.name}>{label}</span>
                    <span className={styles.detail}>Solidity</span>
                  </th>
                  {NETWORKS.map((n) => {
                    const c = byNet.get(n.key)?.evm.find((x) => x.key === key);
                    return (
                      <td key={n.key} data-network={n.name}>
                        {c ? <Cell c={c} /> : <span className={styles.pending}>deploying</span>}
                      </td>
                    );
                  })}
                </tr>
              );
            })
          )}
        </tbody>
      </table>

      <div className={styles.e2e}>
        <h3 className={styles.txHead}>End-to-end transactions</h3>
        {e2e.length ? (
          <ul className={styles.txList}>
            {e2e.map((t) => (
              <li key={t.net + t.hash}>
                <span className={styles.txLabel}>{t.label}</span>
                <span className={styles.txNet}>{t.net}</span>
                <a href={t.href} className={styles.addr} target="_blank" rel="noreferrer">
                  {shortHex(t.hash)}
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.empty}>
            None recorded yet. Each one appears here with an explorer link once it is on-chain.
          </p>
        )}
      </div>
    </div>
  );
}
