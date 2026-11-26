import { AU_2025, AU_2026, AU_2027, ID_2026, type TaxRules } from '@snap/tax-rules';
import { describe, expect, it } from 'vitest';

import type { ExtractionProvider, PageImage, ProviderResult } from '../extraction/provider.js';
import { runExtraction } from '../extraction/run.js';
import type { Extraction } from '../extraction/types.js';
import type { TenantRow } from '../repo.js';
import {
  assessmentDate,
  availableRules,
  heldRules,
  readerRulesOf,
  readerRulesResolver,
  rulesFor,
  rulesStampOf,
  tenantRulesFor,
  todayIso,
} from './taxrules.repo.js';

/**
 * A workspace stores ONE rule set (its country); each document is assessed
 * under the year its own date falls in. No database: everything here is the
 * resolution, which is pure once the tenant row is in hand.
 */

const tenant = (over: Partial<TenantRow> = {}): TenantRow => ({
  id: '00000000-0000-4000-8000-0000000000e1',
  name: 'Tax years test',
  kind: 'personal',
  abn: null,
  abn_valid: null,
  gst_registered: false,
  gst_basis: 'cash',
  simpler_bas: false,
  occupation_profile_id: null,
  financial_year_start_month: 7,
  country: 'AU',
  base_currency: 'AUD',
  // What every Australian email sign-up since PR #105 stored.
  tax_rules_id: 'au-2026',
  tax_rules_version: AU_2026.version,
  ...over,
});

describe('an AU personal workspace that installed au-2026', () => {
  it('assesses each date under the year it falls in', async () => {
    const t = await tenantRulesFor(tenant());
    const at = (d: string) => `${t.on(d).rules.id}/${t.on(d).match}`;
    expect(at('2025-06-30')).toBe('au-2025/earliest_held');
    expect(at('2025-07-01')).toBe('au-2025/exact');
    expect(at('2026-06-30')).toBe('au-2025/exact');
    expect(at('2026-07-01')).toBe('au-2026/exact');
    expect(at('2027-06-30')).toBe('au-2026/exact');
    expect(at('2027-07-01')).toBe('au-2027/exact');
    expect(at('2030-01-01')).toBe('au-2027/latest_held');
  });

  it('keeps the installed rule set as the country, not the year', async () => {
    const t = await tenantRulesFor(tenant());
    expect(t.installed.id).toBe('au-2026');
    expect((await rulesFor(tenant(), '2026-03-15')).version).toBe('2025.1.0');
  });

  it('a receipt dated 2026-03-15 is stamped au-2025 / 2025.1.0, read by the Australian reader', async () => {
    const stamp = rulesStampOf(await tenantRulesFor(tenant()), '2026-03-15');
    expect(stamp).toEqual({
      rulesId: 'au-2025',
      rulesVersion: '2025.1.0',
      onDate: '2026-03-15',
      match: 'exact',
      reader: 'au_builtin',
    });
  });

  it('is still read by the Australian reader in every year', async () => {
    const on = await readerRulesResolver(tenant());
    for (const d of ['2025-03-01', '2026-03-15', '2026-11-26', '2027-07-01', '2030-01-01']) {
      expect(on(d)).toBeNull();
    }
  });

  it('works the same whichever year was installed', async () => {
    for (const r of [AU_2025, AU_2026, AU_2027]) {
      const t = await tenantRulesFor(tenant({ tax_rules_id: r.id, tax_rules_version: r.version }));
      expect(t.on('2026-03-15').rules.id).toBe('au-2025');
      expect(t.on('2027-07-01').rules.id).toBe('au-2027');
    }
  });

  it('still refuses a stored version this server does not carry for the stored id', async () => {
    await expect(
      tenantRulesFor(tenant({ tax_rules_version: '2025.1.0' })),
    ).rejects.toThrow(/au-2026 2025\.1\.0 installed, but this server carries 2026\.1\.0/);
  });

  it('still refuses a workspace with no rule set', async () => {
    await expect(rulesFor(tenant({ tax_rules_id: null, tax_rules_version: null }), '2026-03-15')).rejects.toThrow(
      /no tax rules are installed/,
    );
  });
});

describe('Indonesia, one year held', () => {
  it('gets id-2026 for every date, exactly as before years existed', async () => {
    const id = tenant({ country: 'ID', base_currency: 'IDR', tax_rules_id: 'id-2026', tax_rules_version: ID_2026.version });
    const on = await readerRulesResolver(id);
    for (const d of ['2025-06-01', '2026-06-01', '2027-06-01']) expect(on(d)?.id).toBe('id-2026');
    expect(rulesStampOf(await tenantRulesFor(id), '2027-06-01')).toMatchObject({
      rulesId: 'id-2026',
      match: 'latest_held',
      reader: 'rule_set',
    });
  });
});

