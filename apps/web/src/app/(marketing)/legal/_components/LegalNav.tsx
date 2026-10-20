'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LEGAL_NAV = [
  { href: '/legal/privacy', title: 'Privacy Policy' },
  { href: '/legal/terms', title: 'Terms of Service' },
  { href: '/legal/security', title: 'Data handling & security' },
];

/** Sticky mini-nav between the three legal pages. */
export function LegalNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Legal pages" className="legal-nav">
      <div className="legal-nav-inner no-scrollbar">
        {LEGAL_NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="legal-nav-link"
            aria-current={pathname === item.href ? 'page' : undefined}
          >
            {item.title}
          </Link>
        ))}
      </div>
    </nav>
  );
}
