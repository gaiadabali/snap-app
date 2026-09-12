/**
 * Re-exported from `@snap/api-contract`.
 *
 * The aggregation moved into the contract package so the server computes these
 * summaries with the SAME code the app does. The period comparison in here has
 * already been wrong twice — once comparing a part month against a whole one,
 * once reporting "up 2354%" against a window that predated the data — and a
 * second implementation in SQL would be a third chance to get it wrong.
 */
export * from '@snap/api-contract/analytics';
