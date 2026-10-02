import { Hero } from '@/components/hero/Hero';
import { Colophon } from '@/components/sections/Colophon';
import { Exposure } from '@/components/sections/Exposure';
import { Mechanism } from '@/components/sections/Mechanism';
import { Proof } from '@/components/sections/Proof';
import { WorksWith } from '@/components/sections/WorksWith';
import { readDeployments } from '@/lib/deployments';

export default function Landing() {
  const records = readDeployments();
  return (
    <>
      <main>
        <Hero />
        <Exposure />
        <Mechanism />
        <Proof records={records} />
        <WorksWith />
      </main>
      <Colophon />
    </>
  );
}
