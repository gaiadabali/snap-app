import { notFound } from 'next/navigation';

import { resolveMailRoute } from '@/lib/panels/mail-routes';
import { MailRoutes } from '../MailRoutes';

export const metadata = { title: 'Mail' };

type Params = Promise<{ path?: string[] }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Every mail screen: `/app/mail`, `/app/mail/{folder}`, `/app/mail/message/{id}`,
 * `/app/mail/compose`, `/app/mail/search?q=` and `/app/mail/settings`. One optional
 * catch-all so the real route and the development preview share one URL table
 * (`lib/panels/mail-routes.ts`); an address that is not one of those answers 404.
 *
 * The gate (unavailable, unlinked, not switched on) is the layout's job, so by the time
 * this renders there is a mailbox and a mail client above it.
 */
export default async function MailPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const [{ path }, query] = await Promise.all([params, searchParams]);
  const route = resolveMailRoute(path, query);
  if (!route) notFound();
  return <MailRoutes route={route} />;
}
