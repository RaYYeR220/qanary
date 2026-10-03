import type { ReactNode } from 'react';
import { Providers } from '@/components/product/Providers';

/** Product pages share the wallet and query providers; the landing page loads none of it. */
export default function ProductLayout({ children }: { children: ReactNode }) {
  return <Providers>{children}</Providers>;
}
