import { describe, expect, it } from 'vitest';

import {
  CONFIRM_BLOCKED_COPY,
  displayValue,
  transitionFor,
  transitionsFor,
  type Preview,
} from './provisional';

/**
 * §7.1's table, asserted row by row.
 *
 * The rule under test is "nothing a person has read changes silently". Each of
 * the four transitions is a different way of keeping that true, and the one
 * that matters most is `differs`: the server wins, but the person is told what
 * the preview said, because they may already have believed it.
 */

describe('§7.1 row 1 — both agree', () => {
  it('confirms, and says why that is stronger than one read', () => {
    const t = transitionFor('header.payable_amount', { value: '48.50' }, '48.50');
    expect(t.kind).toBe('confirmed');
    if (t.kind !== 'confirmed') return;
    expect(t.copy).toBe('Confirmed by two independent reads.');
  });

  it('does not call 36.20 and 36.2000 a disagreement', () => {
    // The server stores money at four decimal places. Flagging this would put
    // a "check the docket" chip on every correctly-read total, and a chip that
    // cries wolf is a chip nobody reads.
    expect(transitionFor('header.payable_amount', { value: '36.20' }, '36.2000').kind)
      .toBe('confirmed');
  });

  it('does not call KALINDA GROCERS and Kalinda Grocers a disagreement', () => {
    // The recogniser returns what is printed; the server's document is title
    // case. Same reading, different spelling.
    expect(transitionFor('header.supplier', { value: 'KALINDA GROCERS' }, 'Kalinda Grocers').kind)
      .toBe('confirmed');
  });

  it('compares an ABN by its digits', () => {
    expect(transitionFor('header.supplier_abn', { value: '51 824 753 556' }, '51824753556').kind)
      .toBe('confirmed');
  });
});

describe('§7.1 row 2 — they disagree', () => {
  it('shows the SERVER value and names both', () => {
    const t = transitionFor('header.payable_amount', { value: '48.50' }, '46.50');
    expect(t.kind).toBe('differs');
    if (t.kind !== 'differs') return;
    // The record is the server's read. The preview was advisory throughout.
    expect(t.value).toBe('46.50');
    expect(t.previewValue).toBe('48.50');
    expect(t.copy).toBe('Preview read 48.50 · server read 46.50 — check the docket.');
  });
});

describe('§7.1 row 3 — the server found nothing', () => {
  it('turns the preview into a suggestion rather than a value', () => {
    const t = transitionFor('header.tax_amount', { value: '2.72' }, null);
    expect(t.kind).toBe('suggestion');
    if (t.kind !== 'suggestion') return;
    expect(t.suggested).toBe('2.72');
    expect(t.copy).toContain('could not confirm');
    expect(t.copy).toContain('2.72');
  });

  it("treats the server's '0.0000' as nothing found, not as zero", () => {
    // An unset money column serialises as '0.0000'. Reading that as a real
    // zero turns "no GST found" into "GST is zero" — a different and much more
    // expensive claim to make on a tax record.
    const t = transitionFor('header.tax_amount', { value: '2.72' }, '0.0000');
    expect(t.kind).toBe('suggestion');
  });

  it('also treats an empty string as nothing found', () => {
    expect(transitionFor('header.issue_date', { value: '2026-08-22' }, '').kind).toBe('suggestion');
  });
});

describe('§7.1 row 4 — only the server read it', () => {
  it('shows the value with no provisional history', () => {
    const t = transitionFor('header.supplier', undefined, 'Kalinda Grocers');
    expect(t).toEqual({ kind: 'server-only', value: 'Kalinda Grocers' });
  });

  it('is also what an abstained preview produces', () => {
    const t = transitionFor('header.tax_amount', { value: null, grounded: false }, '2.72');
    expect(t).toEqual({ kind: 'server-only', value: '2.72' });
  });
});

describe('neither read it', () => {
  it('says nothing at all', () => {
    expect(transitionFor('header.tax_amount', { value: null }, null)).toEqual({ kind: 'absent' });
    expect(transitionFor('header.tax_amount', undefined, '0.0000')).toEqual({ kind: 'absent' });
  });
});

describe('dates', () => {
  it('compares the ISO form, not what was printed', () => {
    // `22 / 08 / 2026` against `2026-08-22` is the same day. Comparing the
    // printed form would report a disagreement on every Australian docket.
    const t = transitionFor(
      'header.issue_date',
      { value: '22 / 08 / 2026', normalisedValue: '2026-08-22' },
      '2026-08-22',
    );
    expect(t.kind).toBe('confirmed');
  });

  it('shows the ISO form when there is one', () => {
    expect(displayValue({ value: '22 / 08 / 2026', normalisedValue: '2026-08-22' }))
      .toBe('2026-08-22');
  });

  it('falls back to the printed form when there is no ISO', () => {
    expect(displayValue({ value: 'ACME PTY LTD' })).toBe('ACME PTY LTD');
  });

  it('treats whitespace-only as nothing', () => {
    expect(displayValue({ value: '   ' })).toBeNull();
  });
});

describe('the whole screen at once', () => {
  it('reports one transition per field, including the ones nobody read', () => {
    const preview: Preview = {
      'header.payable_amount': { value: '48.50' },
      'header.tax_amount': { value: '4.41' },
      'header.supplier': { value: 'KALINDA GROCERS' },
    };
    const result = transitionsFor(preview, {
      payableAmount: '46.50',
      taxAmount: '4.4100',
      supplierName: 'Kalinda Grocers',
      issueDate: '2026-08-22',
      supplierAbn: null,
    });

    expect(result['header.payable_amount'].kind).toBe('differs');
    expect(result['header.tax_amount'].kind).toBe('confirmed');
    expect(result['header.supplier'].kind).toBe('confirmed');
    expect(result['header.issue_date'].kind).toBe('server-only');
    expect(result['header.supplier_abn'].kind).toBe('absent');
  });
});

describe('confirm-and-post', () => {
  it('has copy that states a wait, not an error', () => {
    // Offline this is a truthful state: the capture is stored, the preview is
    // on screen, and the button is waiting for signal.
    expect(CONFIRM_BLOCKED_COPY).toContain("Waiting for the server's read");
    expect(CONFIRM_BLOCKED_COPY).not.toMatch(/error|failed|cannot/i);
  });
});
