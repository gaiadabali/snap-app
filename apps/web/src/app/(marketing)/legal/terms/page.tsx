import type { Metadata } from 'next';

import { LegalHeader } from '../_components/LegalHeader';

export const metadata: Metadata = { title: 'Terms of Service' };

export default function TermsOfServicePage() {
  return (
    <article className="legal-prose">
      <LegalHeader title={<>Terms of Service</>} meta={<>Draft — last updated 12 September 2026</>} />

      <section>
        <h2>1. Agreement</h2>
        <p>
          These terms govern use of Snap Apps by individuals and businesses in Australia. By creating
          an account you agree to them. If you use Snap Apps on behalf of a business, you confirm you
          are authorised to accept these terms for it.
        </p>
      </section>

      <section>
        <h2>2. The service</h2>
        <p>
          Snap Apps captures photographs of receipts and tax invoices, extracts and validates the data
          on them, and — once you confirm a document — posts it as a transaction to a double-entry
          ledger. It produces BAS worksheets, an unclaimable-GST report, and a tax pack export from
          that ledger, and can sync posted transactions to Xero if you connect it.
        </p>
      </section>

      <section>
        <h2>3. Plans, quotas, and billing</h2>
        <p>
          Snap Apps is offered on a free tier with a monthly scan limit and shorter retention, and on
          paid plans — a direct plan for individuals and sole traders, and practice plans billed to an
          accounting or bookkeeping firm on behalf of its clients. Current plan details and pricing are
          published on the pricing page. If you reach your plan&apos;s scan quota, we will never
          discard a capture you&apos;ve made — the image is still stored and you will be offered a
          top-up, and extraction resumes once quota is available.
        </p>
        <p>
          Paid plans are billed in advance and, where stated, on an annual basis at a discounted rate.
          Fees are non-refundable except where required by the Australian Consumer Law.
        </p>
      </section>

      <section>
        <h2>4. Your content, your data</h2>
        <p>
          You retain ownership of the receipts, invoices, and financial data you put into Snap Apps.
          You grant us the licence needed to process it in order to provide the service — extraction,
          storage, ledger posting, report generation, and sync to a service you&apos;ve connected. See
          the{' '}
          <a href="/legal/privacy">
            Privacy Policy
          </a>{' '}
          for how it is handled.
        </p>
      </section>

      <section>
        <h2>5. Accuracy of BAS and tax figures</h2>
        <p>
          Snap Apps applies published Australian Taxation Office rules — GST arithmetic, tax invoice
          thresholds, deduction rates — through validated, tested calculations, and every field is
          checked before a document is treated as complete. It is a tool to help you prepare your BAS
          and tax records; it is <strong>not a substitute for advice from a registered tax agent or BAS
          agent</strong>, particularly for anything unusual to your circumstances (input-taxed
          supplies, mixed-use assets, GST grouping, and similar). You remain responsible for the figures
          you lodge with the ATO. Where our underlying deduction rate tables are pending formal
          sign-off by a registered tax agent, we will not present that output as authoritative, and we
          encourage you to have a tax professional review anything you intend to lodge.
        </p>
      </section>

      <section>
        <h2>6. Acceptable use</h2>
        <p>
          Use Snap Apps only for your own genuine business or personal records. Don&apos;t attempt to
          access another workspace&apos;s data, interfere with the service, or use it to submit
          fraudulent or falsified documents.
        </p>
      </section>

      <section>
        <h2>7. Third-party connections</h2>
        <p>
          If you connect Xero or another accounting platform, that platform&apos;s own terms also
          apply to your use of it. You can disconnect at any time; see{' '}
          <a href="/docs/connecting-xero">
            Connecting Xero
          </a>
          .
        </p>
      </section>

      <section>
        <h2>8. Availability</h2>
        <p>
          We aim for the service to be reliably available but do not guarantee uninterrupted access.
          Planned maintenance and incidents are reflected on the{' '}
          <a href="/support">
            Support
          </a>{' '}
          page.
        </p>
      </section>

      <section>
        <h2>9. Liability</h2>
        <p>
          To the extent permitted by law, our liability for loss arising from your use of the service
          is limited to the amount you paid for the service in the twelve months before the claim
          arose. Nothing in these terms excludes a guarantee or right you have under the Australian
          Consumer Law that cannot lawfully be excluded.
        </p>
      </section>

      <section>
        <h2>10. Ending your account</h2>
        <p>
          You may close your account at any time through Support. We may suspend or close an account
          for a material breach of these terms. See{' '}
          <a href="/docs/data-retention">
            Data retention and deletion
          </a>{' '}
          for what happens to your records afterward.
        </p>
      </section>

      <section>
        <h2>11. Governing law</h2>
        <p>
          These terms are governed by the law of Australia, and the parties submit to the
          non-exclusive jurisdiction of its courts.
        </p>
      </section>

      <section>
        <h2>12. Changes</h2>
        <p>
          We will post any material change here and, where practical, notify account holders before it
          takes effect.
        </p>
      </section>

      <section>
        <h2>13. Contact</h2>
        <p>
          Questions about these terms go through{' '}
          <a href="/support">
            Support
          </a>
          .
        </p>
      </section>
    </article>
  );
}
