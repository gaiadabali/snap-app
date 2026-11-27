# T14 screenshots: SnapApp Mail on the phone app (Expo)

Taken 2026-11-27 from the Expo web export of `apps/mobile` in demo mode (the engine's in-memory
mail client and its fixture messages; no server), at a 390 x 844 phone viewport, 2x. They show the
real screens, not a mock-up. What they do not show: the Android WebView (the web build draws the
message body in an iframe instead), the notification permission dialog and notifications.

| File | What |
|---|---|
| `00-menu-mail-entry-light.png` | the Mail entry in the menu |
| `01-inbox-light.png` | Inbox, folder chips with unread counts, the pencil |
| `02-selecting-dark.png` | long press selects; Read, Unread, Move, Trash |
| `03-spam-banner-dark.png` | Spam: the YourTal banner and the three counters |
| `04-junk-unsubscribe-dark.png` | a mailing-list message: Unsubscribe, remote images blocked |
| `05-reader-html-light.png` | an HTML message in the sandbox (iframe, `IFRAME_SANDBOX`, no `allow-scripts`) |
| `06-compose-reply-light.png` | reply |
| `07-settings-light.png` | Mail settings |
| `08-app-password-secret-dark.png` | an app password's one-time secret |
