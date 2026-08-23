/**
 * Esportazione in CSV e in KML.
 *
 * Sono due formati che finiscono in mano a un altro programma, e il modo in cui
 * si rompono è sempre lo stesso: non danno errore. Un CSV con il separatore
 * sbagliato si apre lo stesso, in una colonna sola; un numero scritto col punto
 * dove il foglio si aspetta la virgola entra come testo e la colonna non si
 * somma; un KML con longitudine e latitudine invertite disegna segnaposti in
 * mezzo al deserto invece che in mare. Nessuno di questi difetti si vede
 * leggendo il file: si vede aprendolo, sei mesi dopo.
 *
 * Quindi i test guardano proprio quei tre punti, oltre alla forma.
 */

import { describe, expect, it } from 'vitest';
import { esportaCsv } from '../src/core/export/csv';
import { esportaKml } from '../src/core/export/kml';
import { computeMetrics } from '../src/core/analysis/metrics';
import { AIR, type Dive, type Sample } from '../src/core/model';

function profilo(prof: number, n: number): Sample[] {
  return Array.from({ length: n }, (_, i) => ({
    t: i * 10,
    depth: Math.max(0, prof - Math.abs(n / 2 - i) * (prof / (n / 2))),
    tempC: 15 + (i % 4),
    pressureBar: [200 - i * 0.5],
  }));
}

function immersione(over: Partial<Dive> = {}): Dive {
  const samples = over.samples ?? profilo(30, 60);
  const base: Dive = {
    id: 'a1',
    number: 7,
    startTime: '2026-06-14T10:38:00.000Z',
    durationS: samples[samples.length - 1].t,
    maxDepth: Math.max(...samples.map((s) => s.depth)),
    minTempC: 14.5,
    mode: 'oc',
    salinity: 'salt',
    site: { name: 'Punta Chiappa', region: 'Liguria', country: 'Italia', lat: 44.3167, lon: 9.15 },
    cylinders: [{ mix: AIR, sizeL: 12, startBar: 200, endBar: 70 }],
    source: { format: 'uddf', file: 'x.uddf', importedAt: '2026-06-14T20:00:00Z' },
    tags: [],
    samples,
    ...over,
  };
  return { ...base, metrics: computeMetrics(base) };
}

/** Le righe vere, saltando `sep=` e togliendo il BOM. */
function righe(csv: string): string[] {
  return csv.replace(/^﻿/, '').split('\r\n').slice(1).filter(Boolean);
}

describe('esportazione CSV', () => {
  it('dichiara il separatore e mette il BOM, che è ciò che serve a Excel', () => {
    const { csv } = esportaCsv([immersione()]);
    // Il BOM: senza, Excel su Windows legge il file come Latin-1 e i gradi
    // centigradi nell'intestazione diventano illeggibili.
    expect(csv.startsWith('﻿')).toBe(true);
    // `sep=` è l'unica dichiarazione che Excel legge davvero.
    expect(csv.replace(/^﻿/, '').startsWith('sep=;\r\n')).toBe(true);
  });

  it('una riga per immersione, più l’intestazione', () => {
    const { csv, righe: quante } = esportaCsv([immersione(), immersione({ id: 'a2' })]);
    expect(quante).toBe(2);
    expect(righe(csv)).toHaveLength(3);
  });

  it('con il punto e virgola i decimali hanno la VIRGOLA, altrimenti il punto', () => {
    /*
     * È la coppia che si sbaglia sempre. Un foglio italiano usa il punto e
     * virgola come separatore di colonna e la virgola come separatore
     * decimale: mescolare le due convenzioni fa entrare i numeri come testo,
     * e la colonna del consumo non si somma. Non dà nessun errore.
     */
    const it = esportaCsv([immersione()], { separatore: ';' }).csv;
    const en = esportaCsv([immersione()], { separatore: ',' }).csv;
    expect(righe(it)[1]).toContain('44,3167');
    expect(righe(it)[1]).not.toContain('44.3167');
    expect(righe(en)[1]).toContain('44.3167');
    expect(righe(en)[1]).not.toContain('44,3167');
  });

  it('protegge le celle che contengono il separatore, le virgolette o un a capo', () => {
    const csv = esportaCsv(
      [
        immersione({
          site: { name: 'Grotta; del "Diavolo"' },
          notes: 'prima riga\nseconda riga',
        }),
      ],
      { separatore: ';' },
    ).csv;
    const riga = righe(csv)[1];
    expect(riga).toContain('"Grotta; del ""Diavolo"""');
    expect(riga).toContain('"prima riga\nseconda riga"');
    /*
     * L'a capo dentro una cella NON deve spezzare la riga: fra virgolette è
     * dato, fuori è la fine del record. Contando le righe si verifica che sia
     * finito nel posto giusto.
     */
    expect(righe(csv)).toHaveLength(2);
  });

  it('le intestazioni cambiano lingua, i dati no', () => {
    const en = esportaCsv([immersione()], { lingua: 'en' }).csv;
    expect(righe(en)[0]).toContain('Max depth (m)');
    expect(righe(en)[0]).not.toContain('Prof. max (m)');
    // Il nome del sito è un dato, non un'etichetta: resta quello che è.
    expect(righe(en)[1]).toContain('Punta Chiappa');
  });

  it('le frazioni di gas escono in percentuale, come sono scritte sulla bombola', () => {
    // In `GasMix` l'ossigeno dell'aria è 0.21. In un foglio, «0,21» accanto a una
    // colonna che si chiama «O2 (%)» è una trappola: si legge come 0,21 per cento.
    const csv = esportaCsv([immersione()], { separatore: ',' }).csv;
    const colonne = righe(csv)[1].split(',');
    const iO2 = righe(csv)[0].split(',').indexOf('O2 (%)');
    expect(colonne[iO2]).toBe('21');
  });

  it('una cella vuota resta vuota, non diventa «undefined»', () => {
    const csv = esportaCsv([immersione({ buddy: undefined, notes: undefined })]).csv;
    expect(csv).not.toContain('undefined');
    expect(csv).not.toContain('NaN');
  });

  it('elenca tutte le fonti di un’immersione fusa', () => {
    const csv = esportaCsv([
      immersione({
        extraSources: [{ format: 'logtrak', file: 'y.logtrak', importedAt: '2026-06-15T08:00:00Z' }],
      }),
    ]).csv;
    expect(righe(csv)[1]).toContain('uddf + logtrak');
  });
});

