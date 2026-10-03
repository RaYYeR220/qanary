import type { Metadata } from 'next';
import { ProductHeader } from '@/components/product/ProductHeader';
import { VerifyPlayground } from '@/components/product/VerifyPlayground';
import ui from '@/components/product/ui.module.css';
import { productNetworks } from '@/lib/deployments';

export const metadata: Metadata = {
  title: 'Verify a signature',
  description: 'Sign with a fresh ML-DSA or Falcon key in your browser and check it against the live verifiers. No wallet needed.',
};

export default function VerifyPage() {
  return (
    <main className={ui.page}>
      <ProductHeader plate="XXI" title="Check a post-quantum signature on-chain.">
        <p>
          Make a key here, sign a message with it, and ask the deployed verifiers whether the signature holds. It
          needs no wallet and no account: the check is a read-only call, the same one a Qanary account makes before
          it lets the post-quantum key act.
        </p>
      </ProductHeader>
      <VerifyPlayground networks={productNetworks()} />
    </main>
  );
}
