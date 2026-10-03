import type { Metadata } from 'next';
import { ProductHeader } from '@/components/product/ProductHeader';
import { TripwireView } from '@/components/product/TripwireView';
import ui from '@/components/product/ui.module.css';
import { productNetworks } from '@/lib/deployments';
import { readTargets } from '@/lib/targets';

export const metadata: Metadata = {
  title: 'The tripwire',
  description: 'The canary registry: five target keys nobody holds, their derivation, the live ladder verifier and a drill you can run.',
};

export default function TripwirePage() {
  return (
    <main className={ui.page}>
      <ProductHeader plate="XIX" title="The tripwire, and how to trip it.">
        <p>
          An ownerless registry posts bounties on five public keys whose private keys nobody knows. A claim proves a
          curve has fallen; every Qanary account reads the registry and shuts its classical keys down in response.
        </p>
      </ProductHeader>
      <TripwireView networks={productNetworks()} targets={readTargets()} repoUrl={process.env.NEXT_PUBLIC_REPO_URL ?? null} />
    </main>
  );
}
