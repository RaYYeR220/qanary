import styles from './DegradingHeadline.module.css';

/** Redaction's grades, one per plate state: the type wears with the plate. */
const GRADES = [null, '--font-r10', '--font-r20', '--font-r35', '--font-r70', '--font-r100'] as const;
export function DegradingHeadline({ level, id }: { level: number; id?: string }) {
  // three lines on wide screens, two on a phone; every grade breaks the same way
  const lines = (
    <>
      <span className={styles.line}>Your treasury,</span>
      <span className={styles.line}>
        safe past <br className={styles.turn} />
        Q-Day.
      </span>
    </>
  );
  return (
    <h1 id={id} className={styles.headline}>
      {GRADES.map((g, i) => (
        <span
          key={i}
          className={styles.layer}
          data-on={level === i ? 'true' : 'false'}
          aria-hidden={i === 0 ? undefined : 'true'}
          style={g ? { fontFamily: `var(${g}), var(--face-display)` } : undefined}
        >
          {lines}
        </span>
      ))}
    </h1>
  );
}
