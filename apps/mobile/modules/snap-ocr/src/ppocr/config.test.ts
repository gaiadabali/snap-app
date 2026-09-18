import { describe, expect, it } from 'vitest';

import { PPOCR_ENABLED, PPOCR_MODELS, VOCAB_SIZE } from './config';

describe('OD-14 config', () => {
  it('is off by default — no measured comparison exists yet', () => {
    expect(PPOCR_ENABLED).toBe(false);
  });

  it('pins a well-formed sha256 and a positive size for both models', () => {
    for (const spec of [PPOCR_MODELS.det, PPOCR_MODELS.rec]) {
      expect(spec.url).toMatch(/^https:\/\/huggingface\.co\/PaddlePaddle\/.+\.onnx$/);
      expect(spec.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(spec.sizeBytes).toBeGreaterThan(0);
      expect(spec.licence).toBe('Apache-2.0');
    }
  });

  it('the two model hashes are different files', () => {
    expect(PPOCR_MODELS.det.sha256).not.toBe(PPOCR_MODELS.rec.sha256);
  });

  it('vocab size matches 1 (blank) + 6904 (dict) + 1 (space)', () => {
    expect(VOCAB_SIZE).toBe(1 + 6904 + 1);
  });
});
