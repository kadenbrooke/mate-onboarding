import Link from 'next/link';
// BackLink is a Server Component: @phosphor-icons/react's default import
// uses React Context internally and is client-only. The /dist/ssr subpath
// (same one [sessionId]/layout.tsx already uses for SignOut) is the
// server-safe variant -- using the default import here is what threw
// "createContext only works in Client Components" / "createContext is not
// a function" (production build's less-obvious version of the same error).
import { ArrowLeft } from '@phosphor-icons/react/dist/ssr';
import { FONT_BODY, TEXT_MUTED } from '@/lib/theme';

// Standalone sub-pages (the full leads table, the standalone assistant
// page) used to rely on TopBar's desktop nav pills as "the way back" -- but
// those pills are hidden on mobile (<=640px), which left mobile users
// stranded with no back button at all. This is the fix: an explicit link
// back to the dashboard root, shown on every sub-page regardless of screen
// size.

export function BackLink({ href }: { href: string }) {
  return (
    <Link
      href={href}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        fontSize: 13, fontWeight: 600, fontFamily: FONT_BODY, color: TEXT_MUTED,
        textDecoration: 'none',
      }}
    >
      <ArrowLeft size={15} weight="bold" aria-hidden /> Dashboard
    </Link>
  );
}
