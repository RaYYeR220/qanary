// Plate proportions, kept apart from the engraving code so a page can reserve
// the space before the engraver loads.

import type { ArtName } from './arts';

export const SIZES: Record<ArtName, { width: number; height: number }> = {
  'plate-xii': { width: 880, height: 1180 },
  'fig-key': { width: 400, height: 480 },
  'fig-bucket': { width: 400, height: 480 },
  'fig-ladder': { width: 400, height: 480 },
};
