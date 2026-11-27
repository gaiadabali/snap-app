import { View } from 'react-native';
import { WebView } from 'react-native-webview';

import { SANDBOX_BASE_URL, SANDBOX_WEBVIEW_PROPS, decideNavigation } from '@/lib/mail-webview';
import { usePalette } from '@/theme';
import { PlainBody, openOutside, type MessageBodyProps } from './MessageText';

/**
 * A message body on a phone. Plain text is Text (markup in it is only characters). HTML is
 * the engine's sandbox document in a WebView with JavaScript OFF, no storage and no way to
 * navigate: a tapped link is cancelled here and opened in the phone's browser or mail app
 * (`lib/mail-webview.ts` has the settings and the rule, and the tests).
 *
 * The WebView fills the space it is given and scrolls by itself: with JavaScript off the page
 * cannot report its height, so there is no auto-sizing to do.
 */
export function MessageBody({ doc, text, title }: MessageBodyProps) {
  const p = usePalette();
  if (doc === null) return <PlainBody text={text} />;
  return (
    <View style={{ flex: 1, backgroundColor: p.ground }}>
      <WebView
        {...SANDBOX_WEBVIEW_PROPS}
        accessibilityLabel={title}
        source={{ html: doc, baseUrl: SANDBOX_BASE_URL }}
        style={{ flex: 1, backgroundColor: 'transparent' }}
        onShouldStartLoadWithRequest={(request) => {
          const decision = decideNavigation(request.url);
          if (decision.openOutside) openOutside(decision.openOutside);
          return decision.allow;
        }}
        onOpenWindow={(event) => {
          // A link that asked for a new window: the same rule, and the window is never made.
          const decision = decideNavigation(event.nativeEvent.targetUrl);
          if (decision.openOutside) openOutside(decision.openOutside);
        }}
      />
    </View>
  );
}
