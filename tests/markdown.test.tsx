/**
 * Resa del markdown delle analisi.
 *
 * Verificato sul testo prodotto, non sull'HTML: la proprietà che conta è che
 * intestazioni, elenchi e grassetti diventino elementi distinti e che NIENTE
 * arrivi allo schermo come markup — le analisi vengono da un modello, e
 * `dangerouslySetInnerHTML` su quel testo sarebbe un buco.
 */

import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Markdown } from '../src/ui/components/Markdown';

const html = (text: string) => renderToStaticMarkup(<Markdown text={text} />);

describe('markdown', () => {
  it('intestazioni, paragrafi ed elenchi', () => {
    const out = html(`## Com'è andata

Immersione **pulita**: 32 m per 40 minuti.

- consumo 17.2 L/min
- assetto 2.1 m/min

1. prima cosa
2. seconda cosa`);
    expect(out).toContain('<h3>');
    expect(out).toContain("Com&#x27;è andata");
    expect(out).toContain('<strong>pulita</strong>');
    expect(out).toContain('<ul>');
    expect(out).toContain('<ol>');
    expect(out.match(/<li>/g)).toHaveLength(4);
  });

  it('corsivo e codice in linea', () => {
    const out = html('Un _dettaglio_ e un `campo`.');
    expect(out).toContain('<em>dettaglio</em>');
    expect(out).toContain('<code>campo</code>');
  });

  it('non produce markup dal testo del modello', () => {
    const out = html('Attenzione <script>alert(1)</script> e <b>grassetto finto</b>.');
    expect(out).not.toContain('<script>');
    expect(out).not.toContain('<b>');
    expect(out).toContain('&lt;script&gt;');
  });

  it('unisce le righe di un paragrafo e separa sui vuoti', () => {
    const out = html('riga uno\nriga due\n\nsecondo paragrafo');
    expect(out.match(/<p>/g)).toHaveLength(2);
    expect(out).toContain('riga uno riga due');
  });

  it('regge il testo parziale che arriva in streaming', () => {
    // A metà stream una riga può essere troncata in mezzo a un grassetto: non
    // deve far cadere il rendering.
    for (const partial of ['## Tit', '## Titolo\n\nUn **numero incompl', '- voce\n- vo']) {
      expect(() => html(partial)).not.toThrow();
    }
  });
});
