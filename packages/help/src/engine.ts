import type { Article, Chunk, Hit, Viewer } from './types';

const STOP = new Set([
  'the', 'and', 'of', 'a', 'an', 'to', 'in', 'on', 'for', 'is', 'are', 'it', 'how', 'do', 'does', 'i', 'my', 'can', 'you', 'what', 'with', 'be', 'or', 'at', 'by', 'as', 'this', 'that',
]);

/** Role first: an article reaches a viewer only if its audience names them. Everything else in this file works on that filtered list. */
const allowed = (a: Article, v: Viewer): boolean =>
  a.audience.includes('all') || a.audience.includes(v.role as never) || (a.audience.includes('admin') && (v.isAdmin || v.role === 'firm_admin'));

export const visibleTo = (articles: Article[], v: Viewer): Article[] => articles.filter((a) => allowed(a, v));

/** An article the viewer may not see is indistinguishable from one that does not exist. */
export const articleFor = (articles: Article[], v: Viewer, id: string): Article | undefined => visibleTo(articles, v).find((a) => a.id === id);

export function listFor(articles: Article[], v: Viewer): { category: string; articles: Pick<Article, 'id' | 'title' | 'summary'>[] }[] {
  const groups = new Map<string, Pick<Article, 'id' | 'title' | 'summary'>[]>();
  for (const a of visibleTo(articles, v)) groups.set(a.category, [...(groups.get(a.category) ?? []), { id: a.id, title: a.title, summary: a.summary }]);
  return [...groups.entries()]
    .sort(([x], [y]) => x.localeCompare(y))
    .map(([category, list]) => ({ category, articles: list.sort((x, y) => x.title.localeCompare(y.title)) }));
}

export const forTopic = (articles: Article[], v: Viewer, topic: string): Article[] => visibleTo(articles, v).filter((a) => a.topics.includes(topic));

/** Splits an article at its "## " headings. Text before the first heading belongs under the article title. */
export function chunksOf(a: Article): Chunk[] {
  const out: Chunk[] = [];
  let section = a.title;
  let lines: string[] = [];
  const flush = () => {
    const text = lines.join('\n').trim();
    if (text !== '') out.push({ articleId: a.id, articleTitle: a.title, section, text });
    lines = [];
  };
  for (const line of a.body.split('\n')) {
    const h = /^##\s+(.+?)\s*$/.exec(line);
    if (h) {
      flush();
      section = h[1]!;
    } else {
      lines.push(line);
    }
  }
  flush();
  return out;
}

/** Lower-case words with a light stem, so "approvals", "approval" and "approves" meet. */
export function tokens(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 2 || STOP.has(raw)) continue;
    out.push(stem(raw));
  }
  return out;
}

function stem(w: string): string {
  let s = w;
  for (const suffix of ['ings', 'ing', 'ed', 'es', 's']) {
    if (s.endsWith(suffix) && s.length - suffix.length >= 3 && !(suffix === 's' && s.endsWith('ss'))) {
      s = s.slice(0, -suffix.length);
      break;
    }
  }
  return s.length > 3 && s.endsWith('e') ? s.slice(0, -1) : s;
}

const MAX_QUERY_TOKENS = 20;
const K = 1.2;

interface Indexed extends Chunk {
  body: Map<string, number>;
  title: Set<string>;
  tags: Set<string>;
}

function snippetOf(text: string, stems: string[]): string {
  const lower = text.toLowerCase();
  let at = -1;
  for (const s of stems) {
    const i = lower.indexOf(s);
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  if (at < 0) return text.slice(0, 160);
  const start = Math.max(0, at - 60);
  const end = Math.min(text.length, at + 100);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
}

/**
 * Ranked passages for a question, from the articles this viewer may see and no others. The filter is applied before
 * anything is indexed or scored, so a hidden article can influence neither the results nor their order.
 */
export function searchHelp(articles: Article[], v: Viewer, query: string, opts: { limit?: number } = {}): Hit[] {
  const q = [...new Set(tokens(query))].slice(0, MAX_QUERY_TOKENS);
  if (q.length === 0) return [];

  const index: Indexed[] = visibleTo(articles, v).flatMap((a) =>
    chunksOf(a).map((c) => {
      const body = new Map<string, number>();
      for (const t of tokens(c.text)) body.set(t, (body.get(t) ?? 0) + 1);
      return { ...c, body, title: new Set(tokens(`${a.title} ${c.section}`)), tags: new Set(tokens(a.tags.join(' '))) };
    }),
  );
  if (index.length === 0) return [];

  const df = (t: string) => index.filter((c) => c.body.has(t) || c.title.has(t) || c.tags.has(t)).length;
  const idf = new Map(q.map((t) => [t, Math.log(1 + index.length / (1 + df(t)))]));

  const hits: Hit[] = [];
  for (const c of index) {
    let score = 0;
    for (const t of q) {
      const tf = c.body.get(t) ?? 0;
      const part = (tf * (K + 1)) / (tf + K) + (c.title.has(t) ? 3 : 0) + (c.tags.has(t) ? 2 : 0);
      score += (idf.get(t) ?? 0) * part;
    }
    if (score > 0) hits.push({ articleId: c.articleId, articleTitle: c.articleTitle, section: c.section, text: c.text, score, snippet: snippetOf(c.text, q) });
  }
  return hits.sort((x, y) => y.score - x.score).slice(0, opts.limit ?? 10);
}
