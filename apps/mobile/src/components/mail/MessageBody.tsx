import { PlainBody, type MessageBodyProps } from './MessageText';

export type { MessageBodyProps } from './MessageText';

/**
 * The fallback body, used only where no platform file applies (the unit tests, which run
 * under Node). It never draws HTML: the formatted version needs a sandbox, and each
 * platform has its own (`MessageBody.native.tsx`: a WebView with JavaScript off;
 * `MessageBody.web.tsx`: an iframe with no `allow-scripts`). Showing the plain text is the
 * safe answer when there is no sandbox to show it in.
 */
export function MessageBody({ text }: MessageBodyProps) {
  return <PlainBody text={text} />;
}
