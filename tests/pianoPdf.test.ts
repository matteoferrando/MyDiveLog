/**
 * Il foglio del piano in PDF.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ► PERCHÉ QUESTO FILE ESISTE, e non basta quello della scheda immersione. ◄
 *
 * Perché un PDF non si rompe a metà: o il lettore lo apre, o dice che è
 * corrotto e non mostra niente. Non c'è la via di mezzo di una pagina HTML
 * sbilenca che si legge lo stesso — è la frase con cui si apre `pdf.test.ts`, e
 * vale identica qui.
 *
 * Ma il foglio del piano porta due cose che la scheda non ha, e sono le due che
 * si rompono: **tabelle di larghezza variabile** e **più pagine**. La tabella
 * degli offset — l'unica parte del formato dove un errore rende il file
 * illeggibile — cresce di due oggetti per pagina, e un piano tecnico con venti
 * soste e sei contingenze le pagine le fa davvero.
 *
 * Quello che si verifica qui non è che il foglio sia bello: è che sia un file
 * valido, che resti valido quando dentro ci finisce «Secca del Papa (nord)», e
 * che il testo che ci si mette ci arrivi davvero.
 */

import { describe, expect, it } from 'vitest';
import { larghezzaTesto, pianoPdf } from '../src/core/export/pdf';
import type { FoglioPiano } from '../src/core/export/planPrint';

function foglio(extra: Partial<FoglioPiano> = {}): FoglioPiano {
  return {
    titolo: 'Piano di immersione',
    sottotitolo: '30 m per 25 minuti · EAN32',
    now: '2026-09-08T18:30:00Z',
    sezioni: [
      {
        titolo: 'Risalita',
        colonne: ['Quota', 'Minuti', 'Run time'],
        righe: [
          ['30 m', '25', '25:00'],
          ['5 m', '3', '31:00'],
        ],
        forti: [1],
        numeriche: [1, 2],
      },
    ],
    ...extra,
  };
}

/** Il numero di oggetti dichiarati nel `trailer`, che deve tornare con la `xref`. */
function quantiOggetti(pdf: string): number {
  return Number(/\/Size (\d+)/.exec(pdf)?.[1] ?? 0);
}

/**
 * Gli scostamenti scritti nella tabella, letti come li leggerebbe un lettore.
 *
 * *Si cerca `\nxref\n` e non `xref`: l'ultima occorrenza di `xref` nel file sta
 * dentro `startxref`, che viene DOPO la tabella. Cercando quella si legge un
 * pezzo di file che di righe non ne ha nessuna, e la prova diventa verde
 * misurando il vuoto — che è il modo in cui una prova mente.*
 */
