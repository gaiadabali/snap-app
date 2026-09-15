import BusinessHome from '@/components/home/BusinessHome';
import PersonalHome from '@/components/home/PersonalHome';
import { BUSINESS_FEATURES_ENABLED } from '@/config';
import { useWorkspace } from '@/workspace';

/**
 * Home, for whichever life you are in.
 *
 * Two screens rather than one screen with branches: a household and a
 * business do not want smaller and larger versions of the same dashboard,
 * they want different questions answered. The switch between them lives at
 * the top of both.
 *
 * `BUSINESS_FEATURES_ENABLED` is checked here too, not just in the workspace
 * provider that already withholds business workspaces from `isBusiness` —
 * belt and braces on the one screen a business surface leaking onto would be
 * the most visible possible failure of "personal only".
 */
export default function HomeScreen() {
  const { isBusiness } = useWorkspace();
  return BUSINESS_FEATURES_ENABLED && isBusiness ? <BusinessHome /> : <PersonalHome />;
}
