import type { ReactNode } from 'react';

/** Bold text inside a line. Only **bold** is supported; everything else is shown as plain text. */
function inline(text: string): ReactNode[] {
  return text.split('**').map((part, i) => (i % 2 === 1 ? <strong key={i}>{part}</strong> : part));
}

/**
 * Renders the small Markdown subset used by the help articles: paragraphs, "## " headings, "- " bullets and "1. " steps.
 * Built from elements, never from HTML strings, so article text cannot inject markup.
 */
export function Markdown({ source }: { source: string }) {
  const blocks: ReactNode[] = [];
  const lines = source.split('\n');
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim() === '') {
      i += 1;
    } else if (line.startsWith('## ')) {
      blocks.push(<h3 key={key++}>{line.slice(3)}</h3>);
      i += 1;
    } else if (line.startsWith('- ')) {
      const items: string[] = [];
      while (i < lines.length && lines[i]!.startsWith('- ')) items.push(lines[i++]!.slice(2));
      blocks.push(<ul key={key++}>{items.map((t, n) => <li key={n}>{inline(t)}</li>)}</ul>);
    } else if (/^\d+\. /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\. /.test(lines[i]!)) items.push(lines[i++]!.replace(/^\d+\. /, ''));
      blocks.push(<ol key={key++}>{items.map((t, n) => <li key={n}>{inline(t)}</li>)}</ol>);
    } else {
      const para: string[] = [];
      while (i < lines.length && lines[i]!.trim() !== '' && !lines[i]!.startsWith('## ') && !lines[i]!.startsWith('- ') && !/^\d+\. /.test(lines[i]!)) para.push(lines[i++]!);
      blocks.push(<p key={key++}>{inline(para.join(' '))}</p>);
    }
  }
  return <div className="prose">{blocks}</div>;
}
