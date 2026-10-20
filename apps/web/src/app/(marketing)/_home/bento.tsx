import type { ReactNode } from 'react';

import { cx } from '@/design/primitives/cx';
import { ILLUSTRATIVE_NOTE, Reveal, SectionHead } from '@/design/site';

import {
  BudgetVisual,
  ExportVisual,
  GoalsVisual,
  HouseholdVisual,
  OfflineVisual,
  RecurringVisual,
  SpendingVisual,
  TaxVisual,
} from './bento-visuals';
import './bento-styles.css';

/**
 * "Everything after the snap." — what the app does once a docket is read.
 *
 * Eight tiles on a 12-column grid (two columns from md, one on a phone), each
 * a different width and a different picture, so it reads as a collage of the
 * app and not as a row of icon cards:
 *
 *   spending 7×2 | budgets 5      (the one filled tile, the app's hero card)
 *                | goals 5
 *   tax checks 5 | recurring 4 | household 3
 *   export 7     | offline 5
 *
 * Every tile sits in its own <Reveal> so its charts grow when it is first
 * seen, and the lift-on-hover transform lives on the card inside, not on the
 * reveal wrapper (a reveal's transition would otherwise slow the hover).
 *
 * Only what the shipped personal app does. Nothing here is a business-only
 * surface (BAS, tax pack, invoices, mileage, Xero).
 */
export function HomeBento() {
  return (
    <section className="section band-mist">
      <div className="shell">
        <SectionHead
          align="split"
          title="Everything after the snap."
          lede="Reading the docket is the first job. The rest is what you do with a month of them: where it went, what is left, and which receipts need a second look."
        />

        <div className="mt-14 grid grid-cols-1 gap-4 md:grid-cols-2 lg:mt-20 lg:grid-cols-12 lg:gap-5">
          <Tile
            span="md:col-span-2 lg:col-span-7 lg:row-span-2"
            title="Spending and analytics"
            copy="The month by week and by category, from every receipt you snap."
          >
            <SpendingVisual />
          </Tile>

          <Tile
            span="lg:col-span-5"
            delay={1}
            tone="filled"
            title="Budgets"
            copy="What is left to spend, and what is safe to spend today."
          >
            <BudgetVisual />
          </Tile>

          <Tile
            span="lg:col-span-5"
            delay={2}
            title="Savings goals"
            copy="Put money toward something. Each goal shows how far along it is."
          >
            <GoalsVisual />
          </Tile>

          <Tile
            span="lg:col-span-5"
            title="Tax-invoice checks"
            copy="No ABN, or no GST breakdown? It flags the docket and suggests the fix."
          >
            <TaxVisual />
          </Tile>

          <Tile
            span="lg:col-span-4"
            delay={1}
            title="Recurring"
            copy="Subscriptions and standing bills, found in your receipts."
          >
            <RecurringVisual />
          </Tile>

          <Tile
            span="md:col-span-2 lg:col-span-3"
            delay={2}
            title="Household"
            copy="Everyone in the household sees the same budgets."
          >
            <HouseholdVisual />
          </Tile>

          <Tile
            span="md:col-span-2 lg:col-span-7"
            title="Export"
            copy="CSV, line by line. Open it in any spreadsheet."
          >
            <ExportVisual />
          </Tile>

          <Tile
            span="md:col-span-2 lg:col-span-5"
            delay={1}
            title="Works offline"
            copy="No signal at the truck stop? It waits, then uploads."
          >
            <OfflineVisual />
          </Tile>
        </div>

        <Reveal variant="fade" className="mt-8">
          <p className="small">{ILLUSTRATIVE_NOTE}</p>
        </Reveal>
      </div>
    </section>
  );
}

/**
 * One grid cell. The outer <Reveal> is the grid item (it carries the spans);
 * the inner card carries the look and the hover lift. The picture is
 * `aria-hidden` — the title and line already say what it shows.
 */
function Tile({
  span,
  delay = 0,
  tone = 'plain',
  title,
  copy,
  children,
}: {
  span: string;
  delay?: number;
  tone?: 'plain' | 'filled';
  title: string;
  copy: string;
  children: ReactNode;
}) {
  return (
    <Reveal delay={delay} className={cx('flex min-w-0', span)}>
      <article
        className={cx(
          'bento-tile card card-hover flex min-w-0 flex-1 flex-col p-6 sm:p-7',
          tone === 'filled' && 'bento-tile-grad',
        )}
      >
        <h3 className="hd-4">{title}</h3>
        <p className="small mt-1.5 max-w-[42ch]">{copy}</p>
        <div className="mt-6 grid flex-1" aria-hidden>
          {children}
        </div>
      </article>
    </Reveal>
  );
}
