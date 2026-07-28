import Link from 'next/link';
import { MAX_WORKS_PROJECTS } from '@voidix/content';

import { publish } from '@/app/actions';
import EditorForm from '@/components/EditorForm/EditorForm';
import {
  fetchFaqEntries,
  fetchLatestPublication,
  fetchProjects,
  fetchServices,
} from '@/lib/contentQueries';

export const dynamic = 'force-dynamic';

export default async function OverviewPage() {
  const [services, projects, faqEntries, publication] = await Promise.all([
    fetchServices(),
    fetchProjects(),
    fetchFaqEntries(),
    fetchLatestPublication(),
  ]);

  const collections = [
    { href: '/services', label: 'Services', count: services.length, limit: null },
    { href: '/projects', label: 'Work', count: projects.length, limit: MAX_WORKS_PROJECTS },
    { href: '/faq', label: 'FAQ', count: faqEntries.length, limit: null },
  ];

  return (
    <div className="flex flex-col gap-12">
      <section>
        <p className="eyebrow mb-3">Draft</p>
        <h1 className="font-display text-3xl font-extrabold tracking-tight mb-2">What you&rsquo;re editing</h1>
        <p className="text-sm max-w-xl leading-relaxed" style={{ color: 'var(--muted)' }}>
          Changes here are private until you publish. The live site keeps serving the last published
          version, so nothing you type is visible to visitors until you say so.
        </p>

        <div className="grid gap-3 sm:grid-cols-3 mt-6">
          {collections.map((collection) => (
            <Link
              key={collection.href}
              href={collection.href}
              className="panel-card p-5 hover:border-opacity-30 transition-colors"
            >
              <p className="eyebrow mb-2">{collection.label}</p>
              <p className="font-display text-2xl font-bold">
                {collection.count}
                {collection.limit ? (
                  <span className="text-sm font-normal" style={{ color: 'var(--muted)' }}>
                    {' '}
                    / {collection.limit}
                  </span>
                ) : null}
              </p>
            </Link>
          ))}
        </div>
      </section>

      <section className="panel-card p-6">
        <p className="eyebrow mb-3">Publish</p>
        <h2 className="font-display text-xl font-bold mb-2">Push the draft live</h2>

        <p className="text-sm leading-relaxed mb-6 max-w-xl" style={{ color: 'var(--muted)' }}>
          {publication ? (
            <>
              voidix.tech is currently serving <strong style={{ color: 'var(--fg)' }}>version {publication.version}</strong>
              {publication.label ? ` — “${publication.label}”` : ''}, published{' '}
              {new Date(publication.publishedAt).toLocaleString()}.
            </>
          ) : (
            'Nothing has been published yet, so the site is showing the copy compiled into its build.'
          )}
        </p>

        <EditorForm
          action={publish}
          submitLabel="Publish to voidix.tech"
          pendingLabel="Publishing…"
          hint="Every publish is kept, so an earlier version can always be restored."
        >
          <div>
            <label className="field-label" htmlFor="label">
              What changed (optional)
            </label>
            <input
              id="label"
              name="label"
              type="text"
              className="field-input"
              placeholder="e.g. new Cinder case study copy"
              maxLength={120}
            />
          </div>
        </EditorForm>
      </section>
    </div>
  );
}
