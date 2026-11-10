'use server';

import { revalidatePath } from 'next/cache';
import type { InvoiceIssuerProposalRequest } from '@snap/api-contract';

import { newIdempotencyKey } from '@/lib/api/server';

import { decideInvoiceIssuer, proposeInvoiceIssuer } from '../../_data/governance';

const PATH = '/admin/invoicing';

/** Propose a new issuer. It takes effect only when a DIFFERENT admin approves it. */
export async function proposeIssuerAction(input: InvoiceIssuerProposalRequest): Promise<void> {
  await proposeInvoiceIssuer(input, newIdempotencyKey());
  revalidatePath(PATH);
}

/** Approve (not your own proposal: the server answers 403) or reject (withdraws your own). */
export async function decideIssuerAction(id: string, approve: boolean): Promise<void> {
  await decideInvoiceIssuer(id, approve, newIdempotencyKey());
  revalidatePath(PATH);
}
