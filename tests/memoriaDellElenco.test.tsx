// @vitest-environment jsdom
/**
 * L'ELENCO TORNA DOV'ERA, E LA SCHEDA SI APRE DALL'INIZIO.
 *
 * ► PERCHÉ ESISTE. ◄ *«Quando apro un'immersione e poi torno indietro non mi
 * metto in cima a inizio pagina, ma all'altezza dove ero arrivato.»* Chiesto il
 * 12 settembre 2026 con centinaia di immersioni in archivio: il costo del
 * difetto cresce con l'archivio, cioè grava su chi usa l'applicazione di più, e
 * su un archivio corto — quello di chi scrive le prove — non si vede affatto.
 *
 * ► E PERCHÉ NON BASTAVA SALVARE UN NUMERO. ◄ `Logbook` viene smontato quando
 * si apre una scheda: lo decide la `key` dell'`ErrorBoundary`, che sta lì per
 * impedire che da una scheda rotta non si esca più. Smontandolo muore anche la
 * finestra delle righe — cinquanta per volta — quindi chi aveva premuto «mostra
 * altre» tre volte tornerebbe a un elenco alto un terzo, dove **l'altezza
 * salvata non esiste**. Rimetterla com'era lo scaraventerebbe in fondo alla
 * lista: un rimedio che funziona sull'archivio corto e si rompe su quello
 * lungo, cioè sul solo archivio che aveva il problema.
 *
 * Le prove qui sotto guardano tutte e tre le metà della cosa — l'altezza, la
 * finestra, i filtri — e poi il rovescio, che è la seconda metà della richiesta:
 * *aprendo* una scheda si riparte dalla cima.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { computeMetrics } from '../src/core/analysis/metrics';
import { AIR, type Dive, type Sample } from '../src/core/model';
import {
  contenitoreCheScorre,
  dimenticaElenco,
  elencoRicordato,
  ricordaElenco,
} from '../src/ui/memoriaDellElenco';

const finto = vi.hoisted(() => ({ valore: {} as Record<string, unknown> }));
vi.mock('../src/ui/state', () => ({ useDiveLog: () => finto.valore }));

const { Logbook } = await import('../src/ui/pages/Logbook');
const { App } = await import('../src/ui/App');

/**
 * Il contenitore che scorre, con `scrollTop` che si ricorda quello che gli si
 * scrive.
 *
 * jsdom non fa impaginazione, quindi il suo `scrollTop` risponde zero qualunque
 * cosa gli si assegni: una prova scritta sopra il comportamento vero
 * passerebbe anche con il codice che non scrive niente. Qui la proprietà è
 * strumentata apposta — *quello che si sta provando è che qualcuno LEGGA e
 * SCRIVA quel numero al momento giusto*, non che un browser sappia scorrere.
 */
function contenitore() {
  const main = document.createElement('div');
  main.className = 'main';
  document.body.appendChild(main);
  return strumenta(main);
}

/**
 * Come `contenitore`, ma su un nodo che c'è già: serve per il `.main` che
 * disegna `App`, che non possiamo sostituire con uno nostro — sarebbe il
 * secondo `.main` del documento, e `querySelector` prenderebbe il primo.
 */
function strumenta(nodo: HTMLElement, iniziale = 0) {
  let quota = iniziale;
  Object.defineProperty(nodo, 'scrollTop', {
    get: () => quota,
    set: (v: number) => {
      quota = v;
    },
    configurable: true,
  });
  return nodo;
}

