import { Fragment, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import type { AvailableTaxRules } from '@/api';
import { Icon } from '@/components/Icon';
import { Card, Small } from '@/components/ui';
import { Text } from '@/theme/text';
import { control, radius, space, type, usePalette } from '@/theme';

/**
 * Which country's rules the account runs on, and therefore which currency
 * every amount is shown in. Backed by the installed tax rule sets rather than
 * a hardcoded list — a deployment that has not installed a country should not
 * offer it.
 *
 * Shared by registration (password sign-up) and onboarding (every other way
 * in — an emailed sign-in link, Google, YourTal — reaches onboarding without
 * having been asked).
 */
export function CountryPicker({
  options,
  value,
  onChange,
}: {
  options: AvailableTaxRules[];
  value: AvailableTaxRules | null;
  onChange: (v: AvailableTaxRules) => void;
}) {
  const p = usePalette();
  const [open, setOpen] = useState(false);
  return (
    <View style={{ gap: space.sm, zIndex: 6 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Country"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((v) => !v)}
        style={{
          minHeight: control.input,
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.sm,
          borderWidth: 1,
          borderColor: open ? p.accent : p.ruleStrong,
          borderRadius: radius.lg,
          backgroundColor: p.card,
          paddingHorizontal: space.lg,
        }}
      >
        <Text
          style={[type.input, { flex: 1, color: value ? p.ink : p.inkFaint }]}
          numberOfLines={1}
        >
          {value?.countryName ?? 'Where do you live?'}
        </Text>
        {value ? <Text style={[type.small, { color: p.inkMuted }]}>{value.currency}</Text> : null}
        <Icon name="chevronDown" size={16} color={p.inkMuted} />
      </Pressable>

      {open ? (
        // The options are a white lifted card, rows split by an inset
        // hairline, a check on the one chosen.
        <Card padded={false}>
          <View style={{ borderRadius: radius.xl, overflow: 'hidden' }}>
            {options.map((o, i) => {
              const selected = value?.rulesId === o.rulesId;
              return (
                <Fragment key={o.rulesId}>
                  {i === 0 ? null : (
                    <View
                      style={{
                        height: StyleSheet.hairlineWidth * 2,
                        marginLeft: space.lg,
                        backgroundColor: p.rule,
                      }}
                    />
                  )}
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => {
                      onChange(o);
                      setOpen(false);
                    }}
                    style={({ pressed }) => ({
                      minHeight: control.tap + space.sm,
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: space.sm,
                      paddingHorizontal: space.lg,
                      backgroundColor: pressed ? p.surface : 'transparent',
                    })}
                  >
                    <Text
                      style={[
                        type.body,
                        { flex: 1, color: p.ink, fontWeight: selected ? '600' : '400' },
                      ]}
                    >
                      {o.countryName}
                    </Text>
                    <Text style={[type.small, { color: p.inkMuted }]}>{o.currency}</Text>
                    <View style={{ width: 20, alignItems: 'center' }}>
                      {selected ? <Icon name="check" size={18} color={p.accentText} /> : null}
                    </View>
                  </Pressable>
                </Fragment>
              );
            })}
          </View>
        </Card>
      ) : null}
      <Small>Sets the currency every amount is shown in.</Small>
    </View>
  );
}
