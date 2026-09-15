// @vitest-environment jsdom
/**
 * ► LA PAGINA PROMETTEVA UN CLIC, E DALLA TASTIERA NON SI POTEVA FARE NIENTE. ◄
 *
 * Su Statistiche ci sono tre righe che dicono a chi legge di cliccare:
 *
 *   «Clicca un punto per aprire l'immersione.»
 *   «Ogni punto è un'immersione: cliccala per aprirla…»
 *   «Clicca una bolla per aprire un'immersione fatta lì.»
 *
 * Sotto quelle tre righe c'erano cerchi con un `onClick` e nient'altro: nessun
 * `tabIndex`, nessun `onKeyDown`. Misurato sulla pagina: quattordici grafici,
 * centoventi cerchi con `cursor: pointer`, **zero elementi raggiungibili col
 * tabulatore**. Non era un vicolo cieco — le stesse immersioni si aprono
 * dall'elenco — ma **il difetto è la promessa, non il mouse**: chi naviga da
 * tastiera leggeva quella frase, provava, e non succedeva niente.
 *
 * ► PERCHÉ QUESTA PROVA MONTA LA PAGINA VERA. ◄ Le prove sui componenti
 * (`accessibilita-grafici.test.ts`) dicono che il cursore funziona. Questa dice
 * una cosa diversa e che nessuna di quelle può dire: che **la promessa e la
 * funzione stanno nello stesso posto**. Il difetto non era in un componente,
 * era nella distanza fra una frase scritta in una pagina e un comportamento
 * mancante in un'altra; per vederlo bisogna avere davanti tutte e due.
 *
 * ► E NON CERCA UNA FORMULAZIONE. ◄ Non controlla che la frase dica «frecce» o
 * «Invio» — riscriverla è legittimo, e una guardia sulle parole resterebbe verde
 * il giorno in cui le parole restano e il comportamento se ne va. Controlla la
 * struttura: dove la pagina promette un clic, in quella stessa carta dev'esserci
 * qualcosa che il tabulatore raggiunge. E poi lo prova premendo i tasti.
 */

import { describe, expect, it, vi } from 'vitest';
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';

// Lo stesso finto di `statisticheCoerenti.test.tsx`: la pagina legge l'archivio
// da `useDiveLog()`, e qui l'archivio lo scriviamo noi.
const finto = vi.hoisted(() => ({ valore: {} as Record<string, unknown> }));
vi.mock('../src/ui/state', () => ({ useDiveLog: () => finto.valore }));

import { aggregate } from '../src/core/analysis/aggregate';
import { periodOf } from '../src/core/analysis/window';
import { AIR, type Dive } from '../src/core/model';
import { Stats } from '../src/ui/pages/Stats';

const GIORNO = 86_400_000;
const ORA = Date.parse('2026-08-17T12:00:00Z');

/**
 * Tre siti con le coordinate, e uno è il più a OVEST di tutti.
 *
 * Serve al controllo sull'ordine: le frecce attraversano le bolle da ovest a
 * est, cioè nel verso in cui il disegno le dispone. Punta Corallina ha la
 * longitudine minore ma NON è la prima dell'elenco, così una freccia a destra
 * che si fermasse sul primo sito dell'array invece che sul primo del disegno si
 * vede subito.
 */
const SITI = [
  { name: 'Secca del Papa', lat: 41.2, lon: 9.4 },
  { name: 'Grotta azzurra', lat: 40.8, lon: 9.8 },
  { name: 'Punta Corallina', lat: 41.0, lon: 9.1 },
];

/** Le metriche scritte a mano: qui il difetto da provare non sta nel loro calcolo. */
const metriche = (rmv: number, oscillazione: number): Dive['metrics'] =>
  ({
    quality: { sampleCount: 240, sampleIntervalS: 10, hasProfile: true },
    rmvLpm: rmv,
    bottomVerticalTravelMpm: oscillazione,
    maxAscentRateMpm: 9,
  }) as unknown as Dive['metrics'];

/** Nove immersioni, tre per sito, tutte con consumo e oscillazione misurati. */
function archivio(): Dive[] {
  return Array.from({ length: 9 }, (_, i) => {
    const sito = SITI[i % SITI.length];
    return {
      id: `imm-${i}`,
      startTime: new Date(ORA - (i + 1) * 5 * GIORNO).toISOString(),
      durationS: 2400,
      maxDepth: 20 + i,
      avgDepth: 12 + i * 0.5,
      mode: 'oc',
      cylinders: [{ mix: AIR }],
      source: { format: 'uddf', file: 'prova', importedAt: 'x' },
      tags: [],
      site: { name: sito.name, lat: sito.lat, lon: sito.lon },
      metrics: metriche(15 + i * 0.4, 2 + i * 0.3),
    } as Dive;
  });
}

