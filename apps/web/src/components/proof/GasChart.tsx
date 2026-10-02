import { GAS, LIVE_BASIS, MEASURED, VALIDATION_BUDGET, type GasRow } from '@/content/facts';
import styles from './GasChart.module.css';

const MAX = 1_800_000;
const TICKS = [0, 600_000, 1_200_000, 1_800_000];
const pct = (n: number) => `${(n / MAX) * 100}%`;
const fmt = (n: number) => n.toLocaleString('en-US');
const short = (n: number) => (n >= 1_000_000 ? `${n / 1_000_000}M` : n === 0 ? '0' : `${n / 1_000}k`);

export type LiveGas = Partial<Record<GasRow['scheme'], number>>;

function Bar({ series, value, label, text, tip }: { series: string; value: number; label: string; text: string; tip: string }) {
  return (
    <div className={styles.track}>
      <span className={styles.bar} data-series={series} style={{ width: pct(value) }} tabIndex={0} role="img" aria-label={label}>
        <span className={styles.tip} role="tooltip">
          {tip}
        </span>
      </span>
      <span className={styles.value}>{text}</span>
    </div>
  );
}

/**
 * Verification gas on one linear scale, so the gap is shown at its true size.
 * The comparison with Solidity uses cached execution gas on a Nitro node; the
 * outlined bar is what the same verifier costs per call, live on ApeChain.
 * Series differ by texture as well as colour.
 */
export function GasChart({ live }: { live: LiveGas }) {
  const hasLive = GAS.some((r) => live[r.scheme] !== undefined);
  return (
    <figure className={styles.chart}>
      <div className={styles.legend}>
        <span className={styles.key} data-series="stylus">
          Stylus, cached execution gas
        </span>
        {hasLive && (
          <span className={styles.key} data-series="live">
            Stylus, live per call on ApeChain
          </span>
        )}
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
          const onChain = live[row.scheme];
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
                <Bar
                  series="stylus"
                  value={row.stylus}
                  text={short(row.stylus)}
                  label={`${row.scheme} on Stylus, cached execution gas: ${fmt(row.stylus)}`}
                  tip={`${row.scheme}, Stylus, cached execution: ${fmt(row.stylus)} gas`}
                />
                {onChain !== undefined && (
                  <Bar
                    series="live"
                    value={onChain}
                    text={fmt(onChain)}
                    label={`${row.scheme} on Stylus, live per call on ApeChain: ${fmt(onChain)} gas`}
                    tip={`${row.scheme}, live on ApeChain, per call with calldata: ${fmt(onChain)} gas`}
                  />
                )}
                <div className={styles.track}>
                  <span
                    className={styles.bar}
                    data-series="solidity"
                    style={{ width: pct(best.gas) }}
                    tabIndex={0}
                    role="img"
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
                <span className={styles.less}>less execution gas</span>
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
        Solid bars and ratios: {MEASURED}; Solidity figures as published by their authors.
        <sup>
          <a href="#note-9">9</a>
        </sup>{' '}
        Against main-branch Solidity, ML-DSA-65 on Stylus uses 40 to 108 times less gas.
        {hasLive && <> Outlined bars: {LIVE_BASIS}.</>}
      </figcaption>

      <details className={styles.table}>
        <summary>Show the figures as a table</summary>
        <div className={styles.scroll}>
          <table>
            <thead>
              <tr>
                <th scope="col">Scheme</th>
                <th scope="col">Stylus, cached execution</th>
                <th scope="col">Stylus, live per call on ApeChain</th>
                <th scope="col">Solidity</th>
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
                    <td>{i === 0 ? (live[r.scheme] !== undefined ? fmt(live[r.scheme]!) : 'deploying') : ''}</td>
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
