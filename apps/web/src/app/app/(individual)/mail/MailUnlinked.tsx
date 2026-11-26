'use client';

import { useRouter } from 'next/navigation';

import { YourtalMovePromptView } from '../../_shell/YourtalMovePrompt';

/**
 * Mail lives in the person's YourTal account, so an account that has not moved to
 * YourTal yet gets the same "Sign in with YourTal to keep your account" prompt the rest
 * of the panel shows, here in place of Mail. "Not now" goes back to the overview.
 */
export function MailUnlinked() {
  const router = useRouter();
  return (
    <div className="max-w-[620px]">
      <YourtalMovePromptView onDismiss={() => router.push('/app')} />
    </div>
  );
}
