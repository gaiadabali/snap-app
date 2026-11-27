import * as Clipboard from 'expo-clipboard';
import { useEffect, useState } from 'react';
import { Pressable } from 'react-native';

import { Icon } from '@/components/Icon';
import { Text } from '@/theme/text';
import { space, type, usePalette } from '@/theme';

/**
 * Copies `text` to the clipboard and says so for a moment. The label names what is copied
 * (for a screen reader), never the value itself: an app password's secret is not written
 * into an accessibility label or a log.
 */
export function CopyButton({ text, label, caption = 'Copy' }: { text: string; label: string; caption?: string }) {
  const p = usePalette();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => {
        void Clipboard.setStringAsync(text).then(
          () => setCopied(true),
          () => undefined,
        );
      }}
      hitSlop={8}
      style={({ pressed }) => ({
        minHeight: 44,
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.sm,
        alignSelf: 'flex-start',
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Icon name={copied ? 'check' : 'copy'} size={18} color={p.accentText} />
      <Text style={[type.smallStrong, { color: p.accentText }]}>{copied ? 'Copied' : caption}</Text>
    </Pressable>
  );
}
