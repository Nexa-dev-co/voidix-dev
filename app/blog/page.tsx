import type { Metadata } from 'next';
import BlogPage from '@/components/pages/Blog/BlogPage';
import { resolveBlogPosts } from '@/components/pages/Blog/blogContent';
import SiteContentProvider from '@/lib/cms/SiteContentProvider';
import { reportContent } from '@/lib/cms/contentReport';
import { fetchPublishedContent } from '@/lib/cms/fetchPublishedContent';
import { resolveSharedContent } from '@/lib/cms/siteContent';

export const revalidate = 600;

export const metadata: Metadata = {
  title: 'Field Journal | Voidix',
  alternates: { canonical: '/blog' },
  description:
    'Engineering notes, product decisions, and lessons from building custom software with its own gravity.',
  openGraph: {
    title: 'Field Journal | Voidix',
    description: 'Decisions, failures, and engineering details from inside the build.',
    type: 'website',
  },
};

export default async function Blog() {
  const release = await fetchPublishedContent();
  const report = reportContent({ route: '/blog', release, scope: 'shared', pageKey: 'blogs' });

  return (
    <SiteContentProvider content={resolveSharedContent(release.payload)} report={report}>
      <BlogPage posts={resolveBlogPosts(release.payload?.blogs ?? null)} />
    </SiteContentProvider>
  );
}
