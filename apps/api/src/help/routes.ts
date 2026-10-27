import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ARTICLES, articleFor, forTopic, listFor, searchHelp, type Viewer } from '@auditos/help';
import { actorOf, httpError } from '../authz';

const searchQuery = z.object({
  q: z.string().trim().min(2).max(200),
  limit: z.coerce.number().int().min(1).max(20).default(8),
  /** Include the full passage text, for a program that answers questions from the help (the planned chatbot). */
  full: z.enum(['1', 'true']).optional(),
});
const topicParam = z.string().regex(/^[a-z0-9.-]{1,60}$/);

/** The signed-in person, as the help sees them. Role and the administrator permission decide what they may read. */
const viewerOf = (req: FastifyRequest): Viewer => {
  const a = actorOf(req);
  return { role: a.role, isAdmin: a.isAdmin === true || a.role === 'firm_admin' };
};

export async function helpRoutes(app: FastifyInstance): Promise<void> {
  /** Browse: the articles this person may read, grouped. */
  app.get('/help/articles', { config: { access: 'tenant' } }, async (req) => ({ groups: listFor(ARTICLES, viewerOf(req)) }));

  /** One article. One the person may not read answers exactly as one that does not exist. */
  app.get<{ Params: { id: string } }>('/help/articles/:id', { config: { access: 'tenant' } }, async (req) => {
    const a = articleFor(ARTICLES, viewerOf(req), req.params.id);
    if (!a) throw httpError(404, 'not_found');
    return { id: a.id, title: a.title, summary: a.summary, category: a.category, body: a.body };
  });

  /**
   * Search. The role filter runs before any scoring, so results can never come from a hidden article.
   * The same call, with full=1, is the retrieval step a chatbot would use, with a citation on every passage.
   */
  app.get('/help/search', { config: { access: 'tenant', rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req) => {
    const q = searchQuery.parse(req.query);
    const hits = searchHelp(ARTICLES, viewerOf(req), q.q, { limit: q.limit });
    return {
      query: q.q,
      results: hits.map((h) => ({
        articleId: h.articleId, title: h.articleTitle, section: h.section, snippet: h.snippet, score: Math.round(h.score * 100) / 100,
        ...(q.full ? { text: h.text } : {}),
      })),
    };
  });

  /** Help for the page the person is on ("?"). */
  app.get<{ Params: { topic: string } }>('/help/topics/:topic', { config: { access: 'tenant' } }, async (req) => {
    const topic = topicParam.safeParse(req.params.topic);
    if (!topic.success) throw httpError(404, 'not_found');
    return { articles: forTopic(ARTICLES, viewerOf(req), topic.data).map((a) => ({ id: a.id, title: a.title, summary: a.summary })) };
  });
}
