import Link from 'next/link';

import { signOut } from '@/app/login/actions';
import { createSupabaseServerClient } from '@/lib/supabaseServer';

const NAV_ITEMS = [
  { href: '/', label: 'Overview' },
  { href: '/services', label: 'Services' },
  { href: '/projects', label: 'Work' },
  { href: '/faq', label: 'FAQ' },
];

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  // The middleware already turned away anyone signed out; this is only to show who's signed in.
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b" style={{ borderColor: 'var(--border)' }}>
        <div className="mx-auto max-w-5xl px-6 py-4 flex flex-wrap items-center gap-x-8 gap-y-3">
          <Link href="/" className="font-display font-extrabold tracking-tight">
            Voidix<span style={{ color: 'var(--accent)' }}>.</span>Control
          </Link>

          <nav className="flex items-center gap-6 text-sm">
            {NAV_ITEMS.map((item) => (
              <Link key={item.href} href={item.href} className="hover:opacity-100 opacity-70 transition-opacity">
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-4">
            <span className="text-xs" style={{ color: 'var(--muted)' }}>
              {user?.email}
            </span>
            <form action={signOut}>
              <button type="submit" className="button button-secondary">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl px-6 py-10 flex-1">{children}</main>
    </div>
  );
}
