/**
 * The on-device preview's brain, and the server's second opinion.
 *
 * Deterministic header-field structuring over DocDOM spans — no model, no
 * network, zero runtime dependencies. See `structure.ts` for why an Australian
 * docket's header needs no model once you have text with positions.
 */
// Extensionless, and it has to stay that way: this package is bundled by
// METRO for the mobile app, and Metro resolves a relative specifier
// literally — `./structure.js` names a file that does not exist, because the
// source is `structure.ts` and nothing emits JS here (`noEmit: true`, and
// `exports` maps "." straight at ./src/index.ts).
//
// It went unnoticed until OD-8, because nothing on the phone imported this
// package before. `@snap/tax-rules` is written in the .js style throughout and
// is fine — Metro never reaches it, it is server-only. This was the first
// package in that style handed to a bundler, and it took the whole mobile
// image build down with it.
export * from './structure';
