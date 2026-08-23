/**
 * Il PDF scritto a mano.
 *
 * PERCHÉ QUESTO FILE ESISTE. Un PDF non si rompe a metà: o il lettore lo apre,
 * o dice che è corrotto e non mostra niente. Non c'è la via di mezzo di una
 * pagina HTML sbilenca che si legge lo stesso. Le due cose che lo mandano a
 * gambe all'aria sono sempre le stesse — un byte non ASCII che sposta tutti gli
 * offset della `xref`, e una parentesi non chiusa dentro una stringa — e
 * capitano proprio con i nomi dei siti italiani: «Punta dell'Àncora (secca)».
 *
 * Qui non si verifica che il foglio sia bello. Si verifica che sia un file
 * valido, e che lo resti quando dentro ci finisce l'apostrofo di un utente.
 */

import { describe, expect, it } from 'vitest';
import { schedePdf } from '../src/core/export/pdf';
import type { Dive, Sample } from '../src/core/model';

const CAMPIONI: Sample[] = Array.from({ length: 40 }, (_, i) => ({
  t: i * 60,
  depth: i < 20 ? i * 1.5 : (40 - i) * 1.5,
})) as unknown as Sample[];

function immersione(extra: Partial<Dive> = {}): Dive {
  return {
    id: 'x1',
    startTime: '2026-07-11T09:24:00Z',
    utcOffsetMinutes: 120,
    durationS: 39 * 60,
    maxDepth: 29.4,
    mode: 'oc',
    cylinders: [{ mix: { o2: 0.32, he: 0 } }],
    site: { name: 'Camogli Gonzatti', region: 'Liguria', country: 'Italia' },
    source: { kind: 'manual' },
    ...extra,
  } as unknown as Dive;
}

const OPZIONI = { subacqueo: { nome: 'Mario Rossi', brevetto: 'Advanced' }, now: '2026-08-23T10:00:00Z' };

/**
 * Il controllo vero della `xref`: ogni offset dichiarato deve cadere ESATTAMENTE
 * sull'inizio dell'oggetto che promette. È la stessa lettura che fa un lettore
 * di PDF, e sbagliare di un byte basta.
 */
function xrefTorna(pdf: string): boolean {
  const inizio = Number(
    pdf
      .slice(pdf.lastIndexOf('startxref') + 9)
      .trim()
      .split('\n')[0],
  );
  if (!pdf.startsWith('xref', inizio)) return false;
  const righe = pdf.slice(inizio).split('\n');
  const quanti = Number(righe[1].split(' ')[1]);
  for (let i = 1; i < quanti; i += 1) {
    const offset = Number(righe[1 + i + 1].slice(0, 10));
    if (!pdf.startsWith(`${i} 0 obj`, offset)) return false;
  }
  return true;
}

