import { rungEnds } from '@/engraving/figures';
import { EngravedPlate } from '../plate/EngravedPlate';
import { PlateFrame } from '../plate/PlateFrame';
import book from './book.module.css';
import { PlateSection } from './PlateSection';
import styles from './Mechanism.module.css';

const RUNG_LABELS = ['160, claimed', '192', '224', 'secp256k1', 'P-256'];

export function Mechanism() {
  return (
    <PlateSection id="how" plate="XIV" title="Two keys and a tripwire.">
      <div className={`${book.main} ${book.text}`}>
        <p className={book.lead}>
          A Qanary treasury splits authority by risk. The keys a quantum computer could break get a small, leaking
          allowance and a fuse. The key that holds everything else is post-quantum from the start.
        </p>
      </div>

      <figure className={`${book.wide} ${styles.plate}`}>
        <PlateFrame>
          <div className={styles.figs}>
            <div className={styles.fig}>
              <EngravedPlate lazy name="fig-key" label="Figure 1: an iron key whose bit is cut on a lattice." />
              <span className={styles.figNo}>Fig. 1</span>
            </div>
            <div className={styles.fig}>
              <EngravedPlate lazy name="fig-bucket" label="Figure 2: a wooden bucket leaking drops from a hole near its foot." />
              <span className={styles.figNo}>Fig. 2</span>
            </div>
            <div className={styles.fig}>
              <EngravedPlate lazy name="fig-ladder" label="Figure 3: a ladder of five rungs; the lowest rung is snapped in two." />
              <span className={styles.labels} aria-hidden="true">
                {RUNG_LABELS.map((l, i) => {
                  const [, right] = rungEnds(i);
                  return (
                    <span
                      key={l}
                      className={styles.rungLabel}
                      data-broken={i === 0 ? 'true' : 'false'}
                      style={{ left: `${((right[0] + 18) / 400) * 100}%`, top: `${(right[1] / 480) * 100}%` }}
                    >
                      {l}
                    </span>
                  );
                })}
              </span>
              <span className={styles.figNo}>Fig. 3</span>
            </div>
          </div>
        </PlateFrame>
        <figcaption className={styles.caption}>
          Plate XIV. The cold key, the hot key&rsquo;s leaking cap, and the tripwire.
        </figcaption>
      </figure>

      <aside className={`${book.margin} ${styles.side}`} aria-label="Why Stylus">
        <p>
          <em>Why Stylus.</em> Arbitrum has no post-quantum precompile planned, and EIP-8051 and EIP-8052 are drafts.
          Stylus runs the verifiers as WASM now, each under 18 KB compressed and inside the 500,000-gas ERC-4337
          validation budget.
        </p>
      </aside>

      <div className={`${book.main} ${book.text}`}>
        <h3 className={styles.explHead}>Explanation of the plate</h3>
        <p>
          <span className={styles.runin}>Fig. 1. The cold key.</span> The account&rsquo;s root key is post-quantum:
          ML-DSA-44 or ML-DSA-65 (FIPS 204), or Falcon-512. It can be derived in your browser from a recovery phrase,
          or live in an AWS KMS HSM. Only the cold key moves funds above the cap, changes modules, rotates keys or
          signs ERC-1271 messages.
        </p>
        <p>
          <span className={styles.runin}>Fig. 2. The hot key, under a leaking cap.</span> A classical key, an ECDSA
          wallet or a passkey, spends through an executor with an allowlist: transfers of tracked assets, no
          approvals, no module changes. Its cap is a leaky bucket per asset that refills continuously, so nothing can
          be spent twice at a window boundary. The hot key never validates user operations and cannot sign ERC-1271
          messages.
        </p>
        <p id="tripwire">
          <span className={styles.runin}>Fig. 3. The tripwire.</span> An ownerless, one-way registry offers bounties
          on five curves whose private keys nobody knows: each public key is a public tag hashed to a curve point.
          secp160r1, P-192 and P-224 form the ladder, because a quantum computer breaks short curves before 256-bit
          ones. secp256k1 and P-256 stand for the key families in use.
        </p>
        <p>
          When a rung is claimed, every account responds on its own. By default the hot cap halves at the first rung,
          drops to a tenth at the second, and the hot tier freezes at the third. A broken secp256k1 or P-256 disables
          that key family for good. Each account can choose a different response.
        </p>
        <p>
          A claim is an ECDSA signature by the target key over the chain, the registry, the target and the claimant.
          It is bound to the claimant, so it cannot be front-run, and the bounty is paid to the claimant.
        </p>
        <p className={styles.limit}>
          <em>What the tripwire cannot do.</em> A thief with a quantum computer may steal quietly instead of claiming.
          Cold funds rely on the post-quantum key, not on the tripwire.
        </p>
        <p>
          <span className={styles.runin}>Leaving an exposed wallet</span> takes one batch: create the post-quantum
          account, revoke approvals, move the assets. EIP-7702 can carry the batch, but under 7702 the old key stays
          live, so the funds have to move.
        </p>
      </div>
    </PlateSection>
  );
}
