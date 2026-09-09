// @vitest-environment jsdom
/**
 * Quando lo scarico non riesce, c'è ancora un modo da provare — e lo si offre.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ► PERCHÉ QUESTO FILE ESISTE. ◄
 *
 * Per parlare con un computer subacqueo via Bluetooth l'applicazione fa cinque
 * scelte: a quale servizio parlare, su quale caratteristica scrivere, quale
 * ascoltare, con o senza conferma, e se le notifiche vanno rimesse insieme.
 * Fino al 9 settembre 2026 le faceva una volta sola e senza appello: se una
 * era sbagliata, la schermata diceva «non è riuscito» e finiva lì.
 *
 * Adesso il guscio le elenca in ordine di probabilità, e questa schermata
 * offre la successiva. Quello che si prova qui è il pezzo che nessuna prova
 * Rust può vedere: che il pulsante compaia **solo quando c'è davvero un altro
 * modo**, che riprovando si chieda quello DOPO e non lo stesso, e che il modo
 * che ha funzionato venga conservato per la volta dopo.
 *
 * ► L'ASSERZIONE CHE VALE PIÙ DI TUTTE. ◄ Che il modo si conservi **solo se
 * sono arrivate immersioni**. Un collegamento che si apre, non dice niente e
 * si chiude senza errori non ha dimostrato niente: conservarlo inchioderebbe
 * quel computer a una combinazione muta, e il giro dei tentativi — che esiste
 * per uscire dai vicoli ciechi — ne avrebbe creato uno nuovo.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { BleFoundDevice, DownloadEvent } from '../src/core/ble/types';
import type { Dive } from '../src/core/model';

const finto = vi.hoisted(() => ({
  chiamate: [] as Record<string, unknown>[],
  emit: null as ((e: DownloadEvent) => void) | null,
  finisci: null as ((v: unknown) => void) | null,
  fallisci: null as ((e: unknown) => void) | null,
}));

vi.mock('../src/storage/computerEsterni', () => ({
  riconosciComputerEsterno: () => Promise.resolve([{ marca: 'Mares', modello: 'Quad Ci' }]),
  rispondiCodicePin: () => Promise.resolve(),
  scaricaDaComputerEsterno: (opzioni: Record<string, unknown>) => {
    finto.chiamate.push(opzioni);
    finto.emit = opzioni.emit as (e: DownloadEvent) => void;
    return new Promise((risolvi, rifiuta) => {
      finto.finisci = risolvi;
      finto.fallisci = rifiuta;
    });
  },
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: () => Promise.resolve([{ marca: 'Mares', prodotto: 'Quad Ci' }]),
}));

vi.mock('../src/storage/ble', () => ({
  TauriBleTransport: class {
    available() {
      return Promise.resolve(true as const);
    }
    scan(onUpdate: (d: BleFoundDevice[]) => void, signal: AbortSignal) {
      onUpdate([{ id: 'dev-mares', name: 'Quad Ci', rssi: -60, serviceUuids: [] }]);
      return new Promise<void>((risolvi) => {
        signal.addEventListener('abort', () => risolvi(), { once: true });
      });
    }
    open() {
      return Promise.reject(new Error('qui non si apre niente'));
    }
  },
}));

vi.mock('../src/ui/state', () => ({
  useDiveLog: () => ({
    importDives: () =>
      Promise.resolve({ ok: true, found: 1, added: 1, merged: 0, duplicates: 0, warnings: [] }),
    bleMarkers: {},
    saveBleMarker: () => Promise.resolve(),
    forgetBleMarker: () => Promise.resolve(),
  }),
}));

/* Vedi `pinDelComputer.test.tsx`: l'archivio ce lo portiamo noi, perché
 * `localStorage` c'è o non c'è a seconda della versione di Node. */
const memoria = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  writable: true,
  value: {
    get length() {
      return memoria.size;
    },
    clear: () => memoria.clear(),
    getItem: (k: string) => (memoria.has(k) ? memoria.get(k)! : null),
    key: (i: number) => [...memoria.keys()][i] ?? null,
    removeItem: (k: string) => void memoria.delete(k),
    setItem: (k: string, v: string) => void memoria.set(k, String(v)),
  } satisfies Storage,
});

const { BleDownload } = await import('../src/ui/components/BleDownload');
const { TENTATIVI_AUTOMATICI } = await import('../src/core/insistenza');
const { metodoConservato, salvaMetodo } = await import('../src/core/metodo');

const CHIAVE = 'fe25c237|11111111|22222222|senza|unite';

function premi(host: HTMLElement, etichetta: string) {
  const b = [...host.querySelectorAll('button')].find((x) => (x.textContent ?? '').includes(etichetta));
  if (!b) throw new Error(`nessun pulsante con «${etichetta}»`);
  return b;
}

