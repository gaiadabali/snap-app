import { Card, Empty, SectionTitle, Table, Th, Thead } from '@/design/primitives';

import { getPlatformSettings } from '../../_data/governance';

import { RefusalPanel } from '../_components/RefusalPanel';
import { AddSettingForm } from './_components/AddSettingForm';
import { SettingRow } from './_components/SettingRow';

export const metadata = { title: 'Platform settings · Snap Apps admin' };

export default async function SettingsPage() {
  const gated = await getPlatformSettings();

  return (
    <div className="flex flex-col gap-6">
      <SectionTitle
        eyebrow="Governance · Settings"
        title="Platform settings"
        lede={
          'The server models this as a flat key/value store (GET/PUT /v1/admin/settings) — there is no ' +
          'dedicated schema for feature flags, plan defaults, extraction thresholds, validator toggles, ' +
          'maintenance mode, announcement banners, or support contact info. Whatever exists below is shown ' +
          'as-is; nothing here presents invented structure the server does not actually have.'
        }
      />

      {!gated.allowed ? (
        <RefusalPanel capability="manage_platform_settings" status={gated.status} message={gated.message} />
      ) : (
        <>
          <AddSettingForm />

          <Card>
            <h3 className="text-[16px] font-bold">Current settings</h3>
            <div className="mt-4 overflow-x-auto">
              {gated.data.length === 0 ? (
                <Empty
                  title="No settings have been set"
                  body="Every platform setting lives in one flat key/value table, and it's currently empty. Add one above."
                />
              ) : (
                <Table>
                  <Thead>
                    <Th>Key</Th>
                    <Th>Value</Th>
                    <Th>Updated</Th>
                    <Th align="right"> </Th>
                  </Thead>
                  <tbody>
                    {gated.data.map((s) => (
                      <SettingRow key={s.key} setting={s} />
                    ))}
                  </tbody>
                </Table>
              )}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
