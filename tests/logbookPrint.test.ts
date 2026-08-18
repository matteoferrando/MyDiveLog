/**
 * Stampa del logbook.
 *
 * Che cosa si verifica qui, e perché proprio questo. Un documento HTML non ha una
 * definizione di «giusto» comoda come l'export UDDF, dove basta rileggerlo col
 * proprio parser. Le proprietà che contano su un foglio da firmare sono quattro, e
 * sono tutte verificabili sulla stringa prodotta:
 *
 *  - la STRUTTURA: un documento stampabile, con `@page` e `@media print`, e una
 *    pagina per immersione — né una di meno né una di più;
 *  - l'ESCAPE: nei campi liberi ci può stare qualunque cosa, e nessuna di quelle
 *    cose deve diventare markup nella finestra che apriamo;
 *  - l'ONESTÀ del profilo: senza campioni non si disegna una curva finta;
 *  - il FUSO: l'ora sul foglio è quella del luogo dell'immersione, non quella
 *    della macchina che stampa.
 *
 * Tutto senza React e senza DOM: le funzioni sono pure e restituiscono stringhe,
 * quindi questi test girano in ambiente Node insieme agli altri.
 */

import { describe, expect, it } from 'vitest';
import {
  dataLunga,
  diveProfileSvg,
  escapeHtml,
  etichettaFuso,
  logbookHtml,
  oraLocale,
} from '../src/core/export/logbookPrint';
import { computeMetrics } from '../src/core/analysis/metrics';
import { AIR, type Dive, type Sample } from '../src/core/model';

/** Un profilo a V: scende, tocca il fondo, risale. */
function profilo(depth: number, n: number): Sample[] {
  return Array.from({ length: n }, (_, i) => ({
    t: i * 10,
    depth: Math.max(0, depth - Math.abs(n / 2 - i) * (depth / (n / 2))),
    tempC: 15 + (i % 4),
    pressureBar: [200 - i * 0.5],
  }));
}

function immersione(over: Partial<Dive> = {}): Dive {
  const samples = over.samples === undefined ? profilo(30, 60) : over.samples;
  const base: Dive = {
    id: 'abc123',
    number: 42,
    startTime: '2026-06-14T10:38:00.000Z',
    durationS: samples.length ? samples[samples.length - 1].t : 2400,
    maxDepth: samples.length ? Math.max(...samples.map((s) => s.depth)) : 28,
    minTempC: 14.5,
    airTempC: 27,
    mode: 'oc',
    salinity: 'salt',
    site: { name: 'Punta Chiappa', region: 'Liguria' },
    buddy: 'Anna',
    suit: 'Umida 7 mm',
    weightKg: 6,
    visibilityM: 12,
    rating: 4,
    notes: 'Corrente da nord, cernia sotto lo strapiombo.',
    cylinders: [{ mix: AIR, sizeL: 12, startBar: 200, endBar: 70 }],
    source: { format: 'uddf', file: 'x.uddf', importedAt: '2026-06-14T20:00:00Z' },
    tags: ['corrente'],
    ...over,
    samples,
  };
  return { ...base, metrics: computeMetrics(base) };
}

/** Le immersioni senza campioni passano da qui: la mappa dei profili è vuota. */
const senzaProfili = new Map<string, Sample[]>();

function profiliDi(...dives: Dive[]): Map<string, Sample[]> {
  return new Map(dives.map((d) => [d.id, d.samples ?? []]));
}

