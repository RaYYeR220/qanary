import { NETWORKS, REGISTER, shortHex, type NetworkRecord } from '@/lib/deployments';
import styles from './Register.module.css';

/**
 * The register of deployments: one row per contract, one column per network.
 * Filled from deployments/*.json; a slot without a record reads "deploying".
 */
export function Register({ records }: { records: NetworkRecord[] }) {
  const byNet = new Map(records.map((r) => [r.network.key, r]));
  const txs = records.flatMap((r) => r.transactions.map((t) => ({ ...t, net: r.network.name })));
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
          {REGISTER.map((c, i) => (
            <tr key={c.label}>
              <th scope="row">
                <span className={styles.name}>{c.label}</span>
                <span className={styles.detail}>{c.detail}</span>
              </th>
              {NETWORKS.map((n) => {
                const entry = byNet.get(n.key)?.contracts[i]?.entry ?? null;
                return (
                  <td key={n.key} data-network={n.name}>
                    {entry ? (
                      <a href={entry.href} className={styles.addr} target="_blank" rel="noreferrer">
                        {shortHex(entry.value)}
                      </a>
                    ) : (
                      <span className={styles.pending}>deploying</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      <div className={styles.txs}>
        <h4 className={styles.txHead}>Transactions</h4>
        {txs.length ? (
          <ul className={styles.txList}>
            {txs.map((t) => (
              <li key={t.net + t.key}>
                <span className={styles.txLabel}>{t.label}</span>
                <span className={styles.txNet}>{t.net}</span>
                <a href={t.href} className={styles.addr} target="_blank" rel="noreferrer">
                  {shortHex(t.value)}
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.empty}>
            None recorded yet. Each transaction appears here with an explorer link once it is on-chain.
          </p>
        )}
      </div>
    </div>
  );
}
