import { CHRONOLOGY, TODAY } from '@/content/facts';
import book from './book.module.css';
import { Note } from './Note';
import { PlateSection } from './PlateSection';
import styles from './Exposure.module.css';

const YEARS = Array.from({ length: 10 }, (_, i) => 2026 + i);

export function Exposure() {
  return (
    <PlateSection id="exposure" plate="XIII" title="The public keys are already on-chain.">
      <div className={`${book.main} ${book.text}`}>
        <p className={book.lead}>
          An account shows its public key the first time it signs. A quantum computer that can break secp256k1 could
          work back from that key to the private key, and spend what the account holds.
        </p>
      </div>

      <div className={`${book.main} ${styles.figures}`}>
        <p className={styles.figure}>
          More than 65% of ether sits in accounts whose public keys are exposed.
          <Note n={1} />
        </p>
        <p className={styles.figure}>
          About 6.9 million bitcoin is held at exposed addresses.
          <Note n={2} />
        </p>
      </div>

      <div className={book.main}>
        <h3 className={book.h3}>The dates are set.</h3>
        <ol className={styles.chronology} aria-label="Regulatory timeline, 2026 to 2035">
          {YEARS.map((y) => {
            const events = CHRONOLOGY.filter((e) => e.year === y);
            return (
              <li key={y} className={styles.year} data-empty={events.length ? 'false' : 'true'}>
                <span className={styles.yr}>{y}</span>
                {events.length > 0 && (
                  <ul className={styles.events}>
                    {events.map((e, i) => (
                      <li key={i} className={styles.event}>
                        <span className={styles.when}>{e.when}</span>
                        <span className={styles.who}>{e.who}.</span> {e.what}
                        {e.note ? <Note n={e.note} /> : null}
                      </li>
                    ))}
                    {y === TODAY.year && (
                      <li className={styles.today}>
                        <span className={styles.when}>{TODAY.label}</span> Today.
                      </li>
                    )}
                  </ul>
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </PlateSection>
  );
}
