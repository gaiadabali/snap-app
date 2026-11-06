# Google Play paperwork: drafts (group plan 8.3.d, 8.3.f, 8.4.b)

**Status: DRAFT, 2026-11-06. Nothing is submitted; the Play account does not exist yet (8.1).**
Written from the code at `origin/main` and the privacy policy draft (`apps/web/.../legal/privacy`, "Draft, last updated 20 October 2026").
Google's form wording changes; re-check each question against the live Play Console when the account exists.
Items marked **[confirm]** are collected in section 5.

## 0. What the app does, from the code

| Fact | Source |
|---|---|
| Android permissions: `CAMERA` only. `RECORD_AUDIO` and `SYSTEM_ALERT_WINDOW` are blocked. Foreground location is requested at runtime by the trip screen (`expo-location`) | `apps/mobile/app.json`, `src/components/TripTracker.tsx` |
| No analytics, crash-reporting, ads or push SDK in `apps/mobile/package.json` (no Sentry, Firebase, Crashlytics, Amplitude, expo-notifications) | `apps/mobile/package.json` |
| Trip location is foreground only. Only the **distance (km)**, date, from/to labels and purpose are sent to our API; GPS coordinates are not | `TripTracker.tsx` `save()` |
| Files come from the camera or the document picker (`expo-document-picker`). No gallery/media permission, no contacts, no SMS, no microphone | `capture.tsx`, `app.json` |
| On-device receipt reading uses Google ML Kit (unbundled, via Play services). Image and text stay on the phone; Google gets recogniser metrics | privacy policy section 3, `modules/snap-ocr` |
| Server reading: the receipt image goes to our API on Helios, then to OpenRouter (US) and on to the model provider (US or elsewhere) | privacy policy section 3, `docs/AI.md` |
| Sign-in with YourTal (email-based account) | `docs/ECOSYSTEM.md`, group 3.3 |
| Optional sends: Free Tax Returns (after YourTal confirms the user), Xero (user connects it), ABN lookup (public data out, none of the user's data) | privacy policy section 4 |
| Delete account: in app (Settings, Delete account) and public page `/delete-account`, email fallback hansel@gaiada.com (0.12.c), emailed requests within 30 days | `delete-account/page.tsx`, `DeleteAccountPanel.tsx` |
| Teens: only by a parent's invite (0.9); own space, parent can view, teen is told; no receipt points; no Free Tax Returns | `family.tsx`, group 0.9 |
| Credits: Google Play Billing in the Play build (0.12.b, build work 8.3.b). Until then the in-app checkout charges outside Play and must not ship to Play | group 0.12.b |
| Encryption in transit: HTTPS to the API. Encryption at rest is NOT yet in place (policy says planned with Australian hosting) | privacy policy section 6 |

## 1. Data safety form (8.3.d)

### Section-level answers

| Question | Answer |
|---|---|
| Does the app collect or share any of the required user data types? | Yes |
| Is all of the user data collected by your app encrypted in transit? | Yes (HTTPS). **[confirm]** that every endpoint including the OpenRouter hop and Xero/FTR calls is TLS-only; the code-side calls are |
| Do you provide a way for users to request that their data is deleted? | Yes |
| Deletion URL | `https://snap-apps.gaiada.com/delete-account` **[confirm]** final host |
| Independent security review (MASA)? | No |
| Committed to the Play Families Policy? | Not applicable (not a children's app, see section 2) |

### Per data type

"Shared" in Play's sense means transferred to a third party. Service providers acting on our behalf under contract (hosting, OpenRouter as processor) are exempt from "shared" if the transfer is for the app's functionality under our instructions, but Google asks for a careful reading; the conservative draft below declares the AI hop as **shared** because the images reach providers outside Australia that we do not control. **[confirm]** with legal (8.3.c).

| Play category / type | Collected | Shared | Optional | Purpose | Notes |
|---|---|---|---|---|---|
| **Personal info: Name** | Yes | No | No | App functionality, Account management | From YourTal profile and business details |
| **Personal info: Email address** | Yes | No | No | App functionality, Account management, Communications (transactional email) | YourTal sign-in; also used for deletion requests |
| **Personal info: User IDs** | Yes | No | No | App functionality, Account management | Account and workspace IDs |
| **Personal info: Other info** (ABN, business details, occupation profile) | Yes | Yes, to Free Tax Returns only when the user chooses to send; to Xero only when connected | Yes (business workspace only) | App functionality | |
| **Financial info: Purchase history** | Yes | No | No | App functionality | Credit purchases and balance; Play Billing handles the payment |
| **Financial info: Other financial info** (receipt amounts, GST, suppliers, line items, ledger, BAS figures) | Yes | Yes: OpenRouter and its model providers (reading), Free Tax Returns / Xero (user-initiated) | No (it is the app's core function) | App functionality | Card numbers are not collected; masked to last four plus brand at capture |
| **Financial info: Payment info** | No (declared No) | | | | Credits are bought through Google Play Billing; we never see card details in the Play build. **[confirm]** once 8.3.b ships |
| **Photos and videos: Photos** | Yes | Yes: OpenRouter and its model providers (image is read by the model) | No | App functionality | Receipt and invoice images from the camera or picker; GPS metadata stripped from the processing copy |
| **Files and docs** (PDF invoices/statements picked by the user) | Yes | Same as photos | Yes | App functionality | |
| **Location: Approximate / Precise** | **No** | | | | Trip recording reads GPS on the device, foreground only, and sends only the distance in km. Coordinates never leave the phone, so by Google's definition (data transmitted off device) location is not collected. **[confirm]**; the conservative alternative is declaring Precise location, collected, not shared, optional, App functionality |
| **App activity: App interactions / Other user-generated content** | Yes | No | No | App functionality | Trips, goals, notes, categories the user enters; sign-in events |
| **App info and performance: Diagnostics** | Yes, server-side error and sign-in logs | No | No | App functionality, Analytics (security and reliability only) | No crash SDK in the app. **[confirm]** what the API logs per request |
| **Device or other IDs** | No | | | | No advertising ID, no Android ID read by the app. Session tokens are not device IDs. **[confirm]** by grepping the final release build |
| Contacts, Calendar, Messages, Audio, Health, Web browsing, Search history | No | | | | Not requested |

Other declarations:
- Data is **not** sold. Data is **not** used for advertising or for building user profiles for third parties (policy section 2).
- Data processed **on device** only (ML Kit result, trip coordinates, fingerprint ceremony which is local) is not "collected".
- Google ML Kit: Google receives recogniser metrics, not images or text. Declared in the policy; Play does not currently ask for ML Kit metrics as a data type, but keep the policy text.
- Retention: five years for business records (ATO), then removed automatically; erased immediately on account deletion except where another owner/manager keeps the workspace (name removed). Mention in the policy link, not the form.

## 2. Content rating, target audience, teens (8.3.f)

### Content rating questionnaire (IARC)

Category: **Utility, Productivity, Communication, or Other** (not game, not social, not news).

| Question | Answer |
|---|---|
| Violence, blood, fear/horror | No |
| Sexual content or nudity | No |
| Profanity or crude humour | No |
| Controlled substances (drugs, alcohol, tobacco) depicted or promoted | No |
| Gambling or simulated gambling | No |
| Does the app let users interact or exchange content with each other? | No. Members of one workspace share records, but there is no public or user-to-user chat or posting. **[confirm]** (family invites and workspace members are the closest thing) |
| Does the app share the user's current location with other users? | No |
| Does the app allow users to purchase digital goods? | Yes (credits, via Play Billing) |
| Does the app contain unrestricted web access / user-generated content shared publicly? | No |

Expected rating: **Everyone / PEGI 3 / IARC 3+** on content. Because of purchases it may show "In-app purchases"; that is a label, not a rating change.

### Target audience and content

| Question | Answer |
|---|---|
| Target age groups | **18 and over** only. Do **not** tick any under-18 band |
| Could the app unintentionally appeal to children? | No: a tax, receipt and bookkeeping tool with no cartoons for children. **[confirm]** the Snapper mascot (3D fish) does not read as child-directed; it is on the web, and not in the app today **[confirm]** |
| Ads | None. "Contains ads": No |
| App category | Business (or Finance); **[confirm]** which suits the review better |

### Teens note (important)

0.9 lets a teen use their YourTal account in SnapApp **only when a parent invites them**. Play's Families Policy applies if under-13s are a target audience or the app is "mixed audience" in a way that attracts them. The proposed position:

- Declare the target audience as **18+**, as above. The teen path is a parent-controlled sub-account for spending tracking, not marketing to minors.
- Do not tick 13 to 17 as a target group unless Google or legal advises it is safer. Ticking it would pull in Families Policy and ads/SDK requirements (we have no ads or SDKs, so compliance would be easy, but it widens the review). **[confirm]**
- Spell out the arrangement in the listing and privacy policy: a teen joins only through a parent's invite; the parent can view the teen's space and the teen is told; no receipt points.
- A teen's data is covered by the same account-deletion route.
- The minimum age in YourTal terms and in Australian law (Privacy Act reforms for a children's code, in progress) should be checked by legal. **[confirm]** minimum age (13?) and parental consent wording.

## 3. Financial features declaration (8.3.f)

Play asks which financial features the app provides. Answer by feature:

| Feature | Provided? |
|---|---|
| Personal loans, cash advance, or lending | No |
| Banking or money transfer / peer-to-peer payments | No |
| Crypto exchange, wallet, or tokens | No |
| Trading or investment platform, stocks | No |
| Insurance | No |
| Earned wage access / salary advance | No |
| Buy now pay later | No |
| Mobile payments or digital wallets (as a payment instrument) | No. The app has a "wallet" screen for credits and YourTal points; it is a prepaid balance of in-app credits, not a stored-value instrument for third-party payments. **[confirm]** reading |
| Personal finance management / tax / bookkeeping tools | **Yes**: receipt capture, ledger, GST/BAS figures, tax export. This is the closest category ("Personal finance tools"/"Other") |
| Government-related financial services | No (we are not a government service; the app does not claim to be the ATO or a registered tax agent) |

Declare: **"The app provides financial management tools only; it does not hold, move, lend or invest money."** The app is not a registered tax agent service: the listing says "general information, not tax advice".

Related, outside this form: the Play Business/Finance policy expects a clear statement of who operates the app and its licensing. The operator is the company owning SnapApp (0.12.a). **[confirm]** legal name, address, ABN.

## 4. Store listing text, en-AU (8.4.b)

Rules applied: plain, honest, no earning or income claims, no "get paid", no promise of a refund amount, no tax advice, no ATO endorsement, no claim of accuracy percentages. Prices and the free-scan count must match `credit-packs.ts` at submission.

**App name** (max 30): `Snap Apps: Receipts & Tax` (25 characters) **[confirm]** the Play name must not carry unverified claims; the plain alternative is `Snap Apps` (9).

**Short description** (max 80):

> Photograph receipts, keep a tidy ledger and get your tax records ready. (72)

**Full description** (max 4000; this draft is about 2,100 characters):

```
Snap Apps helps Australian sole traders, tradies and small businesses keep their receipts and records in order.

Take a photo of a receipt or tax invoice and Snap Apps reads it for you: the supplier, date, amount and GST. You check what it found, fix anything that looks wrong, and save it to your ledger. No more shoebox of faded dockets at tax time.

WHAT YOU CAN DO
- Capture receipts and tax invoices with your camera, or add a PDF or image from your phone
- Have the details read for you, then review and correct them before they are saved
- Keep a ledger of your expenses with categories, GST and notes
- Record a work trip as you drive and save the distance to your logbook
- Track goals and spending, and see where your money goes
- Export your records as a pack you can give your accountant, or send your deductions to Free Tax Returns if you choose to
- Connect Xero if you use it, to send your confirmed transactions across

HOW YOUR PHOTOS ARE READ
Snap Apps can read a receipt on your phone, or send the image to our server, where an AI model reads it. When it is read on our server, the image is passed through OpenRouter in the United States to the company that runs the model, which may be in the United States or elsewhere. Our privacy policy explains this in full. We do not sell your data and we do not show ads.

SIGN IN WITH YOURTAL
Use your YourTal account to sign in. You stay in control of what is shared between YourTal apps.

CREDITS
Reading a receipt uses one credit. New accounts start with free scans. You can buy more credits in the app; payments are handled by Google Play.

FAMILIES
A parent can invite a teenager into Snap Apps so they can track their own spending. The teen gets their own space, the parent who invited them can view it, and the teen is told so. Snap Apps is for adults; teen accounts exist only through a parent's invite.

YOUR DATA
- Trip distance is measured only while the trip screen is open, and only the distance is saved, not your route
- You can delete your account and your records in the app (Settings, Delete account) or by email. See snap-apps.gaiada.com/delete-account
- Business records are kept for five years to match the ATO's record-keeping period, unless you delete your account first. Export what you need before you do

IMPORTANT
Snap Apps gives general information and is not tax advice. It is not affiliated with the Australian Taxation Office. For your own situation, ask a registered tax agent. Readings by AI can be wrong, so always check the amounts before you rely on them.

Questions: hansel@gaiada.com
```

**Release notes** (max 500): taken from `apps/mobile/release-notes.json` at submission.
**Contact:** email hansel@gaiada.com (0.12.c) **[confirm]**; website and privacy policy URL need 8.3.c (policy is still marked Draft).
**Graphic assets** (icon 512, feature graphic 1024x500, 2 to 8 phone screenshots) are not part of this draft (8.4.b remainder).

## 5. To confirm (founder, then legal)

1. **Privacy policy** is Draft and must leave Draft (8.3.c) before the listing links to it. It says "encryption at rest is planned" and a Jakarta host; the Data safety form must match it exactly. The form says encrypted in transit only, which matches.
2. **Policy gaps vs this form:** the policy does not mention location (trips), the teen/parent-view arrangement, the YourTal sign-in, Google Play Billing, or Files/PDF. Add before submission so the form and the policy agree.
3. **Shared vs processor** for OpenRouter and its model providers: declared "shared" here to be safe. Confirm with legal; also confirm APP 8 wording (the model provider country is unknown).
4. **Location:** declared "not collected" because only km leaves the device. Confirm you are comfortable, or switch to the conservative Precise-location answer.
5. **Diagnostics:** the app has no crash SDK. Confirm what the API logs per request (IP, user ID, errors) and whether to declare "IP address" under Device or other IDs.
6. **Target audience:** 18+ only, with teens by parent invite. Confirm; and the minimum age for a teen invite and parental-consent wording (legal).
7. **Mascot Snapper:** confirm it is not in the Android app and not child-appealing; if it is added, recheck the audience answer.
8. **Payments:** the Payment info "No" answer holds only after Play Billing replaces the in-app checkout (8.3.b). Check any cached "wallet" wording in the app (a Play reviewer may read it as stored value).
9. **Listing name and category:** `Snap Apps: Receipts & Tax` vs `Snap Apps`; Business vs Finance. Trademark check on "Snap" (Snap Inc.) before the account is created.
10. **Operator details** for the Play page: company name, address, ABN, and whether the business is shown as a "trader" under EU rules (Play asks developers who distribute in the EU; the app is AU-only, so set AU as the sole country).
11. **Support email:** hansel@gaiada.com is a stopgap (0.12.c); a support mailbox is needed before launch. The delete-account page and listing use it.
12. **Fingerprint screen:** `fingerprint.tsx` is an enrolment ceremony that stores a local preference only and is behind `EXPERIMENTAL_FEATURES_ENABLED`; confirm it is off in the Play build so no biometric data claim is needed.
13. **Counts and prices** in the listing ("free scans", credit packs) must be re-checked against `credit-packs.ts` at submission; none are stated in the draft text on purpose.
14. **Data deletion URL:** confirm the production host for `/delete-account` and that it is public with no sign-in (it is today).
