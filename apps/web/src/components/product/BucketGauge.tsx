import { useId } from 'react';
import styles from './BucketGauge.module.css';

interface Props {
  /** Share of the full cap the tripwire still allows, 0..1. */
  scale: number;
  /** Share of the full cap that can be spent now, 0..1. */
  available: number;
  label: string;
}

const CX = 160, CY = 168, R0 = 108, R1 = 140;
const angle = (f: number) => Math.PI * (1 - Math.max(0, Math.min(1, f)));
// rounded so the server and the browser print the same coordinates
const round = (v: number) => Math.round(v * 100) / 100;
const pt = (f: number, r: number) => [round(CX + r * Math.cos(angle(f))), round(CY - r * Math.sin(angle(f)))] as const;

/** An annulus sector from fraction a to b of the dial. */
function sector(a: number, b: number, r0 = R0, r1 = R1): string {
  if (b <= a) return '';
  const [x0, y0] = pt(a, r1), [x1, y1] = pt(b, r1), [x2, y2] = pt(b, r0), [x3, y3] = pt(a, r0);
  const large = b - a > 0.5 ? 1 : 0;
  return `M${x0} ${y0} A${r1} ${r1} 0 ${large} 1 ${x1} ${y1} L${x2} ${y2} A${r0} ${r0} 0 ${large} 0 ${x3} ${y3} Z`;
}

/**
 * The hot tier's bucket as an engraved dial: the full cap spans the half circle,
 * the share the tripwire withholds is hatched in rust, what can be spent now is
 * cut in canary lines that follow the dial, and the needle points at it.
 */
export function BucketGauge({ scale, available, label }: Props) {
  const id = useId().replace(/:/g, '');
  const avail = Math.max(0, Math.min(scale, available));
  // radial burin lines, denser toward the needle
  const lines: string[] = [];
  const steps = 120;
  for (let i = 0; i <= steps; i++) {
    const f = (i / steps) * avail;
    if (avail <= 0) break;
    const [x0, y0] = pt(f, R0 + 2), [x1, y1] = pt(f, R1 - 2);
    lines.push(`M${x0.toFixed(2)} ${y0.toFixed(2)}L${x1.toFixed(2)} ${y1.toFixed(2)}`);
  }
  const ticks = Array.from({ length: 21 }, (_, i) => i / 20);
  const [nx, ny] = pt(avail, R1 + 8);
  return (
    <svg viewBox="0 0 320 196" className={styles.gauge} role="img" aria-label={label}>
      <defs>
        <pattern id={`w${id}`} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="5" className={styles.hatch} />
        </pattern>
      </defs>
      {/* the dial: three engraved rings */}
      {[R0, (R0 + R1) / 2, R1].map((r) => (
        <path key={r} d={`M${CX - r} ${CY} A${r} ${r} 0 0 1 ${CX + r} ${CY}`} className={styles.ring} />
      ))}
      {/* withheld by the tripwire */}
      {scale < 1 && <path d={sector(scale, 1)} fill={`url(#w${id})`} className={styles.withheld} />}
      {/* available now */}
      <path d={lines.join('')} className={styles.cut} />
      {ticks.map((t, i) => {
        const long = i % 5 === 0;
        const [x0, y0] = pt(t, R1 + 2), [x1, y1] = pt(t, R1 + (long ? 12 : 6));
        return <line key={i} x1={x0} y1={y0} x2={x1} y2={y1} className={long ? styles.tickLong : styles.tick} />;
      })}
      {[
        [0, '0'],
        [0.5, '½'],
        [1, 'cap'],
      ].map(([f, t]) => {
        const [x, y] = pt(f as number, R1 + 24);
        return (
          <text key={t as string} x={x} y={y + 4} className={styles.label} textAnchor="middle">
            {t}
          </text>
        );
      })}
      {scale < 1 && scale > 0 && (
        <line x1={pt(scale, R0 - 6)[0]} y1={pt(scale, R0 - 6)[1]} x2={pt(scale, R1 + 6)[0]} y2={pt(scale, R1 + 6)[1]} className={styles.limit} />
      )}
      {/* the needle and its lozenge hub */}
      <line x1={CX} y1={CY} x2={nx} y2={ny} className={styles.needle} />
      <path d={`M${CX} ${CY - 7} L${CX + 7} ${CY} L${CX} ${CY + 7} L${CX - 7} ${CY} Z`} className={styles.hub} />
    </svg>
  );
}
