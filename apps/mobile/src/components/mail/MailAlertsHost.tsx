import { useRouter } from 'expo-router';
import { useEffect } from 'react';

import { listenForMailAlerts } from '@/lib/push';

/**
 * Listens for the things that happen to a new-mail notification while the app runs: a tap
 * opens Mail (also when the tap is what launched the app), and a rotated Firebase token is
 * registered again. It renders nothing and asks the person nothing: the permission is asked
 * for in Mail itself (`app/mail/_layout.tsx`), never at launch. Off Android it does nothing.
 */
export function MailAlertsHost() {
  const router = useRouter();
  useEffect(() => listenForMailAlerts((href) => router.push(href as never)), [router]);
  return null;
}
