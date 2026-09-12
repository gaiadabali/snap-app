import { Text, View } from 'react-native';

import type { ExtractionFinding } from '@/api';
import { Raised } from '@/components/rich';
import { Body, Label, Small } from '@/components/ui';
import { radius, space, usePalette } from '@/theme';

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
 */

const ORDER: Record<ExtractionFinding['severity'], number> = { error: 0, warning: 1, note: 2 };

const GLYPH: Record<ExtractionFinding['severity'], string> = {
  error: '✕',
  warning: '⚠',
  note: 'ℹ',
};

export function Findings({ findings }: { findings: ExtractionFinding[] }) {
  const p = usePalette();
  if (findings.length === 0) return null;

  const tone = (severity: ExtractionFinding['severity']) =>
    severity === 'error' ? p.risk : severity === 'warning' ? p.warn : p.inkMuted;
  const wash = (severity: ExtractionFinding['severity']) =>
    severity === 'error' ? p.riskSoft : severity === 'warning' ? p.warnSoft : p.surfaceAlt;

  // Errors first: an unreadable document is not worth arguing about GST over.
  const sorted = [...findings].sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
  const blocking = sorted.filter((x) => x.severity === 'error').length;
  const needsCheck = sorted.filter((x) => x.severity === 'warning').length;

  return (
    <View style={{ gap: space.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Label>Checks</Label>
        <Small>
          {blocking > 0
            ? `${blocking} to resolve`
            : needsCheck > 0
              ? `${needsCheck} to confirm`
              : 'nothing to do'}
        </Small>
      </View>

      <Raised style={{ padding: 0 }}>
        {sorted.map((finding, i) => (
          <View
            key={`${finding.code}-${finding.field}-${i}`}
            style={{
              flexDirection: 'row',
              gap: space.md,
              paddingHorizontal: space.lg,
              paddingVertical: 13,
              borderTopWidth: i === 0 ? 0 : 1,
              borderTopColor: p.rule,
            }}
          >
            <View
              style={{
                width: 26,
                height: 26,
                borderRadius: 13,
                backgroundColor: wash(finding.severity),
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={{ fontSize: 13, color: tone(finding.severity), fontWeight: '700' }}>
                {GLYPH[finding.severity]}
              </Text>
            </View>

            <View style={{ flex: 1, gap: 3 }}>
              <Body>{finding.message}</Body>
              {finding.fix ? (
                <Small muted={false} style={{ color: tone(finding.severity), fontWeight: '600' }}>
                  {finding.fix}
                </Small>
              ) : null}
            </View>
          </View>
        ))}
      </Raised>

      {blocking > 0 ? (
        <View
          style={{ backgroundColor: p.riskSoft, borderRadius: radius.md, padding: space.md }}
        >
          <Small muted={false} style={{ color: p.risk }}>
            This document cannot be posted until the items above are resolved. The photo is kept
            either way — it is the record.
          </Small>
        </View>
      ) : null}
    </View>
  );
}
