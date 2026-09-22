import type { PublishedBlogBlock, PublishedBlogPost } from '@/lib/cms/publishedContent';
import type { DocSectionMeta } from '@/components/layout/PageShell/docSections';

export type BlogPost = PublishedBlogPost;

/**
 * No invented articles. Unlike a fixed page, a CMS-owned archive can honestly be empty; falling
 * back to sample posts would publish claims nobody wrote and URLs nobody approved.
 */
export const BLOG_FALLBACK: BlogPost[] = [];

export const BLOG_SECTIONS: readonly DocSectionMeta[] = [
  { key: 'archive', number: '01', title: 'The signal archive' },
];

export const ARTICLE_SECTIONS: readonly DocSectionMeta[] = [
  { key: 'article', number: '01', title: 'Filed notes' },
];

export function resolveBlogPosts(published: PublishedBlogPost[] | null): BlogPost[] {
  return published ?? BLOG_FALLBACK;
}

export function findBlogPost(posts: readonly BlogPost[], slug: string): BlogPost | null {
  return posts.find((post) => post.slug === slug) ?? null;
}

export type BlogBlockGroup =
  | { kind: 'block'; block: PublishedBlogBlock }
  | { kind: 'list'; items: string[] };

export function groupBlogBlocks(blocks: readonly PublishedBlogBlock[]): BlogBlockGroup[] {
  const groups: BlogBlockGroup[] = [];

  for (const block of blocks) {
    const previous = groups[groups.length - 1];
    if (block.kind === 'LIST_ITEM' && previous?.kind === 'list') {
      previous.items.push(block.body);
    } else if (block.kind === 'LIST_ITEM') {
      groups.push({ kind: 'list', items: [block.body] });
    } else {
      groups.push({ kind: 'block', block });
    }
  }

  return groups;
}
