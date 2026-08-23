// @vitest-environment jsdom
/**
 * I grafici letti invece che guardati.
 *
 * Metà di questa applicazione sono disegni, e fino a ieri erano SVG nudi: nessun
 * nome, nessuna descrizione, centinaia di nodi vuoti. Per chi usa uno screen
 * reader non erano grafici brutti, erano un buco — la scheda di un'immersione
 * finiva con «immagine» e nient'altro.
 *
 * Questo file verifica le tre cose che tolgono quel buco, e le verifica
 * ESEGUENDO il render, non leggendo il codice:
 *
 *  1. ogni SVG ha `role="img"`, un nome e una descrizione, e la descrizione dice
 *     i NUMERI dei dati passati, non una frase di comodo;
 *  2. tutto ciò che è arredamento — griglie, assi, riempimenti, marche — è
 *     `aria-hidden`, altrimenti la voce legge un elenco di nodi senza testo lungo
 *     quanto le tacche prima di arrivare al dato;
 *  3. dove c'era un cursore guidato dal mouse ora c'è anche la tastiera, e il
 *     valore raggiunto viene annunciato.
 *
 * Il file è in `.ts` e non in `.tsx` di proposito — è il nome concordato — quindi
 * gli elementi si costruiscono con `createElement`. Meno leggibile del JSX, ma è
 * l'unica differenza: quello che viene reso è identico.
 */

import { describe, expect, it } from 'vitest';
import { act, createElement as e, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRoot } from 'react-dom/client';
import {
  BarChart,
  ColumnChart,
  CurveChart,
  ScatterChart,
  TimeSeriesChart,
} from '../src/ui/components/Charts';
import {
  DepthProfile,
  MiniSeries,
  annuncioCampione,
  riassuntoMiniSerie,
  riassuntoProfilo,
} from '../src/ui/components/DepthProfile';
import { riassuntoCompartimenti } from '../src/ui/components/Saturation';
import type { Dive, Sample } from '../src/core/model';

// ---------------------------------------------------------------------------
// Attrezzi
// ---------------------------------------------------------------------------

/** Rende il componente e restituisce il pezzo di DOM, senza montare React. */
function rendi(nodo: ReactElement): HTMLDivElement {
  const host = document.createElement('div');
  host.innerHTML = renderToStaticMarkup(nodo);
  return host;
}

function svgDi(host: HTMLDivElement): Element {
  const svg = host.querySelector('svg');
  if (!svg) throw new Error('il componente non ha disegnato nessun SVG');
  return svg;
}

/**
 * Il controllo che vale per tutti i grafici, senza eccezioni.
 *
 * Il nome accessibile deve esistere ED essere anche nel `<title>`: `aria-label`
 * da solo funziona sui browser di oggi, il `<title>` interno è quello che si
 * legge quando l'SVG viene salvato o aperto da solo. Due canali per la stessa
 * frase, che quindi deve essere la stessa.
 */
function verificaEtichette(host: HTMLDivElement) {
  const svg = svgDi(host);
  expect(svg.getAttribute('role')).toBe('img');
  const nome = svg.getAttribute('aria-label');
  expect(nome, 'manca aria-label').toBeTruthy();

  const titolo = svg.querySelector('title');
  expect(titolo, 'manca <title>').not.toBeNull();
  expect(titolo!.textContent).toBe(nome);

  const desc = svg.querySelector('desc');
  expect(desc, 'manca <desc>').not.toBeNull();
  // Il collegamento fra `aria-describedby` e l'id della descrizione è la parte
  // che si rompe per prima quando si copia un grafico per farne un altro: se i
  // due non combaciano la descrizione c'è nel documento e non viene mai letta.
  expect(desc!.getAttribute('id')).toBe(svg.getAttribute('aria-describedby'));
  expect(desc!.textContent!.length).toBeGreaterThan(20);
  return { nome: nome!, descrizione: desc!.textContent! };
}

/**
 * Nessun nodo decorativo lasciato scoperto.
 *
 * Il conto si fa sui figli DIRETTI dell'SVG: se il primo livello è tutto
 * nascosto, lo è per costruzione anche tutto quello che sta sotto. Il test
 * fallisce quando qualcuno aggiunge una linea o un'etichetta nuova e si dimentica
 * l'attributo — che è esattamente il modo in cui questi difetti tornano.
 */
