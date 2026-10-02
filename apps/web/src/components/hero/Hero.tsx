'use client';

import { useState } from 'react';
import { RUNGS } from '@/content/facts';
import { Cta } from '../chrome/Cta';
import { EngravedPlate } from '../plate/EngravedPlate';
import { PlateFrame } from '../plate/PlateFrame';
import { DegradingHeadline } from './DegradingHeadline';
import { Ladder } from './Ladder';
import styles from './Hero.module.css';

const PLATE_LABEL =
  'Engraving of a yellow canary perched on the ring of a Davy safety lamp. A small flame burns inside the wire gauze.';

/**
 * The hero is one grid. Wide screens: the plate on the left, claim, lede,
 * action and ladder on the right. Phones: claim and action first, then the
 * plate with its ladder directly under it, then the lede, so the control is in
 * the first screen.
 */
export function Hero() {
  const [level, setLevel] = useState(0);
  const rung = RUNGS[level] ?? RUNGS[0]!;
  return (
    <section className={styles.hero} aria-labelledby="claim">
      <div className={styles.claim}>
        <DegradingHeadline level={level} id="claim" />
      </div>

      <p className={styles.lede}>
        Qanary treasury accounts answer to a post-quantum key: <span className={styles.nb}>ML-DSA</span> or Falcon
        signatures, verified by Arbitrum Stylus programs now live on ApeChain. A capped classical key handles daily
        spending, and a tripwire shuts classical keys down as weaker curves are broken.
      </p>

      <div className={styles.actions}>
        <Cta href="/app">Open a treasury</Cta>
        <a href="#tripwire" className={styles.secondary}>
          How the tripwire works
        </a>
      </div>

      <figure className={styles.figure}>
        <div className={styles.plateBox}>
          <PlateFrame>
            <EngravedPlate name="plate-xii" level={level} label={PLATE_LABEL} />
            <span className={styles.state}>{rung.plate}</span>
          </PlateFrame>
        </div>
        <figcaption className={styles.caption}>
          Plate XII. The canary, <span className={styles.binomial}>Serinus canaria</span>, on Sir Humphry Davy&rsquo;s
          safety lamp.
        </figcaption>
      </figure>

      <div className={styles.control}>
        <Ladder level={level} onChange={setLevel} />
      </div>
    </section>
  );
}
