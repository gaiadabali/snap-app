import type { MailStatus } from '@snap/api-contract';
import { describe, expect, it } from 'vitest';

import { gateFor, mailEntryListed } from './mail-gate';

const settings = { statements: false, workspaceId: null, alerts: true };
const status = (over: Partial<MailStatus> = {}): MailStatus => ({
  available: true,
  linked: true,
  mailbox: { state: 'on', address: 'geewizduck@yourtal.gaiada.com', quota: { limitBytes: 100, usedBytes: 1 } },
  settings,
  ...over,
});

describe('gateFor', () => {
  it('shows nothing when mail is off here', () => {
    expect(gateFor(status({ available: false, linked: false, mailbox: null }), null)).toEqual({ kind: 'unavailable' });
  });

  it('asks an account that did not sign in with YourTal to do so (status answers 200 linked:false)', () => {
    expect(gateFor(status({ linked: false, mailbox: null }), null)).toEqual({ kind: 'unlinked' });
  });

  it('keeps a teen out, whatever the server said', () => {
    expect(gateFor(status(), 'teen')).toEqual({ kind: 'notAllowed' });
    expect(gateFor(status(), 'parent').kind).toBe('on');
  });

  it('reports a refused or paused mailbox', () => {
    expect(gateFor(status({ mailbox: { state: 'not_allowed' } }), null)).toEqual({ kind: 'notAllowed' });
    expect(gateFor(status({ mailbox: { state: 'suspended', address: 'a@b.co' } }), null)).toEqual({ kind: 'suspended' });
  });

  it('offers to switch on when there is no mailbox yet', () => {
    expect(gateFor(status({ mailbox: null }), null)).toEqual({ kind: 'off' });
    expect(gateFor(status({ mailbox: { state: 'off' } }), null)).toEqual({ kind: 'off' });
    // "on" without an address is not usable: treat it as not switched on rather than showing a blank address.
    expect(gateFor(status({ mailbox: { state: 'on' } }), null)).toEqual({ kind: 'off' });
  });

  it('opens the mailbox with its address, quota and settings', () => {
    expect(gateFor(status(), null)).toEqual({
      kind: 'on',
      address: 'geewizduck@yourtal.gaiada.com',
      quota: { limitBytes: 100, usedBytes: 1 },
      settings,
    });
    const noQuota = gateFor(status({ mailbox: { state: 'on', address: 'a@b.co' } }), null);
    expect(noQuota).toEqual({ kind: 'on', address: 'a@b.co', settings });
    expect('quota' in noQuota).toBe(false);
  });
});

describe('mailEntryListed', () => {
  it('lists Mail for a mailbox, a switch-on, a pause and an unlinked account', () => {
    expect(mailEntryListed(status(), null)).toBe(true);
    expect(mailEntryListed(status({ mailbox: null }), null)).toBe(true);
    expect(mailEntryListed(status({ mailbox: { state: 'suspended' } }), null)).toBe(true);
    expect(mailEntryListed(status({ linked: false, mailbox: null }), null)).toBe(true);
  });

  it('hides it while loading, when off, for a teen and for a refused account', () => {
    expect(mailEntryListed(null, null)).toBe(false);
    expect(mailEntryListed(status({ available: false }), null)).toBe(false);
    expect(mailEntryListed(status(), 'teen')).toBe(false);
    expect(mailEntryListed(status({ mailbox: { state: 'not_allowed' } }), null)).toBe(false);
  });
});
