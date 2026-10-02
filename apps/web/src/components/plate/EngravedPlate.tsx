'use client';

import { useEffect, useRef } from 'react';
import { print, type PlateArt } from '@/engraving/render';
import styles from './EngravedPlate.module.css';

interface Props {
  art: PlateArt;
  /** Plate state: 0 = proof, 5 = worn through. */
  level?: number;
  /** What the engraving shows, for assistive technology. */
  label: string;
  /** Wait until the plate nears the viewport before engraving it. */
  lazy?: boolean;
  className?: string;
}

/** The gradient map comes from the design tokens. */
function readInk(el: Element) {
  const cs = getComputedStyle(el);
  const ramp = Array.from({ length: 7 }, (_, i) => cs.getPropertyValue(`--engrave-${i}`).trim());
  const foxing = cs.getPropertyValue('--foxing').trim();
  return ramp.every(Boolean) && foxing ? { ramp, foxing } : undefined;
}

/** Line pitch on screen (CSS px): finer where the screen can hold it. */
function pitchFor(width: number, dpr: number): number {
  if (dpr < 1.5) return width < 420 ? 3.0 : 3.2;
  return width < 420 ? 2.25 : 2.6;
}

/**
 * Prints an engraving into a canvas at the device's pixel ratio. A change of
 * state is printed into a second canvas and cross-faded in.
 */
export function EngravedPlate({ art, level = 0, label, lazy = false, className }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const canvases = [useRef<HTMLCanvasElement>(null), useRef<HTMLCanvasElement>(null)] as const;
  const st = useRef({ front: -1, want: level, shown: -1, width: 0, busy: false, visible: !lazy });
  const runRef = useRef<() => void>(() => {});

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const s = st.current;
    let timer = 0;
    let resizeTimer = 0;

    const run = () => {
      if (!s.visible || s.busy) return;
      const width = el.clientWidth;
      if (width < 8) return;
      if (s.shown === s.want && Math.abs(width - s.width) < 2) return;
      s.busy = true;
      // let the browser paint the control that asked for this first
      timer = window.setTimeout(() => {
        const target = s.want;
        const dpr = Math.min(2.5, window.devicePixelRatio || 1);
        const height = (width * art.height) / art.width;
        const pitchPx = pitchFor(width, dpr);
        const pitch = pitchPx / (width / art.width);
        const back = s.front === 0 ? 1 : 0;
        const cv = canvases[back].current;
        if (cv) {
          try {
            const ink = readInk(el);
            print(cv, art, art.ops(pitch, target), { cssWidth: width, cssHeight: height, dpr, level: target, pitchPx, ...(ink ? { ink } : {}) });
            if (s.front < 0) cv.dataset.first = 'true';
            else delete cv.dataset.first;
            cv.dataset.on = 'true';
            const prev = s.front === 0 || s.front === 1 ? canvases[s.front].current : null;
            if (prev) prev.dataset.on = 'false';
            s.front = back;
            s.shown = target;
            s.width = width;
          } catch (e) {
            console.error(e);
          }
        }
        s.busy = false;
        run();
      }, 16);
    };

    const ro = new ResizeObserver(() => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(run, 120);
    });
    ro.observe(el);

    let io: IntersectionObserver | null = null;
    if (!s.visible) {
      io = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            s.visible = true;
            io?.disconnect();
            run();
          }
        },
        { rootMargin: '480px 0px' },
      );
      io.observe(el);
    } else {
      run();
    }
    runRef.current = run;
    return () => {
      ro.disconnect();
      io?.disconnect();
      window.clearTimeout(timer);
      window.clearTimeout(resizeTimer);
      s.busy = false;
    };
    // the art object is static per plate; the canvas refs are stable
  }, [art]);

  useEffect(() => {
    st.current.want = level;
    runRef.current();
  }, [level]);

  return (
    <div
      ref={box}
      className={[styles.plate, className].filter(Boolean).join(' ')}
      style={{ aspectRatio: `${art.width} / ${art.height}` }}
      role="img"
      aria-label={label}
    >
      <canvas ref={canvases[0]} className={styles.layer} aria-hidden="true" />
      <canvas ref={canvases[1]} className={styles.layer} aria-hidden="true" />
    </div>
  );
}