function verificaDecorazioniNascoste(host: HTMLDivElement) {
  const svg = svgDi(host);
  const scoperti: string[] = [];
  for (const figlio of Array.from(svg.children)) {
    const tag = figlio.tagName.toLowerCase();
    if (tag === 'title' || tag === 'desc') continue;
    if (figlio.getAttribute('aria-hidden') !== 'true') scoperti.push(tag);
  }
  expect(scoperti, `nodi decorativi non nascosti: ${scoperti.join(', ')}`).toEqual([]);
}

/** La tabella equivalente: presente, invisibile, ma NON tolta all'albero. */
function tabellaNascosta(host: HTMLDivElement) {
  const contenitore = host.querySelector('.solo-lettori');
  expect(contenitore, 'manca la tabella equivalente').not.toBeNull();
  const stile = contenitore!.getAttribute('style') ?? '';
  // `display:none` e `visibility:hidden` la toglierebbero anche agli screen
  // reader: è l'errore classico, e il motivo per cui questa riga esiste.
  expect(stile).not.toContain('display: none');
  expect(stile).not.toContain('visibility: hidden');
  expect(stile).toContain('clip');
  return contenitore!.querySelector('table')!;
}

function monta(nodo: ReactElement) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(nodo));
  return { host, unmount: () => act(() => root.unmount()) };
}

// ---------------------------------------------------------------------------
// Dati di prova, con numeri che si controllano a mente
// ---------------------------------------------------------------------------

const MESI = [
  { key: '2025-01', label: 'gennaio', value: 0 },
  { key: '2025-02', label: 'febbraio', value: 4 },
  { key: '2025-03', label: 'marzo', value: 8 },
];

/**
 * Un profilo di quattro campioni: 3 minuti, massima 30 m al minuto 1, media
 * pesata sul tempo 20.0 m (900 + 1800 + 900 metri·secondo su 180 secondi).
 */
const CAMPIONI: Sample[] = [
  { t: 0, depth: 0, tempC: 20 },
  { t: 60, depth: 30 },
  { t: 120, depth: 30, ceiling: 6 },
  { t: 180, depth: 0, ceiling: 3, tempC: 24 },
];

function immersione(samples: Sample[] = CAMPIONI, extra: Partial<Dive> = {}): Dive {
  return {
    id: 'accessibilita-1',
    startTime: '2026-06-14T10:38:00+02:00',
    durationS: 180,
    maxDepth: 30,
    mode: 'oc',
    cylinders: [{ mix: { o2: 0.21, he: 0 }, sizeL: 12 }],
    source: { format: 'logtrak', file: 'a.logtrak', importedAt: '2026-06-14T20:00:00Z' },
    tags: [],
    samples,
    ...extra,
  };
}

// ---------------------------------------------------------------------------

