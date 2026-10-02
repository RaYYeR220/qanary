import { PARTNERS } from '@/content/facts';
import book from './book.module.css';
import { PlateSection } from './PlateSection';
import styles from './WorksWith.module.css';

export function WorksWith() {
  return (
    <PlateSection id="works-with" plate="XVI" title="Works with what you already run.">
      <div className={`${book.main} ${book.text}`}>
        <p className={book.lead}>
          The verifiers are ERC-7913 contracts that any account can call. Qanary plugs into the smart-account stacks
          treasuries already use, and keeps keys where institutions already keep them.
        </p>
      </div>
      <ul className={`${book.main} ${styles.marks}`}>
        {PARTNERS.map((p) => (
          <li key={p.mark} className={styles.entry}>
            <span className={styles.mark}>{p.mark}</span>
            <span className={styles.detail}>{p.detail}</span>
            <span className={styles.role}>{p.role}</span>
          </li>
        ))}
      </ul>
    </PlateSection>
  );
}
