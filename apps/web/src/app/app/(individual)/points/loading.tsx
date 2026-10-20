import { SectionTitle } from '@/design/primitives';
import { LINK_COPY } from '@/lib/yourtal-link';
import { YourtalLinkLoading } from './YourtalLinkView';

export default function Loading() {
  return (
    <div className="flex flex-col gap-6">
      <SectionTitle as="h1" title={LINK_COPY.title} />
      <YourtalLinkLoading />
    </div>
  );
}
