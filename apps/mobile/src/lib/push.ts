import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { api } from '@/api';

import { MAIL_HREF } from './mail-routes';

/**
 * New-mail notifications on Android (spambank/BUILD.md §4.9, B9).
 *
 * The SnapApp server sends a Firebase Cloud Messaging notification, "You have N new emails"
 * with no sender or subject, to every token this phone registered. This file is the phone's
 * half:
 *
 *   - the `mail` notification channel, created before the permission prompt (Android 13
 *     shows the prompt only once a channel exists);
 *   - the permission, asked for only when the person opens Mail or turns alerts on, never
 *     at launch;
 *   - the Firebase token (`getDevicePushTokenAsync`, the FCM token itself: no Expo account
 *     or Expo push service is involved), registered with `POST /v1/devices/push-token` and
 *     remembered on the phone so it can be withdrawn on sign-out or when alerts go off;
 *   - a tap on the notification opens Mail.
 *
 * NO FIREBASE IN THE BUILD. An APK built without `google-services.json` (apps/mobile/
 * google-services.cjs) has no Firebase app, and `getDevicePushTokenAsync` throws. That is
 * "alerts unavailable in this build", not an error: nothing is registered, the Mail
 * screens work as always, and settings says so.
 *
 * Only Android: the website build and (until Phase 11) iOS have no alerts. Every export
 * is safe to call anywhere and does nothing off Android.
 */

export const MAIL_CHANNEL_ID = 'mail';
/** The FCM `data.type` the server sets on a new-mail notification (`apps/server/src/push`). */
export const MAIL_NOTIFICATION_TYPE = 'spambank-mail';
export const PUSH_TOKEN_KEY = 'snap.push.token';
/** Set once the permission dialog has been offered from opening Mail, so opening Mail never nags. */
export const PUSH_PROMPTED_KEY = 'snap.push.prompted';

export type AlertsOutcome =
  /** Registered: alerts will arrive. */
  | 'on'
  /** The person said no to notifications, or this phone has them off for SnapApp. */
  | 'denied'
  /** This build carries no Firebase config (or Google Play services is missing): alerts cannot work here. */
  | 'unavailable'
  /** Not an Android phone. */
  | 'unsupported'
  /** The server did not take the token (offline, or it refused): try again later. */
  | 'failed';

const isAndroid = (): boolean => Platform.OS === 'android';

async function rememberedToken(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(PUSH_TOKEN_KEY);
  } catch {
    return null;
  }
}

async function remember(token: string | null): Promise<void> {
  try {
    if (token === null) await AsyncStorage.removeItem(PUSH_TOKEN_KEY);
    else await AsyncStorage.setItem(PUSH_TOKEN_KEY, token);
  } catch {
    // A token that is not remembered is registered again next time; nothing is lost.
  }
}

/** The Firebase token, or `null` when this build or phone cannot have one. */
async function deviceToken(): Promise<string | null> {
  try {
    const t = await Notifications.getDevicePushTokenAsync();
    return typeof t.data === 'string' && t.data !== '' ? t.data : null;
  } catch {
    return null;
  }
}

