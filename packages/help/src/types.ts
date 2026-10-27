/** Who an article is for. 'all' means everyone signed in; 'admin' means anyone holding the administrator permission. */
export type Audience = 'all' | 'admin' | 'firm_admin' | 'partner' | 'manager' | 'senior' | 'staff' | 'quality_officer' | 'eqr';

export interface Article {
  id: string;
  title: string;
  /** One sentence shown in lists and search results. */
  summary: string;
  category: string;
  audience: Audience[];
  tags: string[];
  /** Page keys this article answers for ("?" help on a page). */
  topics: string[];
  /** Markdown subset: paragraphs, "## " headings, "- " bullets, "1. " steps, **bold**. */
  body: string;
}

export interface Viewer {
  role: string;
  isAdmin: boolean;
}

/** A passage of an article, the unit that search returns and a chatbot would be given. */
export interface Chunk {
  articleId: string;
  articleTitle: string;
  section: string;
  text: string;
}

export interface Hit extends Chunk {
  score: number;
  /** A short excerpt around the first matching word. */
  snippet: string;
}
