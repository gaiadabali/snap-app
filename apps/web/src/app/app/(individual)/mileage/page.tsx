import { HouseAd } from '@/components/ads';
import { Card, Empty, Money, SectionTitle, Stat } from '@/design/primitives';
import { getMileage } from '@/lib/panels/data';
import { addTrip, deleteTrip } from '@/lib/panels/mileage-actions';
import { loadWorkspace } from '@/lib/panels/workspace';
import { MileageClient } from './MileageClient';

export const metadata = { title: 'Mileage' };

export default async function MileagePage() {
  const { workspace } = await loadWorkspace('personal');
  if (!workspace) return <Empty title="No personal workspace yet" />;

  const path = '/app/mileage';
  const mileage = await getMileage(workspace.id);

  return (
    <div className="flex flex-col gap-6">
      <SectionTitle
        as="h1"
        title="Mileage"
        lede="The logbook behind a cents-per-km claim. The rate is capped at the first 5,000 work kilometres each year — past that, a logbook becomes the better method."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <Stat label="Work km this year" value={mileage.workKm} tone={mileage.overCentsPerKmCap ? 'warn' : 'neutral'} />
        </Card>
        <Card>
          <Stat label="Total km logged" value={mileage.totalKm} />
        </Card>
        <Card>
          <Stat
            label="Claim at cents/km"
            value={<Money amount={mileage.claimAtCentsPerKm} />}
            hint={`${mileage.centsPerKmRate}¢/km, capped at ${mileage.centsPerKmCapKm.toLocaleString()} km`}
          />
        </Card>
        <Card tone={mileage.overCentsPerKmCap ? 'accent' : 'surface'}>
          <Stat
            label="Work share"
            value={`${mileage.logbookPercent}%`}
            tone={mileage.overCentsPerKmCap ? 'warn' : 'neutral'}
            hint={mileage.overCentsPerKmCap ? 'Over the 5,000 km cap — a logbook may claim more' : 'of all driving logged'}
          />
        </Card>
      </div>

      <MileageClient
        trips={mileage.trips}
        onAdd={addTrip.bind(null, workspace.id, path)}
        onDelete={deleteTrip.bind(null, workspace.id, path)}
      />

      <HouseAd placement="individual-mileage" />
    </div>
  );
}