describe('esportazione KML', () => {
  const conCoordinate = (nome: string, lat: number, lon: number, giorno: string, id: string) =>
    immersione({ id, site: { name: nome, lat, lon }, startTime: `${giorno}T10:00:00.000Z` });

  it('scrive longitudine PRIMA di latitudine, che è l’ordine di KML', () => {
    /*
     * L'errore classico di questo formato. Invertite, le immersioni liguri
     * (44.3 N, 9.1 E) finiscono a 9.1 N 44.3 E, cioè in Somalia — e il file
     * si apre lo stesso, senza un errore.
     */
    const { kml } = esportaKml([immersione()]);
    expect(kml).toContain('<coordinates>9.15,44.3167,0</coordinates>');
  });

  it('un segnaposto per SITO, non per immersione', () => {
    const { kml, siti } = esportaKml([
      conCoordinate('Moregallo', 45.86, 9.31, '2026-05-01', 'a'),
      conCoordinate('Moregallo', 45.86, 9.31, '2026-06-01', 'b'),
      conCoordinate('Isuela', 44.31, 9.14, '2026-07-01', 'c'),
    ]);
    expect(siti).toBe(2);
    expect(kml.match(/<Placemark>/g)).toHaveLength(2);
    expect(kml).toContain('2 immersioni');
    expect(kml).toContain('dal 2026-05-01 al 2026-06-01');
  });

  it('raggruppa per nome anche quando il GPS dà coordinate leggermente diverse', () => {
    // Il GPS prende il punto in superficie e la barca si sposta: due immersioni
    // allo stesso posto non hanno mai la stessa coordinata al quinto decimale.
    const { siti } = esportaKml([
      conCoordinate('Moregallo', 45.86, 9.31, '2026-05-01', 'a'),
      conCoordinate('Moregallo', 45.8601, 9.3102, '2026-05-02', 'b'),
    ]);
    expect(siti).toBe(1);
  });

  it('dichiara i siti senza coordinate invece di farli sparire', () => {
    const { siti, senzaCoordinate } = esportaKml([
      conCoordinate('Isuela', 44.31, 9.14, '2026-07-01', 'a'),
      immersione({ id: 'b', site: { name: 'Piscina comunale' } }),
    ]);
    expect(siti).toBe(1);
    expect(senzaCoordinate).toEqual(['Piscina comunale']);
  });

  it('un sito che ha le coordinate su UNA sola immersione non è un sito senza coordinate', () => {
    const { siti, senzaCoordinate } = esportaKml([
      immersione({ id: 'a', site: { name: 'Relitto Haven' } }),
      conCoordinate('Relitto Haven', 44.4, 8.75, '2026-07-02', 'b'),
    ]);
    expect(siti).toBe(1);
    expect(senzaCoordinate).toEqual([]);
  });

  it('protegge i nomi con caratteri che romperebbero l’XML', () => {
    const { kml } = esportaKml([immersione({ site: { name: 'Punta <Nord> & Sud', lat: 44, lon: 9 } })]);
    expect(kml).toContain('<name>Punta &lt;Nord&gt; &amp; Sud</name>');
  });

  it('la dimensione del segnaposto dice quanto ci vai', () => {
    const molte = Array.from({ length: 12 }, (_, i) =>
      conCoordinate('Moregallo', 45.86, 9.31, '2026-05-01', `m${i}`),
    );
    const { kml } = esportaKml([...molte, conCoordinate('Isuela', 44.31, 9.14, '2026-07-01', 'x')]);
    expect(kml).toContain('#sito-molte');
    expect(kml).toContain('#sito-una');
  });

  it('le etichette dentro le schede seguono la lingua', () => {
    const { kml } = esportaKml([immersione()], { lingua: 'en' });
    expect(kml).toContain('1 dive');
    expect(kml).toContain('max depth');
  });
});