function monta(nodo: ReactNode) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(nodo));
  return {
    host,
    smonta: () => {
      act(() => root.unmount());
      host.remove();
    },
  };
}

function montaStatistiche(aperte: string[]) {
  const dives = archivio();
  finto.valore = {
    aggregates: aggregate(dives, ORA),
    dives,
    scope: {
      period: periodOf('12m'),
      dives,
      excluded: 0,
      from: dives[dives.length - 1].startTime,
      to: dives[0].startTime,
    },
    gear: { equipment: [], sets: [] },
  };
  return monta(<Stats onOpen={(id: string) => aperte.push(id)} />);
}

/** Preme un tasto sull'elemento, come farebbe il browser. */
function premi(el: Element, key: string) {
  act(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
}

/** La carta il cui titolo è quello: è l'unico appiglio stabile per trovarla. */
function carta(host: HTMLElement, titolo: string): HTMLElement {
  const trovata = [...host.querySelectorAll('.card')].find(
    (c) => (c.querySelector('h2')?.textContent ?? '') === titolo,
  );
  if (!trovata) throw new Error(`nessuna carta intitolata «${titolo}»`);
  return trovata as HTMLElement;
}

describe('su Statistiche, dove si promette un clic la tastiera arriva', () => {
  it('ogni promessa di clic sta in una carta che il tabulatore raggiunge', () => {
    /*
     * È la misura del difetto, fatta al contrario e sulla pagina intera.
     *
     * Prima: tre frasi che dicono «clicca», zero elementi con `tabIndex ≥ 0` in
     * tutta la pagina. Adesso ogni frase deve avere, nella SUA carta, almeno una
     * tappa di tabulazione — cioè il grafico di cui parla. Togliendo il cursore
     * da tastiera i grafici tornano muti e questa riga diventa rossa, mentre una
     * guardia che cercasse la parola «Invio» nella frase resterebbe verde.
     */
    const aperte: string[] = [];
    const vista = montaStatistiche(aperte);

    const promesse = [...vista.host.querySelectorAll('p')].filter((p) => /licca/i.test(p.textContent ?? ''));
    /*
     * La rete sotto la rete: se un giorno le frasi cambiano al punto da non
     * contenere più nessun «clicca», il ciclo qui sotto girerebbe a vuoto e
     * dichiarerebbe sana una pagina che nessuno ha più guardato. Tre sono le
     * promesse di oggi: la serie temporale, le nuvole, la mappa dei siti.
     */
    expect(promesse.length, 'la pagina non promette più nessun clic: la prova gira a vuoto').toBe(3);

    for (const p of promesse) {
      const dentro = p.closest('.card');
      expect(dentro, `«${p.textContent}» non sta in nessuna carta`).not.toBeNull();
      const tappe = dentro!.querySelectorAll('[tabindex="0"]');
      expect(
        tappe.length,
        `«${p.textContent}» promette un clic, ma in quella carta niente si raggiunge col tabulatore`,
      ).toBeGreaterThan(0);
    }
    vista.smonta();
  });

  it('sulla mappa dei siti le frecce scelgono una bolla e l’Invio la apre', () => {
    const aperte: string[] = [];
    const vista = montaStatistiche(aperte);
    const mappa = carta(vista.host, 'Dove ti immergi');
    const svg = mappa.querySelector('svg')!;

    // Una tappa sola per la mappa, e non una per bolla.
    expect(mappa.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
    expect(svg.getAttribute('tabindex')).toBe('0');

    // Invio prima di aver scelto non apre un'immersione a caso.
    premi(svg, 'Enter');
    expect(aperte).toEqual([]);

    // La prima freccia a destra sceglie la bolla più a ovest: Punta Corallina,
    // che nell'archivio è il TERZO sito e la SECONDA immersione.
    premi(svg, 'ArrowRight');
    premi(svg, 'Enter');
    expect(aperte).toEqual(['imm-2']);

    // E il nome accessibile dice quale sito si sta per aprire, perché la
    // regione viva annuncia una volta sola e poi tace.
    expect(svg.getAttribute('aria-label')).toContain('Punta Corallina');
    vista.smonta();
  });

  it('sul grafico dell’andamento le frecce aprono l’immersione di quel punto', () => {
    const aperte: string[] = [];
    const vista = montaStatistiche(aperte);
    // La carta dell'andamento è intitolata con la misura scelta nel menù, che
    // parte dal consumo di superficie.
    const andamento = carta(vista.host, 'Consumo di superficie');
    const svg = andamento.querySelector('svg')!;
    expect(svg.getAttribute('tabindex')).toBe('0');

    premi(svg, 'ArrowRight');
    premi(svg, 'Enter');
    // La serie è in ordine di tempo: il primo punto è l'immersione più vecchia
    // delle nove, cioè quella generata per ultima.
    expect(aperte).toEqual(['imm-8']);
    vista.smonta();
  });
});
