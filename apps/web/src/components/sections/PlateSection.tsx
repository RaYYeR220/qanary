import type { ReactNode } from 'react';
import styles from './PlateSection.module.css';

interface Props {
  id: string;
  /** Plate number, in Roman numerals: the sections run on from the hero's Plate XII. */
  plate: string;
  title: ReactNode;
  children: ReactNode;
}

/**
 * One plate of the book: the plate number stands in the margin beside the
 * title, the text keeps to a reading measure, and figures may take the full
 * width of the page.
 */
export function PlateSection({ id, plate, title, children }: Props) {
  return (
    <section id={id} className={styles.section} aria-labelledby={`${id}-title`}>
      <header className={styles.head}>
        <p className={styles.plate}>Plate {plate}</p>
        <h2 id={`${id}-title`} className={styles.title}>
          {title}
        </h2>
      </header>
      <div className={styles.body}>{children}</div>
    </section>
  );
}