describe('nome e descrizione di ogni grafico', () => {
  it('istogramma a colonne', () => {
    const host = rendi(e(ColumnChart, { data: MESI, unit: 'immersioni' }));
    const { nome, descrizione } = verificaEtichette(host);
    expect(nome).toContain('immersioni');
    // I numeri veri: totale 12, picco marzo con 8, una colonna vuota.
    expect(descrizione).toContain('totale 12 immersioni');
    expect(descrizione).toContain('Massimo marzo con 8');
    expect(descrizione).toContain('A zero: 1 su 3');
    verificaDecorazioniNascoste(host);
  });

  it('barre orizzontali', () => {
    const siti = [
      { key: 'a', label: 'Secca del Papa', value: 12 },
      { key: 'b', label: 'Punta Corallina', value: 5 },
    ];
    const host = rendi(e(BarChart, { data: siti, unit: 'immersioni' }));
    const { descrizione } = verificaEtichette(host);
    expect(descrizione).toContain('2 voci, totale 17 immersioni');
    verificaDecorazioniNascoste(host);
  });

  it('serie temporale', () => {
    const punti = [
      { at: Date.UTC(2025, 2, 15, 12), value: 20 },
      { at: Date.UTC(2025, 5, 15, 12), value: 18 },
      { at: Date.UTC(2025, 8, 15, 12), value: 16 },
      { at: Date.UTC(2025, 11, 15, 12), value: 14 },
    ];
    const host = rendi(e(TimeSeriesChart, { points: punti, unit: 'L/min' }));
    const { descrizione } = verificaEtichette(host);
    expect(descrizione).toContain('4 rilevazioni');
    expect(descrizione).toContain('Mediana 17.0 L/min');
    expect(descrizione).toContain('in diminuzione');
    verificaDecorazioniNascoste(host);
  });

  it('dispersione', () => {
    const punti = Array.from({ length: 6 }, (_, i) => ({
      x: i + 1,
      y: (i + 1) * 2,
      diveId: `d${i}`,
      label: `immersione ${i}`,
    }));
    const host = rendi(
      e(ScatterChart, { points: punti, xLabel: 'profondità (m)', yLabel: 'consumo (L/min)' }),
    );
    const { nome, descrizione } = verificaEtichette(host);
    expect(nome).toBe('Dispersione: consumo (L/min) in funzione di profondità (m)');
    expect(descrizione).toContain('6 immersioni');
    expect(descrizione).toContain('Correlazione +1.00');
    verificaDecorazioniNascoste(host);
  });

  it('curva del pianificatore', () => {
    const punti = [
      { x: 20, y: 60 },
      { x: 30, y: 30 },
      { x: 40, y: 12 },
    ];
    const host = rendi(e(CurveChart, { points: punti, xLabel: 'm', yLabel: 'min', marker: 30 }));
    const { descrizione } = verificaEtichette(host);
    expect(descrizione).toContain('Si va da 60 a 12 (in diminuzione)');
    expect(descrizione).toContain('Nel punto marcato, 30: 30');
    verificaDecorazioniNascoste(host);
  });

  it('profilo di profondità', () => {
    const host = rendi(e(DepthProfile, { dive: immersione() }));
    const { nome, descrizione } = verificaEtichette(host);
    expect(nome).toContain('Profilo');
    expect(descrizione).toContain('Massima 30.0 m al minuto 1, media 20.0 m');
    expect(descrizione).toContain('Tetto di decompressione presente dal minuto 2 al minuto 3');
    verificaDecorazioniNascoste(host);
  });

  it('serie secondaria allineata al profilo', () => {
    const host = rendi(
      e(MiniSeries, {
        samples: CAMPIONI,
        pick: (s: Sample) => s.depth,
        label: 'Profondità',
        unit: 'm',
        digits: 1,
      }),
    );
    const { nome, descrizione } = verificaEtichette(host);
    expect(nome).toBe('Profondità (m)');
    expect(descrizione).toContain('Minimo 0.0 al minuto 0, massimo 30.0 al minuto 1');
    verificaDecorazioniNascoste(host);
  });
});

