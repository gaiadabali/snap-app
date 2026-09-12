import { customType } from 'drizzle-orm/pg-core';

/**
 * Postgres DOMAIN mappings.
 *
 * The SQL schema defines domains (`money_amount`, `currency_code`, …) rather
 * than raw `NUMERIC(19,4)` so the constraint lives in one place. These custom
 * types make Drizzle emit the domain name, which is also what lets the drift
 * test compare declarations against `information_schema` meaningfully.
 *
 * MONEY IS A STRING, DELIBERATELY.
 * The `pg` driver returns NUMERIC as a string so precision is never lost, and
 * we keep it that way all the way through. A `NUMERIC(19,4)` silently cast to a
 * JS float defeats the entire point of the ledger — 0.1 + 0.2 is not 0.3, and a
 * BAS that is out by a cent is a BAS that is wrong. The branded types below make
 * `parseFloat(amount)` a type error rather than a rounding bug discovered at
 * audit time. Use the helpers in `./money.ts` for arithmetic.
 */

/** A decimal amount as a string, e.g. "110.0000". Never a number. */
export type Money = string & { readonly __brand: 'Money' };
/** A unit price with up to 6 decimals, e.g. "1.899000" (fuel per litre). */
export type UnitPrice = string & { readonly __brand: 'UnitPrice' };
/** A quantity with up to 6 decimals. */
export type Quantity = string & { readonly __brand: 'Quantity' };
/** A tax rate as a string, e.g. "10.0000". */
export type TaxRate = string & { readonly __brand: 'TaxRate' };
/** ISO 4217, e.g. "AUD". */
export type CurrencyCode = string & { readonly __brand: 'CurrencyCode' };
/** ISO 3166-1 alpha-2, e.g. "AU". */
export type CountryCode = string & { readonly __brand: 'CountryCode' };
/** 0.000 – 1.000 as a string. */
export type Confidence = string & { readonly __brand: 'Confidence' };

const domain = <T extends string>(name: string) =>
  customType<{ data: T; driverData: string }>({
    dataType() {
      return name;
    },
    fromDriver(value: string) {
      return value as T;
    },
    toDriver(value: T) {
      return value;
    },
  });

export const moneyAmount = domain<Money>('money_amount');
export const unitPrice = domain<UnitPrice>('unit_price');
export const quantity = domain<Quantity>('quantity');
export const taxRate = domain<TaxRate>('tax_rate');
export const currencyCode = domain<CurrencyCode>('currency_code');
export const countryCode = domain<CountryCode>('country_code');
export const confidence = domain<Confidence>('confidence');

/** `citext` — case-insensitive text, used for email. */
export const citext = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'citext';
  },
});

/** `bytea` — SHA-256 digests, argon2id hashes, AEAD ciphertext. */
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

/** `inet` — audit-log source address. */
export const inet = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'inet';
  },
});
