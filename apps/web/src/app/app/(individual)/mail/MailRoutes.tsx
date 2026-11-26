'use client';

import type { MailRoute } from '@/lib/panels/mail-routes';
import { Compose } from './Compose';
import { MailSettingsView } from './MailSettings';
import { MessageList } from './MessageList';
import { Reader } from './Reader';

/** Which screen a resolved URL shows. The real route and the dev preview both render this. */
export function MailRoutes({ route }: { route: MailRoute }) {
  switch (route.view) {
    case 'folder':
      return <MessageList folder={route.folder} />;
    case 'search':
      return <MessageList search={route.q} />;
    case 'message':
      return <Reader id={route.id} />;
    case 'compose':
      return <Compose mode={route.mode} id={route.id} />;
    case 'settings':
      return <MailSettingsView />;
  }
}
