import type { MailStatementImport } from '@snap/api-contract';

/**
 * What the "Imported from Spambank" list says about one mailed file
 * (`GET /v1/mail/imports`, Spambank T12): a short status and one plain sentence.
 * The reasons are `MailStatementImportReason` in `@snap/api-contract`; one this
 * screen does not know gets the general sentence for its status.
 */
export type ImportLine = { label: string; tone: 'good' | 'neutral' | 'warn' | 'risk'; sentence: string };

const SKIPPED: Record<string, string> = {
  no_workspace: 'No workspace was chosen to import into.',
  not_workspace_admin: 'You no longer own or administer the chosen workspace.',
  unsupported_type: 'Only PDF and CSV files are imported.',
  too_large: 'The file is larger than 10 MB.',
  password_protected: 'The PDF is password-protected. Download it from the email and upload it in SnapApps.',
  too_many_pages: 'The PDF has more than 40 pages.',
  not_a_statement: 'The PDF does not look like a bank or card statement.',
  no_credits: 'You were out of scan credits. A PDF statement uses one credit.',
  daily_limit: 'The workspace had reached its daily limit for reading documents.',
  teen_space_unfunded: 'The workspace cannot pay for scans right now.',
  not_allowed: 'Mail is not available for this account any more.',
  no_account: 'There was no SnapApps account to import into.',
};

const FAILED: Record<string, string> = {
  unreadable_pdf: 'The PDF could not be opened.',
  not_a_pdf: 'The file says it is a PDF but is not one.',
  empty: 'The file was empty.',
  not_offered: 'The email or file is no longer in your mailbox.',
};

export function importLine(item: Pick<MailStatementImport, 'status' | 'reason' | 'message' | 'documentId'>): ImportLine {
  const reason = item.reason ?? '';
  switch (item.status) {
    case 'pending':
      return { label: 'Importing', tone: 'neutral', sentence: 'SnapApps is importing this file.' };
    case 'imported':
      if (reason === 'waiting_for_credits') {
        return { label: 'Waiting', tone: 'warn', sentence: 'Saved. It will be read once you have scan credits again.' };
      }
      if (reason === 'queued' && !item.documentId) {
        return { label: 'Reading', tone: 'neutral', sentence: 'Saved and being read. This takes a minute or two.' };
      }
      return { label: 'Imported', tone: 'good', sentence: 'Added to your statements.' };
    case 'duplicate':
      return { label: 'Already there', tone: 'neutral', sentence: 'This file was already in the workspace, so nothing new was added.' };
    case 'skipped':
      return { label: 'Not imported', tone: 'warn', sentence: SKIPPED[reason] ?? 'This file was not imported.' };
    case 'failed':
      if (reason === 'csv_unreadable') {
        return {
          label: 'Could not import',
          tone: 'risk',
          sentence: item.message ? `The CSV could not be read. ${item.message}` : 'The CSV could not be read.',
        };
      }
      return { label: 'Could not import', tone: 'risk', sentence: FAILED[reason] ?? 'Something went wrong importing this file.' };
  }
}
