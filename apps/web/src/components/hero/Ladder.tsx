'use client';

import { RUNGS } from '@/content/facts';
import styles from './Ladder.module.css';

interface Props {
  level: number;
  onChange: (level: number) => void;
}

/**
 * The tripwire ladder as a control: five rungs (three short curves, then the
 * two families in use). Moving the marker breaks rungs up to that point and
 * the status line gives the treasury's default response.
 */
export function Ladder({ level, onChange }: Props) {
  const rung = RUNGS[level] ?? RUNGS[0]!;
  return (
    <div className={styles.ladder}>
      <label htmlFor="rungs" className={styles.legend}>
        Break rungs on the tripwire ladder
      </label>
      <div className={styles.track}>
        <span className={styles.rails} aria-hidden="true" />
        {RUNGS.slice(1).map((r) => (
          <span
            key={r.at}
            className={styles.rung}
            data-broken={level >= r.at ? 'true' : 'false'}
            data-family={r.at >= 4 ? 'true' : 'false'}
            style={{ ['--i' as string]: r.at }}
            aria-hidden="true"
          />
        ))}
        <input
          id="rungs"
          className={styles.input}
          type="range"
          min={0}
          max={5}
          step={1}
          value={level}
          onChange={(e) => onChange(Number(e.currentTarget.value))}
          aria-valuetext={`${rung.event} ${rung.response}`}
          aria-describedby="rungs-note"
        />
      </div>
      <div className={styles.ticks} aria-hidden="true">
        {RUNGS.map((r) => (
          <button
            key={r.at}
            type="button"
            tabIndex={-1}
            className={styles.tick}
            data-on={level === r.at ? 'true' : 'false'}
            data-broken={r.at > 0 && level >= r.at ? 'true' : 'false'}
            style={{ ['--i' as string]: r.at }}
            onClick={() => onChange(r.at)}
          >
            <span className={styles.long}>{r.tick}</span>
            <span className={styles.short}>{r.short}</span>
          </button>
        ))}
      </div>
      {/* not a live region: the slider already announces these words through aria-valuetext */}
      <p className={styles.status}>
        <em>{rung.event}</em> {rung.response}
      </p>
      <p id="rungs-note" className={styles.note}>
        Default responses. Each account chooses its own.
      </p>
    </div>
  );
}
