// Engraves and prints plates off the main thread.

import { ARTS, type ArtName } from './arts';
import { print, type PrintOptions } from './render';

export interface PrintRequest {
  id: number;
  name: ArtName;
  options: PrintOptions;
}

export type PrintReply = { id: number; bitmap: ImageBitmap } | { id: number; error: string };

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<PrintRequest>) => void) | null;
  postMessage: (msg: PrintReply, transfer?: Transferable[]) => void;
};

scope.onmessage = (e) => {
  const { id, name, options: o } = e.data;
  try {
    const art = ARTS[name];
    const pitch = o.pitchPx / (o.cssWidth / art.width);
    const surface = new OffscreenCanvas(Math.round(o.cssWidth * o.dpr), Math.round(o.cssHeight * o.dpr));
    print(surface, art, art.ops(pitch, o.level), o);
    const bitmap = surface.transferToImageBitmap();
    scope.postMessage({ id, bitmap }, [bitmap]);
  } catch (err) {
    scope.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