describe('stampa del logbook — struttura del documento', () => {
  it('produce un documento HTML completo e autosufficiente', () => {
    const d = immersione();
    const html = logbookHtml([d], profiliDi(d), { now: '2026-08-18T09:00:00Z' });

    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('<html lang="it">');
    expect(html).toContain('<meta charset="utf-8" />');
    expect(html).toContain('</html>');
    // Autosufficiente: nessun foglio di stile esterno, nessuna immagine da caricare.
    expect(html).not.toContain('<link rel="stylesheet"');
    expect(html).not.toContain('<img ');
    expect(html).toContain('<style>');
  });

  it('è un documento pensato per la stampa, non una pagina qualunque', () => {
    const d = immersione();
    const html = logbookHtml([d], profiliDi(d));

    // Il formato carta e i margini li dichiara il documento.
    expect(html).toMatch(/@page\s*\{[^}]*size:\s*A4/);
    expect(html).toContain('@media print');
    // L'interruzione di pagina è dichiarata anche nella forma storica: i motori
    // di stampa più vecchi conoscono solo quella.
    expect(html).toContain('page-break-after: always');
    expect(html).toContain('break-after: page');
    // Senza questo i browser tolgono i fondi in stampa e il profilo esce vuoto.
    expect(html).toContain('print-color-adjust: exact');
  });

  it('le istruzioni per ottenere il PDF si vedono a schermo e spariscono in stampa', () => {
    const d = immersione();
    const html = logbookHtml([d], profiliDi(d));
    expect(html).toContain('class="nostampa"');
    expect(html).toMatch(/Esporta come PDF/);
    // La regola che le nasconde sta dentro il blocco di stampa, non fuori.
    const blocco = html.slice(html.indexOf('@media print'));
    expect(blocco).toMatch(/\.nostampa\s*\{\s*display:\s*none/);
  });
});

describe('stampa del logbook — una pagina per immersione', () => {
  it('tre immersioni fanno tre pagine, numerate', () => {
    const a = immersione({ id: 'a', number: 1, startTime: '2026-06-14T08:00:00.000Z' });
    const b = immersione({ id: 'b', number: 2, startTime: '2026-06-14T12:00:00.000Z' });
    const c = immersione({ id: 'c', number: 3, startTime: '2026-06-15T09:00:00.000Z' });

    const html = logbookHtml([a, b, c], profiliDi(a, b, c));
    expect(html.match(/<section class="scheda"/g)).toHaveLength(3);
    expect(html).toContain('pagina 1 di 3');
    expect(html).toContain('pagina 2 di 3');
    expect(html).toContain('pagina 3 di 3');
  });

  it('l’ordine è cronologico, comunque arrivino le immersioni', () => {
    const tardi = immersione({ id: 'tardi', number: 9, startTime: '2026-06-16T10:00:00.000Z' });
    const presto = immersione({ id: 'presto', number: 8, startTime: '2026-06-14T10:00:00.000Z' });

    const html = logbookHtml([tardi, presto], profiliDi(tardi, presto));
    expect(html.indexOf('n. 8')).toBeLessThan(html.indexOf('n. 9'));
  });

  it('senza numero dal computer non se ne inventa uno: dichiara la posizione nel fascicolo', () => {
    const d = immersione({ number: undefined });
    const html = logbookHtml([d], profiliDi(d));
    expect(html).toContain('1ª di questo fascicolo');
    expect(html).not.toContain('n. 1<');
  });

  it('un fascicolo vuoto è una pagina che lo dice, non un errore', () => {
    const html = logbookHtml([], senzaProfili);
    expect(html).toContain('Nessuna immersione da stampare');
    expect(html.match(/<section class="scheda"/g)).toBeNull();
  });
});

describe('stampa del logbook — i numeri e la firma', () => {
  it('la pagina porta i numeri che rendono leggibile l’immersione', () => {
    const d = immersione();
    const html = logbookHtml([d], profiliDi(d));

    expect(html).toContain('Punta Chiappa, Liguria');
    expect(html).toContain('Compagno: <strong>Anna</strong>');
    expect(html).toContain('30.0 m'); // massima
    expect(html).toContain('Profondità media');
    expect(html).toContain('Durata');
    expect(html).toContain('min 14.5 °C · aria 27 °C');
    expect(html).toContain('Aria'); // miscela
    expect(html).toContain('12 L Aria · 200 → 70 bar (130 usati)');
    expect(html).toContain('Circuito aperto');
    expect(html).toContain('Salata');
    expect(html).toContain('6.0 kg');
    expect(html).toContain('12 m'); // visibilità
    expect(html).toContain('★★★★☆ (4 su 5)');
    expect(html).toContain('Umida 7 mm');
    expect(html).toContain('Corrente da nord, cernia sotto lo strapiombo.');
  });

  it('lo spazio per firma e timbro c’è, ed è il motivo per cui questa stampa esiste', () => {
    const d = immersione();
    const html = logbookHtml([d], profiliDi(d));
    expect(html).toContain('Firma dell’istruttore o della guida');
    expect(html).toContain('Firma del subacqueo');
    expect(html).toContain('Timbro del centro o della didattica');

    // Ed è disattivabile, per chi vuole solo archiviare il fascicolo.
    const senza = logbookHtml([d], profiliDi(d), { signature: false });
    expect(senza).not.toContain('Timbro del centro');
  });

  it('il consumo compare solo se è calcolabile, e dice che cosa manca', () => {
    // Con volume e pressioni: L/min, il numero confrontabile.
    const completa = immersione();
    expect(logbookHtml([completa], profiliDi(completa))).toMatch(/[\d.]+ L\/min/);

    // Senza volume: bar/min, dichiarando che non è convertibile.
    const senzaVolume = immersione({
      cylinders: [{ mix: AIR, startBar: 200, endBar: 70 }],
    });
    const htmlSenzaVolume = logbookHtml([senzaVolume], profiliDi(senzaVolume));
    expect(htmlSenzaVolume).toContain('bar/min');
    expect(htmlSenzaVolume).toContain('non è convertibile in L/min');

    // Senza pressioni da nessuna parte — né sulla bombola né nei campioni:
    // nessun numero inventato. La bombola nuda da sola non basta a costruire il
    // caso, perché le metriche il consumo lo ricavano anche dal trasmettitore.
    const nuda = immersione({ cylinders: [{ mix: AIR }], samples: [] });
    const htmlNuda = logbookHtml([nuda], senzaProfili);
    expect(htmlNuda).toContain('non calcolabile: servono pressione iniziale e finale');
    expect(htmlNuda).not.toMatch(/[\d.]+ L\/min/);
  });

  it('dichiara che la saturazione è stimata quando il profilo è ricostruito', () => {
    const stimata = immersione({ samples: [] });
    stimata.metrics = { ...stimata.metrics!, tissuesEstimated: true };
    const html = logbookHtml([stimata], senzaProfili);
    expect(html).toContain('class="avviso"');
    expect(html).toMatch(/valori di saturazione .*<strong>stimati<\/strong>/);
    expect(html).toContain('profilo quadro');

    // E non lo dichiara quando i tessuti vengono da un profilo vero.
    const misurata = immersione();
    expect(logbookHtml([misurata], profiliDi(misurata))).not.toContain('class="avviso"');
  });
});

describe('stampa del logbook — il profilo', () => {
  it('con i campioni disegna un SVG in linea, non un’immagine da caricare', () => {
    const d = immersione();
    const html = logbookHtml([d], profiliDi(d));
    expect(html).toContain('<svg class="profilo-svg"');
    expect(html).toContain('viewBox="0 0 660 210"');
    expect(html).toContain('<polyline class="profilo-linea"');
    expect(html).toContain('<path class="profilo-area"');
    expect(html).toContain('Ricostruito da 60 campioni');
  });

  it('senza campioni NON disegna un profilo finto: scrive che non c’è', () => {
    const d = immersione({ samples: [] });
    const html = logbookHtml([d], senzaProfili);
    expect(html).not.toContain('<svg');
    expect(html).toContain('non ha un profilo campionato');
    expect(html).toContain('la curva non esiste e non viene disegnata');
    // I numeri restano: l'immersione inserita a mano è un'immersione a tutti gli effetti.
    expect(html).toContain('Punta Chiappa');
  });

  it('la funzione del profilo è pura e si rifiuta di disegnare l’indisegnabile', () => {
    expect(diveProfileSvg([])).toBe('');
    expect(diveProfileSvg([{ t: 0, depth: 0 }])).toBe('');
    // Due campioni allo stesso istante: nessun asse dei tempi possibile.
    expect(
      diveProfileSvg([
        { t: 30, depth: 10 },
        { t: 30, depth: 12 },
      ]),
    ).toBe('');
  });

  it('il profilo ha l’asse invertito e un punto per campione', () => {
    const samples = profilo(24, 12);
    const svg = diveProfileSvg(samples, { width: 400, height: 200 });
    const punti = /points="([^"]+)"/.exec(svg)?.[1].trim().split(/\s+/) ?? [];
    expect(punti).toHaveLength(12);

    // Y cresce verso il basso: il campione più profondo ha la Y più grande.
    const y = punti.map((p) => Number(p.split(',')[1]));
    const iPiuProfondo = samples.reduce((a, s, i) => (s.depth > samples[a].depth ? i : a), 0);
    expect(y[iPiuProfondo]).toBe(Math.max(...y));
    expect(y[0]).toBe(Math.min(...y)); // il primo campione è in superficie
    // La profondità massima è etichettata sul disegno.
    expect(svg).toContain('24.0 m');
  });

  it('un fondo scala comune rende confrontabili due profili a occhio', () => {
    const bassa = diveProfileSvg(profilo(12, 20), { maxDepthM: 40 });
    const profonda = diveProfileSvg(profilo(40, 20), { maxDepthM: 40 });
    const picco = (svg: string) =>
      Math.max(
        .../points="([^"]+)"/
          .exec(svg)![1]
          .trim()
          .split(/\s+/)
          .map((p) => Number(p.split(',')[1])),
      );
    // Stesso fondo scala: 12 m occupano meno di un terzo dell'altezza di 40 m.
    expect(picco(bassa)).toBeLessThan(picco(profonda) * 0.45);
  });
});