describe('the catalogue shows one choice per country', () => {
  it('the year covering the date, never three Australias', () => {
    expect(availableRules('2026-11-26').map((r) => r.rulesId)).toEqual(['au-2026', 'id-2026']);
    expect(availableRules('2026-03-15').map((r) => r.rulesId)).toEqual(['au-2025', 'id-2026']);
    expect(availableRules('2027-07-01').map((r) => r.rulesId)).toEqual(['au-2027', 'id-2026']);
    expect(availableRules('2027-07-01')[0]).toMatchObject({ taxYear: '2027-28', version: '2027.1.0' });
  });

  it('defaults to today', () => {
    expect(availableRules()).toEqual(availableRules(todayIso()));
  });

  it('every held year can still be installed', () => {
    expect(heldRules('au-2025')?.version).toBe('2025.1.0');
    expect(heldRules('au-2027')?.version).toBe('2027.1.0');
    expect(heldRules('au-2019')).toBeUndefined();
  });
});

describe('assessmentDate: the document date, else the capture date, else today', () => {
  it('takes the first date it is given', () => {
    expect(assessmentDate('2026-03-15', '2026-11-20')).toBe('2026-03-15');
    expect(assessmentDate(null, '2026-11-20')).toBe('2026-11-20');
    expect(assessmentDate(undefined, '2026-11-20T23:10:00Z')).toBe('2026-11-20');
    expect(assessmentDate(null, new Date('2026-07-02T01:00:00Z'))).toBe('2026-07-02');
  });

  it('skips what is not a date and ends at today', () => {
    expect(assessmentDate('', 'soon', null)).toBe(todayIso());
    expect(assessmentDate()).toBe(todayIso());
  });
});

describe('runExtraction chooses the year from the date it read', () => {
  const f = <T>(value: T | null, confidence = 0.99) => ({ value, confidence });
  const docket = (issueDate: string): Extraction => ({
    schemaVersion: '1',
    docType: f('receipt' as const),
    saysTaxInvoice: f(false),
    documentNumber: f(null),
    issueDate: f(issueDate),
    currency: f('IDR'),
    supplierName: f('Warung'),
    supplierAbn: f(null),
    buyerIdentified: f(false),
    taxExclusiveAmount: f('1000000'),
    taxAmount: f('110000'),
    payableAmount: f('1110000'),
    lines: [],
    notes: { legible: true, imageIssues: [], warnings: [] },
  });
  const provider = (issueDate: string): ExtractionProvider => ({
    name: 'fake',
    model: 'fake-1',
    async extract(): Promise<ProviderResult> {
      return {
        extraction: docket(issueDate),
        meta: { provider: 'fake', model: 'fake-1', promptVersion: 'test', latencyMs: 1, inputTokens: null, outputTokens: null, raw: '' },
      };
    },
  });
  const PAGE: PageImage = { bytes: Buffer.from('fake'), mimeType: 'image/png' };

  // A second Indonesian year, as a fixture: what `id-2025` will look like.
  const ID_2025: TaxRules = { ...ID_2026, id: 'id-2025', version: '2025.1.0', effectiveFrom: '2025-01-01', effectiveTo: '2025-12-31' };

  it('validates under the year of the receipt, not the year it was photographed', async () => {
    const asked: (string | null)[] = [];
    const byYear = (issueDate: string | null) => {
      asked.push(issueDate);
      return issueDate && issueDate < '2026-01-01' ? ID_2025 : ID_2026;
    };
    const old = await runExtraction(provider('2025-11-03'), PAGE, new Date('2026-02-10'), byYear);
    if (!old.ok) throw new Error(old.failure.error);
    expect(old.run.rules?.id).toBe('id-2025');
    expect(old.run.rulesDate).toBe('2025-11-03');
    // The date order is asked for before the date is read.
    expect(asked[0]).toBeNull();

    const fresh = await runExtraction(provider('2026-02-01'), PAGE, new Date('2026-02-10'), byYear);
    if (!fresh.ok) throw new Error(fresh.failure.error);
    expect(fresh.run.rules?.id).toBe('id-2026');
  });

  it('with a plain rule set (or null) behaves exactly as before', async () => {
    const r = await runExtraction(provider('2025-11-03'), PAGE, new Date('2026-02-10'), ID_2026);
    if (!r.ok) throw new Error(r.failure.error);
    expect(r.run.rules?.id).toBe('id-2026');
    const au = await runExtraction(provider('2025-11-03'), PAGE, new Date('2026-02-10'), null);
    if (!au.ok) throw new Error(au.failure.error);
    expect(au.run.rules).toBeNull();
  });

  it('the shared reader mapping gives the worker null for every Australian year', async () => {
    const on = readerRulesOf(await tenantRulesFor(tenant()));
    expect(on('2026-03-15')).toBeNull();
    expect(on('2027-07-01')).toBeNull();
  });
});