describe('la scheda in PDF', () => {
  it('è un file PDF vero, dal primo byte all’ultimo', () => {
    const pdf = schedePdf([immersione()], new Map([['x1', CAMPIONI]]), OPZIONI);
    expect(pdf.startsWith('%PDF-1.4\n')).toBe(true);
    expect(pdf.endsWith('%%EOF\n')).toBe(true);
    expect(xrefTorna(pdf)).toBe(true);
  });

  it('resta ASCII: è l’unica ragione per cui gli offset in caratteri sono offset in byte', () => {
    /*
     * `esporta()` passa una stringa, e chi la scrive — il Blob del browser o
     * `as_bytes()` in Rust — la codifica in UTF-8. Finché ogni carattere sta
     * sotto 128, un carattere è un byte e la `xref` regge. Il primo accento non
     * convertito varrebbe due byte e sposterebbe tutto quello che segue.
     */
    const pdf = schedePdf(
      [
        immersione({
          site: { name: 'Punta dell’Àncora — città', region: 'Puglia', country: 'Italia' },
        } as Partial<Dive>),
      ],
      new Map([['x1', CAMPIONI]]),
      OPZIONI,
    );
    for (let i = 0; i < pdf.length; i += 1) {
      if (pdf.charCodeAt(i) > 126) throw new Error(`byte non ASCII a ${i}: ${JSON.stringify(pdf[i])}`);
    }
    // L'accento non è sparito: è diventato la sua fuga ottale WinAnsi.
    expect(pdf).toContain('\\300'); // À
    expect(pdf).toContain('\\222'); // apostrofo tipografico
    expect(pdf).toContain('\\227'); // trattino lungo
  });

  it('una parentesi nel nome del sito non spezza la pagina', () => {
    // Il difetto classico di chi scrive PDF a mano: «(secca)» chiude la stringa
    // in anticipo e da lì in poi il file è spazzatura.
    const pdf = schedePdf(
      [immersione({ site: { name: 'Secca (nord) \\ ovest', country: 'Italia' } } as Partial<Dive>)],
      new Map([['x1', CAMPIONI]]),
      OPZIONI,
    );
    expect(pdf).toContain('Secca \\(nord\\) \\\\ ovest');
    expect(xrefTorna(pdf)).toBe(true);
  });

  it('nessun punto interrogativo: le nostre etichette usano solo glifi che Helvetica ha', () => {
    /*
     * IL DIFETTO CHE QUESTO CONTROLLO CHIUDE. Un carattere fuori dalla tabella
     * WinAnsi diventa «?». Visto sul foglio: le pressioni erano scritte
     * «210→60 bar» e uscivano «210?60 bar», che non sembra un limite del
     * formato — sembra un dato letto male dal computer subacqueo.
     *
     * La freccia non c'è in nessuna delle quattordici famiglie base del PDF, e
     * non ci sarà mai. L'unica difesa è scrivere le etichette con i caratteri
     * che esistono, e accorgersene qui e non a valle. Il testo di questa
     * immersione è tutto ASCII: ogni «?» nell'uscita viene da una nostra
     * etichetta, non dall'utente.
     */
    const pdf = schedePdf(
      [
        immersione({
          site: { name: 'Camogli', region: 'Liguria', country: 'Italia' },
          cylinders: [{ mix: { o2: 0.32, he: 0 }, sizeL: 15, startBar: 210, endBar: 60 }],
          center: 'Diving Camogli',
          buddy: 'Luca Bianchi',
          plannedMaxDepth: 32,
        } as Partial<Dive>),
      ],
      new Map([['x1', CAMPIONI]]),
      OPZIONI,
    );
    expect(pdf).toContain('da 210 a 60 bar');
    expect(pdf).not.toContain('?');
  });

  it('una pagina per immersione, in ordine di data', () => {
    const pdf = schedePdf(
      [
        immersione({
          id: 'b',
          startTime: '2026-07-12T09:00:00Z',
          site: { name: 'Seconda' },
        } as Partial<Dive>),
        immersione({ id: 'a', startTime: '2026-07-11T09:00:00Z', site: { name: 'Prima' } } as Partial<Dive>),
      ],
      new Map([
        ['a', CAMPIONI],
        ['b', CAMPIONI],
      ]),
      OPZIONI,
    );
    expect(pdf).toContain('/Type /Pages /Count 2');
    expect(pdf.indexOf('(Prima)')).toBeGreaterThan(0);
    expect(pdf.indexOf('(Prima)')).toBeLessThan(pdf.indexOf('(Seconda)'));
    expect(xrefTorna(pdf)).toBe(true);
  });

  it('senza profilo il file resta valido: chi scrive a mano non ha campioni', () => {
    const pdf = schedePdf([immersione()], new Map(), OPZIONI);
    expect(xrefTorna(pdf)).toBe(true);
    expect(pdf.length).toBeGreaterThan(1000);
  });

  it('la firma si disegna solo se qualcuno l’ha davvero tracciata', () => {
    /*
     * La lettera o) è la firma dell'istruttore o della guida. Un PDF che la
     * disegna da solo è un documento falso: senza tratti raccolti sul posto
     * esce la riga vuota, e chi firma lo fa a penna sulla carta.
     *
     * Il confronto è fra gli stessi dati con e senza `firmaGuida`: il foglio
     * senza firma non deve contenere il tratto in più.
     */
    const senza = schedePdf([immersione()], new Map([['x1', CAMPIONI]]), OPZIONI);
    const con = schedePdf(
      [
        immersione({
          firmaGuida: {
            tratti: [
              [
                { x: 0, y: 20 },
                { x: 30, y: 4 },
                { x: 60, y: 24 },
                { x: 90, y: 6 },
              ],
            ],
            larghezza: 100,
            altezza: 30,
            quando: '2026-07-11T12:30:00Z',
            offsetMinuti: 120,
          },
        } as Partial<Dive>),
      ],
      new Map([['x1', CAMPIONI]]),
      OPZIONI,
    );
    // Il tratto della firma è disegnato con una penna più spessa di tutto il
    // resto della pagina: è la traccia che distingue i due file.
    expect(senza).not.toContain('1.2 w');
    expect(con).toContain('1.2 w');
    expect(con.length).toBeGreaterThan(senza.length);
    expect(xrefTorna(senza)).toBe(true);
    expect(xrefTorna(con)).toBe(true);
  });
});
