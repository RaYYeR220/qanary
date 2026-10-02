import { ARBITRUM_ONE_PAUSE } from '@/content/facts';
import type { NetworkRecord } from '@/lib/deployments';
import { GasChart, type LiveGas } from '../proof/GasChart';
import { Register } from '../proof/Register';
import book from './book.module.css';
import { Note } from './Note';
import { PlateSection } from './PlateSection';
import styles from './Proof.module.css';

export function Proof({ records }: { records: NetworkRecord[] }) {
  const ape = records.find((r) => r.network.key === 'apechain');
  const live: LiveGas = {};
  const put = (k: keyof LiveGas, v: number | undefined) => {
    if (v !== undefined) live[k] = v;
  };
  put('Falcon-512', ape?.stylus.falcon512Verifier?.verifyCallGas);
  put('ML-DSA-44', ape?.stylus.mldsa44Verifier?.verifyCallGas);
  put('ML-DSA-65', ape?.stylus.mldsa65Verifier?.verifyCallGas);

  return (
    <PlateSection id="proof" plate="XV" title="The verifiers, live on ApeChain.">
      <div className={`${book.main} ${book.text}`}>
        <p className={book.lead}>
          Post-quantum signatures are large, and checking them is heavy work. Written in Solidity, every published
          verifier runs past what an ERC-4337 account may spend on validation. As Arbitrum Stylus programs, all three
          fit inside it, and all three are live on ApeChain, an Arbitrum Orbit chain that settles to Arbitrum One.
        </p>
      </div>
      <div className={book.wide}>
        <GasChart live={live} />
      </div>
      <aside className={`${book.margin} ${styles.side}`} aria-label="Stylus on Arbitrum One">
        <p>
          <em>On Arbitrum One.</em> On {ARBITRUM_ONE_PAUSE.date} the Arbitrum Security Council paused new Stylus
          activations on Arbitrum One and Nova
          <Note n={8} /> (
          <a href={ARBITRUM_ONE_PAUSE.tx} target="_blank" rel="noreferrer">
            transaction
          </a>
          ,{' '}
          <a href={ARBITRUM_ONE_PAUSE.forum} target="_blank" rel="noreferrer">
            notice
          </a>
          ). Until activations return, the same account modules run there with {ARBITRUM_ONE_PAUSE.fallback}, behind
          the same ERC-7913 interface. An account moves to the Stylus verifier with one key rotation.
        </p>
      </aside>
      <div className={book.main}>
        <Register records={records} />
      </div>
    </PlateSection>
  );
}
