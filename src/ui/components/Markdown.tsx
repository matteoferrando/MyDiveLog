/**
 * Markdown minimo, scritto a mano.
 *
 * Serve a mostrare le analisi generate: intestazioni, grassetto, corsivo, codice
 * in linea, elenchi puntati e numerati, paragrafi. Niente tabelle, niente
 * immagini, niente link — non compaiono nelle risposte che chiediamo, e ogni
 * costrutto in più è codice da mantenere.
 *
 * Perché non `marked` o `react-markdown`: sono 30–100 KB per un sottoinsieme che
 * qui sta in ottanta righe, su un progetto che gira su tre piattaforme e che ha
 * già scelto di scrivere a mano il lettore SQLite e lo scompattatore gzip.
 *
 * SICUREZZA: niente `dangerouslySetInnerHTML`. Il testo viene trasformato in
 * elementi React, quindi qualunque cosa arrivi dal modello resta testo e non può
 * diventare markup eseguibile.
 */

import type { ReactNode } from 'react';

export function Markdown({ text }: { text: string }) {
  return <div className="markdown">{render(text)}</div>;
}

function render(text: string): ReactNode[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const out: ReactNode[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let key = 0;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    out.push(<p key={key++}>{inline(paragraph.join(' '))}</p>);
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    const items = list.items.map((item, i) => <li key={i}>{inline(item)}</li>);
    out.push(list.ordered ? <ol key={key++}>{items}</ol> : <ul key={key++}>{items}</ul>);
    list = null;
  };
  const flushAll = () => {
    flushParagraph();
    flushList();
  };

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (!line.trim()) {
      flushAll();
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      flushAll();
      const level = heading[1].length;
      const content = inline(heading[2]);
      // Le intestazioni delle analisi partono da ## : le mappiamo su h3/h4 per
      // non competere con il titolo della carta che le contiene.
      out.push(
        level <= 2 ? <h3 key={key++}>{content}</h3> : <h4 key={key++}>{content}</h4>,
      );
      continue;
    }

    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    if (bullet) {
      flushParagraph();
      if (!list || list.ordered) {
        flushList();
        list = { ordered: false, items: [] };
      }
      list.items.push(bullet[1]);
      continue;
    }

    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (numbered) {
      flushParagraph();
      if (!list || !list.ordered) {
        flushList();
        list = { ordered: true, items: [] };
      }
      list.items.push(numbered[1]);
      continue;
    }

    // Continuazione di una voce di elenco su più righe.
    if (list && /^\s{2,}\S/.test(raw)) {
      list.items[list.items.length - 1] += ` ${line.trim()}`;
      continue;
    }

    flushList();
    paragraph.push(line.trim());
  }

  flushAll();
  return out;
}

/** Grassetto, corsivo e codice in linea. */
export function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  // Un'unica espressione per i tre costrutti: l'ordine conta, `**` prima di `*`.
  const pattern = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\*[^*\n]+\*|_[^_\n]+_)/g;
  let last = 0;
  let key = 0;
  for (const match of text.matchAll(pattern)) {
    const at = match.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const token = match[0];
    if (token.startsWith('**') || token.startsWith('__')) {
      out.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('`')) {
      out.push(<code key={key++}>{token.slice(1, -1)}</code>);
    } else {
      out.push(<em key={key++}>{token.slice(1, -1)}</em>);
    }
    last = at + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
