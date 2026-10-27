'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { Empty, ErrorNote } from '@/components/bits';

interface Group { category: string; articles: { id: string; title: string; summary: string }[] }
interface Hit { articleId: string; title: string; section: string; snippet: string }

function HelpHome() {
  const params = useSearchParams();
  const topic = params.get('topic');
  const browse = useApi<{ groups: Group[] }>('/help/articles');
  const forPage = useApi<{ articles: { id: string; title: string; summary: string }[] }>(topic ? `/help/topics/${encodeURIComponent(topic)}` : null);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [asked, setAsked] = useState('');
  const [error, setError] = useState<unknown>();

  async function search(ev: FormEvent) {
    ev.preventDefault();
    setError(undefined);
    const query = q.trim();
    if (query.length < 2) return;
    try {
      const r = await api.get<{ results: Hit[] }>(`/help/search?q=${encodeURIComponent(query)}`);
      setHits(r.results);
      setAsked(query);
    } catch (e) {
      setError(e);
    }
  }

  return (
    <div className="stack-lg">
      <div className="page-head">
        <h1>Help</h1>
        <p>Guides written for your role. Search in plain words, for example "how do I sign off a paper".</p>
      </div>

      <form className="sheet row" onSubmit={search} role="search">
        <label htmlFor="hq" className="sr-only">Search the help</label>
        <input id="hq" type="search" placeholder="What do you want to do?" value={q} onChange={(e) => setQ(e.target.value)} maxLength={200} style={{ flex: 1, minWidth: '16rem' }} />
        <button>Search</button>
      </form>
      <ErrorNote error={error} />

      {hits && (
        <section className="sheet stack" aria-live="polite">
          <h2>Results for "{asked}"</h2>
          {hits.length === 0 && <Empty>Nothing found for your role. Try other words, or browse the guides below.</Empty>}
          <ul className="item-list">
            {hits.map((h, i) => (
              <li key={`${h.articleId}-${i}`}>
                <Link href={`/help/${h.articleId}`}><strong>{h.title}</strong></Link>
                <div className="small muted">{h.section}</div>
                <div>{h.snippet}</div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {topic && forPage.data && (
        <section className="sheet stack">
          <h2>For the page you were on</h2>
          {forPage.data.articles.length === 0 && <Empty>There is no guide for that page for your role yet. Search above or browse below.</Empty>}
          <ul className="item-list">
            {forPage.data.articles.map((a) => (
              <li key={a.id}><Link href={`/help/${a.id}`}><strong>{a.title}</strong></Link><div className="small muted">{a.summary}</div></li>
            ))}
          </ul>
        </section>
      )}

      <ErrorNote error={browse.error} />
      {browse.data?.groups.map((g) => (
        <section key={g.category} className="sheet stack">
          <h2>{g.category}</h2>
          <ul className="item-list">
            {g.articles.map((a) => (
              <li key={a.id}><Link href={`/help/${a.id}`}><strong>{a.title}</strong></Link><div className="small muted">{a.summary}</div></li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export default function HelpPage() {
  return (
    <Suspense>
      <HelpHome />
    </Suspense>
  );
}
