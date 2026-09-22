import Link from 'next/link';
import type { CSSProperties } from 'react';
import DocSection from '@/components/layout/PageShell/DocSection';
import PageShell from '@/components/layout/PageShell/PageShell';
import { BLOG_SECTIONS, type BlogPost } from './blogContent';

interface BlogPageProps {
  posts: BlogPost[];
}

export default function BlogPage({ posts }: BlogPageProps) {
  const [leadPost, ...remainingPosts] = posts;

  return (
    <PageShell
      eyebrow="Voidix field journal"
      title={['Notes from the edge.', 'Proof from the build.']}
      lead="Systems leave traces. We publish the decisions, failures, and engineering details that survive the final frame."
      sections={BLOG_SECTIONS}
    >
      <DocSection meta={BLOG_SECTIONS[0]} wide>
        {!leadPost ? (
          <div className="blog-empty">
            <p className="font-display blog-empty-title">No signals have cleared the horizon yet.</p>
            <p className="blog-empty-copy">The archive will open with the first published field note.</p>
          </div>
        ) : (
          <>
            <Link href={`/blog/${leadPost.slug}`} className="blog-feature">
              <span className="blog-feature-orbit" aria-hidden="true" />
              <span className="blog-feature-meta">
                <span>{leadPost.category}</span>
                <time dateTime={leadPost.publishedOn}>{leadPost.publishedOn.replaceAll('-', ' / ')}</time>
              </span>
              <span className="font-display blog-feature-title">{leadPost.title}</span>
              <span className="blog-feature-excerpt">{leadPost.excerpt}</span>
              <span className="blog-feature-read">
                Enter transmission <span aria-hidden="true">{'\u2192'}</span>
              </span>
            </Link>

            {remainingPosts.length > 0 && (
              <ol className="blog-list">
                {remainingPosts.map((post, index) => (
                  <li
                    key={post.slug}
                    className="blog-entry"
                    style={{ '--reveal-index': index + 1 } as CSSProperties}
                  >
                    <Link href={`/blog/${post.slug}`} className="blog-entry-link">
                      <span className="font-display blog-entry-index">{post.index}</span>
                      <span className="blog-entry-copy">
                        <span className="blog-entry-meta">
                          <span>{post.category}</span>
                          <time dateTime={post.publishedOn}>{post.publishedOn.replaceAll('-', ' / ')}</time>
                        </span>
                        <span className="font-display blog-entry-title">{post.title}</span>
                        <span className="blog-entry-excerpt">{post.excerpt}</span>
                      </span>
                      <span className="blog-entry-glyph" aria-hidden="true">{'\u2192'}</span>
                    </Link>
                  </li>
                ))}
              </ol>
            )}
          </>
        )}
      </DocSection>
    </PageShell>
  );
}
