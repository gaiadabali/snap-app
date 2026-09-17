/**
 * Exactly one tax engine, installed and swappable.
 *
 * The shape Hansel asked for: the rule set is chosen by country at registration,
 * changeable in settings, **one active at a time**, and switching country
 * *replaces* the installed rule set rather than adding to it — so the app stays the
 * same size whether it supports two jurisdictions or forty.
 *
 * Three rules make that safe rather than merely small:
 *
 *  1. **Replace is atomic.** The new rule set is fetched and verified *before* the
 *     old one is released. A failed install leaves the previous rule set active and
 *     working — never an app with no engine, and never a partially applied one.
 *  2. **There is no fallback.** If nothing is installed, every call throws
 *     `NoRulesInstalled`. It does not quietly fall back to Australia, which is
 *     the failure that would be invisible: an Indonesian user would get
 *     plausible numbers computed under the wrong law.
 *  3. **Results carry the rule set version.** `interpreter.ts` stamps
 *     `rules.version` into everything it returns, so a figure stored today can
 *     be re-derived under the same rules in three years. README principle 2.
 *
 * This is a store, not a downloader. `fetchRules` is supplied by the host — the
 * server reads from disk, the mobile app from its cache directory — because
 * where bytes come from is a platform concern and the rules above are not.
 */

import type { TaxRules, TaxpayerScope } from './contract.js';
import { assertRules, RulesRejected, rulesCoverDate } from './verify.js';

export class NoRulesInstalled extends Error {
  constructor(operation: string) {
    super(
      `no tax rules are installed, so ${operation} cannot be answered. ` +
        'Install a rule set for the taxpayer\'s country first — there is deliberately no default.',
    );
    this.name = 'NoRulesInstalled';
  }
}

export class RulesScopeMismatch extends Error {
  constructor(rulesId: string, want: TaxpayerScope, got: TaxpayerScope) {
    super(`tax rules ${JSON.stringify(rulesId)} is a ${got} rules; this workspace needs ${want}`);
    this.name = 'RulesScopeMismatch';
  }
}

/** Where a rule set's bytes come from. Async because it is usually a fetch or a read. */
export type RulesSource = (rulesId: string) => Promise<unknown>;

export interface InstalledRules {
  rules: TaxRules;
  installedAt: string;
  /** How it got here, for support and for the audit trail. */
  origin: 'builtin' | 'fetched';
}

export interface RegistryOptions {
  /**
   * Rule sets compiled into the binary. Always available, never fetched.
   *
   * Keeping at least one built in is what makes the app usable offline on
   * first run, and what makes the "fetch failed" path testable without a
   * network.
   */
  builtin?: TaxRules[];
  /** Fetches a rule set that is not built in. Omit to allow built-ins only. */
  fetchRules?: RulesSource;
  /** Injectable for tests; defaults to `Date`. */
  now?: () => Date;
}

/**
 * The installed-engine store.
 *
 * Deliberately a class with explicit state rather than a module-level
 * singleton: the server serves many tenants in one process and each request
 * resolves its own jurisdiction. A module-level "current rule set" would be a
 * cross-tenant data leak wearing a performance optimisation's clothes.
 */
export class TaxRulesRegistry {
  #installed: InstalledRules | null = null;
  readonly #builtin: Map<string, TaxRules>;
  readonly #fetch: RulesSource | null;
  readonly #now: () => Date;

  constructor(options: RegistryOptions = {}) {
    this.#builtin = new Map();
    for (const p of options.builtin ?? []) {
      // A built-in rule set is verified at construction, not at install. A broken
      // rule set compiled into the binary should fail the build's tests, loudly,
      // rather than wait for a user to switch country.
      const verified = assertRules(p);
      this.#builtin.set(verified.id, verified);
    }
    this.#fetch = options.fetchRules ?? null;
    this.#now = options.now ?? (() => new Date());
  }

