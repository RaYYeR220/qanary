import book from './book.module.css';

/** A footnote reference to the sources at the foot of the page. */
export function Note({ n }: { n: number }) {
  return (
    <sup className={book.note}>
      <a href={`#note-${n}`} aria-label={`Source ${n}`}>
        {n}
      </a>
    </sup>
  );
}
