/**
 * OD-14 public surface — `docs/ON-DEVICE.md` §11 Stage 3.
 *
 * `PPOCR_ENABLED` is `false` (`config.ts`): importing this module changes
 * nothing about `device-mlkit` or the capture flow. See `recognise.ts`'s doc
 * comment for the full "why" and what remains unverified without a handset.
 */
export { PPOCR_ENABLED, PPOCR_ENGINE_ID, PPOCR_ENGINE_VERSION, PPOCR_MODELS } from './config';
export { isPpocrAvailable, recognisePpocr } from './recognise';
export type {
  CtcResult,
  DetPrep,
  PpocrBox,
  PpocrDeviceInfo,
  PpocrRecogniseResult,
  RecPrep,
} from './types';
