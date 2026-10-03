import type { Metadata } from 'next';
import { ProductHeader } from '@/components/product/ProductHeader';
import { Scanner } from '@/components/product/Scanner';
import ui from '@/components/product/ui.module.css';
import { productNetworks } from '@/lib/deployments';

export const metadata: Metadata = {
  title: 'Exposure scanner',
  description: 'Check whether an address has revealed its public key on Arbitrum One or ApeChain, and what it holds.',
};

export default function ScanPage() {
  return (
    <main className={ui.page}>
      <ProductHeader plate="XX" title="Has this address shown its key?">
        <p>
          Paste an address. The scanner reads its code, how many transactions it has sent and what it holds, and finds
          the transaction that revealed its public key. Everything is read from public nodes; nothing is sent.
        </p>
      </ProductHeader>
      <Scanner networks={productNetworks()} />
    </main>
  );
}
