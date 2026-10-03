import type { ReactNode } from 'react';
import ui from './ui.module.css';

/** A product page opens like a plate: its number, a title, one paragraph. */
export function ProductHeader({ plate, title, children }: { plate: string; title: ReactNode; children?: ReactNode }) {
  return (
    <header className={ui.head}>
      <p className={ui.plate}>Plate {plate}</p>
      <h1 className={ui.title}>{title}</h1>
      {children && <div className={ui.lede}>{children}</div>}
    </header>
  );
}
