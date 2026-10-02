'use client';

import { useEffect, useRef } from 'react';
import type { ArtName } from '@/engraving/arts';
import type { PrintOptions } from '@/engraving/render';
import type { PrintReply, PrintRequest } from '@/engraving/print.worker';
import { SIZES } from '@/engraving/sizes';
import styles from './EngravedPlate.module.css';

interface Props {
  name: ArtName;
  /** Plate state: 0 = proof, 5 = worn through. */
  level?: number;
  /** What the engraving shows, for assistive technology. */
  label: string;
  /** Wait until the plate nears the viewport before engraving it. */
  lazy?: boolean;
  className?: string;
}

// ---------- the engraver: a worker when the browser has one, else this thread ----------

type Job = { resolve: (b: ImageBitmap | null) => void };
let worker: Worker | null | undefined;
let nextId = 1;
const jobs = new Map<number, Job>();

function engraver(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') throw new Error('no worker');
    worker = new Worker(new URL('../../engraving/print.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<PrintReply>) => {
      const job = jobs.get(e.data.id);
      jobs.delete(e.data.id);
      if (!job) return;
      if ('bitmap' in e.data) job.resolve(e.data.bitmap);
      else {
        console.error(e.data.error);
        job.resolve(null);
      }
    };
  } catch {
    worker = null;
  }
  return worker;
}

async function engrave(name: ArtName, options: PrintOptions, target: HTMLCanvasElement): Promise<boolean> {
  const w = engraver();
  if (w) {
    const id = nextId++;
    const bitmap = await new Promise<ImageBitmap | null>((resolve) => {
      jobs.set(id, { resolve });
      w.postMessage({ id, name, options } satisfies PrintRequest);
    });
    if (!bitmap) return false;
    target.width = bitmap.width;
    target.height = bitmap.height;
    const ctx = target.getContext('2d');
    ctx?.clearRect(0, 0, bitmap.width, bitmap.height);
    ctx?.drawImage(bitmap, 0, 0);
    bitmap.close();
    return true;
  }
  const [{ ARTS }, { print }] = await Promise.all([import('@/engraving/arts'), import('@/engraving/render')]);
  const art = ARTS[name];
  print(target, art, art.ops(options.pitchPx / (options.cssWidth / art.width), options.level), options);
  return true;
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
export function EngravedPlate({ name, level = 0, label, lazy = false, className }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const canvases = [useRef<HTMLCanvasElement>(null), useRef<HTMLCanvasElement>(null)] as const;
  const st = useRef({ front: -1, want: level, shown: -1, width: 0, busy: false, visible: !lazy, alive: true });
  const runRef = useRef<() => void>(() => {});
  const size = SIZES[name];

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const s = st.current;
    s.alive = true;
    s.busy = false;
    let resizeTimer = 0;

    const run = () => {
      if (!s.alive || !s.visible || s.busy) return;
      const width = el.clientWidth;
      if (width < 8) return;
      if (s.shown === s.want && Math.abs(width - s.width) < 2) return;
      s.busy = true;
      const target = s.want;
      const screenDpr = window.devicePixelRatio || 1;
      // on a 1x screen the plate is printed at 2x and let down: the lines keep
      // their pitch but lose their stair-steps and moiré
      const dpr = Math.min(2.5, Math.max(2, screenDpr));
      const ink = readInk(el);
      const options: PrintOptions = {
        cssWidth: width,
        cssHeight: (width * size.height) / size.width,
        dpr,
        level: target,
        pitchPx: pitchFor(width, screenDpr),
        ...(ink ? { ink } : {}),
      };
      const back = s.front === 0 ? 1 : 0;
      const cv = canvases[back].current;
      if (!cv) {
        s.busy = false;
        return;
      }
      engrave(name, options, cv)
        .then((ok) => {
          if (!ok || !s.alive) return;
          if (s.front < 0) cv.dataset.first = 'true';
          else delete cv.dataset.first;
          cv.dataset.on = 'true';
          const prev = s.front === 0 || s.front === 1 ? canvases[s.front].current : null;
          if (prev && prev !== cv) prev.dataset.on = 'false';
          s.front = back;
          s.shown = target;
          s.width = width;
        })
        .catch((e: unknown) => console.error(e))
        .finally(() => {
          s.busy = false;
          if (s.alive) run();
        });
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
      s.alive = false;
      ro.disconnect();
      io?.disconnect();
      window.clearTimeout(resizeTimer);
    };
    // the canvas refs are stable for the life of the component
  }, [name, size.height, size.width]);

  useEffect(() => {
    st.current.want = level;
    runRef.current();
  }, [level]);

  return (
    <div
      ref={box}
      className={[styles.plate, className].filter(Boolean).join(' ')}
      style={{ aspectRatio: `${size.width} / ${size.height}` }}
      role="img"
      aria-label={label}
    >
      <canvas ref={canvases[0]} className={styles.layer} aria-hidden="true" />
      <canvas ref={canvases[1]} className={styles.layer} aria-hidden="true" />
    </div>
  );
}
