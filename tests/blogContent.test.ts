import assert from 'node:assert/strict';
import test from 'node:test';
import * as blogContent from '../components/pages/Blog/blogContent';
import {
  findBlogPost,
  resolveBlogPosts,
  type BlogPost,
} from '../components/pages/Blog/blogContent';

const publishedPost = {
  index: '01',
  slug: 'designing-for-the-last-frame',
  title: 'Designing for the last frame',
  excerpt: 'What a cinematic interface owes the person using it.',
  category: 'Interaction',
  publishedOn: '2026-09-21',
  seoTitle: 'Designing for the last frame | Voidix',
  body: [
    { kind: 'PARAGRAPH' as const, body: 'The opening moment gets attention.' },
    { kind: 'PARAGRAPH' as const, body: 'The final frame earns trust.' },
  ],
};

test('resolves published blog posts without mixing in fallback copy', () => {
  const posts = resolveBlogPosts([publishedPost]);

  assert.deepEqual(posts, [publishedPost satisfies BlogPost]);
});

test('keeps an intentionally empty published archive empty', () => {
  assert.deepEqual(resolveBlogPosts([]), []);
});

test('finds a post by its stable CMS slug', () => {
  assert.equal(findBlogPost([publishedPost], publishedPost.slug)?.title, publishedPost.title);
  assert.equal(findBlogPost([publishedPost], 'missing-post'), null);
});

test('groups consecutive article list items for semantic rendering', () => {
  assert.equal(typeof blogContent.groupBlogBlocks, 'function');

  const grouped = blogContent.groupBlogBlocks!([
    { kind: 'PARAGRAPH', body: 'Opening.' },
    { kind: 'LIST_ITEM', body: 'First' },
    { kind: 'LIST_ITEM', body: 'Second' },
    { kind: 'HEADING_2', body: 'Next section' },
  ]);

  assert.deepEqual(grouped, [
    { kind: 'block', block: { kind: 'PARAGRAPH', body: 'Opening.' } },
    { kind: 'list', items: ['First', 'Second'] },
    { kind: 'block', block: { kind: 'HEADING_2', body: 'Next section' } },
  ]);
});
