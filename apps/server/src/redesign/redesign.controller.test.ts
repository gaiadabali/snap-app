import { BadRequestException } from '@nestjs/common';
import { beforeAll, describe, expect, it } from 'vitest';

import type { AuthUser } from '../common/auth.guard.js';

/**
 * The preference PATCH endpoints store what the client sends, so what they
 * accept is the whole control: known keys only, right types only.
 * The controller is called directly — the guard is not what is under test.
 */
let ctl: InstanceType<typeof import('./redesign.controller.js').MePreferencesController>;

// A fresh user per test: the controller's state is a process-wide Map.
let n = 0;
const newUser = (): AuthUser => ({ userId: `prefs-user-${++n}` }) as AuthUser;

beforeAll(async () => {
  process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/test';
  process.env.TOKEN_SECRET ??= 'test-only-secret-at-least-32-characters-long';
  process.env.WEB_PUBLIC_URL ??= 'http://127.0.0.1:3000';
  const { MePreferencesController } = await import('./redesign.controller.js');
  ctl = new MePreferencesController();
});

describe('PATCH /v1/me/notifications', () => {
  it('applies a known boolean and leaves the rest alone', () => {
    const u = newUser();
    const next = ctl.setNotifications(u, { productNews: true });
    expect(next).toEqual({
      budgetTight: true,
      reviewNeeded: true,
      lowCredits: true,
      recurringDue: true,
      productNews: true,
    });
    expect(ctl.getNotifications(u).productNews).toBe(true);
  });

  it('ignores unknown keys instead of storing them', () => {
    const next = ctl.setNotifications(newUser(), { lowCredits: false, isAdmin: true });
    expect(next.lowCredits).toBe(false);
    expect(Object.keys(next).sort()).toEqual(
      ['budgetTight', 'lowCredits', 'productNews', 'recurringDue', 'reviewNeeded'],
    );
  });

  it.each([['"false"', 'false'], ['1', 1], ['null', null]])('rejects %s for a boolean key', (_l, v) => {
    expect(() => ctl.setNotifications(newUser(), { budgetTight: v })).toThrow(BadRequestException);
  });

  it.each([null, 'x', [true], 3])('rejects a body that is not an object (%j)', (b) => {
    expect(() => ctl.setNotifications(newUser(), b)).toThrow(BadRequestException);
  });

  it('stores nothing when a later key is invalid', () => {
    const u = newUser();
    expect(() => ctl.setNotifications(u, { productNews: true, lowCredits: 'no' })).toThrow(BadRequestException);
    expect(ctl.getNotifications(u).productNews).toBe(false);
  });
});

describe('PATCH /v1/me/privacy', () => {
  it('applies known keys and ignores unknown ones', () => {
    const next = ctl.setPrivacy(newUser(), { analyticsOptIn: true, role: 'admin' });
    expect(next).toEqual({
      analyticsOptIn: true,
      crashReports: false,
      contributeToModel: false,
      retentionMonths: 60,
    });
  });

  it('keeps the 60-month floor and accepts longer retention', () => {
    expect(ctl.setPrivacy(newUser(), { retentionMonths: 12 }).retentionMonths).toBe(60);
    expect(ctl.setPrivacy(newUser(), { retentionMonths: 84 }).retentionMonths).toBe(84);
  });

  it.each([['NaN', NaN], ['a string', '84'], ['a fraction', 61.5], ['Infinity', Infinity], ['null', null]])(
    'rejects %s for retentionMonths',
    (_l, v) => {
      expect(() => ctl.setPrivacy(newUser(), { retentionMonths: v })).toThrow(BadRequestException);
    },
  );

  it('rejects a non-boolean for a switch', () => {
    expect(() => ctl.setPrivacy(newUser(), { contributeToModel: 'yes' })).toThrow(BadRequestException);
  });
});
