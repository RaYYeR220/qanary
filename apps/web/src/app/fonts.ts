import localFont from 'next/font/local';

// Redaction (MCKL, SIL OFL 1.1): display face. Its graded cuts carry the
// headline's wear; they are subset to the headline's glyphs and load lazily.
export const redaction = localFont({
  variable: '--font-redaction',
  display: 'swap',
  src: [
    { path: '../fonts/redaction/redaction-regular.woff2', weight: '400', style: 'normal' },
    { path: '../fonts/redaction/redaction-italic.woff2', weight: '400', style: 'italic' },
  ],
  fallback: ['Iowan Old Style', 'Georgia', 'serif'],
  adjustFontFallback: 'Times New Roman',
});

// Literata (The Literata Project Authors, SIL OFL 1.1): text face, with
// optical sizes 7-72 and weights 400-600.
export const literata = localFont({
  variable: '--font-literata',
  display: 'swap',
  src: [
    { path: '../fonts/literata/literata-roman.woff2', weight: '400 600', style: 'normal' },
    { path: '../fonts/literata/literata-italic.woff2', weight: '400 600', style: 'italic' },
  ],
  fallback: ['Iowan Old Style', 'Georgia', 'serif'],
  adjustFontFallback: 'Times New Roman',
});

export const redaction10 = localFont({ src: '../fonts/redaction/redaction-10-headline.woff2', variable: '--font-r10', preload: false, display: 'block', fallback: ['Georgia'] });
export const redaction20 = localFont({ src: '../fonts/redaction/redaction-20-headline.woff2', variable: '--font-r20', preload: false, display: 'block', fallback: ['Georgia'] });
export const redaction35 = localFont({ src: '../fonts/redaction/redaction-35-headline.woff2', variable: '--font-r35', preload: false, display: 'block', fallback: ['Georgia'] });
export const redaction70 = localFont({ src: '../fonts/redaction/redaction-70-headline.woff2', variable: '--font-r70', preload: false, display: 'block', fallback: ['Georgia'] });
export const redaction100 = localFont({ src: '../fonts/redaction/redaction-100-headline.woff2', variable: '--font-r100', preload: false, display: 'block', fallback: ['Georgia'] });

export const fontVariables = [redaction, literata, redaction10, redaction20, redaction35, redaction70, redaction100]
  .map((f) => f.variable)
  .join(' ');
