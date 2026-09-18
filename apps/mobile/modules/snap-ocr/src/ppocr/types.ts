import type { Document } from '@snap/api-contract/docdom';

/** Mirrors `SnapOcrPpocr.deviceInfo()` (Kotlin) — duplicated intentionally, see that function's comment. */
export type PpocrDeviceInfo = {
  platform: 'android';
  osVersion: string;
  model: string;
  totalMemoryMb: number;
};

/** `SnapOcrPpocr.prepareDetTensor()`'s resolved value. */
export type DetPrep = {
  data: number[];
  width: number;
  height: number;
  /** The recognised-copy frame — what `dbPostprocess`'s `destWidth`/`destHeight` should be. */
  recognisedWidth: number;
  recognisedHeight: number;
  originalWidth: number;
  originalHeight: number;
  scaleX: number;
  scaleY: number;
};

/** One `dbPostprocess()` result entry: `box` is 8 numbers, `[tlX,tlY,trX,trY,brX,brY,blX,blY]`. */
export type PpocrBox = {
  score: number;
  box: number[];
};

export type RecPrep = {
  data: number[];
  width: number;
  height: number;
};

export type CtcResult = {
  text: string;
  confidence: number;
};

export type PpocrRecogniseResult = {
  document: Partial<Document>;
  device: PpocrDeviceInfo;
  timings: { recogniseMs: number; detMs: number; recMs: number; linesRead: number };
};
