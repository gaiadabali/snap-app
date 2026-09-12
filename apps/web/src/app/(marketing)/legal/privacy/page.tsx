import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Privacy Policy' };

export default function PrivacyPolicyPage() {
  return (
    <article className="flex flex-col gap-8 leading-relaxed text-[var(--color-ink-muted)]">
      <header>
        <h1 className="text-[28px] font-bold text-[var(--color-ink)]">Privacy Policy</h1>
        <p className="mt-2 text-[13px] text-[var(--color-ink-faint)]">Draft — last updated 12 September 2026</p>
      </header>

      <p>
        Snap Apps (&quot;we&quot;, &quot;us&quot;) provides receipt capture, extraction, ledger, and
        Australian tax export services to Australian sole traders, tradies, and the accounting and
        bookkeeping practices that act for them. This policy explains what personal and financial
        information we collect, why, where it is processed and stored, and the rights you have over
        it under the Australian Privacy Principles (APPs) in the Privacy Act 1988 (Cth).
      </p>

      <section>
        <h2 className="text-[20px] font-bold text-[var(--color-ink)]">1. What we collect</h2>
        <ul className="mt-3 flex flex-col gap-2">
          <li>
            <strong className="text-[var(--color-ink)]">Account information:</strong> name, email,
            business/ABN details if you operate a business workspace, and your chosen occupation
            profile if you use the deduction tools.
          </li>
          <li>
            <strong className="text-[var(--color-ink)]">Receipt and invoice images</strong> you
            capture, plus the financial data extracted from them: supplier names and ABNs, amounts,
            GST, line items, and dates.
          </li>
          <li>
            <strong className="text-[var(--color-ink)]">Ledger and tax data</strong> derived from your
            confirmed transactions, including BAS figures calculated from them.
          </li>
          <li>
            <strong className="text-[var(--color-ink)]">Connection data</strong> if you connect Xero
            or another accounting platform — an authorisation token, not your Xero password.
          </li>
          <li>
            <strong className="text-[var(--color-ink)]">Usage and device data</strong> needed to
            operate and secure the service, such as sign-in events and error diagnostics.
          </li>
        </ul>
        <p className="mt-3">
          We do <strong>not</strong> collect or store full card numbers. Receipts that show a masked
          card number have it reduced at the point of capture to only the last four digits and the
          card brand — see{' '}
          <a className="text-[var(--color-accent)] hover:underline" href="/legal/security">
            Data handling &amp; security
          </a>
          . We do not collect device location from your receipt photos: GPS metadata is stripped from
          the copy used for processing and is never indexed.
        </p>
      </section>

      <section>
        <h2 className="text-[20px] font-bold text-[var(--color-ink)]">2. Why we collect it</h2>
        <p className="mt-3">
          To extract and validate the data on your receipts, maintain your ledger, calculate your BAS
          and deduction figures, sync confirmed transactions to Xero if you choose to connect it,
          bill your plan, and secure your account. We do not use your financial data to sell you
          advertising, and we do not sell it to third parties.
        </p>
      </section>

      <section>
        <h2 className="text-[20px] font-bold text-[var(--color-ink)]">3. Where your data is processed</h2>
        <p className="mt-3">
          Your data is stored in Australia (AWS <code>ap-southeast-2</code>, Sydney). The model that
          reads your receipts also runs in that region, on purpose: keeping extraction in Sydney
          avoids sending your financial records overseas to get a receipt read, which is otherwise a
          cross-border disclosure under APP 8. Where a provider outside Australia is used during
          development or as a fallback, this is disclosed to you separately and is not used for
          production processing of your data without that disclosure.
        </p>
        <p className="mt-3">
          Where our AI provider is Anthropic, Anthropic does not train its models on data submitted via
          its API.
        </p>
      </section>

      <section>
        <h2 className="text-[20px] font-bold text-[var(--color-ink)]">4. Who we share it with</h2>
        <ul className="mt-3 flex flex-col gap-2">
          <li>
            <strong className="text-[var(--color-ink)]">Xero</strong>, or another accounting platform,
            only if and when you connect it — and only your posted transactions and their receipt
            images, not your whole account.
          </li>
          <li>
            <strong className="text-[var(--color-ink)]">The Australian Business Register</strong>, to
            confirm a supplier&apos;s ABN and GST registration status. This is a lookup of public
            business information, not a disclosure of your own data to the Register.
          </li>
          <li>
            <strong className="text-[var(--color-ink)]">Infrastructure and processing providers</strong>{' '}
            (cloud hosting, storage, and the AI provider described above) who process data on our
            behalf under contract, and are not permitted to use it for their own purposes.
          </li>
          <li>
            <strong className="text-[var(--color-ink)]">Your accounting practice</strong>, if your
            account is managed under a Practice plan by a bookkeeper or accountant you&apos;ve engaged.
          </li>
          <li>Regulators or law enforcement, where we are legally required to disclose.</li>
        </ul>
      </section>

      <section>
        <h2 className="text-[20px] font-bold text-[var(--color-ink)]">5. How long we keep it</h2>
        <p className="mt-3">
          Business records are retained for five years from the date they were prepared or the related
          transaction completed, matching the ATO&apos;s record-keeping requirement — see{' '}
          <a className="text-[var(--color-accent)] hover:underline" href="/docs/data-retention">
            Data retention and deletion
          </a>
          . Records are actively removed by an automated process once that period passes, rather than
          kept indefinitely, consistent with APP 11&apos;s requirement to destroy or de-identify
          personal information no longer needed for a permitted purpose.
        </p>
      </section>

      <section>
        <h2 className="text-[20px] font-bold text-[var(--color-ink)]">6. Security</h2>
        <p className="mt-3">
          Financial data is encrypted at rest and in transit, tenant data is isolated so one
          business&apos;s records are never visible to another, and particularly sensitive fields
          (bank details, Xero tokens) receive additional application-level encryption. Full detail is
          in{' '}
          <a className="text-[var(--color-accent)] hover:underline" href="/legal/security">
            Data handling &amp; security
          </a>
          .
        </p>
      </section>

      <section>
        <h2 className="text-[20px] font-bold text-[var(--color-ink)]">7. Data breaches</h2>
        <p className="mt-3">
          We maintain an audit trail of access to your data so that, in the event of a suspected
          breach, the scope of what was affected can be established quickly. Where a breach is likely
          to result in serious harm, we intend to notify affected individuals and the Office of the
          Australian Information Commissioner (OAIC) within the timeframe required under the Notifiable
          Data Breaches scheme.
        </p>
      </section>

      <section>
        <h2 className="text-[20px] font-bold text-[var(--color-ink)]">8. Your rights</h2>
        <p className="mt-3">
          You can ask us for access to the personal information we hold about you, ask us to correct
          it, and ask us to delete your account — see{' '}
          <a className="text-[var(--color-accent)] hover:underline" href="/support">
            Support
          </a>
          . Where a record is still inside its mandatory five-year retention window, we can close it
          out of active use but cannot delete the underlying record until that window passes, because
          we are legally required to be able to produce it. If you are not satisfied with how we
          handle a privacy concern, you can complain to the OAIC.
        </p>
      </section>

      <section>
        <h2 className="text-[20px] font-bold text-[var(--color-ink)]">9. Changes to this policy</h2>
        <p className="mt-3">
          We will post any material change here and, where practical, notify account holders directly
          before it takes effect.
        </p>
      </section>

      <section>
        <h2 className="text-[20px] font-bold text-[var(--color-ink)]">10. Contact</h2>
        <p className="mt-3">
          For privacy questions or requests, contact Support (see the{' '}
          <a className="text-[var(--color-accent)] hover:underline" href="/support">
            Support
          </a>{' '}
          page for current channels).
        </p>
      </section>
    </article>
  );
}
