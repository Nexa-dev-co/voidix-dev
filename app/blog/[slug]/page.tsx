import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import BlogArticlePage from '@/components/pages/Blog/BlogArticlePage';
import { findBlogPost, resolveBlogPosts } from '@/components/pages/Blog/blogContent';
import SiteContentProvider from '@/lib/cms/SiteContentProvider';
import { fetchPublishedContent } from '@/lib/cms/fetchPublishedContent';
import { resolveSharedContent } from '@/lib/cms/siteContent';

export const revalidate = 600;

interface BlogArticleRouteProps {
  params: { slug: string };
}

export async function generateMetadata({ params }: BlogArticleRouteProps): Promise<Metadata> {
  const release = await fetchPublishedContent();
  const post = findBlogPost(resolveBlogPosts(release.payload?.blogs ?? null), params.slug);

  if (!post) return {};

  return {
    title: post.seoTitle,
    description: post.excerpt,
    alternates: { canonical: `/blog/${post.slug}` },
    openGraph: { title: post.title, description: post.excerpt, type: 'article' },
  };
}

export default async function BlogArticle({ params }: BlogArticleRouteProps) {
  const release = await fetchPublishedContent();
  const posts = resolveBlogPosts(release.payload?.blogs ?? null);
  const post = findBlogPost(posts, params.slug);
  if (!post) notFound();

  const currentIndex = posts.findIndex((entry) => entry.slug === post.slug);
  const nextPost = posts[currentIndex + 1] ?? null;

  return (
    <SiteContentProvider content={resolveSharedContent(release.payload)}>
      <BlogArticlePage post={post} nextPost={nextPost} />
    </SiteContentProvider>
  );
}
