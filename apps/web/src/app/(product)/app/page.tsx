import type { Metadata } from 'next';
import { OpenTreasury } from '@/components/product/OpenTreasury';
import { ProductHeader } from '@/components/product/ProductHeader';
import ui from '@/components/product/ui.module.css';
import { productNetworks } from '@/lib/deployments';

export const metadata: Metadata = {
  title: 'Open a treasury',
  description: 'Make a post-quantum key in your browser and open a Qanary treasury account with it.',
};

export default function OpenTreasuryPage() {
  return (
    <main className={ui.page}>
      <ProductHeader plate="XVII" title="Open a treasury.">
        <p>
          The root key is made here, from a recovery phrase only you hold. Your wallet pays for storing the key and sends
          the account&rsquo;s first operation; the post-quantum key signs it. No server sees the phrase.
        </p>
      </ProductHeader>
      <OpenTreasury networks={productNetworks()} />
    </main>
  );
}
