// @vitest-environment jsdom
/**
 * LE PORTE DELLE SCHERMATE VUOTE.
 *
 * ► PERCHÉ ESISTE. ◄ L'applicazione con l'archivio vuoto aveva una porta sola —
 * Importa — e Importa vuole un file da un computer subacqueo o un collegamento
 * Bluetooth. Chi arriva col libretto di carta, col brevetto preso ieri, con un
 * computer a noleggio o con un modello che non si collega non ha né l'uno né
 * l'altro: per lui l'applicazione finiva sulla prima schermata. E il modulo per
 * scrivere un'immersione a mano — l'unico di tutta l'applicazione — stava
 * SOTTO il `return` anticipato del ramo vuoto, cioè era codice irraggiungibile
 * esattamente quando serviva.
 *
 * Era un difetto invisibile ai tipi e ai test unitari: il componente esisteva,
 * compilava, e aveva persino i suoi test. Semplicemente non veniva mai
 * disegnato. Per questo le prove qui sotto MONTANO le pagine e guardano cosa
 * c'è a schermo, che è l'unica domanda che conta.
 *
 * Le altre tre riguardano la stessa idea da angoli diversi: una schermata vuota
 * non deve chiedere prima di dare (il selettore di periodo), non deve dire il
 * falso (il piano che dice «servono PIÙ immersioni» a chi ne ha zero), e non
 * deve presentare numeri di esempio come se fossero di chi legge (il
 * pianificatore).
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { aggregate } from '../src/core/analysis/aggregate';
import { computeMetrics } from '../src/core/analysis/metrics';
import { periodOf } from '../src/core/analysis/window';
import { AIR, type Dive, type Sample } from '../src/core/model';

const finto = vi.hoisted(() => ({ valore: {} as Record<string, unknown> }));
vi.mock('../src/ui/state', () => ({ useDiveLog: () => finto.valore }));

import { Logbook } from '../src/ui/pages/Logbook';
import { Planner } from '../src/ui/pages/Planner';
import { PeriodPicker } from '../src/ui/components/PeriodPicker';
import { Coach } from '../src/ui/pages/Coach';
import { Stats } from '../src/ui/pages/Stats';
import { buildPlan } from '../src/core/analysis/coaching';

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

/** Il pulsante che porta quella parola, o l'errore che dice quali ci sono. */
function bottone(host: HTMLElement, etichetta: string): HTMLButtonElement {
  const trovato = [...host.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes(etichetta));
  if (!trovato) {
    const tutti = [...host.querySelectorAll('button')].map((b) => b.textContent).join(' | ');
    throw new Error(`nessun pulsante con «${etichetta}». Ci sono: ${tutti}`);
  }
  return trovato;
}

