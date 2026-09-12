import { Badge } from '@/design/primitives';

const TONE = {
  active: 'good',
  connected: 'good',
  dormant: 'warn',
  needs_review: 'warn',
  error: 'risk',
  suspended: 'risk',
  disconnected: 'neutral',
} as const;

type Status = keyof typeof TONE;

const LABEL: Record<Status, string> = {
  active: 'Active',
  connected: 'Connected',
  dormant: 'Dormant',
  needs_review: 'Needs review',
  error: 'Error',
  suspended: 'Suspended',
  disconnected: 'Not connected',
};

export function StatusBadge({ status }: { status: Status }) {
  return <Badge tone={TONE[status]}>{LABEL[status]}</Badge>;
}