describe('tabelle equivalenti', () => {
  it('l’istogramma porta tutte le sue colonne, etichetta e valore', () => {
    const host = rendi(e(ColumnChart, { data: MESI, unit: 'immersioni' }));
    const tabella = tabellaNascosta(host);
    expect(tabella.querySelectorAll('tbody tr')).toHaveLength(3);
    expect(tabella.textContent).toContain('febbraio');
    expect(tabella.textContent).toContain('marzo');
  });

  it('le barre portano il nome INTERO del sito, che nel disegno è troncato', () => {
    const siti = [{ key: 'a', label: 'Secca del Papa — cattedrale nord', value: 12 }];
    const host = rendi(e(BarChart, { data: siti, unit: 'immersioni' }));
    // Solo le etichette DISEGNATE: il nome intero compare comunque nel `<desc>`,
    // ed è giusto così — quello che manca al disegno è la riga leggibile.
    const disegnate = Array.from(svgDi(host).querySelectorAll('text'))
      .map((t) => t.textContent)
      .join(' ');
    expect(disegnate).not.toContain('cattedrale nord');
    expect(tabellaNascosta(host).textContent).toContain('Secca del Papa — cattedrale nord');
  });

  it('la serie temporale è raggruppata per periodo, non punto per punto', () => {
    const punti = Array.from({ length: 40 }, (_, i) => ({
      at: Date.UTC(2025, 5, 1, 12) + i * 86_400_000,
      value: 15 + (i % 5),
    }));
    const host = rendi(e(TimeSeriesChart, { points: punti, unit: 'L/min' }));
    const righe = tabellaNascosta(host).querySelectorAll('tbody tr');
    // Quaranta giorni consecutivi stanno in due mesi: due righe, non quaranta.
    expect(righe.length).toBe(2);
  });

  it('la dispersione dà i quartili dei due assi', () => {
    const punti = Array.from({ length: 6 }, (_, i) => ({
      x: i + 1,
      y: (i + 1) * 2,
      diveId: `d${i}`,
      label: `immersione ${i}`,
    }));
    const host = rendi(e(ScatterChart, { points: punti, xLabel: 'zavorra (kg)', yLabel: 'consumo' }));
    const tabella = tabellaNascosta(host);
    expect(tabella.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(tabella.textContent).toContain('zavorra (kg)');
    expect(tabella.querySelectorAll('thead th')).toHaveLength(6);
  });

  it('il profilo NON ha una tabella: migliaia di righe non sono un servizio', () => {
    const fitto = Array.from({ length: 400 }, (_, i) => ({ t: i * 10, depth: 20 }));
    const host = rendi(e(DepthProfile, { dive: immersione(fitto) }));
    expect(host.querySelector('.solo-lettori table')).toBeNull();
  });
});

describe('cursore da tastiera', () => {
  /** Preme un tasto sull'SVG come farebbe il browser. */
  function premi(svg: Element, key: string, shiftKey = false) {
    act(() => {
      svg.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true }));
    });
  }

  it('il profilo entra nell’ordine di tabulazione solo se c’è un cursore', () => {
    const senza = rendi(e(DepthProfile, { dive: immersione() }));
    expect(svgDi(senza).getAttribute('tabindex')).toBeNull();

    const con = rendi(e(DepthProfile, { dive: immersione(), cursor: { t: null, onChange: () => {} } }));
    expect(svgDi(con).getAttribute('tabindex')).toBe('0');
  });

  it('la prima freccia porta al punto più profondo, non al minuto zero', () => {
    const visti: (number | null)[] = [];
    const vista = monta(
      e(DepthProfile, { dive: immersione(), cursor: { t: null, onChange: (t) => visti.push(t) } }),
    );
    premi(vista.host.querySelector('svg')!, 'ArrowRight');
    // Il campione a 30 m sta al secondo 60: è l'istante che si va a cercare.
    expect(visti).toEqual([60]);
    vista.unmount();
  });

  it('le frecce si muovono di un campione, Home e Fine agli estremi, Esc annulla', () => {
    const visti: (number | null)[] = [];
    const vista = monta(
      e(DepthProfile, { dive: immersione(), cursor: { t: 60, onChange: (t) => visti.push(t) } }),
    );
    const svg = vista.host.querySelector('svg')!;
    premi(svg, 'ArrowRight');
    premi(svg, 'ArrowLeft');
    premi(svg, 'Home');
    premi(svg, 'End');
    premi(svg, 'Escape');
    expect(visti).toEqual([120, 0, 0, 180, null]);
    vista.unmount();
  });

  it('un tasto che non c’entra non muove niente', () => {
    const visti: (number | null)[] = [];
    const vista = monta(
      e(DepthProfile, { dive: immersione(), cursor: { t: 60, onChange: (t) => visti.push(t) } }),
    );
    premi(vista.host.querySelector('svg')!, 'a');
    expect(visti).toEqual([]);
    vista.unmount();
  });

  it('annuncia il valore corrente solo quando quel grafico ha il fuoco', () => {
    // Il cursore è CONDIVISO fra il profilo e gli otto grafici sotto: se ognuno
    // tenesse una regione viva sempre presente, una freccia premuta produrrebbe
    // nove annunci uguali.
    const vista = monta(e(DepthProfile, { dive: immersione(), cursor: { t: 120, onChange: () => {} } }));
    expect(vista.host.querySelector('[role="status"]')).toBeNull();
    const svg = vista.host.querySelector('svg')!;
    act(() => {
      svg.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    });
    const annuncio = vista.host.querySelector('[role="status"]');
    expect(annuncio).not.toBeNull();
    expect(annuncio!.getAttribute('aria-live')).toBe('polite');
    expect(annuncio!.textContent).toContain('30.0 m');
    expect(annuncio!.textContent).toContain('tetto 6.0 m');
    vista.unmount();
  });
});

