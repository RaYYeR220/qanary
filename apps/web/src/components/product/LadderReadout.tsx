import styles from './LadderReadout.module.css';

const RUNGS = ['160', '192', '224', 'secp256k1', 'P-256'];

/**
 * The tripwire ladder as a reading, not a control: the same stiles and rungs as
 * the hero, with the targets a registry has seen claimed snapped in two.
 */
export function LadderReadout({ claimed, label }: { claimed: readonly boolean[]; label: string }) {
  return (
    <figure className={styles.ladder} aria-label={label}>
      <div className={styles.track} aria-hidden="true">
        <span className={styles.rails} />
        {RUNGS.map((r, i) => (
          <span key={r} className={styles.rung} data-broken={claimed[i] ? 'true' : 'false'} data-family={i >= 3 ? 'true' : 'false'} style={{ ['--i' as string]: i + 1 }} />
        ))}
      </div>
      <div className={styles.ticks} aria-hidden="true">
        {RUNGS.map((r, i) => (
          <span key={r} className={styles.tick} data-broken={claimed[i] ? 'true' : 'false'} style={{ ['--i' as string]: i + 1 }}>
            {r}
          </span>
        ))}
      </div>
      <figcaption className="visually-hidden">{label}</figcaption>
    </figure>
  );
}
