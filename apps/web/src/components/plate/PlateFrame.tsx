import type { ReactNode } from 'react';
import styles from './PlateFrame.module.css';

/**
 * The plate-mark: the bevelled edge a copper or steel plate presses into the
 * sheet, drawn as a double frame with a light and a shaded bevel.
 */
export function PlateFrame({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={[styles.mark, className].filter(Boolean).join(' ')}>
      <div className={styles.bevel}>{children}</div>
    </div>
  );
}
