import { Linking, ScrollView } from 'react-native';

import { linkify } from '@/lib/mail-text';
import { Text } from '@/theme/text';
import { space, type, usePalette } from '@/theme';

/**
 * What a message body component takes. `doc` is the engine's `toSandboxDocument()` output of
 * the server's sanitised HTML (a CSP meta first, remote images already stripped), or `null`
 * when the message has no HTML or the person chose plain text.
 */
export interface MessageBodyProps {
  doc: string | null;
  /** The plain-text body, shown when there is no `doc`. */
  text: string;
  /** Names the frame for a screen reader. */
  title: string;
}

/** Where a tapped link may go: a web page or a mail address, in the phone's own apps. Nothing else. */
export function isOpenableLink(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' || u.protocol === 'mailto:';
  } catch {
    return false;
  }
}

/** Opens a link OUTSIDE the app (browser, mail app). A link that is not plainly http(s) or mailto is ignored. */
export function openOutside(url: string): void {
  if (!isOpenableLink(url)) return;
  void Linking.openURL(url).catch(() => undefined);
}

/**
 * A plain-text body. It is Text, so markup in it is just characters; only http(s) links
 * become tappable, and they open in the browser, never in this app.
 */
export function PlainBody({ text }: { text: string }) {
  const p = usePalette();
  const parts = linkify(text);
  return (
    <ScrollView
      testID="mail-text-body"
      contentContainerStyle={{ padding: space.gutter, paddingBottom: space.xxl }}
      keyboardShouldPersistTaps="handled"
    >
      <Text selectable style={[type.body, { color: p.ink, lineHeight: 23 }]}>
        {parts.map((part, i) =>
          part.kind === 'link' ? (
            <Text
              key={i}
              accessibilityRole="link"
              onPress={() => openOutside(part.href)}
              style={{ color: p.accentText, textDecorationLine: 'underline' }}
            >
              {part.text}
            </Text>
          ) : (
            part.text
          ),
        )}
      </Text>
    </ScrollView>
  );
}
