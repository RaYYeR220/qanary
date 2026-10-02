'use client';

import { useState } from 'react';
import { RUNGS } from '@/content/facts';
import { Cta } from '../chrome/Cta';
import { plateXII } from '@/engraving/plate-xii';
import { EngravedPlate } from '../plate/EngravedPlate';
import { PlateFrame } from '../plate/PlateFrame';
import { DegradingHeadline } from './DegradingHeadline';
import { Ladder } from './Ladder';
import styles from './Hero.module.css';

const PLATE_LABEL =
  'Engraving of a yellow canary perched on the ring of a Davy safety lamp. A small flame burns inside the wire gauze.';

export function Hero() {
  const [level, setLevel] = useState(0);
  const rung = RUNGS[level] ?? RUNGS[0]!;
  return (
    <section className={styles.hero} aria-labelledby="claim">
      <figure className={styles.figure}>
        <PlateFrame>
          <EngravedPlate art={plateXII} level={level} label={PLATE_LABEL} />
          <span className={styles.state}>{rung.plate}</span>
        </PlateFrame>
        <figcaption className={styles.caption}>
          Plate XII. The canary, <span className={styles.binomial}>Serinus canaria</span>, on Sir Humphry Davy&rsquo;s
          safety lamp.
        </figcaption>
      </figure>

      <div className={styles.copy}>
        <DegradingHeadline level={level} id="claim" />
        <p className={styles.lede}>
          Qanary treasury accounts answer to a post-quantum key: ML-DSA or Falcon signatures, verified on-chain by
          Arbitrum Stylus. A capped classical key handles daily spending, and a tripwire shuts classical keys down as
          weaker curves are broken.
        </p>
        <div className={styles.actions}>
          <Cta href="/app">Open a treasury</Cta>
          <a href="#tripwire" className={styles.secondary}>
            How the tripwire works
          </a>
        </div>
      </div>

      <div className={styles.control}>
        <Ladder level={level} onChange={setLevel} />
      </div>
    </section>
  );
}
