/**
 * The ATO's ABN check-digit algorithm: subtract 1 from the first digit, weight
 * the eleven digits (10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19), and the sum must
 * divide by 89. It proves the number is well formed, not that it is registered.
 * The same rule is in SQL (`abn_is_valid`, migration 0001), which the issuer
 * table's CHECK uses; this copy gives the admin a clean 400 before the database
 * is asked. Written from the ATO's description, after YourTal's invoicing.
 */
const WEIGHTS = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];

/** Digits only, spaces dropped; NULL when nothing is left. */
export function normaliseAbn(input: string | null | undefined): string | null {
  const digits = (input ?? '').replace(/\s+/g, '');
  return digits === '' ? null : digits;
}

export function isValidAbn(abn: string): boolean {
  if (!/^\d{11}$/.test(abn)) return false;
  const digits = abn.split('').map(Number);
  digits[0] = (digits[0] ?? 0) - 1;
  const sum = digits.reduce((total, digit, i) => total + digit * (WEIGHTS[i] ?? 0), 0);
  return sum % 89 === 0;
}

/** 51824753556 -> "51 824 753 556". */
export function formatAbn(abn: string): string {
  return /^\d{11}$/.test(abn) ? `${abn.slice(0, 2)} ${abn.slice(2, 5)} ${abn.slice(5, 8)} ${abn.slice(8)}` : abn;
}