describe('stampa del logbook — sicurezza dei campi liberi', () => {
  it('una nota con <script> viene stampata, non eseguita', () => {
    const cattiva = immersione({
      notes: '<script>alert("ciao")</script> poi la cernia',
    });
    const html = logbookHtml([cattiva], profiliDi(cattiva));

    // Nessun tag script nel documento: se ci fosse, la finestra che apriamo lo eseguirebbe.
    expect(html).not.toContain('<script');
    expect(html).not.toContain('</script>');
    // Il testo però c'è, sfuggito e leggibile: la nota va stampata com'è stata scritta.
    expect(html).toContain('&lt;script&gt;alert(&quot;ciao&quot;)&lt;/script&gt; poi la cernia');
  });

  it('sito, compagno, muta ed etichette passano tutti dall’escape', () => {
    const d = immersione({
      site: { name: 'Secca "del Diavolo" & Co.', region: '<b>Liguria</b>' },
      buddy: 'Anna <img src=x onerror=alert(1)>',
      suit: 'Stagna & sottomuta',
      tags: ['<em>corrente</em>', 'notte & buio'],
    });
    const html = logbookHtml([d], profiliDi(d));

    expect(html).not.toContain('<b>Liguria</b>');
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<em>corrente</em>');
    expect(html).toContain('Secca &quot;del Diavolo&quot; &amp; Co.');
    expect(html).toContain('&lt;b&gt;Liguria&lt;/b&gt;');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('Stagna &amp; sottomuta');
  });

  it('anche il titolo del fascicolo finisce in un attributo, e va sfuggito', () => {
    const d = immersione();
    const html = logbookHtml([d], profiliDi(d), { title: 'Logbook di "Marco" & C.', owner: "L'istruttore" });
    // Nel <title> e nell'intestazione di pagina: mai una virgoletta cruda.
    expect(html).toContain('<title>Logbook di &quot;Marco&quot; &amp; C.</title>');
    expect(html).toContain('L&#39;istruttore');
  });

  it('escapeHtml sfugge tutti e cinque i caratteri, e l’ampersand per primo', () => {
    expect(escapeHtml('&<>"\'')).toBe('&amp;&lt;&gt;&quot;&#39;');
    // L'ordine conta: se & venisse sfuggito per ultimo, &lt; diventerebbe &amp;lt;.
    expect(escapeHtml('<')).toBe('&lt;');
    expect(escapeHtml('&amp;')).toBe('&amp;amp;');
  });
});

