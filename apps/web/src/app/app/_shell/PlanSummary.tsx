import type { PlanUsage } from '@snap/api-contract';

import { Badge, Card, SectionTitle, Stat } from '@/design/primitives';

export function PlanSummary({ workspaceName, plan }: { workspaceName: string; plan: PlanUsage }) {
  return (
    <div className="flex flex-col gap-6">
      <SectionTitle as="h1" eyebrow={workspaceName} title={plan.planName} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <Stat
            label="Scans"
            value={plan.scansRemaining === null ? 'Unlimited' : `${plan.scansUsed} used`}
            hint={plan.scanQuota === null ? 'No monthly cap' : `${plan.scansRemaining} of ${plan.scanQuota} left this period`}
          />
        </Card>
        <Card>
          <Stat label="Seats" value={`${plan.seatsUsed} / ${plan.seatLimit}`} tone={plan.seatsUsed >= plan.seatLimit ? 'warn' : 'neutral'} />
        </Card>
        <Card>
          <Stat
            label="Extraction speed"
            value={<Badge tone={plan.realtime ? 'good' : 'neutral'}>{plan.realtime ? 'Realtime' : 'Batched (within the hour)'}</Badge>}
          />
        </Card>
        <Card>
          <Stat label="Retention" value={`${plan.retentionMonths} months`} hint="How long documents stay searchable" />
        </Card>
      </div>

      <Card>
        <dl className="grid grid-cols-2 gap-y-2 text-[13px] sm:max-w-[420px]">
          <dt className="text-[var(--color-ink-muted)]">Plan code</dt>
          <dd className="text-right font-medium">{plan.planCode}</dd>
          <dt className="text-[var(--color-ink-muted)]">Current period ends</dt>
          <dd className="text-right font-medium">{plan.periodEnds}</dd>
          {plan.firmName ? (
            <>
              <dt className="text-[var(--color-ink-muted)]">Managed by</dt>
              <dd className="text-right font-medium">{plan.firmName}</dd>
            </>
          ) : null}
        </dl>
      </Card>
    </div>
  );
}
