import { GAS, MEASURED, VALIDATION_BUDGET } from '@/content/facts';
import styles from './GasChart.module.css';

const MAX = 1_800_000;
const TICKS = [0, 600_000, 1_200_000, 1_800_000];
const pct = (n: number) => `${(n / MAX) * 100}%`;
const fmt = (n: number) => n.toLocaleString('en-US');
const short = (n: number) => (n >= 1_000_000 ? `${n / 1_000_000}M` : n === 0 ? '0' : `${n / 1_000}k`);

/**
 * Verification gas on one linear scale, so the gap is shown at its true size.
 * Stylus is the solid canary bar; Solidity is rust and hatched, so the two read
 * apart without colour.
 */
export function GasChart() {
  return (
    <figure className={styles.chart}>
      <div className={styles.legend}>
        <span className={styles.key} data-series="stylus">
          Stylus verifier (Qanary)
        </span>
        <span className={styles.key} data-series="solidity">
          Best published Solidity verifier
        </span>
        <span className={styles.key} data-series="budget">
          ERC-4337 validation budget, {fmt(VALIDATION_BUDGET)} gas
        </span>
      </div>

      <div className={styles.plot} role="group" aria-label="Verification gas by signature scheme">
        {GAS.map((row) => {
          const best = row.solidity[0]!;
          return (
            <div key={row.scheme} className={styles.row}>
              <div className={styles.label}>
                <span className={styles.scheme}>{row.scheme}</span>
                <span className={styles.sizes}>
                  {fmt(row.sig)} B signature, {fmt(row.pk)} B key
                </span>
              </div>
              <div className={styles.bars}>
                <span className={styles.budget} style={{ left: pct(VALIDATION_BUDGET) }} aria-hidden="true" />
                <div className={styles.track}>
                  <span
                    className={styles.bar}
                    data-series="stylus"
                    style={{ width: pct(row.stylus) }}
                    tabIndex={0}
                    aria-label={`${row.scheme} on Stylus: ${fmt(row.stylus)} gas`}
                  >
                    <span className={styles.tip} role="tooltip">
                      {row.scheme}, Stylus: {fmt(row.stylus)} gas
                    </span>
                  </span>
                  <span className={styles.value}>{short(row.stylus)}</span>
                </div>
                <div className={styles.track}>
                  <span
                    className={styles.bar}
                    data-series="solidity"
                    style={{ width: pct(best.gas) }}
                    tabIndex={0}
                    aria-label={`${row.scheme} in Solidity: ${fmt(best.gas)} gas, ${best.source}`}
                  >
                    <span className={styles.tip} role="tooltip">
                      {row.scheme}, Solidity: {fmt(best.gas)} gas ({best.source})
                    </span>
                  </span>
                  <span className={styles.value} data-clear={row.solidity.length > 1 ? 'true' : undefined}>
                    {short(best.gas)}
                  </span>
                  {row.solidity.slice(1).map((alt) => (
                    <span
                      key={alt.source}
                      className={styles.alt}
                      style={{ left: pct(alt.gas) }}
                      title={`${fmt(alt.gas)} gas, ${alt.source}`}
                      aria-hidden="true"
                    />
                  ))}
                </div>
                <span className={styles.altNote}>
                  Solidity: {best.source}
                  {row.solidity.length > 1 &&
                    `; the tick marks ${row.solidity
                      .slice(1)
                      .map((a) => `${fmt(a.gas)} (${a.source})`)
                      .join('; ')}`}
                </span>
              </div>
              <div className={styles.ratio}>
                <span className={styles.times}>~{row.ratio}×</span>
                <span className={styles.less}>less gas</span>
              </div>
            </div>
          );
        })}
        <div className={styles.axisRow} aria-hidden="true">
          <div className={styles.axis}>
            {TICKS.map((t) => (
              <span key={t} className={styles.tick} style={{ left: pct(t) }}>
                {short(t)}
              </span>
            ))}
          </div>
        </div>
      </div>

      <figcaption className={styles.caption}>
        {MEASURED} Solidity figures as published by their authors.<sup><a href="#note-7">7</a></sup> Against main-branch
        Solidity, ML-DSA-65 on Stylus uses 40 to 108 times less gas.
      </figcaption>

      <details className={styles.table}>
        <summary>Show the figures as a table</summary>
        <div className={styles.scroll}>
        <table>
          <thead>
            <tr>
              <th scope="col">Scheme</th>
              <th scope="col">Stylus gas</th>
              <th scope="col">Solidity gas</th>
              <th scope="col">Source</th>
              <th scope="col">Signature, bytes</th>
              <th scope="col">Public key, bytes</th>
            </tr>
          </thead>
          <tbody>
            {GAS.flatMap((r) =>
              r.solidity.map((s, i) => (
                <tr key={r.scheme + s.source}>
                  <th scope="row">{i === 0 ? r.scheme : ''}</th>
                  <td>{i === 0 ? fmt(r.stylus) : ''}</td>
                  <td>{fmt(s.gas)}</td>
                  <td>{s.source}</td>
                  <td>{i === 0 ? fmt(r.sig) : ''}</td>
                  <td>{i === 0 ? fmt(r.pk) : ''}</td>
                </tr>
              )),
            )}
          </tbody>
        </table>
        </div>
      </details>
    </figure>
  );
}
