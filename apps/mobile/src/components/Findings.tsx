import { View } from 'react-native';
import { Text } from '@/theme/text';
import type { IconName } from '@/components/Icon';

import type { ExtractionFinding } from '@/api';
import { Notice, SectionHeader, Small } from '@/components/ui';
import { space } from '@/theme';

/**
 * What the checks found, in the order a person should read it.
 *
 * The review screen used to offer a confidence percentage and a list of
 * compliance codes, which told the user that something might be wrong without
 * saying what. These are the server's deterministic findings: each names a
 * field, states the discrepancy with the numbers in it, and says what to do.
 *
 * "GST reads $26.69, but 1/11 of the taxable amount is $24.26" is actionable.
 * "94% confident" is not.
 *
 * Each finding is a tone Notice, so severity reads as colour before it is
 * read as text. Red is for an error only — something that blocks posting; a
 * warning is amber and a note is neutral blue.
 */

const ORDER: Record<ExtractionFinding['severity'], number> = { error: 0, warning: 1, note: 2 };

const GLYPH: Record<ExtractionFinding['severity'], IconName> = {
  error: 'close',
  warning: 'alert',
  note: 'info',
};

export function Findings({ findings }: { findings: ExtractionFinding[] }) {
  if (findings.length === 0) return null;

  const tone = (severity: ExtractionFinding['severity']): 'risk' | 'warn' | 'info' =>
    severity === 'error' ? 'risk' : severity === 'warning' ? 'warn' : 'info';

  // Errors first: an unreadable document is not worth arguing about GST over.
  const sorted = [...findings].sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
  const blocking = sorted.filter((x) => x.severity === 'error').length;
  const needsCheck = sorted.filter((x) => x.severity === 'warning').length;

  return (
    <View style={{ gap: space.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <SectionHeader title="Checks" />
        <Small>
          {blocking > 0
            ? `${blocking} to resolve`
            : needsCheck > 0
              ? `${needsCheck} to confirm`
              : 'nothing to do'}
        </Small>
      </View>

      <View style={{ gap: space.sm }}>
        {sorted.map((finding, i) => (
          <Notice
            key={`${finding.code}-${finding.field}-${i}`}
            tone={tone(finding.severity)}
            icon={GLYPH[finding.severity]}
          >
            {finding.message}
            {finding.fix ? <Text style={{ fontWeight: '600' }}>{`\n${finding.fix}`}</Text> : null}
          </Notice>
        ))}
      </View>

      {blocking > 0 ? (
        <Small>
          This document cannot be posted until the items above are resolved. The photo is kept
          either way — it is the record.
        </Small>
      ) : null}
    </View>
  );
}
