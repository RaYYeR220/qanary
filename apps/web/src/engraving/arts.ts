// Every engraving the site prints, by name.

import { figBucket, figColdKey, figLadder } from './figures';
import { plateXII } from './plate-xii';
import type { PlateArt } from './render';

export const ARTS = {
  'plate-xii': plateXII,
  'fig-key': figColdKey,
  'fig-bucket': figBucket,
  'fig-ladder': figLadder,
} satisfies Record<string, PlateArt>;

export type ArtName = keyof typeof ARTS;
