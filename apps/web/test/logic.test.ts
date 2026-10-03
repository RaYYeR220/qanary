import { encodeErrorResult, parseAbi, zeroAddress, type Hex } from 'viem';
import { describe, expect, it } from 'vitest';
import { bucketView, effectiveCap, formatDuration } from '@/lib/bucket';
import { ERRORS_ABI, explainRecordedError, explainRevertData } from '@/lib/errors';

const enc = (errorName: string, args: readonly unknown[]): Hex =>
  encodeErrorResult({ abi: ERRORS_ABI, errorName, args } as Parameters<typeof encodeErrorResult>[0]);

describe('error decoding', () => {
  it('marks the four hot-tier refusals as refusals, with their numbers', () => {
    const cap = explainRevertData(enc('CapExceeded', [zeroAddress, 2n * 10n ** 18n, 5n * 10n ** 17n]), 'APE')!;
    expect(cap.name).toBe('CapExceeded');
    expect(cap.refusal).toBe(true);
    expect(cap.message).toContain('2 APE');
    expect(cap.message).toContain('0.5 APE');

    const broken = explainRevertData(enc('ClassicalFamilyBroken', [0]))!;
    expect([broken.name, broken.refusal]).toEqual(['ClassicalFamilyBroken', true]);
    expect(broken.message).toContain('secp256k1');

    const frozen = explainRevertData(enc('HotTierFrozen', [3]))!;
    expect([frozen.name, frozen.refusal]).toEqual(['HotTierFrozen', true]);

    const call = explainRevertData(enc('CallNotAllowed', ['0x1111111111111111111111111111111111111111', '0x095ea7b3']))!;
    expect([call.name, call.refusal]).toEqual(['CallNotAllowed', true]);
  });

  it('decodes registry and verifier errors as plain failures', () => {
    expect(explainRevertData(enc('InvalidProof', []))).toMatchObject({ name: 'InvalidProof', refusal: false });
    expect(explainRevertData(enc('AlreadyClaimed', [2]))).toMatchObject({ name: 'AlreadyClaimed', refusal: false });
    expect(explainRevertData(enc('KeyNotPrepared', [`0x${'ab'.repeat(32)}`]))?.message).toContain('prepareKey');
  });

  it('looks inside EntryPoint FailedOpWithRevert for the account revert', () => {
    const inner = enc('HotTierFrozen', [2]);
    const outer = enc('FailedOpWithRevert', [0n, 'AA23 reverted', inner]);
    expect(explainRevertData(outer)).toMatchObject({ name: 'HotTierFrozen', refusal: true });
  });

  it('returns undefined for unknown data', () => {
    const other = encodeErrorResult({ abi: parseAbi(['error Nope(uint256)']), errorName: 'Nope', args: [1n] });
    expect(explainRevertData(other)).toBeUndefined();
    expect(explainRevertData('0x')).toBeUndefined();
  });
});

describe('errors recorded by the live run', () => {
  it('explains the recorded refusals', () => {
    const cap = explainRecordedError('CapExceeded(0x0000000000000000000000000000000000000000, 2000000000000001, 1000000000000000)', 'APE');
    expect(cap).toMatchObject({ name: 'CapExceeded', refusal: true });
    expect(cap.message).toContain('0.002000000000000001 APE');
    expect(cap.message).toContain('0.001 APE');
    expect(explainRecordedError('ClassicalFamilyBroken(0)')).toMatchObject({ name: 'ClassicalFamilyBroken', refusal: true });
    expect(explainRecordedError('FailedOp(0, AA24 signature error)').message).toContain('did not verify');
    expect(explainRecordedError('LadderUnavailable()').name).toBe('LadderUnavailable');
  });
});

describe('bucket display math', () => {
  it('scales the cap by the tripwire level', () => {
    expect(effectiveCap(1000n, 10_000)).toBe(1000n);
    expect(effectiveCap(1000n, 5_000)).toBe(500n);
    expect(effectiveCap(1000n, 1_000)).toBe(100n);
    expect(effectiveCap(1000n, 0)).toBe(0n);
  });

  it('derives fill, refill rate and time to full', () => {
    const v = bucketView({ cap: 1000n, available: 250n, effectiveBps: 5_000, window: 86_400 });
    expect(v.effectiveCap).toBe(500n);
    expect(v.fill).toBeCloseTo(0.5, 6);
    expect(v.scale).toBe(0.5);
    // 500 per day, so 20.83 per hour, rounded down in base units
    expect(v.refillPerHour).toBe(20n);
    // 250 missing at 500 per day: half a day
    expect(v.secondsToFull).toBe(43_200);
    expect(v.frozen).toBe(false);
  });

  it('clamps an over-full reading and reports a frozen tier', () => {
    expect(bucketView({ cap: 1000n, available: 900n, effectiveBps: 5_000, window: 3600 }).fill).toBe(1);
    const f = bucketView({ cap: 1000n, available: 0n, effectiveBps: 0, window: 3600 });
    expect([f.frozen, f.fill, f.secondsToFull, f.refillPerHour]).toEqual([true, 0, 0, 0n]);
  });

  it('formats durations for people', () => {
    expect(formatDuration(42)).toBe('42 s');
    expect(formatDuration(600)).toBe('10 min');
    expect(formatDuration(12_000)).toBe('3 h 20 min');
    expect(formatDuration(190_800)).toBe('2 d 5 h');
  });
});