describe('frasi calcolate dai dati', () => {
  it('il riassunto del profilo cambia quando cambiano i campioni', () => {
    // È la proprietà che distingue una descrizione calcolata da una scritta a
    // mano: la seconda resta uguale mentre il disegno diventa un altro.
    const primo = riassuntoProfilo(immersione());
    const secondo = riassuntoProfilo(
      immersione([
        { t: 0, depth: 0 },
        { t: 60, depth: 12 },
        { t: 120, depth: 12 },
        { t: 180, depth: 0 },
      ]),
    );
    expect(primo).not.toBe(secondo);
    expect(secondo).toContain('Massima 12.0 m al minuto 1, media 8.0 m.');
    expect(secondo).toContain('Nessun obbligo di decompressione');
  });

  it('il riassunto del profilo conta i segnalibri e l’escursione termica', () => {
    const testo = riassuntoProfilo(immersione(CAMPIONI, { events: [{ t: 30 }, { t: 90 }] }));
    expect(testo).toBe(
      'Profilo di 3 minuti su 4 campioni. Massima 30.0 m al minuto 1, media 20.0 m. ' +
        'Tetto di decompressione presente dal minuto 2 al minuto 3, il più profondo 6.0 m. ' +
        'Temperatura da 20 a 24 °C. 2 segnalibri sul computer.',
    );
  });

  it('la media del profilo è pesata sul tempo, non sui campioni', () => {
    // Campionamento che si infittisce in risalita, come fanno i computer: la
    // media aritmetica dei sei campioni darebbe 11.7 m, perché i cinque campioni
    // fitti della risalita peserebbero quanto i dieci minuti passati sul fondo.
    // Con i trapezi sul tempo: 12000 + 175 + 125 + 75 + 25 = 12400 metri·secondo
    // su 640 secondi, cioè 19.4 m.
    const irregolare: Sample[] = [
      { t: 0, depth: 20 },
      { t: 600, depth: 20 },
      { t: 610, depth: 15 },
      { t: 620, depth: 10 },
      { t: 630, depth: 5 },
      { t: 640, depth: 0 },
    ];
    expect(riassuntoProfilo(immersione(irregolare))).toContain('media 19.4 m');
  });

  it('un’immersione senza profilo lo dice, invece di descrivere il vuoto', () => {
    expect(riassuntoProfilo(immersione([]))).toBe('Immersione senza profilo campionato.');
  });

  it('la serie secondaria nomina gli estremi e l’istante in cui cadono', () => {
    const punti = [
      { t: 0, v: 99 },
      { t: 600, v: 12 },
      { t: 1200, v: 40 },
    ];
    expect(riassuntoMiniSerie(punti, { etichetta: 'NDL', unita: 'min' })).toBe(
      'NDL in min, 3 rilevazioni su 20 minuti. Minimo 12 al minuto 10, massimo 99 al minuto 0. ' +
        'Valore finale 40.',
    );
  });

  it('l’annuncio del cursore dice le stesse righe del tooltip', () => {
    const testo = annuncioCampione({
      t: 750,
      depth: 42.34,
      ceiling: 6,
      tempC: 14.2,
      pressureBar: [123.4],
    });
    expect(testo).toBe('minuto 12:30, 42.3 m, tetto 6.0 m, 14.2 °C, 123 bar');
  });

  it('i compartimenti dicono chi comanda e chi ha sforato', () => {
    const list = [
      { index: 1, halfTimeMin: 4, n2: 1.1, he: 0, total: 1.1, mValue: 2.5, limit: 2.0, percent: 20 },
      { index: 2, halfTimeMin: 8, n2: 1.5, he: 0, total: 1.5, mValue: 2.0, limit: 1.8, percent: 75 },
      { index: 3, halfTimeMin: 12.5, n2: 1.9, he: 0, total: 1.9, mValue: 1.95, limit: 1.85, percent: 96 },
    ];
    expect(riassuntoCompartimenti(list)).toBe(
      '3 compartimenti. Comanda: 3 (12.5 min), 1.90 bar, limite 1.85, valore M 1.95 — ' +
        '96% del gradiente ammesso. Più carico: 3 (1.90 bar). Oltre il limite: 3.',
    );
    // Quando il compartimento che comanda è dichiarato da chi ci chiama, vince
    // quello: è lo stesso numero che la tessera mostra accanto al grafico.
    expect(riassuntoCompartimenti(list, { comanda: 2 })).toContain('Comanda: 2');
    // Il «nessuno oltre il limite» va detto, non sottinteso.
    expect(riassuntoCompartimenti(list.slice(0, 2))).toContain('Nessun compartimento oltre');
  });
});

describe('l’istruzione da tastiera è annunciata', () => {
  /**
   * Una funzione che esiste ma di cui nessuno viene informato è, per chi non
   * vede lo schermo, una funzione che non c'è: l'istruzione va nella descrizione
   * del grafico, che è l'unica cosa che lo screen reader legge quando ci arriva.
   */
  it('il profilo spiega le frecce quando il cursore c’è, e tace quando non c’è', () => {
    const con = rendi(e(DepthProfile, { dive: immersione(), cursor: { t: null, onChange: () => {} } }));
    expect(svgDi(con).querySelector('desc')!.textContent).toContain('Frecce per muovere il cursore');

    const senza = rendi(e(DepthProfile, { dive: immersione() }));
    expect(svgDi(senza).querySelector('desc')!.textContent).not.toContain('Frecce');
  });
});
