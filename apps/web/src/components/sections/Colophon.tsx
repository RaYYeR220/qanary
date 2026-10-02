import { SOURCES } from '@/content/facts';
import { Cta } from '../chrome/Cta';
import { Monogram } from '../chrome/Monogram';
import styles from './Colophon.module.css';

export function Colophon() {
  return (
    <footer className={styles.footer}>
      <section className={styles.close} aria-labelledby="close-title">
        <Monogram size={56} className={styles.mono} />
        <h2 id="close-title" className={styles.title}>
          Set the tripwire before the first rung breaks.
        </h2>
        <p className={styles.text}>
          Start with a post-quantum key in your browser, or keep it in AWS KMS. The hot key and its cap come after.
        </p>
        <Cta href="/app">Open a treasury</Cta>
      </section>

      <section className={styles.notes} aria-labelledby="notes-title">
        <h2 id="notes-title" className={styles.notesTitle}>
          Notes
        </h2>
        <ol className={styles.list}>
          {SOURCES.map((s) => (
            <li key={s.n} id={`note-${s.n}`}>
              {s.text}
            </li>
          ))}
        </ol>
      </section>

      <p className={styles.colophon}>
        Plates engraved in code. Set in Redaction, by MCKL, and Literata, both under the SIL Open Font License. Falcon
        is round-3 Falcon-512; ML-DSA follows FIPS 204.
      </p>
    </footer>
  );
}