function premi(host: HTMLElement, etichetta: string) {
  const b = bottone(host, etichetta);
  act(() => {
    b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  return b;
}

/** Un archivio sintetico con profilo e pressioni, quanto basta a far parlare i conti. */
function archivio(n: number): Dive[] {
  const GIORNO = 86_400_000;
  const ora = Date.now();
  return Array.from({ length: n }, (_, i) => {
    const inizio = new Date(ora - (5 + (n - 1 - i) * 10) * GIORNO);
    const samples: Sample[] = Array.from({ length: 240 }, (_, k) => ({
      t: k * 10,
      depth: Math.max(0, 28 - Math.abs(120 - k) * 0.22),
      tempC: 17,
      pressureBar: [200 - k * 0.5],
    }));
    const dive: Dive = {
      id: `v${i}`,
      number: i + 1,
      startTime: inizio.toISOString(),
      durationS: 2400,
      maxDepth: 28,
      minTempC: 17,
      site: { name: 'Punta Chiappa' },
      mode: 'oc',
      cylinders: [{ mix: AIR, sizeL: 12, startBar: 200, endBar: 80 }],
      salinity: 'salt',
      source: { format: 'uddf', file: 'sintetico', importedAt: inizio.toISOString() },
      tags: [],
      samples,
    };
    dive.metrics = computeMetrics(dive);
    return dive;
  });
}

/** La finestra che le pagine leggono, costruita sulle immersioni che le si danno. */
function finestra(dives: Dive[]) {
  return {
    period: periodOf('12m'),
    dives,
    excluded: 0,
    from: dives[0]?.startTime,
    to: dives[dives.length - 1]?.startTime,
  };
}

const inventarioVuoto = { equipment: [], sets: [] };

beforeEach(() => {
  finto.valore = {};
  document.body.innerHTML = '';
});

// ---------------------------------------------------------------------------
// 1. Il logbook vuoto
// ---------------------------------------------------------------------------

describe('logbook con l’archivio vuoto', () => {
  const archivioFinto = (dives: Dive[] = [], creata?: (d: Dive) => void) => {
    finto.valore = {
      dives,
      numeri: { prossimo: dives.length + 1, buchi: [] },
      gear: inventarioVuoto,
      saveGear: async () => undefined,
      createDive: async (d: Dive) => {
        creata?.(d);
        return { merged: false };
      },
      updateDives: async () => undefined,
    };
  };

  it('offre di scrivere a mano, e non solo di importare', () => {
    archivioFinto();
    const vista = monta(<Logbook onOpen={() => undefined} />);

    // Le due porte, dichiarate insieme. Prima ce n’era una sola.
    expect(bottone(vista.host, 'Vai a Importa')).toBeTruthy();
    expect(bottone(vista.host, 'Scrivila a mano')).toBeTruthy();
    // E il motivo per cui la seconda esiste, scritto per chi non lo sa già.
    expect(vista.host.textContent).toContain('libretto di carta');
    vista.smonta();
  });

  it('«Scrivila a mano» apre davvero il modulo, con un tocco solo', () => {
    archivioFinto();
    const vista = monta(<Logbook onOpen={() => undefined} />);

    // Prima: il modulo non c’è. Questo è il difetto originale — `NewDive` stava
    // sotto il return anticipato e con l’archivio vuoto non veniva mai disegnato.
    expect(vista.host.querySelector('input[type="datetime-local"]')).toBeNull();

    premi(vista.host, 'Scrivila a mano');

    // Dopo: i tre campi senza cui l’immersione non esiste sono a schermo, e ci
    // si è arrivati con UN tocco. Con due (uno per rivelare il riquadro, uno per
    // aprirlo) il difetto sarebbe corretto a metà.
    expect(vista.host.querySelector('input[type="datetime-local"]')).not.toBeNull();
    expect(vista.host.textContent).toContain('I primi tre campi bastano per salvare');
    vista.smonta();
  });

  it('il modulo salva, e l’immersione scritta a mano arriva all’archivio', async () => {
    const salvate: Dive[] = [];
    archivioFinto([], (d) => salvate.push(d));
    const vista = monta(<Logbook onOpen={() => undefined} />);
    premi(vista.host, 'Scrivila a mano');

    /*
     * Si scrive passando dal setter nativo: React installa il proprio sul nodo,
     * e assegnare `campo.value` direttamente cambierebbe il DOM senza che lo
     * stato del componente se ne accorga — il campo mostrerebbe il numero e il
     * salvataggio partirebbe con la casella vuota.
     */
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    const scrivi = (campo: HTMLInputElement | undefined, valore: string) => {
      if (!campo) throw new Error('campo assente nel modulo');
      act(() => {
        setter.call(campo, valore);
        campo.dispatchEvent(new Event('input', { bubbles: true }));
      });
    };

    // Data, durata, profondità: il minimo che il libretto di carta contiene.
    scrivi(
      vista.host.querySelector<HTMLInputElement>('input[type="datetime-local"]') ?? undefined,
      '2026-07-04T09:00',
    );
    scrivi(vista.host.querySelector<HTMLInputElement>('input[type="number"]') ?? undefined, '42');
    scrivi(vista.host.querySelector<HTMLInputElement>('input[inputmode="decimal"]') ?? undefined, '28,5');

    await act(async () => {
      bottone(vista.host, 'Salva').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(salvate).toHaveLength(1);
    expect(salvate[0].durationS).toBe(42 * 60);
    // La virgola decimale arriva intera: è il motivo per cui i campi sono di testo.
    expect(salvate[0].maxDepth).toBeCloseTo(28.5, 3);
    vista.smonta();
  });
});

// ---------------------------------------------------------------------------
// 2. Il pianificatore senza archivio
// ---------------------------------------------------------------------------

describe('pianificatore con l’archivio vuoto', () => {
  const archivioFinto = (dives: Dive[]) => {
    finto.valore = {
      dives,
      scope: finestra(dives),
      period: '12m',
      setPeriod: () => undefined,
      gasInput: null,
      saveGasInput: () => undefined,
      decoInput: null,
      saveDecoInput: () => undefined,
      decoPlans: [],
      saveNamedDecoPlan: async () => undefined,
      deleteNamedDecoPlan: async () => undefined,
    };
  };

  it('dice che i numeri non sono di chi legge, e spegne la stampa', () => {
    archivioFinto([]);
    const vista = monta(<Planner />);

    expect(vista.host.textContent).toContain('Questi sono valori di esempio, non i tuoi');
    // Il foglio esce dall’applicazione e l’avviso non lo segue: finché non c’è
    // un’immersione vera, il pulsante è spento e dice perché.
    expect(bottone(vista.host, 'Stampa il piano').disabled).toBe(true);
    expect(vista.host.textContent).toContain('La stampa si accende con la prima immersione');
    vista.smonta();
  });

  it('con l’archivio pieno l’avviso sparisce e la stampa torna attiva', () => {
    archivioFinto(archivio(6));
    const vista = monta(<Planner />);

    expect(vista.host.textContent).not.toContain('valori di esempio');
    expect(bottone(vista.host, 'Stampa il piano').disabled).toBe(false);
    vista.smonta();
  });
});

// ---------------------------------------------------------------------------
// 3. Gli stati vuoti che chiedevano prima di dare
// ---------------------------------------------------------------------------

describe('selettore del periodo', () => {
  it('con zero immersioni non chiede niente', () => {
    finto.valore = { dives: [], scope: finestra([]), period: '12m', setPeriod: () => undefined };
    const vista = monta(<PeriodPicker />);
    // Né i quattro pulsanti di periodo né lo «0 immersioni nel periodo»: una
    // scelta che non cambia nulla, chiesta a chi non ha ancora niente.
    expect(vista.host.querySelectorAll('button')).toHaveLength(0);
    expect(vista.host.textContent).toBe('');
    vista.smonta();
  });

  it('appena c’è qualcosa da filtrare, torna', () => {
    const dives = archivio(4);
    finto.valore = { dives, scope: finestra(dives), period: '12m', setPeriod: () => undefined };
    const vista = monta(<PeriodPicker />);
    expect(vista.host.querySelectorAll('button').length).toBeGreaterThan(0);
    expect(vista.host.textContent).toContain('nel periodo');
    vista.smonta();
  });
});

describe('piano di miglioramento vuoto', () => {
  const archivioFinto = (dives: Dive[]) => {
    const agg = aggregate(dives);
    finto.valore = {
      dives,
      aggregates: agg,
      plan: buildPlan(dives, agg, 'general'),
      goalId: 'general',
      setGoalId: () => undefined,
      period: '12m',
      setPeriod: () => undefined,
      scope: finestra(dives),
      aiCredentials: null,
      analysis: () => undefined,
      runAnalysis: async () => undefined,
      clearAnalysis: async () => undefined,
    };
  };

  it('con zero immersioni non dice «servono PIÙ immersioni»', () => {
    archivioFinto([]);
    const vista = monta(<Coach />);
    // «Più» di quante? Con l’archivio vuoto non c’è un «più»: c’è un inizio.
    expect(vista.host.textContent).not.toContain('Servono più immersioni');
    expect(vista.host.textContent).toContain('Nessuna immersione in archivio');
    expect(vista.host.textContent).toContain('scrivi la prima a mano');
    vista.smonta();
  });

  it('con qualcuna ma non abbastanza, «servono più immersioni» è vero e resta', () => {
    archivioFinto(archivio(2));
    const vista = monta(<Coach />);
    expect(vista.host.textContent).toContain('Servono più immersioni');
    vista.smonta();
  });
});

// ---------------------------------------------------------------------------
// 4. La spiegazione della velocità di risalita
// ---------------------------------------------------------------------------

describe('statistiche', () => {
  it('spiega la risalita di picco senza la finestra di 30 secondi', () => {
    const dives = archivio(8);
    finto.valore = {
      dives,
      aggregates: aggregate(dives),
      scope: finestra(dives),
      gear: inventarioVuoto,
    };
    const vista = monta(<Stats onOpen={() => undefined} />);

    const scelta = [...vista.host.querySelectorAll<HTMLSelectElement>('select')].find((s) =>
      [...s.options].some((o) => o.value === 'ascent'),
    );
    if (!scelta) throw new Error('manca il menu della serie');
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
    act(() => {
      setter.call(scelta, 'ascent');
      scelta.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(vista.host.textContent).toContain('Il momento più veloce della risalita, non la media');
    // Il dettaglio d’implementazione era già stato tolto ad agosto ed era
    // tornato: questa riga è la sola cosa che impedisce che torni una terza volta.
    expect(vista.host.textContent).not.toContain('finestra di 30 secondi');
    vista.smonta();
  });
});