function scostamenti(pdf: string): number[] {
  const dopo = pdf.slice(pdf.indexOf('\nxref\n'));
  return [...dopo.matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
}

describe('il PDF del piano è un file valido', () => {
  it('comincia con l’intestazione e finisce con il rimando alla tabella', () => {
    const pdf = pianoPdf(foglio());
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(pdf).toContain('startxref');
  });

  /*
   * ► LA PROVA CHE VALE PIÙ DI TUTTE. ◄ Ogni numero della tabella `xref` è uno
   * scostamento in byte dall'inizio del file, e all'indirizzo che indica deve
   * esserci l'oggetto giusto. Se questa passa, il file si apre; se sballa di
   * uno, nessun lettore lo mostra e il messaggio non nomina la causa.
   */
  it('ogni scostamento della tabella punta al suo oggetto', () => {
    const pdf = pianoPdf(foglio());
    const offsets = scostamenti(pdf);
    expect(offsets.length).toBe(quantiOggetti(pdf) - 1);
    offsets.forEach((o, i) => {
      expect(pdf.slice(o, o + String(i + 1).length + 6)).toBe(`${i + 1} 0 obj`);
    });
  });

  /*
   * E GLI SCOSTAMENTI SONO IN BYTE, NON IN CARATTERI: coincidono solo se il
   * file è tutto ASCII. È la ragione per cui gli accenti diventano sequenze
   * ottali, ed è una proprietà che si può verificare invece di ricordare.
   */
  it('non contiene nemmeno un byte sopra 127', () => {
    const pdf = pianoPdf(
      foglio({
        titolo: 'Piano — Secca dell’Àncora',
        sottotitolo: 'Profondità 42 m · 20 °C · «tecnica»',
        note: 'Corrente da nord, uscita sull’ancora. Attenzione ai pescatori.',
      }),
    );
    // Il controllo si fa sui codici, non con una classe di caratteri di
    // controllo dentro una regola: la lente lo vieta, e contare è più chiaro.
    const fuoriAscii = [...pdf].filter((c) => (c.codePointAt(0) ?? 0) > 127);
    expect(fuoriAscii).toEqual([]);
    expect(Buffer.byteLength(pdf, 'utf8')).toBe(pdf.length);
  });

  /*
   * ► LE PARENTESI. ◄ Dentro una stringa PDF una parentesi non bilanciata
   * sposta la fine della stringa e rompe tutto il resto della pagina — ed è il
   * difetto classico di chi scrive PDF a mano, che salta fuori con i nomi dei
   * siti italiani: «Secca del Papa (nord)».
   */
  it('sopravvive a una parentesi aperta nel nome del sito', () => {
    const pdf = pianoPdf(foglio({ titolo: 'Piano — Secca del Papa (nord' }));
    expect(pdf).toContain('Secca del Papa \\(nord');
    const offsets = scostamenti(pdf);
    offsets.forEach((o, i) => expect(pdf.slice(o, o + String(i + 1).length + 6)).toBe(`${i + 1} 0 obj`));
  });

  /*
   * ► PIÙ PAGINE, che è la cosa che la stampa di sistema faceva gratis. ◄ Un
   * piano tecnico con venti soste e sei contingenze non sta su un foglio, e
   * ogni pagina in più aggiunge due oggetti alla tabella: è esattamente il
   * punto in cui un conteggio sbagliato smette di essere visibile a occhio.
   */
  it('spezza su più pagine e la tabella resta coerente', () => {
    const righe = Array.from({ length: 120 }, (_, i) => [`${60 - i * 0.4} m`, String(i), `${i}:00`]);
    const pdf = pianoPdf(
      foglio({ sezioni: [{ titolo: 'Risalita lunga', colonne: ['Quota', 'Minuti', 'Run time'], righe }] }),
    );
    const pagine = [...pdf.matchAll(/\/Type \/Page[^s]/g)].length;
    expect(pagine).toBeGreaterThan(1);
    const offsets = scostamenti(pdf);
    expect(offsets.length).toBe(quantiOggetti(pdf) - 1);
    offsets.forEach((o, i) => expect(pdf.slice(o, o + String(i + 1).length + 6)).toBe(`${i + 1} 0 obj`));
    // Ogni pagina oltre la prima porta «segue»: un foglio staccato dagli altri
    // deve dire di che piano parla, o in barca è carta anonima.
    expect([...pdf.matchAll(/\(segue\) Tj/g)].length).toBe(pagine - 1);
  });

  /*
   * IL CONTENUTO CI ARRIVA DAVVERO. Un file valido e vuoto passerebbe tutte le
   * prove qui sopra: questa guarda che i numeri del piano siano nella pagina.
   */
  it('porta sul foglio le righe della tabella e gli avvisi', () => {
    const pdf = pianoPdf(
      foglio({ avvisi: [{ livello: 'critical', testo: 'PPO2 oltre il limite impostato.' }] }),
    );
    expect(pdf).toContain('(31:00) Tj');
    expect(pdf).toContain('(CRITICO) Tj');
    expect(pdf).toContain('(PPO2 oltre il limite impostato.) Tj');
    // L'avvertenza sta sul foglio perché il foglio gira senza lo schermo.
    expect(pdf).toContain('non sostituisce il computer subacqueo');
  });

  /*
   * LE LARGHEZZE SERVONO A UNA COSA SOLA: allineare a destra una colonna di
   * numeri. Una tabella dove i bar sono allineati a sinistra si legge male
   * proprio dove la si legge male, cioè in barca.
   */
  it('misura il testo con le metriche del font, non a caratteri', () => {
    // In Helvetica la `i` è molto più stretta della `m`: contare i caratteri
    // darebbe lo stesso numero, e sarebbe il difetto che le larghezze tolgono.
    expect(larghezzaTesto('iiii', 10)).toBeLessThan(larghezzaTesto('mmmm', 10) / 3);
    expect(larghezzaTesto('', 10)).toBe(0);
    // Un carattere che la tabella non conosce non azzera la misura.
    expect(larghezzaTesto('Ж', 10)).toBeGreaterThan(0);
  });
});
