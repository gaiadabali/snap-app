import { IFRAME_SANDBOX } from '@snap/mail-engine';
import { View } from 'react-native';

import { usePalette } from '@/theme';
import { PlainBody, type MessageBodyProps } from './MessageText';

/**
 * A message body in the browser build (the PWA). Plain text is Text. HTML is the engine's
 * sandbox document in an iframe whose `sandbox` is exactly `IFRAME_SANDBOX`: there is no
 * `allow-scripts`, so nothing in a mail can run, and `allow-same-origin` only keeps the
 * frame's own origin readable by the page (which it never touches). `referrerPolicy` stops a
 * followed link from telling the next site which page it came from. Links open in a new tab
 * (`allow-popups`, with `target="_blank"` already set by the server's sanitiser).
 *
 * The frame fills the space it is given and scrolls by itself, like the phone's WebView.
 */
export function MessageBody({ doc, text, title }: MessageBodyProps) {
  const p = usePalette();
  if (doc === null) return <PlainBody text={text} />;
  return (
    <View style={{ flex: 1, backgroundColor: p.ground }}>
      <iframe
        title={title}
        sandbox={IFRAME_SANDBOX}
        referrerPolicy="no-referrer"
        srcDoc={doc}
        data-testid="mail-html-frame"
        style={{ border: 0, width: '100%', height: '100%', flex: 1, background: 'transparent' }}
      />
    </View>
  );
}
