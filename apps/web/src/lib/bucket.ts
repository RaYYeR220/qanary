// The hot tier's leaky bucket, as the dashboard draws it.
//
// The executor stores a cap per asset and a window. At tripwire level l every
// cap is scaled by levelBps[l] / 10,000 (effectiveBps); an emptied bucket refills
// linearly to its scaled cap over the window. `available` is what the contract
// reports for now; everything else here is derived from it for display.

export interface BucketInput {
  cap: bigint;
  available: bigint;
  effectiveBps: number;
  window: number;
}

export interface BucketView {
  /** Cap after the tripwire scaling. */
  effectiveCap: bigint;
  /** Share of the effective cap that can be spent now, 0..1. */
  fill: number;
  /** Share of the full cap the scaled cap still allows, 0..1. */
  scale: number;
  /** Refill per hour, in the asset's base units. */
  refillPerHour: bigint;
  /** Seconds until the bucket is full again (0 when full or frozen). */
  secondsToFull: number;
  frozen: boolean;
}

export function effectiveCap(cap: bigint, effectiveBps: number): bigint {
  if (effectiveBps <= 0) return 0n;
  return (cap * BigInt(Math.min(10_000, Math.floor(effectiveBps)))) / 10_000n;
}

export function bucketView(b: BucketInput): BucketView {
  const eff = effectiveCap(b.cap, b.effectiveBps);
  const frozen = eff === 0n;
  const avail = b.available > eff ? eff : b.available < 0n ? 0n : b.available;
  const fill = eff === 0n ? 0 : Number((avail * 1_000_000n) / eff) / 1_000_000;
  const window = Math.max(1, Math.floor(b.window));
  const refillPerHour = frozen ? 0n : (eff * 3600n) / BigInt(window);
  const missing = eff - avail;
  const secondsToFull = frozen || missing === 0n ? 0 : Math.ceil(Number((missing * BigInt(window) * 1000n) / eff) / 1000);
  return {
    effectiveCap: eff,
    fill,
    scale: Math.min(1, Math.max(0, b.effectiveBps / 10_000)),
    refillPerHour,
    secondsToFull,
    frozen,
  };
}

/** "3 h 20 min", "45 s", "2 d 4 h": a duration for people. */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d} d ${h % 24} h` : `${d} d`;
}

/** Default hot-tier scaling by tripwire level: full, half, a tenth, frozen. */
export const DEFAULT_LEVEL_BPS = [10_000, 5_000, 1_000, 0] as const;
