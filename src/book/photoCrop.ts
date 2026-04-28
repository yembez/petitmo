export type PhotoCrop = { xPct: number; yPct: number; scale: number };

export function defaultPhotoCrop(): PhotoCrop {
  return { xPct: 0, yPct: 0, scale: 1 };
}
