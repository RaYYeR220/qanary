import type { Metadata } from 'next';
import Link from 'next/link';
import { EngravedPlate } from '@/components/plate/EngravedPlate';
import { PlateFrame } from '@/components/plate/PlateFrame';
import styles from './page.module.css';

export const metadata: Metadata = {
  title: 'Open a treasury',
  description: 'The Qanary treasury app is opening soon.',
};

export default function AppSoon() {
  return (
    <main className={styles.page}>
      <figure className={styles.figure}>
        <PlateFrame>
          <div className={styles.fig}>
            <EngravedPlate lazy name="fig-key" label="An iron key whose bit is cut on a lattice." />
          </div>
        </PlateFrame>
        <figcaption className={styles.caption}>The cold key, waiting to be cut.</figcaption>
      </figure>
      <div className={styles.copy}>
        <h1 className={styles.title}>The treasury app opens soon.</h1>
        <p className={styles.text}>
          A Qanary treasury answers to a post-quantum root key, derived in your browser from a recovery phrase or kept
          in an AWS KMS HSM.
        </p>
        <p className={styles.links}>
          <Link href="/#how">Read how the two keys and the tripwire work</Link>
        </p>
      </div>
    </main>
  );
}
