import Link from 'next/link';
import { Monogram } from './Monogram';
import { NavLinks } from './NavLinks';
import styles from './Masthead.module.css';

/** The wordmark rail on wide screens; a top bar with a menu on narrow ones. */
export function Masthead() {
  return (
    <header className={styles.masthead}>
      <Link href="/" className={styles.mark} aria-label="Qanary, home">
        <Monogram size={40} className={styles.monogram} />
        <span className={styles.word}>Qanary</span>
      </Link>
      <nav aria-label="Primary" className={styles.nav}>
        <NavLinks className={styles.list} />
      </nav>
      <details className={styles.menu}>
        <summary className={styles.summary}>Menu</summary>
        <nav aria-label="Primary" className={styles.sheet}>
          <NavLinks className={styles.sheetList} />
        </nav>
      </details>
    </header>
  );
}