  /** Pack ids available without a network. */
  builtinIds(): string[] {
    return [...this.#builtin.keys()].sort();
  }

  /** The active rule set, or null. Prefer `require()` where one is needed. */
  current(): InstalledRules | null {
    return this.#installed;
  }

  /**
   * The active rule set, or throw.
   *
   * Named for what it does to the caller. Every computation goes through here,
   * so "no engine installed" surfaces as a refusal at the point of use rather
   * than as a subtly wrong number somewhere downstream.
   */
  require(operation = 'this calculation'): TaxRules {
    if (!this.#installed) throw new NoRulesInstalled(operation);
    return this.#installed.rules;
  }

  /**
   * Install the rule set for a country, replacing whatever is installed.
   *
   * Atomic: verify first, swap second. If the fetch fails or the bytes are
   * rejected, this throws and the previously installed rule set is untouched and
   * still active.
   */
  async install(rulesId: string): Promise<InstalledRules> {
    const builtin = this.#builtin.get(rulesId);
    let rules: TaxRules;
    let origin: InstalledRules['origin'];

    if (builtin) {
      rules = builtin;
      origin = 'builtin';
    } else {
      if (!this.#fetch) {
        throw new NoRulesInstalled(
          `installing ${JSON.stringify(rulesId)} (not built in, and no fetchRules was configured)`,
        );
      }
      const raw = await this.#fetch(rulesId);
      // Throws RulesRejected with every problem. Nothing is swapped.
      rules = assertRules(raw);
      origin = 'fetched';

      if (rules.id !== rulesId) {
        throw new RulesRejected(rulesId, [
          {
            path: 'id',
            message: `fetched rules identifies as ${JSON.stringify(rules.id)}, not ${JSON.stringify(rulesId)}`,
          },
        ]);
      }
    }

    const next: InstalledRules = {
      rules,
      installedAt: this.#now().toISOString(),
      origin,
    };
    // The swap. Single assignment, after every check has passed.
    this.#installed = next;
    return next;
  }

  /**
   * Remove the installed rule set, leaving no engine.
   *
   * The app is then in a state where every tax calculation refuses. That is
   * intentional and it is the honest state between "the user changed their
   * country" and "the new rule set finished installing".
   */
  uninstall(): void {
    this.#installed = null;
  }

  /**
   * Assert the installed rule set fits this workspace and this date.
   *
   * Two failures that a shape check cannot catch:
   *  - a **business** rule set serving a personal workspace, which would offer
   *    input-tax credits to someone who cannot claim them;
   *  - a structurally perfect rule set for the wrong year, which produces a
   *    plausible number under superseded law.
   */
  requireFor(scope: TaxpayerScope, isoDate: string, operation = 'this calculation'): TaxRules {
    const rules = this.require(operation);
    if (rules.scope !== scope) {
      throw new RulesScopeMismatch(rules.id, scope, rules.scope);
    }
    if (!rulesCoverDate(rules, isoDate)) {
      throw new RulesRejected(rules.id, [
        {
          path: 'effectiveFrom',
          message:
            `covers ${rules.effectiveFrom}..${rules.effectiveTo ?? 'open'}, ` +
            `which does not include ${isoDate}`,
        },
      ]);
    }
    return rules;
  }
}

/**
 * The rule set id for a country, for the tax year in force.
 *
 * Deliberately not a lookup table of every country: this returns a *candidate
 * id*, and `install()` decides whether such a rule set exists. Adding Malaysia
 * means shipping `my-2026`, not editing a list here.
 */
export function rulesIdFor(country: string, taxYear: string): string {
  if (!/^[A-Za-z]{2}$/.test(country)) {
    throw new Error(`not an ISO 3166-1 alpha-2 country: ${JSON.stringify(country)}`);
  }
  if (!/^\d{4}$/.test(taxYear)) {
    throw new Error(`not a tax year: ${JSON.stringify(taxYear)}`);
  }
  return `${country.toLowerCase()}-${taxYear}`;
}
