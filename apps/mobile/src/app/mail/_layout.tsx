import { Stack } from 'expo-router';
import { useEffect } from 'react';

import { MailGate } from '@/components/mail/MailGate';
import { useMailAccount } from '@/components/mail/MailRoot';
import { enableMailAlertsOnOpen } from '@/lib/push';
import { usePalette } from '@/theme';

/**
 * Opening Mail with alerts on registers this phone for new-mail notifications. It is the one
 * place the permission dialog is offered from (the first time only, never at launch); a "no" is
 * shown on the settings screen, where the person can change their mind. It does not block Mail.
 */
function AlertsOnOpen() {
  const { settings } = useMailAccount();
  useEffect(() => {
    if (settings.alerts) void enableMailAlertsOnOpen().catch(() => undefined);
  }, [settings.alerts]);
  return null;
}

/**
 * Every Mail screen sits behind the gate (`MailGate`: not offered, not linked, no mailbox
 * yet, paused) and shares one mail client. The screens draw their own headers.
 */
export default function MailLayout() {
  const p = usePalette();
  return (
    <MailGate>
      <AlertsOnOpen />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: p.ground } }} />
    </MailGate>
  );
}
