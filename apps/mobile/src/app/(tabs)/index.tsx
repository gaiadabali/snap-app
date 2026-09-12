import BusinessHome from '@/components/home/BusinessHome';
import PersonalHome from '@/components/home/PersonalHome';
import { useWorkspace } from '@/workspace';

/**
 * Home, for whichever life you are in.
 *
 * Two screens rather than one screen with branches: a household and a
 * business do not want smaller and larger versions of the same dashboard,
 * they want different questions answered. The switch between them lives at
 * the top of both.
 */
export default function HomeScreen() {
  const { isBusiness } = useWorkspace();
  return isBusiness ? <BusinessHome /> : <PersonalHome />;
}
