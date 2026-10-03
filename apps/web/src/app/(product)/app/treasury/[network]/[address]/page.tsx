import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getAddress, isAddress } from 'viem';
import { Dashboard } from '@/components/product/Dashboard';
import { ProductHeader } from '@/components/product/ProductHeader';
import ui from '@/components/product/ui.module.css';
import { productNetworks } from '@/lib/deployments';

export const metadata: Metadata = {
  title: 'Treasury',
  description: 'The two keys of a Qanary treasury, its hot-key cap, the tripwire level and its operations.',
};

export default async function TreasuryPage({ params }: { params: Promise<{ network: string; address: string }> }) {
  const { network: key, address } = await params;
  const network = productNetworks().find((n) => n.key === key);
  if (!network || !isAddress(address)) notFound();
  const account = getAddress(address);
  return (
    <main className={ui.page}>
      <ProductHeader plate="XVIII" title="The treasury.">
        <p>
          <span className={ui.hex}>{account}</span> on {network.name}. The post-quantum key holds everything; the hot
          key spends inside its cap until the tripwire says otherwise.
        </p>
      </ProductHeader>
      <Dashboard network={network} account={account} />
    </main>
  );
}
