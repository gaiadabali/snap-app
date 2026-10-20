import type { Metadata } from 'next';

import { LegalHeader } from '../_components/LegalHeader';

export const metadata: Metadata = { title: 'Privacy Policy' };

export default function PrivacyPolicyPage() {
  return (
    <article className="legal-prose">
      <LegalHeader title={<>Privacy Policy</>} meta={<>Draft — last updated 20 October 2026</>} />

      <p>
        Snap Apps (&quot;we&quot;, &quot;us&quot;) provides receipt capture, extraction, ledger, and
        Australian tax export services to Australian sole traders, tradies, and the accounting and
        bookkeeping practices that act for them. This policy explains what personal and financial
        information we collect, why, where it is processed and stored, and the rights you have over
        it under the Australian Privacy Principles (APPs) in the Privacy Act 1988 (Cth).
      </p>

      <section>
        <h2>1. What we collect</h2>
        <ul>
          <li>
            <strong>Account information:</strong> name, email,
            business/ABN details if you operate a business workspace, and your chosen occupation
            profile if you use the deduction tools.
          </li>
          <li>
            <strong>Receipt and invoice images</strong> you
            capture, plus the financial data extracted from them: supplier names and ABNs, amounts,
            GST, line items, and dates.
          </li>
          <li>
            <strong>Ledger and tax data</strong> derived from your
            confirmed transactions, including BAS figures calculated from them.
          </li>
          <li>
            <strong>Connection data</strong> if you connect Xero
            or another accounting platform — an authorisation token, not your Xero password.
          </li>
          <li>
            <strong>Usage and device data</strong> needed to
            operate and secure the service, such as sign-in events and error diagnostics.
          </li>
        </ul>
        <p>
          We do <strong>not</strong> collect or store full card numbers. Receipts that show a masked
          card number have it reduced at the point of capture to only the last four digits and the
          card brand — see{' '}
          <a href="/legal/security">
            Data handling &amp; security
          </a>
          . We do not collect device location from your receipt photos: GPS metadata is stripped from
          the copy used for processing and is never indexed.
        </p>
      </section>

      <section>
        <h2>2. Why we collect it</h2>
        <p>
          To extract and validate the data on your receipts, maintain your ledger, calculate your BAS
          and deduction figures, sync confirmed transactions to Xero if you choose to connect it,
          bill your plan, and secure your account. We do not use your financial data to sell you
          advertising, and we do not sell it to third parties.
        </p>
      </section>

      <section>
        <h2>3. Where your data is processed</h2>
        {/*
          Corrected 2026-10-20. This section said storage and receipt reading
          ran in AWS Sydney (ap-southeast-2). That is the PLANNED arrangement
          (docs/PLAN.md D12/D13), not the running one: the service runs on a
          Hostinger server in Jakarta, and extraction goes through OpenRouter
          (EXTRACTION_PROVIDER=openrouter on the host, checked that day). A
          privacy policy has to describe what actually happens to the data.
          Still a draft — see the banner — and due a legal review.
        */}
        <p>
          Your data — your account, your records and the original images of your receipts — is
          stored on a server operated for us by Hostinger in Jakarta, Indonesia.
        </p>
        <p>
          To read a receipt, a copy of its image is sent to OpenRouter, Inc. in the United States,
          which passes it to the provider running the language model that reads it. That provider
          may be in the United States or another country. Each of them processes the image under its
          own terms.
        </p>
        <p>
          Both are disclosures of your personal information outside Australia, and APP 8 of the
          Privacy Act applies to them. Moving storage and receipt reading to Australia is planned;
          until that happens, the arrangement above is the one in use.
        </p>
        {/*
          ML Kit disclosure — docs/ON-DEVICE.md §11 OD-9.
          Google's ML Kit Terms require developers to inform users that Google
          processes ML Kit metrics data. We use the UNBUNDLED text recogniser,
          so no model weights ship in the app and no image reaches Google; the
          metrics do. Both halves are stated because only stating the first
          would be the flattering half.
        */}
        <p>
          <strong>Reading on your phone.</strong> When the Android
          app reads a receipt on the device itself, it uses Google&apos;s ML Kit text recogniser. Your
          photo and the text read from it stay on your phone — ML Kit does not send the image or its
          result to Google. Google does receive usage and performance metrics about the recogniser
          itself, which Google processes under its own terms; those metrics describe how the
          recogniser ran, not what your receipt says. The recognition model is supplied by Google
          Play services rather than bundled into the app, which is why Google is involved at all, and
          a device without Google Play services simply uses the server extraction described above.
        </p>
      </section>

      <section>
        <h2>4. Who we share it with</h2>
        <ul>
          <li>
            <strong>Xero</strong>, or another accounting platform,
            only if and when you connect it — and only your posted transactions and their receipt
            images, not your whole account.
          </li>
          <li>
            <strong>The Australian Business Register</strong>, to
            confirm a supplier&apos;s ABN and GST registration status. This is a lookup of public
            business information, not a disclosure of your own data to the Register.
          </li>
          <li>
            <strong>Infrastructure and processing providers</strong>{' '}
            (cloud hosting, storage, and the AI provider described above) who process data on our
            behalf under contract, and are not permitted to use it for their own purposes.
          </li>
          <li>
            <strong>Your accounting practice</strong>, if your
            account is managed under a Practice plan by a bookkeeper or accountant you&apos;ve engaged.
          </li>
          <li>
            <strong>Google</strong>, where the Android app reads a
            receipt on your device — and only usage and performance metrics from its ML Kit text
            recogniser. Not your receipt images, and not the text read from them.
          </li>
          <li>Regulators or law enforcement, where we are legally required to disclose.</li>
        </ul>
      </section>

      <section>
        <h2>5. How long we keep it</h2>
        <p>
          Business records are retained for five years from the date they were prepared or the related
          transaction completed, matching the ATO&apos;s record-keeping requirement — see{' '}
          <a href="/docs/data-retention">
            Data retention and deletion
          </a>
          . Records are actively removed by an automated process once that period passes, rather than
          kept indefinitely, consistent with APP 11&apos;s requirement to destroy or de-identify
          personal information no longer needed for a permitted purpose.
        </p>
      </section>

      <section>
        <h2>6. Security</h2>
        <p>
          {/* Corrected 2026-10-20: "at rest" was not true of the running server — see /legal/security. */}
          Financial data is encrypted in transit (encryption at rest is planned with the move to
          Australian hosting), tenant data is isolated so one
          business&apos;s records are never visible to another, and particularly sensitive fields
          (bank details, Xero tokens) receive additional application-level encryption. Full detail is
          in{' '}
          <a href="/legal/security">
            Data handling &amp; security
          </a>
          .
        </p>
      </section>

      <section>
        <h2>7. Data breaches</h2>
        <p>
          We maintain an audit trail of access to your data so that, in the event of a suspected
          breach, the scope of what was affected can be established quickly. Where a breach is likely
          to result in serious harm, we intend to notify affected individuals and the Office of the
          Australian Information Commissioner (OAIC) within the timeframe required under the Notifiable
          Data Breaches scheme.
        </p>
      </section>

      <section>
        <h2>8. Your rights</h2>
        <p>
          You can ask us for access to the personal information we hold about you, ask us to correct
          it, and ask us to delete your account — see{' '}
          <a href="/support">
            Support
          </a>
          . Where a record is still inside its mandatory five-year retention window, we can close it
          out of active use but cannot delete the underlying record until that window passes, because
          we are legally required to be able to produce it. If you are not satisfied with how we
          handle a privacy concern, you can complain to the OAIC.
        </p>
      </section>

      <section>
        <h2>9. Changes to this policy</h2>
        <p>
          We will post any material change here and, where practical, notify account holders directly
          before it takes effect.
        </p>
      </section>

      <section>
        <h2>10. Contact</h2>
        <p>
          For privacy questions or requests, contact Support (see the{' '}
          <a href="/support">
            Support
          </a>{' '}
          page for current channels).
        </p>
      </section>
    </article>
  );
}