function ce(host: HTMLElement, etichetta: string) {
  return [...host.querySelectorAll('button')].some((x) => (x.textContent ?? '').includes(etichetta));
}

const immersione = (): Dive => ({
  id: 'imm-1',
  startTime: '2026-06-11T10:00:00+02:00',
  durationS: 2400,
  maxDepth: 25,
  mode: 'oc',
  cylinders: [],
  source: { format: 'shearwater-ble', file: 'ble', importedAt: '2026-06-20T10:00:00Z' },
  tags: [],
});

async function apri() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<BleDownload />);
  });
  return { host, smonta: () => act(() => root.unmount()) };
}

async function avvia(host: HTMLElement) {
  await act(async () => {
    premi(host, 'Cerca il computer').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  expect(host.textContent).toContain('Quad Ci');
  await act(async () => {
    premi(host, 'Scarica').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

/** Il guscio dice con quale metodo sta provando. */
async function metodo(index: number, total: number, chiave = CHIAVE) {
  await act(async () =>
    finto.emit!({ kind: 'method', index, total, name: 'senza conferma, notifiche unite', key: chiave }),
  );
}

/** Il guscio dice quanto è arrivato davvero sul filo. */
async function scambio(notifiche: number, byte = notifiche * 100) {
  await act(async () => finto.emit!({ kind: 'exchange', writes: 10, notifications: notifiche, bytes: byte }));
}

/**
 * Lascia che l'applicazione provi da sola finché non smette.
 *
 * A ogni giro annuncia il metodo che `metodoDi` indica, dice quanto è
 * arrivato, e fa fallire il tentativo. Si ferma quando l'app non ne apre un
 * altro — e se non smette mai, fallisce dicendolo, perché un'insistenza senza
 * fine è il difetto peggiore che questo codice possa avere.
 */
async function lasciaProvare(
  metodoDi: (giro: number) => [number, number] | null,
  notificheDi: (giro: number) => number = () => 0,
) {
  for (let giro = 0; giro < 12; giro += 1) {
    const prima = finto.chiamate.length;
    const m = metodoDi(giro);
    if (m) await metodo(m[0], m[1]);
    await scambio(notificheDi(giro));
    await act(async () => finto.fallisci!(new Error('niente')));
    if (finto.chiamate.length === prima) return giro + 1;
  }
  throw new Error('l’applicazione non ha mai smesso di riprovare');
}

beforeEach(() => {
  finto.chiamate = [];
  finto.emit = null;
  finto.finisci = null;
  finto.fallisci = null;
  localStorage.clear();
});

afterEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
});

describe('il giro dei modi di collegarsi', () => {
  it('prova da sola, e solo quando ha finito la pazienza offre il pulsante', async () => {
    /*
     * ► IL PULSANTE NON È PIÙ LA PRIMA PROPOSTA: È L'ULTIMA. ◄ Prima bastava
     * un fallimento perché l'applicazione si fermasse e chiedesse a chi ha il
     * computer in mano di premere qualcosa. Adesso i modi li prova da sola, e
     * il pulsante compare solo dopo che ha esaurito i tentativi automatici —
     * con dentro scritto quale sarebbe il prossimo, così chi preme sa cosa sta
     * chiedendo.
     */
    const { host, smonta } = await apri();
    try {
      await avvia(host);
      // Il primo giro lo chiede la persona; i `TENTATIVI_AUTOMATICI` dopo li
      // fa l'applicazione da sola. Da lì in poi tocca di nuovo a chi guarda.
      const giri = await lasciaProvare((g) => [g + 1, 8]);
      expect(giri, 'i tentativi automatici hanno un tetto').toBe(TENTATIVI_AUTOMATICI + 1);
      expect(finto.chiamate).toHaveLength(TENTATIVI_AUTOMATICI + 1);

      expect(host.textContent).toContain('C’è un altro modo da provare');
      expect(host.textContent).toContain('Modo 7 di 8');
      expect(ce(host, 'Riprova con un altro modo')).toBe(true);
    } finally {
      smonta();
    }
  });

  it('► se il computer HA RISPOSTO, riprova allo stesso modo invece di cambiarlo ◄', async () => {
    /*
     * ════════════════════════════════════════════════════════════════════════
     * È LA PROVA PIÙ IMPORTANTE DI QUESTO FILE, ED È NATA DA DUE DIARI VERI.
     *
     * Il 9 settembre 2026 lo stesso iPhone con lo stesso Mares ha mandato due
     * scarichi falliti: uno dopo **276 KB**, l'altro dopo **25 775 byte**. In
     * tutti e due i casi il metodo aveva funzionato — le notifiche erano
     * arrivate — e a rompersi era stato il collegamento.
     *
     * L'applicazione, in tutti e due i casi, offriva «prova un altro modo»:
     * cioè consigliava di buttare via l'unica combinazione che si sapeva buona
     * per provarne una mai vista. E se quella, per caso, avesse portato a casa
     * un'immersione sola, se la sarebbe pure conservata per le volte dopo.
     */
    const { host, smonta } = await apri();
    try {
      await avvia(host);
      // Il primo tentativo riceve roba vera e poi fallisce.
      const giri = await lasciaProvare(
        (g) => (g === 0 ? [1, 8] : null),
        () => 120,
      );
      // Due riprove uguali, poi si cambia: al terzo giro il metodo non è più
      // stato annunciato, quindi il giro finisce senza altri metodi da provare.
      expect(finto.chiamate[1].tentativo, 'la prima riprova è sullo STESSO metodo').toBe(0);
      expect(finto.chiamate[2].tentativo, 'la seconda pure').toBe(0);
      expect(giri).toBeGreaterThan(2);
    } finally {
      smonta();
    }
  });

  it('se non è arrivato niente, il metodo lo cambia da sola', async () => {
    const { host, smonta } = await apri();
    try {
      await avvia(host);
      await lasciaProvare((g) => [g + 1, 8]);
      expect(finto.chiamate[1].tentativo).toBe(1);
      expect(finto.chiamate[2].tentativo).toBe(2);
      expect(finto.chiamate[3].tentativo).toBe(3);
    } finally {
      smonta();
    }
  });

  it('il diario tiene TUTTI i tentativi, non solo l’ultimo', async () => {
    /*
     * Chi ci manda una segnalazione copia quello che vede. Se ogni tentativo
     * cancellasse il diario del precedente, riceveremmo l'ultimo — cioè quello
     * fatto nelle condizioni peggiori, dopo che il computer è stato scollegato
     * e ricollegato più volte — e non il primo, che racconta come è cominciata.
     */
    const { host, smonta } = await apri();
    try {
      await avvia(host);
      await lasciaProvare((g) => [g + 1, 8]);
      const testo = host.textContent ?? '';
      expect(testo).toContain('── tentativo n. 2 ──');
      expect(testo).toContain('── tentativo n. 5 ──');
      expect(testo).toContain('nessuna risposta con questo modo: provo il prossimo');
    } finally {
      smonta();
    }
  });

  it('«Interrompi» ferma anche i tentativi automatici', async () => {
    /*
     * Il trasferimento in corso non si può fermare — il guscio Rust è dentro
     * la libreria — ma il tentativo DOPO sì, e deve. Un pulsante che non ferma
     * niente si legge come un'applicazione bloccata, e chi lo preme due volte
     * a vuoto chiude l'app.
     */
    const { host, smonta } = await apri();
    try {
      await avvia(host);
      await metodo(1, 8);
      await scambio(0);
      await act(async () => {
        premi(host, 'Interrompi').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      await act(async () => finto.fallisci!(new Error('niente')));
      expect(finto.chiamate, 'dopo «Interrompi» non parte nessun altro tentativo').toHaveLength(1);
    } finally {
      smonta();
    }
  });

  it('il pulsante, quando resta, chiede quello DOPO e non ripete lo stesso', async () => {
    /*
     * La strada a mano esiste ancora, per dopo che l'applicazione ha finito la
     * sua pazienza: chi ha il computer in mano sa cose che noi non sappiamo, e
     * un'ultima spiaggia va lasciata. Ma deve chiedere il modo SUCCESSIVO —
     * ripetere lo stesso insegnerebbe a non premere più.
     */
    const { host, smonta } = await apri();
    try {
      await avvia(host);
      expect(finto.chiamate[0].tentativo).toBeUndefined();
      await lasciaProvare((g) => [g + 1, 8]);
      const quanti = finto.chiamate.length;

      await act(async () => {
        premi(host, 'Riprova con un altro modo').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      expect(finto.chiamate).toHaveLength(quanti + 1);
      expect(finto.chiamate[quanti].tentativo).toBe(TENTATIVI_AUTOMATICI + 1);
    } finally {
      smonta();
    }
  });

  it('sull’ultimo modo non c’è più niente da offrire', async () => {
    // Un pulsante che promette un altro tentativo quando non ce n'è è peggio
    // di nessun pulsante: fa premere, non succede niente di nuovo, e da lì in
    // poi non si crede più a nessun messaggio dell'applicazione.
    const { host, smonta } = await apri();
    try {
      await avvia(host);
      await lasciaProvare(() => [4, 4]);
      expect(host.textContent).not.toContain('C’è un altro modo');
      expect(ce(host, 'Riprova con un altro modo')).toBe(false);
    } finally {
      smonta();
    }
  });

  it('il modo che ha portato immersioni si conserva, e la volta dopo si riparte da lì', async () => {
    const { host, smonta } = await apri();
    try {
      await avvia(host);
      await metodo(2, 4);
      await act(async () => finto.finisci!([immersione()]));
      expect(metodoConservato('dev-mares')).toBe(CHIAVE);
      // A scarico riuscito non si offre nessun altro modo: non c'è niente da
      // cercare.
      expect(ce(host, 'Riprova con un altro modo')).toBe(false);

      // Il giro dopo: si riparte da quello conservato, senza numero di
      // tentativo — il numero è di chi riprova, la chiave di chi ricomincia.
      await act(async () => {
        premi(host, 'Cerca il computer').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      await act(async () => {
        premi(host, 'Scarica').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      expect(finto.chiamate[1].metodo).toBe(CHIAVE);
      expect(finto.chiamate[1].tentativo).toBeUndefined();
    } finally {
      smonta();
    }
  });

  it('un collegamento muto NON si conserva come se avesse funzionato', async () => {
    /*
     * Zero immersioni e nessun errore: il computer si è collegato e non ha
     * detto niente. Non dimostra che quel modo sia quello giusto, e
     * conservarlo inchioderebbe questo computer a una combinazione muta —
     * cioè creerebbe il vicolo cieco da cui il giro esiste per uscire.
     */
    const { host, smonta } = await apri();
    try {
      await avvia(host);
      await metodo(1, 8);
      await scambio(0);
      await act(async () => finto.finisci!([]));
      expect(metodoConservato('dev-mares')).toBeUndefined();
      // E siccome non ha funzionato, l'applicazione passa da sola al modo dopo.
      expect(finto.chiamate).toHaveLength(2);
      expect(finto.chiamate[1].tentativo).toBe(1);
    } finally {
      smonta();
    }
  });

  it('un modo conservato che fallisce si dimentica', async () => {
    // Ha funzionato una volta e adesso no: riproporlo domani vorrebbe dire
    // ripetere all'infinito la cosa che ha appena fallito.
    salvaMetodo('dev-mares', CHIAVE);
    const { host, smonta } = await apri();
    try {
      await avvia(host);
      expect(finto.chiamate[0].metodo).toBe(CHIAVE);
      await metodo(2, 4);
      await scambio(0);
      await act(async () => finto.fallisci!(new Error('niente')));
      expect(metodoConservato('dev-mares')).toBeUndefined();
    } finally {
      smonta();
    }
  });

  it('chi riprova non si porta dietro il modo conservato', async () => {
    /*
     * Premere «riprova con un altro modo» è dire proprio che quello conservato
     * non va: rimandarlo giù sarebbe chiedere due cose opposte nella stessa
     * chiamata.
     *
     * ► IL CASO SI COSTRUISCE CON UN COLLEGAMENTO MUTO, E NON CON UN ERRORE. ◄
     * Dopo un errore il modo conservato viene dimenticato, quindi al secondo
     * giro non ci sarebbe comunque e questa prova resterebbe verde qualunque
     * cosa faccia il codice — cioè non sarebbe una prova. Uno scarico che
     * finisce senza eccezioni e senza immersioni, invece, il modo conservato
     * lo lascia dov'è: è lì che si vede se la riga fa il suo mestiere.
     */
    salvaMetodo('dev-mares', CHIAVE);
    const { host, smonta } = await apri();
    try {
      await avvia(host);
      await metodo(1, 8);
      await scambio(0);
      await act(async () => finto.finisci!([]));
      expect(metodoConservato('dev-mares'), 'un collegamento muto non lo dimentica').toBe(CHIAVE);

      // Il tentativo che parte da solo è già «riprova»: non deve rimandare giù
      // il modo conservato, o chiederebbe due cose opposte nella stessa
      // chiamata.
      expect(finto.chiamate[1].tentativo).toBe(1);
      expect(finto.chiamate[1].metodo).toBeUndefined();
    } finally {
      smonta();
    }
  });

  it('con un modo solo non si parla di modi', async () => {
    /*
     * Il caso normale: un computer conosciuto, un modo solo. L'avanzamento non
     * deve riempirsi di «Metodo 1/1», che è rumore per chi non ha nessun
     * problema da risolvere.
     */
    const { host, smonta } = await apri();
    try {
      await avvia(host);
      await metodo(1, 1);
      expect(host.textContent).not.toContain('Metodo 1/1');
      await scambio(0);
      await act(async () => finto.fallisci!(new Error('niente')));
      expect(ce(host, 'Riprova con un altro modo')).toBe(false);
      expect(finto.chiamate, 'con un modo solo non c’è niente da ruotare').toHaveLength(1);
    } finally {
      smonta();
    }
  });
});
