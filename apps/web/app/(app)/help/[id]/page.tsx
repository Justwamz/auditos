'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useApi } from '@/lib/hooks';
import { Markdown } from '@/components/Markdown';

interface Article { id: string; title: string; summary: string; category: string; body: string }

export default function ArticlePage() {
  const { id } = useParams<{ id: string }>();
  const article = useApi<Article>(`/help/articles/${encodeURIComponent(id)}`);
  if (article.error) {
    return (
      <div className="stack">
        <p className="small"><Link href="/help">All help</Link></p>
        <div className="notice error" role="alert">That guide could not be found, or it is not written for your role.</div>
      </div>
    );
  }
  if (!article.data) return <p className="muted">Loading…</p>;
  const a = article.data;
  return (
    <div className="stack-lg">
      <div className="page-head">
        <p className="small"><Link href="/help">All help</Link> · {a.category}</p>
        <h1>{a.title}</h1>
        <p>{a.summary}</p>
      </div>
      <article className="sheet">
        <Markdown source={a.body} />
      </article>
    </div>
  );
}
