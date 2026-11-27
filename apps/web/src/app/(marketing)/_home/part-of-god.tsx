import { GOD_BRANDS, otherBrandSites } from '@/lib/god-brands';

/**
 * "Part of GOD" (founder request 2026-11-27): every GOD brand website says it belongs to the group and
 * links to the GOD site and to its sister brands' sites. It sits below the main content of the home page,
 * above the footer, and is NOT part of the header or footer components.
 *
 * Names, purposes and URLs come from `lib/god-brands.ts`, which a CI drift test pins to god.gaiada.com's
 * brands.json. Links open in a new tab, carry no query string or fragment, and track nothing.
 */
const card =
  'group flex items-center gap-4 rounded-[var(--s-radius-sm)] border border-[var(--s-edge-2)] bg-[var(--s-card)] p-4 shadow-[var(--s-shadow-1)] transition-shadow hover:shadow-[var(--s-shadow-2)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--s-brand)]';

export function HomePartOfGod() {
  const { god } = GOD_BRANDS;
  const others = otherBrandSites();
  return (
    <section className="section-tight" aria-labelledby="home-god-title">
      <div className="shell">
        <div className="rounded-[var(--s-radius)] border border-[var(--s-edge)] bg-[var(--s-mist)] px-6 py-10 sm:px-12 sm:py-12">
          <div className="grid gap-8 lg:grid-cols-[1fr_1.4fr] lg:gap-14">
            <div>
              <p className="kicker">Part of {god.name}</p>
              <h2 id="home-god-title" className="mt-3 text-[1.5rem] font-[650] leading-tight text-[var(--s-ink)]">
                SnapApps is part of {god.name} ({god.fullName}).
              </h2>
              <p className="mt-4 max-w-[46ch] text-[1rem] leading-relaxed text-[var(--s-ink-2)]">
                {god.name} is the Australian group behind YourTal, SnapApps, Free Tax Returns and Spambank.
              </p>
              <a
                href={god.url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`About ${god.name} (${god.fullName}), opens in a new tab`}
                className="mt-5 inline-flex min-h-11 items-center font-[600] text-[var(--s-brand-text)] underline decoration-[var(--s-brand-text)]/35 underline-offset-[3px] hover:decoration-current focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--s-brand)]"
              >
                Visit {god.name}
              </a>
            </div>
            <ul className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3" aria-label="Other GOD brands">
              {others.map((b) => (
                <li key={b.key}>
                  <a
                    href={b.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`${b.name}: ${b.purpose}, opens in a new tab`}
                    className={`${card} h-full sm:flex-col sm:items-start lg:flex-row lg:items-center xl:flex-col xl:items-start`}
                  >
                    <span className="flex size-12 shrink-0 items-center justify-center rounded-[12px] bg-white p-1.5 ring-1 ring-[var(--s-edge-2)]">
                      {/* eslint-disable-next-line @next/next/no-img-element -- a small static mark */}
                      <img src={b.icon} alt="" width={36} height={36} className="size-full object-contain" />
                    </span>
                    <span>
                      <span className="block font-[650] text-[var(--s-ink)]">{b.name}</span>
                      <span className="mt-0.5 block text-[0.9rem] leading-snug text-[var(--s-ink-3)]">{b.purpose}</span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
