'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export const NAV = [
  { href: '/app', label: 'Treasury', match: (p: string) => p === '/app' || p.startsWith('/app/') },
  { href: '/tripwire', label: 'Tripwire', match: (p: string) => p.startsWith('/tripwire') },
  { href: '/scan', label: 'Scan', match: (p: string) => p.startsWith('/scan') },
  { href: '/verify', label: 'Verify', match: (p: string) => p.startsWith('/verify') },
];

export function NavLinks({ className }: { className?: string }) {
  const path = usePathname() ?? '/';
  return (
    <ul className={className}>
      {NAV.map((n) => (
        <li key={n.href}>
          <Link href={n.href} aria-current={n.match(path) ? 'page' : undefined}>
            {n.label}
          </Link>
        </li>
      ))}
    </ul>
  );
}
