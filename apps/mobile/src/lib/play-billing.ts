import type { Purchase } from 'expo-iap';

import { api, type CreditPurchase } from '@/api';

/**
 * Buying credits through Google Play, in the Play build only (group plan
 * 8.3.b, founder ruling 0.12.b). Play rejects an app that takes money through
 * its own checkout, so the Play build never opens the web checkout.
 *
 * The Play product id IS the pack code (`credits_50`, `credits_100`,
 * `credits_250`): set up the products in Play Console under those ids.
 *
 * The phone grants nothing. It hands Play's purchase token to the server,
 * which asks Google about it, grants the pack once and consumes the purchase.
 * Play refunds a purchase nobody consumes within three days, so a purchase the
 * server never confirmed costs the buyer nothing in the end.
 *
 * `expo-iap` is loaded lazily, so web and the sideloaded builds never touch
 * the native billing module.
 */

type Iap = typeof import('expo-iap');

let connected: Promise<Iap> | null = null;

function billing(): Promise<Iap> {
  connected ??= import('expo-iap')
    .then(async (iap) => {
      await iap.initConnection();
      return iap;
    })
    .catch((error: unknown) => {
      connected = null;
      throw error;
    });
  return connected;
}

/** Play's own price for each pack it sells, by pack code. Empty when Play cannot be reached. */
export async function playPrices(codes: string[]): Promise<Record<string, string>> {
  if (codes.length === 0) return {};
  try {
    const iap = await billing();
    const products = (await iap.fetchProducts({ skus: codes, type: 'in-app' })) ?? [];
    return Object.fromEntries(
      (products as { id: string; displayPrice: string }[]).map((p) => [p.id, p.displayPrice]),
    );
  } catch {
    return {};
  }
}

/**
 * Hands the server any pack bought but not yet confirmed (the app closed
 * mid-purchase, or the network dropped). Safe to repeat: the server grants
 * each token once. Only purchases made for this workspace: another's would
 * be refused here, and is confirmed when that workspace is open. Best
 * effort; returns how many it confirmed.
 */
export async function confirmUnfinishedPlayPurchases(workspaceId: string): Promise<number> {
  let confirmed = 0;
  try {
    const iap = await billing();
    for (const p of await iap.getAvailablePurchases()) {
      if (!p.productId.startsWith('credits_') || p.purchaseState !== 'purchased' || !p.purchaseToken) continue;
      if ('obfuscatedAccountIdAndroid' in p && p.obfuscatedAccountIdAndroid !== workspaceId) continue;
      try {
        await api().redeemGooglePlayPurchase(p.productId, p.purchaseToken);
        confirmed += 1;
      } catch {
        /* Left for the next visit; Play refunds it if it is never confirmed. */
      }
    }
  } catch {
    /* Play unreachable: nothing to do now. */
  }
  return confirmed;
}

export type PlayOutcome =
  | { kind: 'paid'; purchase: CreditPurchase }
  | { kind: 'pending' }
  | { kind: 'cancelled' };

/**
 * Opens Play's billing sheet for one pack and confirms the result with the
 * server. `ids` tie the purchase to this workspace and person; the server
 * refuses a token bought for anyone else.
 */
export async function buyOnPlay(
  packCode: string,
  ids: { workspaceId: string; userId: string },
): Promise<PlayOutcome> {
  const iap = await billing();
  // An earlier purchase of the same pack left unconfirmed would make Play
  // answer "already owned".
  await confirmUnfinishedPlayPurchases(ids.workspaceId);

  const products = (await iap.fetchProducts({ skus: [packCode], type: 'in-app' })) ?? [];
  if (products.length === 0) {
    throw new Error('This pack is not on sale in Google Play right now. Nothing was charged.');
  }

  let purchase: Purchase;
  try {
    purchase = await new Promise<Purchase>((resolve, reject) => {
      const done = iap.purchaseUpdatedListener((p) => {
        if (p.productId !== packCode) return;
        stop();
        resolve(p);
      });
      const failed = iap.purchaseErrorListener((e) => {
        stop();
        reject(e);
      });
      function stop() {
        done.remove();
        failed.remove();
      }
      iap
        .requestPurchase({
          type: 'in-app',
          request: {
            google: {
              skus: [packCode],
              obfuscatedAccountId: ids.workspaceId,
              obfuscatedProfileId: ids.userId,
            },
          },
        })
        .catch((e: unknown) => {
          stop();
          reject(e);
        });
    });
  } catch (error) {
    if (iap.isUserCancelledError(error)) return { kind: 'cancelled' };
    if ((error as { code?: string } | null)?.code === iap.ErrorCode.AlreadyOwned) {
      throw new Error(
        'Google Play says you already have this pack, still waiting to be added. Open Credits in the workspace you bought it for; if it is never added, Google Play refunds it within three days.',
      );
    }
    throw error;
  }

  // Cash and some cards settle later; Play delivers the purchase again then,
  // and the next visit to Credits confirms it.
  if (purchase.purchaseState === 'pending' || !purchase.purchaseToken) return { kind: 'pending' };
  try {
    return { kind: 'paid', purchase: await api().redeemGooglePlayPurchase(packCode, purchase.purchaseToken) };
  } catch {
    // Paid but not confirmed yet: the Credits screen retries, and Play
    // refunds it if the server never confirms. Never "nothing was charged".
    return { kind: 'pending' };
  }
}
