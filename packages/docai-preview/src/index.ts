/**
 * The on-device preview's brain, and the server's second opinion.
 *
 * Deterministic header-field structuring over DocDOM spans — no model, no
 * network, zero runtime dependencies. See `structure.ts` for why an Australian
 * docket's header needs no model once you have text with positions.
 */
export * from './structure.js';
