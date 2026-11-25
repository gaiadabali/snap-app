import { View } from 'react-native';

import { Body, Button, Title } from '@/components/ui';
import { AUTH_RETURN_COPY, type AuthReturnOutcome } from '@/lib/auth-return';
import { space, usePalette } from '@/theme';

/**
 * What the YourTal popup shows on the PWA's return page (`lib/auth-return.ts`). Usually
 * seen for a moment only: the opening tab closes the popup once it has the URL.
 */
export function AuthReturnPage({ outcome, onOpenApp }: { outcome: AuthReturnOutcome; onOpenApp: () => void }) {
  const p = usePalette();
  const handedBack = outcome === 'handed-back';
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: p.ground,
        alignItems: 'center',
        justifyContent: 'center',
        padding: space.lg,
      }}
    >
      <View style={{ maxWidth: 420, width: '100%', gap: space.md }}>
        <Title level="h2">{handedBack ? AUTH_RETURN_COPY.handedBackTitle : AUTH_RETURN_COPY.nothingTitle}</Title>
        <Body muted>{handedBack ? AUTH_RETURN_COPY.handedBackBody : AUTH_RETURN_COPY.nothingBody}</Body>
        {handedBack ? null : <Button label={AUTH_RETURN_COPY.open} onPress={onOpenApp} />}
      </View>
    </View>
  );
}
