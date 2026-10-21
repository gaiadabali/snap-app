'use server';

import { redirect } from 'next/navigation';
import type { AuthUser } from '@snap/api-contract';

import { ApiError, api } from '@/lib/api/server';

import { apiErrorCode } from './auth-errors';
import { setSessionCookie } from './session';

type SignInResult = {
  token: string;
  user: AuthUser;
  workspaces: Array<{ id: string; name: string; kind: string; role: string }>;
};

/**
 * The website's half of password reset and email verification (task 1.2).
 *
 * The emails link here because a link has to land somewhere a person can
 * type a new password, and a phone opens it in its browser. Every check —
 * single use, expiry, the limits — is the API's; these only carry the form
 * across and turn the answer into a page.
 */

function to(path: string, params: Record<string, string>): never {
  const url = new URL(path, 'http://placeholder');
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  redirect(`${url.pathname}${url.search}`);
}

/**
 * Ask for a reset link. Lands on the same "check your email" page whether or
 * not the address has an account — the API answers the same either way, and
 * so must this. Only a rate limit is reported, and it too is the same for
 * every address.
 */
export async function requestPasswordResetAction(formData: FormData): Promise<void> {
  const email = String(formData.get('email') ?? '').trim();
  if (!email) to('/forgot-password', { error: 'email_required' });

  try {
    await api('/v1/auth/password/reset/request', { method: 'POST', body: { email }, anonymous: true });
  } catch (error) {
    if (error instanceof ApiError && error.status === 429) {
      to('/forgot-password', { error: 'rate_limited' });
    }
    // Anything else is swallowed: see the doc comment.
  }
  to('/forgot-password', { sent: '1' });
}

/** Set the new password with the link's token, then sign in on this browser. */
export async function confirmPasswordResetAction(formData: FormData): Promise<void> {
  const token = String(formData.get('token') ?? '');
  const newPassword = String(formData.get('newPassword') ?? '');
  const confirm = String(formData.get('confirmPassword') ?? '');

  if (!token) to('/forgot-password', { error: 'link_invalid' });
  if (newPassword !== confirm) {
    to('/reset-password', { token, error: 'passwords_mismatch' });
  }

  let result: SignInResult;
  try {
    result = await api<SignInResult>('/v1/auth/password/reset/confirm', {
      method: 'POST',
      body: { token, newPassword },
      anonymous: true,
    });
  } catch (error) {
    // A dead link sends the person to ask for a new one; a weak password
    // keeps them on the form with the same (still unspent) link.
    if (error instanceof ApiError && error.status === 401) to('/forgot-password', { error: 'link_invalid' });
    to('/reset-password', {
      token,
      error: error instanceof ApiError && error.status === 400 ? 'password_rejected' : apiErrorCode(error, 'reset_failed'),
    });
  }

  await setSessionCookie(result.token);
  to(result.workspaces.length === 0 ? '/onboarding' : '/app', {});
}

/** Confirm an email address with the link's token. Needs no session. */
export async function confirmEmailAction(formData: FormData): Promise<void> {
  const token = String(formData.get('token') ?? '');
  if (!token) to('/verify-email', { error: 'link_invalid' });

  try {
    await api('/v1/auth/email/verification/confirm', {
      method: 'POST',
      body: { token },
      anonymous: true,
    });
  } catch (error) {
    to('/verify-email', { error: apiErrorCode(error, 'verify_failed') });
  }
  to('/verify-email', { done: '1' });
}
