import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * New-mail alerts (lib/push.ts) against a fake `expo-notifications`, a fake API and an
 * in-memory AsyncStorage: what is asked, in what order, and what is remembered. The
 * notification itself, the permission dialog and FCM are native and are checked on a phone.
 */

const platform = vi.hoisted(() => ({ OS: 'android' }));
vi.mock('react-native', () => ({ Platform: platform }));

const store = vi.hoisted(() => new Map<string, string>());
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (k: string) => store.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      store.set(k, v);
    },
    removeItem: async (k: string) => {
      store.delete(k);
    },
  },
}));

const n = vi.hoisted(() => ({
  setNotificationChannelAsync: vi.fn(async () => undefined),
  getPermissionsAsync: vi.fn(async () => ({ granted: true, canAskAgain: true })),
  requestPermissionsAsync: vi.fn(async () => ({ granted: true, canAskAgain: true })),
  getDevicePushTokenAsync: vi.fn(async () => ({ type: 'android', data: 'fcm-token-1' }) as { type: string; data: unknown }),
  setNotificationHandler: vi.fn(),
  addNotificationResponseReceivedListener: vi.fn(() => ({ remove: vi.fn() })),
  addPushTokenListener: vi.fn(() => ({ remove: vi.fn() })),
  getLastNotificationResponseAsync: vi.fn(async () => null as unknown),
  clearLastNotificationResponseAsync: vi.fn(async () => undefined),
  AndroidImportance: { DEFAULT: 3 },
}));
vi.mock('expo-notifications', () => n);

const server = vi.hoisted(() => ({
  registerPushToken: vi.fn(async (_token: string) => undefined),
  unregisterPushToken: vi.fn(async (_token: string) => undefined),
}));
vi.mock('@/api', () => ({ api: () => server }));

import {
  MAIL_CHANNEL_ID,
  PUSH_PROMPTED_KEY,
  PUSH_TOKEN_KEY,
  destinationFor,
  disableMailAlerts,
  enableMailAlerts,
  enableMailAlertsOnOpen,
  isMailNotification,
  listenForMailAlerts,
  refreshMailAlertsToken,
} from './push';

beforeEach(() => {
  store.clear();
  platform.OS = 'android';
  for (const fn of Object.values(n)) if (typeof fn === 'function' && 'mockClear' in fn) fn.mockClear();
  n.getPermissionsAsync.mockResolvedValue({ granted: true, canAskAgain: true });
  n.requestPermissionsAsync.mockResolvedValue({ granted: true, canAskAgain: true });
  n.getDevicePushTokenAsync.mockResolvedValue({ type: 'android', data: 'fcm-token-1' });
  n.getLastNotificationResponseAsync.mockResolvedValue(null);
  server.registerPushToken.mockReset().mockResolvedValue(undefined);
  server.unregisterPushToken.mockReset().mockResolvedValue(undefined);
});

describe('enableMailAlerts', () => {
  it('creates the mail channel, then registers the Firebase token and remembers it', async () => {
    expect(await enableMailAlerts({ prompt: true })).toBe('on');
    expect(n.setNotificationChannelAsync).toHaveBeenCalledWith(MAIL_CHANNEL_ID, expect.objectContaining({ name: 'New mail' }));
    expect(server.registerPushToken).toHaveBeenCalledExactlyOnceWith('fcm-token-1');
    expect(store.get(PUSH_TOKEN_KEY)).toBe('fcm-token-1');
    expect(n.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('asks for permission only when allowed to, after the channel exists', async () => {
    n.getPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: true });
    const order: string[] = [];
    n.setNotificationChannelAsync.mockImplementationOnce(async () => void order.push('channel'));
    n.requestPermissionsAsync.mockImplementationOnce(async () => {
      order.push('prompt');
      return { granted: true, canAskAgain: true };
    });
    expect(await enableMailAlerts({ prompt: true })).toBe('on');
    expect(order).toEqual(['channel', 'prompt']);
  });

  it('never prompts when told not to, and registers nothing', async () => {
    n.getPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: true });
    expect(await enableMailAlerts({ prompt: false })).toBe('denied');
    expect(n.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(server.registerPushToken).not.toHaveBeenCalled();
  });

  it('reports a refusal, and does not ask again when the phone will not show the dialog', async () => {
    n.getPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: false });
    expect(await enableMailAlerts({ prompt: true })).toBe('denied');
    expect(n.requestPermissionsAsync).not.toHaveBeenCalled();

    n.getPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: true });
    n.requestPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: false });
    expect(await enableMailAlerts({ prompt: true })).toBe('denied');
    expect(server.registerPushToken).not.toHaveBeenCalled();
  });

  it('treats a build with no Firebase as "unavailable", not as an error', async () => {
    n.getDevicePushTokenAsync.mockRejectedValue(new Error('Default FirebaseApp is not initialized'));
    expect(await enableMailAlerts({ prompt: true })).toBe('unavailable');
    expect(server.registerPushToken).not.toHaveBeenCalled();
    expect(store.size).toBe(0);
  });

  it('does not trust a token that is not a string', async () => {
    n.getDevicePushTokenAsync.mockResolvedValue({ type: 'android', data: { endpoint: 'x' } });
    expect(await enableMailAlerts({ prompt: true })).toBe('unavailable');
  });

  it('says "failed" and remembers nothing when the server will not take the token', async () => {
    server.registerPushToken.mockRejectedValue(new Error('offline'));
    expect(await enableMailAlerts({ prompt: true })).toBe('failed');
    expect(store.size).toBe(0);
  });

  it('withdraws the old token when Firebase rotated it', async () => {
    store.set(PUSH_TOKEN_KEY, 'fcm-token-0');
    expect(await enableMailAlerts({ prompt: false })).toBe('on');
    expect(server.unregisterPushToken).toHaveBeenCalledExactlyOnceWith('fcm-token-0');
    expect(store.get(PUSH_TOKEN_KEY)).toBe('fcm-token-1');
  });

  it('does nothing off Android', async () => {
    platform.OS = 'web';
    expect(await enableMailAlerts({ prompt: true })).toBe('unsupported');
    expect(n.setNotificationChannelAsync).not.toHaveBeenCalled();
    expect(server.registerPushToken).not.toHaveBeenCalled();
  });
});

