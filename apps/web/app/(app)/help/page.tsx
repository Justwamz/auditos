'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { ErrorNote } from '@/components/bits';
import { Disclosure } from '@/components/ui/Disclosure';
import { EmptyState, Skeleton } from '@/components/ui/EmptyState';
import { PageHead } from '@/components/ui/PageHead';

interface Article { id: string; title: string; summary: string }
interface Group { category: string; articles: Article[] }
interface Hit { articleId: string; title: string; section: string; snippet: string }

function ArticleList({ articles }: { articles: Article[] }) {
  return (
    <ul className="item-list">
      {articles.map((a) => (
        <li key={a.id}><Link href={`/help/${a.id}`}><strong>{a.title}</strong></Link><div className="small muted">{a.summary}</div></li>
      ))}
    </ul>
  );
}

function HelpHome() {
  const params = useSearchParams();
  const topic = params.get('topic');
  const browse = useApi<{ groups: Group[] }>('/help/articles');
  const forPage = useApi<{ articles: Article[] }>(topic ? `/help/topics/${encodeURIComponent(topic)}` : null);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [asked, setAsked] = useState('');
  const [error, setError] = useState<unknown>();
  const [openGroup, setOpenGroup] = useState<string | null>(null);

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
      <PageHead title="Help" sentence={'Guides written for your role. Search in plain words, for example "how do I sign off a paper".'} />

      <form className="sheet row" onSubmit={search} role="search">
        <label htmlFor="hq" className="sr-only">Search the help</label>
        <input id="hq" type="search" placeholder="What do you want to do?" value={q} onChange={(e) => setQ(e.target.value)} maxLength={200} style={{ flex: 1, minWidth: '16rem' }} />
        <button>Search</button>
      </form>
      <ErrorNote error={error} />

      {hits && (
        <section className="sheet stack" aria-live="polite" aria-labelledby="help-results">
          <h2 id="help-results">Results for "{asked}"</h2>
          {hits.length === 0 && <EmptyState kind="folder" title="Nothing found for your role">Try other words, or browse the guides below.</EmptyState>}
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
          {forPage.data.articles.length === 0 ? (
            <EmptyState kind="folder" title="No guide for that page yet">There is no guide for that page for your role yet. Search above or browse below.</EmptyState>
          ) : (
            <ArticleList articles={forPage.data.articles} />
          )}
        </section>
      )}

      <ErrorNote error={browse.error} />
      {browse.loading && !browse.data && (
        <section className="sheet prospects-loading" aria-label="Loading guides">
          <Skeleton height={48} />
          <Skeleton height={48} />
          <Skeleton height={48} />
        </section>
      )}
      {browse.data && (
        <section className="sheet stack" aria-labelledby="help-all">
          <h2 id="help-all">All guides</h2>
          {browse.data.groups.map((g) => (
            <Disclosure
              key={g.category}
              open={openGroup === g.category}
              onToggle={(on) => setOpenGroup(on ? g.category : null)}
              summary={<span>{g.category} <span className="muted small">({g.articles.length})</span></span>}
            >
              <ArticleList articles={g.articles} />
            </Disclosure>
          ))}
        </section>
      )}
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
