/**
 * Re-exported from `@snap/api-contract`.
 *
 * These helpers moved into the contract package because the SERVER needs the
 * identical arithmetic: GST as 1/11 of a GST-inclusive purchase is not a rule
 * that may be implemented twice and hope to agree. This file stays so the
 * screens keep importing `@/lib/money`.
 */
export * from '@snap/api-contract/money';