describe('stampa del logbook — il fuso è quello del luogo', () => {
  it('l’ora stampata è quella che il computer subacqueo mostrava', () => {
    // 06:38 UTC in Mar Rosso (UTC+3) sono le 09:38 del mattino sulla barca.
    const marRosso = immersione({
      startTime: '2026-06-14T06:38:00.000Z',
      utcOffsetMinutes: 180,
    });
    const html = logbookHtml([marRosso], profiliDi(marRosso));
    expect(html).toContain('ore 09:38');
    expect(html).toContain('domenica 14 giugno 2026');
    // E il foglio dichiara SEMPRE il fuso: chi lo legge non era per forza su quella barca.
    expect(html).toContain('UTC+3, ora locale del sito');
  });

  it('il fuso può spostare anche il giorno, e la data segue', () => {
    // 22:30 UTC del 14, ma alle Maldive (UTC+5) è già l'1:30 del 15.
    const maldive = immersione({
      startTime: '2026-06-14T20:30:00.000Z',
      utcOffsetMinutes: 300,
    });
    const html = logbookHtml([maldive], profiliDi(maldive));
    expect(html).toContain('lunedì 15 giugno 2026');
    expect(html).toContain('ore 01:30');
  });

  it('senza fuso dichiarato si legge in UTC, mai nel fuso della macchina che stampa', () => {
    // Questo test gira anche sotto `npm run test:tz`, con TZ=Pacific/Kiritimati
    // (UTC+14) e TZ=Pacific/Midway (UTC-11): se il modulo usasse l'ora locale,
    // l'orario stampato cambierebbe con la macchina, e su un foglio firmato no.
    const d = immersione({ startTime: '2026-06-14T10:38:00.000Z', utcOffsetMinutes: undefined });
    const html = logbookHtml([d], profiliDi(d));
    expect(html).toContain('ore 10:38');
    expect(html).toContain('domenica 14 giugno 2026');
    // Senza fuso noto non si scrive un'etichetta di fuso che non si conosce.
    expect(html).not.toContain('ora locale del sito');
  });

  it('le funzioni di data sono pure e deterministiche, senza dipendere dall’ICU', () => {
    expect(dataLunga('2026-01-01T00:00:00.000Z')).toBe('giovedì 1 gennaio 2026');
    expect(dataLunga('2026-12-31T23:00:00.000Z', 120)).toBe('venerdì 1 gennaio 2027');
    expect(oraLocale('2026-06-14T06:38:00.000Z', -270)).toBe('02:08');
    expect(etichettaFuso(180)).toBe('UTC+3');
    expect(etichettaFuso(-210)).toBe('UTC-3:30');
    expect(etichettaFuso(undefined)).toBeUndefined();
  });
});
