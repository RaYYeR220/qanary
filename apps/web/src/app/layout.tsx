import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Masthead } from '@/components/chrome/Masthead';
import { fontVariables } from './fonts';
import './globals.css';
import styles from './layout.module.css';

export const metadata: Metadata = {
  title: { default: 'Qanary: quantum-safe treasury accounts for Arbitrum', template: '%s · Qanary' },
  description:
    'Quantum-safe treasury accounts for Arbitrum: NIST post-quantum signatures verified on-chain by Stylus, a capped classical hot key for daily operations, and a trustless Q-Day tripwire that shuts classical keys down automatically.',
};

export const viewport: Viewport = {
  themeColor: '#211207',
  colorScheme: 'dark',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={fontVariables}>
      <body>
        <a href="#main" className="skip">
          Skip to content
        </a>
        <Masthead />
        <div id="main" className={styles.page}>
          {children}
        </div>
      </body>
    </html>
  );
}