function archivio(n: number): Dive[] {
  const GIORNO = 86_400_000;
  const ora = Date.now();
  return Array.from({ length: n }, (_, i) => {
    const inizio = new Date(ora - (5 + (n - 1 - i) * 10) * GIORNO);
    const samples: Sample[] = Array.from({ length: 12 }, (_, k) => ({
      t: k * 60,
      depth: Math.max(0, 28 - Math.abs(6 - k) * 2),
      tempC: 17,
      pressureBar: [200 - k * 8],
    }));
    const dive: Dive = {
      id: `v${i}`,
      number: i + 1,
      startTime: inizio.toISOString(),
      durationS: 2400,
      maxDepth: 28,
      minTempC: 17,
      // Due luoghi diversi: senza, non c'è niente da filtrare e la prova sul
      // filtro conservato proverebbe soltanto che una stringa vuota resta vuota.
      site: { name: i % 2 === 0 ? 'Punta Chiappa' : 'Bergeggi' },
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

function archivioFinto(dives: Dive[]) {
  finto.valore = {
    // `ready` e `initError` li guarda `App`: senza, la prova sull'apertura
    // resterebbe ferma sulla schermata di avvio.
    ready: true,
    initError: undefined,
    dives,
    // `numeri` è una Map da id a numero progressivo: vedi `core/numerazione.ts`.
    numeri: new Map(dives.map((d) => [d.id, d.number])),
    gear: { equipment: [], sets: [] },
    saveGear: async () => undefined,
    createDive: async () => ({ merged: false }),
    updateDive: async () => undefined,
    deleteDive: async () => undefined,
  };
}

function monta(nodo: ReactNode) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  void act(() => root.render(nodo));
  return {
    host,
    ridisegna: (altro: ReactNode) => act(() => root.render(altro)),
    smonta: () => {
      void act(() => root.unmount());
      host.remove();
    },
  };
}

/** Le righe dell'elenco: quelle cliccabili, non l'intestazione. */
function righe(host: HTMLElement) {
  return [...host.querySelectorAll('tr.clickable')];
}

function premiRiga(host: HTMLElement, indice: number) {
  const riga = righe(host)[indice];
  if (!riga) throw new Error(`non c'è la riga n. ${indice}: ce ne sono ${righe(host).length}`);
  void act(() => riga.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}

function premi(host: HTMLElement, etichetta: string) {
  const b = [...host.querySelectorAll('button')].find((x) => (x.textContent ?? '').includes(etichetta));
  if (!b) {
    const tutti = [...host.querySelectorAll('button')].map((x) => x.textContent).join(' | ');
    throw new Error(`nessun pulsante con «${etichetta}». Ci sono: ${tutti}`);
  }
  void act(() => b.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}

function scrivi(campo: HTMLInputElement | HTMLSelectElement, valore: string) {
  act(() => {
    const prototipo = campo instanceof HTMLSelectElement ? HTMLSelectElement : HTMLInputElement;
    Object.getOwnPropertyDescriptor(prototipo.prototype, 'value')?.set?.call(campo, valore);
    campo.dispatchEvent(new Event('change', { bubbles: true }));
    campo.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

beforeEach(() => {
  dimenticaElenco();
  Element.prototype.scrollIntoView = () => {};
  document.body.innerHTML = '';
});

afterEach(() => {
  vi.restoreAllMocks();
  dimenticaElenco();
});

describe('il contenitore che scorre', () => {
  it('è `.main` e non la finestra, e dove non c’è non si lamenta', () => {
    /*
     * ► È LA RIGA CHE SEPARA «NON FA NIENTE» DA «NON C'È». ◄ In questa
     * applicazione la barra laterale sta ferma e a scorrere è `.main`: un
     * ripristino scritto contro `window` non darebbe errore e non farebbe
     * nulla, che è il genere di guasto peggiore da trovare dopo.
     */
    expect(contenitoreCheScorre()).toBeNull();
    const main = contenitore();
    expect(contenitoreCheScorre()).toBe(main);
  });
});

describe('tornando all’elenco', () => {
  it('rimette altezza, finestra delle righe e filtri come stavano', () => {
    const main = contenitore();
    archivioFinto(archivio(120));
    const { host, smonta } = monta(<Logbook onOpen={() => {}} />);

    // Cinquanta righe per volta: si allarga la finestra una volta sola, e
    // cento righe sono già più di quante ne restino dopo un rimontaggio nudo.
    expect(righe(host)).toHaveLength(50);
    premi(host, 'in più');
    expect(righe(host)).toHaveLength(100);

    // Un filtro, perché perdere il filtro è lo stesso difetto visto di lato.
    const cerca = host.querySelector<HTMLInputElement>('input[type="search"], input[type="text"]');
    if (!cerca) throw new Error('non c’è la casella di ricerca');
    scrivi(cerca, 'Bergeggi');
    const quanteFiltrate = righe(host).length;
    expect(quanteFiltrate).toBeGreaterThan(0);

    // Il filtro riporta la finestra a cinquanta — è una regola già scritta e
    // provata altrove — quindi la si riallarga: quello che conta è che il
    // numero ritrovato dopo sia QUESTO, non il valore di partenza.
    premi(host, 'in più');
    const primaDiAprire = righe(host).length;

    main.scrollTop = 1234;
    premiRiga(host, 0);

    const ricordo = elencoRicordato();
    expect(ricordo?.scorrimento).toBe(1234);
    expect(ricordo?.query).toBe('Bergeggi');
    expect(ricordo?.quante).toBe(100);

    // Lo smontaggio è quello vero: `Logbook` sparisce dall'albero come fa
    // quando si apre una scheda.
    smonta();
    main.scrollTop = 0;

    const secondo = monta(<Logbook onOpen={() => {}} />);
    expect(main.scrollTop).toBe(1234);
    expect(righe(secondo.host)).toHaveLength(primaDiAprire);
    const cerca2 = secondo.host.querySelector<HTMLInputElement>('input[type="search"], input[type="text"]');
    expect(cerca2?.value).toBe('Bergeggi');
    secondo.smonta();
  });

  it('non tocca l’altezza finché le righe non ci sono', () => {
    /*
     * ► L'ARCHIVIO ARRIVA DOPO, E IL RIPRISTINO DEVE SAPERLO ASPETTARE. ◄ Al
     * primo disegno l'elenco può essere vuoto: scrivere lì l'altezza vorrebbe
     * dire scriverla su una pagina alta zero — il browser la taglia a zero e
     * non succede niente, in silenzio. Il difetto peggiore di tutti: una riga
     * che gira, non fallisce, e non fa quello che dice.
     */
    const main = contenitore();
    ricordaElenco({
      query: '',
      luogo: '',
      profonditaMinima: '',
      ordine: 'date',
      quante: 50,
      scorrimento: 900,
    });

    archivioFinto([]);
    const { ridisegna, smonta } = monta(<Logbook onOpen={() => {}} />);
    expect(main.scrollTop).toBe(0);

    archivioFinto(archivio(60));
    ridisegna(<Logbook onOpen={() => {}} />);
    expect(main.scrollTop).toBe(900);
    smonta();
  });

  it('rimette l’altezza una volta sola, e poi la pagina è di chi la guarda', () => {
    /*
     * ► SENZA QUESTA, SCORRERE DIVENTEREBBE IMPOSSIBILE. ◄ L'effetto gira a
     * ogni disegno, e l'elenco si ridisegna per mille motivi — una spunta, un
     * filtro, «mostra altre». Se rimettesse l'altezza ogni volta, la pagina
     * tornerebbe indietro sotto le dita di chi sta scorrendo.
     */
    const main = contenitore();
    ricordaElenco({
      query: '',
      luogo: '',
      profonditaMinima: '',
      ordine: 'date',
      quante: 50,
      scorrimento: 700,
    });
    archivioFinto(archivio(120));
    const { host, smonta } = monta(<Logbook onOpen={() => {}} />);
    expect(main.scrollTop).toBe(700);

    main.scrollTop = 20;
    premi(host, 'in più');
    expect(main.scrollTop).toBe(20);
    smonta();
  });
});

describe('aprendo una scheda', () => {
  it('la pagina riparte dall’inizio, anche se l’elenco era a metà', async () => {
    /*
     * ► LA SECONDA METÀ DELLA RICHIESTA, E TIRA DALLA PARTE OPPOSTA. ◄
     * *«Quando apro un'immersione devo sempre ripartire da inizio pagina.»* È
     * lo stesso contenitore dell'altra prova, con il desiderio rovesciato: per
     * questo vanno scritte tutte e due, e per questo questa monta `App` vera
     * invece del solo `Logbook` — il nodo che scorre è di `App`, e una prova
     * che si costruisse il proprio `.main` non direbbe niente su quello che la
     * gente vede.
     *
     * Senza la riga che azzera, chi apriva la riga centoquaranta si ritrovava a
     * metà della scheda nuova, su un punto che non vuol dire niente. E non
     * darebbe nessun errore: la pagina c'è, è solo guardata dal posto sbagliato.
     */
    archivioFinto(archivio(120));
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => root.render(<App />));

    const main = host.querySelector<HTMLElement>('.main');
    if (!main) throw new Error('App non ha disegnato il contenitore che scorre');
    strumenta(main, 640);
    expect(main.scrollTop).toBe(640);

    await act(async () => {
      righe(host)[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(host.textContent).not.toContain('Mostra 50 in più');
    expect(main.scrollTop).toBe(0);

    await act(async () => root.unmount());
    host.remove();
  });
});
