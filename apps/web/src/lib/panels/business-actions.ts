'use server';

import { revalidatePath } from 'next/cache';

import { api, ApiError, newIdempotencyKey } from '@/lib/api/server';
import type { ActionResult } from './actions';

const DECIMAL = /^\d+(\.\d{1,4})?$/;

/* ── Bills ─────────────────────────────────────────────────────────────── */

export async function payBill(
  workspaceId: string,
  path: string,
  billId: string,
  amount: string | undefined,
): Promise<ActionResult> {
  if (amount !== undefined && amount !== '' && !DECIMAL.test(amount)) {
    return { ok: false, message: 'Enter a plain number, e.g. 250 or 250.00.' };
  }
  try {
    await api(`/v1/bills/${billId}/pay`, {
      method: 'POST',
      body: amount ? { amount } : {},
      workspaceId,
      idempotencyKey: newIdempotencyKey(),
    });
  } catch (error) {
    return { ok: false, message: error instanceof ApiError ? error.message : 'Could not pay that bill.' };
  }
  revalidatePath(path);
  return { ok: true };
}

/* ── Invoices & payments ──────────────────────────────────────────────── */

export async function recordPayment(
  workspaceId: string,
  path: string,
  invoiceId: string,
  amount: string,
  method: 'bank' | 'card' | 'cash' | 'other',
  reference: string,
): Promise<ActionResult> {
  if (!DECIMAL.test(amount)) return { ok: false, message: 'Enter a plain number for the amount received.' };
  try {
    await api('/v1/payments', {
      method: 'POST',
      body: { invoiceId, amount, method, reference: reference || undefined },
      workspaceId,
      idempotencyKey: newIdempotencyKey(),
    });
  } catch (error) {
    return { ok: false, message: error instanceof ApiError ? error.message : 'Could not record that payment.' };
  }
  revalidatePath(path);
  return { ok: true };
}

export async function convertEstimate(workspaceId: string, path: string, estimateId: string): Promise<ActionResult> {
  try {
    await api(`/v1/invoices/${estimateId}/convert`, {
      method: 'POST',
      body: {},
      workspaceId,
      idempotencyKey: newIdempotencyKey(),
    });
  } catch (error) {
    return { ok: false, message: error instanceof ApiError ? error.message : 'Could not convert that estimate.' };
  }
  revalidatePath(path);
  return { ok: true };
}

/* ── Stock ─────────────────────────────────────────────────────────────── */

export async function createItem(
  workspaceId: string,
  path: string,
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const name = String(formData.get('name') ?? '').trim();
  const unit = String(formData.get('unit') ?? '').trim() || 'ea';
  const sellPrice = String(formData.get('sellPrice') ?? '').trim();
  const costPrice = String(formData.get('costPrice') ?? '').trim();
  const sku = String(formData.get('sku') ?? '').trim();
  const stockRaw = String(formData.get('stockOnHand') ?? '').trim();
  if (name === '') return { ok: false, message: 'Give it a name.' };
  if (!DECIMAL.test(sellPrice) || !DECIMAL.test(costPrice)) {
    return { ok: false, message: 'Sell price and cost price must both be plain numbers.' };
  }
  try {
    await api('/v1/items', {
      method: 'POST',
      body: {
        name,
        sku: sku || undefined,
        unit,
        sellPrice,
        costPrice,
        stockOnHand: stockRaw === '' ? undefined : Number(stockRaw),
      },
      workspaceId,
      idempotencyKey: newIdempotencyKey(),
    });
  } catch (error) {
    return { ok: false, message: error instanceof ApiError ? error.message : 'Could not add that item.' };
  }
  revalidatePath(path);
  return { ok: true };
}

export async function countStock(
  workspaceId: string,
  path: string,
  itemId: string,
  countedQuantity: number,
): Promise<ActionResult> {
  try {
    await api(`/v1/items/${itemId}/count`, {
      method: 'POST',
      body: { countedQuantity },
      workspaceId,
      idempotencyKey: newIdempotencyKey(),
    });
  } catch (error) {
    return { ok: false, message: error instanceof ApiError ? error.message : 'Could not record that count.' };
  }
  revalidatePath(path);
  return { ok: true };
}
