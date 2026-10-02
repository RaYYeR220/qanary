'use client';

import { figBucket, figColdKey, figLadder } from '@/engraving/figures';
import { EngravedPlate } from './EngravedPlate';

const ART = { key: figColdKey, bucket: figBucket, ladder: figLadder } as const;

/** A small engraved figure, printed when it nears the viewport. */
export function EngravedFigure({ name, label }: { name: keyof typeof ART; label: string }) {
  return <EngravedPlate art={ART[name]} label={label} lazy />;
}
