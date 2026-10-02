import Link from 'next/link';
import type { ReactNode } from 'react';
import styles from './Cta.module.css';

/** The primary action, framed with a small plate-mark. */
export function Cta({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className={styles.cta}>
      {children}
    </Link>
  );
}