async function ensureChannel(): Promise<void> {
  await Notifications.setNotificationChannelAsync(MAIL_CHANNEL_ID, {
    name: 'New mail',
    description: 'A short note when mail arrives in your Spambank inbox. It never says who it is from.',
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

/**
 * Turns alerts on for this phone: channel, permission (asked only when `prompt`), token,
 * registration. Safe to repeat.
 */
export async function enableMailAlerts(opts: { prompt: boolean }): Promise<AlertsOutcome> {
  if (!isAndroid()) return 'unsupported';
  try {
    await ensureChannel();
    let perm = await Notifications.getPermissionsAsync();
    if (!perm.granted) {
      if (!opts.prompt || !perm.canAskAgain) return 'denied';
      perm = await Notifications.requestPermissionsAsync();
      if (!perm.granted) return 'denied';
    }
  } catch {
    return 'unavailable';
  }
  const token = await deviceToken();
  if (token === null) return 'unavailable';
  const before = await rememberedToken();
  try {
    await api().registerPushToken(token);
  } catch {
    return 'failed';
  }
  await remember(token);
  // Firebase rotated the token: the old one is dead weight on the server.
  if (before && before !== token) await api().unregisterPushToken(before).catch(() => undefined);
  return 'on';
}

/**
 * Opening Mail with alerts on: offers the permission dialog the FIRST time only, then just
 * keeps the registration fresh. A person who said no is not asked again on every visit; the
 * switch in Mail settings (`enableMailAlerts({ prompt: true })`) is where they change their mind.
 */
export async function enableMailAlertsOnOpen(): Promise<AlertsOutcome> {
  if (!isAndroid()) return 'unsupported';
  let asked = false;
  try {
    asked = (await AsyncStorage.getItem(PUSH_PROMPTED_KEY)) === '1';
  } catch {
    // Unreadable storage reads as "not asked yet": one more dialog is the safe error.
  }
  const outcome = await enableMailAlerts({ prompt: !asked });
  if (!asked && outcome !== 'unavailable') {
    try {
      await AsyncStorage.setItem(PUSH_PROMPTED_KEY, '1');
    } catch {
      // Asked again next time at worst.
    }
  }
  return outcome;
}

/**
 * Withdraws this phone's token (sign-out, or alerts turned off). Best effort: a failure is
 * swallowed because the server also drops a token FCM reports as gone, and sign-out must
 * never be held up by a notification.
 */
export async function disableMailAlerts(): Promise<void> {
  if (!isAndroid()) return;
  const token = await rememberedToken();
  if (token === null) return;
  try {
    await api().unregisterPushToken(token);
  } catch {
    // Kept for another try: forgetting it would leave a token on the server for good.
    return;
  }
  await remember(null);
}

/**
 * At launch: when this phone registered before, check Firebase still has the same token
 * (it can change after a reinstall or a long idle) and tell the server if not. Never asks
 * for permission and never registers a phone that never opted in.
 */
export async function refreshMailAlertsToken(): Promise<void> {
  if (!isAndroid()) return;
  if ((await rememberedToken()) === null) return;
  await enableMailAlerts({ prompt: false });
}

/** Is this notification data a new-mail alert? Anything else is not ours to open. */
export function isMailNotification(data: unknown): boolean {
  return typeof data === 'object' && data !== null && (data as Record<string, unknown>)['type'] === MAIL_NOTIFICATION_TYPE;
}

/** Where a tapped notification goes: Mail for ours, nowhere for anything else. */
export function destinationFor(response: Notifications.NotificationResponse | null | undefined): string | null {
  const data = response?.notification.request.content.data;
  return isMailNotification(data) ? MAIL_HREF : null;
}

/**
 * Shows a new-mail alert while the app is open too. `shouldPlaySound` is true because on
 * Android a notification with no sound is not shown as a banner at all.
 */
export function installNotificationHandler(): void {
  if (!isAndroid()) return;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

/**
 * Listens for the things that happen to notifications while the app runs, and returns the
 * function that stops listening: a tap (opens Mail), and Firebase rotating the token.
 * `open` is called with the href to go to. A tap that launched the app from closed is
 * delivered once, then cleared so the next launch does not repeat it.
 */
export function listenForMailAlerts(open: (href: string) => void): () => void {
  if (!isAndroid()) return () => undefined;
  installNotificationHandler();

  const tapped = Notifications.addNotificationResponseReceivedListener((response) => {
    const href = destinationFor(response);
    if (href) open(href);
  });
  const rotated = Notifications.addPushTokenListener(() => {
    void refreshMailAlertsToken();
  });

  void Notifications.getLastNotificationResponseAsync()
    .then((response) => {
      const href = destinationFor(response);
      if (href) {
        open(href);
        return Notifications.clearLastNotificationResponseAsync();
      }
      return undefined;
    })
    .catch(() => undefined);
  void refreshMailAlertsToken().catch(() => undefined);

  return () => {
    tapped.remove();
    rotated.remove();
  };
}
