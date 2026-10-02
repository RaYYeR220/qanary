import Link from 'next/link';
import { Monogram } from './Monogram';
import styles from './Masthead.module.css';

const NAV = [
  { href: '/#how', label: 'How it works' },
  { href: '/#proof', label: 'Proof' },
];

/** The wordmark rail on wide screens; a top bar on narrow ones. */
export function Masthead() {
  return (
    <header className={styles.masthead}>
      <Link href="/" className={styles.mark} aria-label="Qanary, home">
        <Monogram size={40} className={styles.monogram} />
        <span className={styles.word}>Qanary</span>
      </Link>
      <nav aria-label="Primary" className={styles.nav}>
        <ul>
          {NAV.map((n) => (
            <li key={n.href}>
              <Link href={n.href}>{n.label}</Link>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}
