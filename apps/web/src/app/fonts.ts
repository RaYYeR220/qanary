import localFont from 'next/font/local';

// Only the two roman cuts the first screen needs are preloaded: Redaction for
// the claim and Literata for the text. Italics are separate families that load
// on use (see --face-*-italic in tokens.css).

// Redaction (MCKL, SIL OFL 1.1): display face. Its graded cuts carry the
// headline's wear; they are subset to the headline's glyphs and load lazily.
export const redaction = localFont({
  src: '../fonts/redaction/redaction-regular.woff2',
  weight: '400',
  style: 'normal',
  variable: '--font-redaction',
  display: 'swap',
  fallback: ['Iowan Old Style', 'Georgia', 'serif'],
  adjustFontFallback: 'Times New Roman',
});

export const redactionItalic = localFont({
  src: '../fonts/redaction/redaction-italic.woff2',
  weight: '400',
  style: 'italic',
  variable: '--font-redaction-italic',
  display: 'swap',
  preload: false,
  fallback: ['Iowan Old Style', 'Georgia', 'serif'],
  adjustFontFallback: 'Times New Roman',
});

// Literata (The Literata Project Authors, SIL OFL 1.1): text face, with
// optical sizes 7-72 and weights 400-600. The preloaded roman is 'optional', so
// running text never re-flows late on a slow first visit.
export const literata = localFont({
  src: '../fonts/literata/literata-roman.woff2',
  weight: '400 600',
  style: 'normal',
  variable: '--font-literata',
  display: 'optional',
  fallback: ['Iowan Old Style', 'Georgia', 'serif'],
  adjustFontFallback: 'Times New Roman',
});

export const literataItalic = localFont({
  src: '../fonts/literata/literata-italic.woff2',
  weight: '400 600',
  style: 'italic',
  variable: '--font-literata-italic',
  // not preloaded, so it would miss the 'optional' window on a first view
  display: 'swap',
  preload: false,
  fallback: ['Iowan Old Style', 'Georgia', 'serif'],
  adjustFontFallback: 'Times New Roman',
});

export const redaction10 = localFont({ src: '../fonts/redaction/redaction-10-headline.woff2', variable: '--font-r10', preload: false, display: 'block', fallback: ['Georgia'] });
export const redaction20 = localFont({ src: '../fonts/redaction/redaction-20-headline.woff2', variable: '--font-r20', preload: false, display: 'block', fallback: ['Georgia'] });
export const redaction35 = localFont({ src: '../fonts/redaction/redaction-35-headline.woff2', variable: '--font-r35', preload: false, display: 'block', fallback: ['Georgia'] });
export const redaction70 = localFont({ src: '../fonts/redaction/redaction-70-headline.woff2', variable: '--font-r70', preload: false, display: 'block', fallback: ['Georgia'] });
export const redaction100 = localFont({ src: '../fonts/redaction/redaction-100-headline.woff2', variable: '--font-r100', preload: false, display: 'block', fallback: ['Georgia'] });

export const fontVariables = [
  redaction,
  redactionItalic,
  literata,
  literataItalic,
  redaction10,
  redaction20,
  redaction35,
  redaction70,
  redaction100,
]
  .map((f) => f.variable)
  .join(' ');
