import { describe, expect, test } from 'vitest';
import { articleFor, chunksOf, forTopic, listFor, searchHelp, visibleTo } from '../src/engine';
import type { Article, Viewer } from '../src/types';

const art = (over: Partial<Article> & Pick<Article, 'id'>): Article => ({
  title: over.id, summary: '', category: 'General', audience: ['all'], tags: [], topics: [], body: '', ...over,
});

const ARTICLES: Article[] = [
  art({ id: 'sign-off', title: 'Signing off a paper', audience: ['manager', 'partner'], tags: ['review', 'approve'], topics: ['paper.signoff'], body: 'Intro text.\n\n## Manager review\nThe manager checks the paper and signs it.\n\n## Partner approval\nThe partner approves the reviewed paper with a fresh code.' }),
  art({ id: 'prepare', title: 'Preparing a paper', audience: ['staff', 'senior'], tags: ['draft'], topics: ['paper.edit'], body: 'Write your notes, then mark the paper prepared.\n\n## Attach evidence\nUpload receipts and statements as evidence.' }),
  art({ id: 'people', title: 'Inviting people', audience: ['admin'], tags: ['invite'], topics: ['admin.users'], body: 'Invite a named person and give them a role.' }),
  art({ id: 'welcome', title: 'Welcome', audience: ['all'], tags: [], topics: ['dashboard'], body: 'Start from your dashboard. Your next step is shown at the top.' }),
  art({ id: 'eqr', title: 'Quality review', audience: ['eqr', 'partner'], tags: ['quality'], topics: [], body: 'The reviewer signs the final level of the quality review paper.' }),
];

const viewer = (role: string, isAdmin = false): Viewer => ({ role, isAdmin });

describe('who may see an article', () => {
  test('audiences match the role; "all" is for everyone; "admin" follows the permission, not the role', () => {
    const ids = (v: Viewer) => visibleTo(ARTICLES, v).map((a) => a.id).sort();
    expect(ids(viewer('staff'))).toEqual(['prepare', 'welcome']);
    expect(ids(viewer('manager'))).toEqual(['sign-off', 'welcome']);
    expect(ids(viewer('partner'))).toEqual(['eqr', 'sign-off', 'welcome']);
    expect(ids(viewer('partner', true))).toEqual(['eqr', 'people', 'sign-off', 'welcome']);
    expect(ids(viewer('firm_admin', true))).toEqual(['people', 'welcome']);
    expect(ids(viewer('staff', true))).toEqual(['people', 'prepare', 'welcome']);
  });

  test('an unknown role sees only what is for everyone', () => {
    expect(visibleTo(ARTICLES, viewer('intruder')).map((a) => a.id)).toEqual(['welcome']);
  });

  test('articleFor returns nothing for an article the viewer may not see, the same as for one that does not exist', () => {
    expect(articleFor(ARTICLES, viewer('staff'), 'sign-off')).toBeUndefined();
    expect(articleFor(ARTICLES, viewer('staff'), 'no-such-article')).toBeUndefined();
    expect(articleFor(ARTICLES, viewer('manager'), 'sign-off')?.id).toBe('sign-off');
  });

  test('the browse list groups visible articles by category without leaking hidden ones', () => {
    const list = listFor(ARTICLES, viewer('staff'));
    expect(list.flatMap((g) => g.articles.map((a) => a.id)).sort()).toEqual(['prepare', 'welcome']);
  });
});

describe('search never goes beyond the viewer', () => {
  test('words that appear only in a hidden article find nothing', () => {
    expect(searchHelp(ARTICLES, viewer('staff'), 'partner approves reviewed fresh code')).toEqual([]);
    expect(searchHelp(ARTICLES, viewer('staff'), 'invite named person')).toEqual([]);
  });

  test('the same words find the article for a role that may see it', () => {
    const hits = searchHelp(ARTICLES, viewer('manager'), 'partner approval');
    expect(hits[0]).toMatchObject({ articleId: 'sign-off', section: 'Partner approval' });
  });

  test('hits carry the chunk text, a citation and a snippet that contains the matched word', () => {
    const [hit] = searchHelp(ARTICLES, viewer('staff'), 'receipts');
    expect(hit).toMatchObject({ articleId: 'prepare', articleTitle: 'Preparing a paper', section: 'Attach evidence' });
    expect(hit!.text).toContain('receipts');
    expect(hit!.snippet.toLowerCase()).toContain('receipts');
  });

  test('a title match outranks a body match', () => {
    const items = [
      art({ id: 'a', title: 'Materiality', body: 'How to set the figure.' }),
      art({ id: 'b', title: 'Other topic', body: 'Materiality is mentioned here in passing.' }),
    ];
    expect(searchHelp(items, viewer('staff'), 'materiality').map((h) => h.articleId)).toEqual(['a', 'b']);
  });

  test('plurals and case do not matter, and punctuation is ignored', () => {
    expect(searchHelp(ARTICLES, viewer('staff'), 'RECEIPT!').length).toBeGreaterThan(0);
    expect(searchHelp(ARTICLES, viewer('manager'), 'Approvals?').length).toBeGreaterThan(0);
  });

  test('empty, one-letter and stop-word-only queries return nothing', () => {
    for (const q of ['', '   ', 'a', 'the and of']) expect(searchHelp(ARTICLES, viewer('manager'), q)).toEqual([]);
  });

  test('the limit is respected and results come best first', () => {
    const many = Array.from({ length: 30 }, (_, i) => art({ id: `x${i}`, title: `Paper ${i}`, body: 'paper '.repeat(i + 1) }));
    const hits = searchHelp(many, viewer('staff'), 'paper', { limit: 5 });
    expect(hits).toHaveLength(5);
    expect(hits.map((h) => h.score)).toEqual([...hits.map((h) => h.score)].sort((a, b) => b - a));
  });

  test('a very long query is harmless', () => {
    expect(() => searchHelp(ARTICLES, viewer('staff'), 'paper '.repeat(5000))).not.toThrow();
  });
});

describe('chunks', () => {
  test('an article is split at its headings, with the opening text under the title', () => {
    const chunks = chunksOf(ARTICLES[0]!);
    expect(chunks.map((c) => c.section)).toEqual(['Signing off a paper', 'Manager review', 'Partner approval']);
    expect(chunks[1]!.text).toBe('The manager checks the paper and signs it.');
  });

  test('empty sections are dropped', () => {
    expect(chunksOf(art({ id: 'e', body: '## One\n\n## Two\ntext' })).map((c) => c.section)).toEqual(['Two']);
  });
});

describe('help on this page', () => {
  test('returns the viewer-visible articles for a page key, best match first', () => {
    expect(forTopic(ARTICLES, viewer('manager'), 'paper.signoff').map((a) => a.id)).toEqual(['sign-off']);
    expect(forTopic(ARTICLES, viewer('staff'), 'paper.signoff')).toEqual([]);
    expect(forTopic(ARTICLES, viewer('staff'), 'dashboard').map((a) => a.id)).toEqual(['welcome']);
  });
});
