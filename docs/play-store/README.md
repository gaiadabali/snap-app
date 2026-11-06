# Google Play graphics (group plan 8.4.b)

Listing text lives in [`../PLAY-STORE.md`](../PLAY-STORE.md) section 4. Everything here is generated from the repo or captured from staging by the scripts in `tools/`. Nothing is submitted; the Play account does not exist yet (8.1).

## Files

| File | Size | Format | What it shows |
|---|---|---|---|
| `icon-512.png` | 512x512 | 32-bit PNG (RGBA, fully opaque), 24 KB | The app icon from `apps/mobile/assets/icon.png` (1024 px master, downscaled; not redrawn). Square, full bleed: Play applies its own rounded mask |
| `feature-graphic-1024x500.png` | 1024x500 | 24-bit PNG, 81 KB | Brand blue gradient (#1878D8 to a deeper step), the icon, "Snap Apps", "Receipts into records" and "Photograph a receipt, check what was read." (both lines are the app's own sign-in copy). No prices, no device frame, no claims |
| `phone/1-home.png` | 1080x1920 | 24-bit PNG | Home: left to spend this month, credits left, YourTal points, shortcuts (Kate Marsh, seeded demo person) |
| `phone/2-scan.png` | 1080x1920 | 24-bit PNG | Scan screen with framing guide and shutter. **The viewfinder is a mock feed** (see below) |
| `phone/3-receipt.png` | 1080x1920 | 24-bit PNG | A read receipt: supplier, date, confidence, the stored original |
| `phone/4-receipt-lines.png` | 1080x1920 | 24-bit PNG | The same receipt scrolled: the lines that were read, each tappable to correct, and the start of Amounts |
| `phone/5-budgets.png` | 1080x1920 | 24-bit PNG | Budgets: spent, budgeted, days left, safe to spend a day, per-category limits |
| `phone/6-menu.png` | 1080x1920 | 24-bit PNG | Menu sheet: spending, analytics, budgets, recurring, savings goals |
| `phone/7-credits.png` | 1080x1920 | 24-bit PNG | Credits: balance and top-up packs. **Shows prices and a checkout button; do not upload until the questions below are settled** |

All sizes are checked by `python3 docs/play-store/tools/verify.py` (Play limits: screenshots JPEG or 24-bit PNG, each side 320 to 3840 px, long side at most 2x the short side, 8 MB; icon 512x512 32-bit PNG up to 1024 KB; feature graphic 1024x500 JPEG or 24-bit PNG). All pass.

## How the screenshots were made

`tools/capture-phone.cjs` drives the Expo web build at https://snap-apps-app.gaiada.com in Chromium with a 360x640 viewport at deviceScaleFactor 3 (1080x1920, standard Android xxhdpi). Sign-in is `POST /v1/auth/google-simulator/sign-in` for two of the five seeded demo people (Kate Marsh, Sam Oyelaran); the token is placed in the app's own storage slot. No account was created.

- **Mock viewfinder (`2-scan.png`).** A browser has no camera, so the web build draws a text placeholder. The script swaps that placeholder for the demo receipt photo and darkens its edges. The frame, shutter, Torch button, "Filing to" chip and tab bar are the real UI. On a phone the live camera fills that area.
- **One synthetic receipt was scanned on staging** as Sam Oyelaran, through the normal Scan screen: `tools/demo-receipt.jpg` ("Harbour St Coffee", a made-up cafe; the image is made by `tools/make_demo_receipt.py`). It cost one scan credit (60 to 59) and left one receipt in Sam's Personal space. This was needed because the existing staging receipts are real people's: Kate's household holds two real receipts (one shows a personal Gmail address) and are in IDR. Those are not used anywhere in these files.
- Regenerate: `python3 tools/make_static.py <geist font dir>` (icon and feature graphic), `PLAYWRIGHT=<path to playwright module> node tools/capture-phone.cjs tools/demo-receipt.jpg` (screenshots), then `python3 tools/verify.py`.

## Still missing or needs a decision

1. **Trips and deductions are not in the shipped app.** The brief and the listing text mention trips, a ledger, GST/BAS and sending deductions to Free Tax Returns, but `BUSINESS_FEATURES_ENABLED` is off: staging says "This app tracks personal spending" to the business-only demo people (Dan Whitby, Priya Nandan), and `/mileage` redirects home. So there is no trips or deductions screenshot, by design (no screens for features that are not there). Either the Play build turns the business features on (then add trips, deductions and export screenshots) or the full description in `PLAY-STORE.md` section 4 should drop trips, ledger, Xero and Free Tax Returns claims to match what the app shows.
2. **`7-credits.png` shows prices (5, 10 and 25 dollars) and a Pay button.** The listing text says Play Billing handles payment (8.3.b), and says prices must match `credit-packs.ts` at submission. Re-take after Play Billing ships; the Play reviewer reads this screen.
3. **Home and Budgets use Kate's seeded household.** Its budgets are "Jajan" and "Pets" with $0 spent. The Home screen below the fold (the Latest list) has real people's receipts and was kept out of frame. A purpose-made demo workspace with AUD receipts across categories would give much stronger Home, Budgets, Spending and Analytics screenshots; that needs a seed change (a server task, outside docs/play-store).
4. **Staging data quality issues seen while capturing** (not fixed here): IDR receipts are totalled as dollars (two receipts of Rp 70,900 and Rp 20 read as "$70,920.00" in Kate's Spending list and Export); Sam's Home turns red ("Over budget") when a receipt exists and no budget is set; the receipt screen shows "Excluding GST $0.00" for the demo receipt; the demo receipt's made-up ABN fails the checksum, which is why its Checks list shows a warning (that is the app working, and it is below the shots' crop).
5. **No tablet screenshots** (7-inch and 10-inch). Play only asks for them to feature on tablets; `app.json` has `supportsTablet` for iOS only. Capture a 600x1024 @2 and 800x1280 @2 set from the same script if wanted.
6. **No promo video, no localised sets** (en-AU only). **Dark-mode** screenshots are possible with the toggle on Home if wanted.
7. Screenshots come from the web build, not an Android device: fonts and the system status bar differ slightly. Re-shoot from the release APK on a device or emulator before submission if exact fidelity matters.
8. Listing name wording (`Snap Apps: Receipts & Tax` vs `Snap Apps`) is an open item in PLAY-STORE.md; the feature graphic says "Snap Apps" only, so it works with either.