describe('enableMailAlertsOnOpen', () => {
  it('offers the permission dialog the first time only', async () => {
    n.getPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: true });
    n.requestPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: true });
    expect(await enableMailAlertsOnOpen()).toBe('denied');
    expect(n.requestPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(store.get(PUSH_PROMPTED_KEY)).toBe('1');

    expect(await enableMailAlertsOnOpen()).toBe('denied');
    expect(n.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it('registers straight away when the permission is already there', async () => {
    expect(await enableMailAlertsOnOpen()).toBe('on');
    expect(n.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(server.registerPushToken).toHaveBeenCalledWith('fcm-token-1');
  });

  it('does not use up the one offer on a build that cannot have alerts', async () => {
    n.getDevicePushTokenAsync.mockRejectedValue(new Error('no firebase'));
    expect(await enableMailAlertsOnOpen()).toBe('unavailable');
    expect(store.has(PUSH_PROMPTED_KEY)).toBe(false);
  });

  it('does nothing off Android', async () => {
    platform.OS = 'web';
    expect(await enableMailAlertsOnOpen()).toBe('unsupported');
  });
});

describe('disableMailAlerts', () => {
  it('withdraws the remembered token and forgets it', async () => {
    store.set(PUSH_TOKEN_KEY, 'fcm-token-1');
    await disableMailAlerts();
    expect(server.unregisterPushToken).toHaveBeenCalledExactlyOnceWith('fcm-token-1');
    expect(store.has(PUSH_TOKEN_KEY)).toBe(false);
  });

  it('keeps the token for another try when the server cannot be reached, and never throws', async () => {
    store.set(PUSH_TOKEN_KEY, 'fcm-token-1');
    server.unregisterPushToken.mockRejectedValue(new Error('offline'));
    await expect(disableMailAlerts()).resolves.toBeUndefined();
    expect(store.get(PUSH_TOKEN_KEY)).toBe('fcm-token-1');
  });

  it('does nothing for a phone that never registered', async () => {
    await disableMailAlerts();
    expect(server.unregisterPushToken).not.toHaveBeenCalled();
  });
});

describe('refreshMailAlertsToken', () => {
  it('leaves a phone that never opted in alone', async () => {
    await refreshMailAlertsToken();
    expect(n.getDevicePushTokenAsync).not.toHaveBeenCalled();
    expect(server.registerPushToken).not.toHaveBeenCalled();
  });

  it('re-registers a phone that did, without prompting', async () => {
    store.set(PUSH_TOKEN_KEY, 'fcm-token-1');
    n.getPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: true });
    await refreshMailAlertsToken();
    expect(n.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(server.registerPushToken).not.toHaveBeenCalled();
  });
});

describe('tapping a notification', () => {
  const response = (data: unknown) => ({ notification: { request: { content: { data } } } }) as never;

  it('opens Mail for a new-mail alert and nothing else', () => {
    expect(isMailNotification({ type: 'spambank-mail' })).toBe(true);
    expect(isMailNotification({ type: 'something-else' })).toBe(false);
    expect(isMailNotification(null)).toBe(false);
    expect(isMailNotification('spambank-mail')).toBe(false);
    expect(destinationFor(response({ type: 'spambank-mail' }))).toBe('/mail');
    expect(destinationFor(response({ type: 'promo', url: 'https://evil.example' }))).toBeNull();
    expect(destinationFor(null)).toBeNull();
  });

  it('opens Mail when the app was launched by the tap, once', async () => {
    n.getLastNotificationResponseAsync.mockResolvedValue(response({ type: 'spambank-mail' }));
    const open = vi.fn();
    const stop = listenForMailAlerts(open);
    await vi.waitFor(() => expect(open).toHaveBeenCalledExactlyOnceWith('/mail'));
    await vi.waitFor(() => expect(n.clearLastNotificationResponseAsync).toHaveBeenCalledTimes(1));
    stop();
  });

  it('opens Mail on a tap while running, and stops listening when told', () => {
    const remove = vi.fn();
    let onTap: (r: unknown) => void = () => undefined;
    n.addNotificationResponseReceivedListener.mockImplementation(((fn: (r: unknown) => void) => {
      onTap = fn;
      return { remove };
    }) as never);
    const open = vi.fn();
    const stop = listenForMailAlerts(open);
    onTap(response({ type: 'spambank-mail' }));
    onTap(response({ type: 'other' }));
    expect(open).toHaveBeenCalledExactlyOnceWith('/mail');
    stop();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('listens to nothing off Android', () => {
    platform.OS = 'web';
    const stop = listenForMailAlerts(vi.fn());
    expect(n.addNotificationResponseReceivedListener).not.toHaveBeenCalled();
    stop();
  });
});
