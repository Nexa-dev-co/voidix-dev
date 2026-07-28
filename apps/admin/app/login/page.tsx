import LoginForm from './LoginForm';

export default function LoginPage({
  searchParams,
}: {
  searchParams: { next?: string };
}) {
  return (
    <main className="min-h-screen grid place-items-center px-6">
      <div className="w-full max-w-sm">
        <div className="mb-10">
          <p className="eyebrow mb-3">Voidix</p>
          <h1 className="font-display text-3xl font-extrabold tracking-tight">Control</h1>
          <p className="text-sm mt-2" style={{ color: 'var(--muted)' }}>
            Sign in to edit what voidix.tech shows.
          </p>
        </div>

        <LoginForm next={searchParams.next ?? '/'} />
      </div>
    </main>
  );
}
