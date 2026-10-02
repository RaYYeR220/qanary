import type { NetworkRecord } from '@/lib/deployments';
import { GasChart } from '../proof/GasChart';
import { Register } from '../proof/Register';
import book from './book.module.css';
import { PlateSection } from './PlateSection';

export function Proof({ records }: { records: NetworkRecord[] }) {
  return (
    <PlateSection id="proof" plate="XV" title="The verifiers, measured on Arbitrum.">
      <div className={`${book.main} ${book.text}`}>
        <p className={book.lead}>
          Post-quantum signatures are large, and checking them is heavy work. Written in Solidity, every published
          verifier runs past what an ERC-4337 account may spend on validation. Compiled to WASM and run by Stylus, all
          three fit inside it.
        </p>
      </div>
      <div className={book.wide}>
        <GasChart />
      </div>
      <p className={book.margin}>
        <em>Verified on-chain.</em> Addresses and transactions are read from the project&rsquo;s deployment records.
        Nothing is listed here until it is on-chain.
      </p>
      <div className={book.main}>
        <Register records={records} />
      </div>
    </PlateSection>
  );
}
