import { Card, SectionTitle, Table, Th, Thead } from '@/design/primitives';

import {
  getAnnouncementBanners,
  getExtractionThresholds,
  getFeatureFlags,
  getMaintenanceMode,
  getPlanDefaults,
  getSupportConfig,
  getValidatorToggles,
  type FeatureFlag,
} from '../../_data/governance';

import { BannerManager } from './_components/BannerManager';
import { FlagRow } from './_components/FlagRow';
import { MaintenancePanel } from './_components/MaintenancePanel';
import { PlanDefaultRow } from './_components/PlanDefaultRow';
import { SupportConfigForm } from './_components/SupportConfigForm';
import { ThresholdEditor } from './_components/ThresholdEditor';
import { ValidatorRow } from './_components/ValidatorRow';

export const metadata = { title: 'Platform settings · Snap Apps admin' };

const FLAG_GROUP_LABEL: Record<FeatureFlag['group'], string> = {
  capture: 'Capture & extraction',
  sync: 'Accounting-software sync',
  assistant: 'Assistant',
  billing: 'Billing & plans',
};

function groupFlags(flags: FeatureFlag[]): Array<[FeatureFlag['group'], FeatureFlag[]]> {
  const order: FeatureFlag['group'][] = ['capture', 'sync', 'assistant', 'billing'];
  return order
    .map((g) => [g, flags.filter((f) => f.group === g)] as [FeatureFlag['group'], FeatureFlag[]])
    .filter(([, fs]) => fs.length > 0);
}

export default async function SettingsPage() {
  const [maintenance, banners, flags, planDefaults, thresholds, validators, support] = await Promise.all([
    getMaintenanceMode(),
    getAnnouncementBanners(),
    getFeatureFlags(),
    getPlanDefaults(),
    getExtractionThresholds(),
    getValidatorToggles(),
    getSupportConfig(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <SectionTitle
        eyebrow="Governance · Settings"
        title="What drives the mobile app, server, and website"
        lede="Grouped by what each setting controls, with which client it affects and when a change takes effect — not a wall of undifferentiated toggles."
      />

      <Card tone={maintenance.enabled ? 'accent' : 'surface'}>
        <MaintenancePanel mode={maintenance} />
      </Card>

      <Card>
        <h3 className="text-[16px] font-bold">Announcement banners</h3>
        <p className="mt-1 text-[13px] text-[var(--color-ink-muted)]">Shown at the top of the affected client(s). Takes effect immediately.</p>
        <div className="mt-4">
          <BannerManager banners={banners} />
        </div>
      </Card>

      <Card>
        <h3 className="text-[16px] font-bold">Feature flags</h3>
        <div className="mt-2 flex flex-col gap-5">
          {groupFlags(flags).map(([group, groupFlags2]) => (
            <div key={group}>
              <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-ink-faint)]">
                {FLAG_GROUP_LABEL[group]}
              </div>
              <div className="mt-1">
                {groupFlags2.map((f) => (
                  <FlagRow key={f.key} flag={f} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <h3 className="text-[16px] font-bold">Plan &amp; quota defaults</h3>
        <p className="mt-1 text-[13px] text-[var(--color-ink-muted)]">
          Applies to new workspaces on this plan — see <code>docs/MONETISATION.md</code> §3. Existing
          tenants keep whatever they were assigned; changing a default here is not retroactive.
        </p>
        <div className="mt-4 overflow-x-auto">
          <Table>
            <Thead>
              <Th>Plan</Th>
              <Th align="right">Price</Th>
              <Th align="right">Scan quota</Th>
              <Th align="right">Seat limit</Th>
              <Th align="right">Retention</Th>
              <Th align="right"> </Th>
            </Thead>
            <tbody>
              {planDefaults.map((p) => (
                <PlanDefaultRow key={p.planCode} plan={p} />
              ))}
            </tbody>
          </Table>
        </div>
      </Card>

      <Card>
        <h3 className="text-[16px] font-bold">Extraction thresholds</h3>
        <p className="mt-1 text-[13px] text-[var(--color-ink-muted)]">
          The auto-accept bar (docs/PLAN.md §4): every field ≥ this AND every validator passes, or the
          document goes to <code>needs_review</code>.
        </p>
        <div className="mt-2">
          {thresholds.map((t) => (
            <ThresholdEditor key={t.key} threshold={t} />
          ))}
        </div>
      </Card>

      <Card>
        <h3 className="text-[16px] font-bold">Deterministic validators</h3>
        <p className="mt-1 text-[13px] text-[var(--color-ink-muted)]">
          Run after every extraction (docs/PLAN.md §4). A failure escalates to the next model tier;
          still failing sends the document to review.
        </p>
        <div className="mt-2">
          {validators.map((v) => (
            <ValidatorRow key={v.key} validator={v} />
          ))}
        </div>
      </Card>

      <Card>
        <h3 className="text-[16px] font-bold">Support &amp; contact</h3>
        <p className="mt-1 text-[13px] text-[var(--color-ink-muted)]">Shown on the website and referenced by the mobile app's help screen.</p>
        <div className="mt-4">
          <SupportConfigForm config={support} />
        </div>
      </Card>
    </div>
  );
}
