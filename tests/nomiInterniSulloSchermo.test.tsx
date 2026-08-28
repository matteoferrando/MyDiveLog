// @vitest-environment jsdom
/**
 * ► LA STESSA GUARDIA, DAVANTI AI DUE SCHERMI CHE UNA PERSONA GUARDA DAVVERO. ◄
 *
 * `nomiInterniAValle.test.tsx` fa entrare gli errori finti dai moduli — archivio,
 * servizio di accesso, lettore di file. Qui si entra dall'altra parte: si monta
 * il componente vero, gli si fa fallire quello che sta sotto con un errore che
 * porta un nome di `NOMI_INTERNI`, e si legge **il DOM**, cioè esattamente la
 * stringa che finirebbe sotto gli occhi di chi usa l'app.
 *
 * La differenza non è formale. Il difetto del 28 agosto 2026 era invisibile a
 * ogni prova sui moduli — `causaDelGuasto` non esisteva ancora, ma anche se
 * fosse esistita e fosse stata verde, la riga che stampava «Btleplug error:
 * Permission denied» non passava di lì. Passava dal componente al riquadro
 * rosso, e per vederla bisognava guardare il riquadro rosso.
 *
 * ► COSA NON COPRE, e vale la pena saperlo prima di fidarsi. ◄
 *
 *  - **la strada di libdivecomputer non è guidata.** Per arrivarci servono la
 *    scelta di marca e modello nel catalogo, cioè due schermate che non
 *    c'entrano con questa proprietà. Il messaggio che quella strada costruisce
 *    ha la stessa forma di quello provato qui sotto per la strada dei driver di
 *    casa — stessa funzione, stesse frasi, e la prova «il motivo riportato dal
 *    trasferimento» gli fa passare proprio la riga del Rust — ma **è una
 *    somiglianza, non una prova**;
 *  - **il diario resta escluso, di proposito.** Lo scarico allega un blocco
 *    tecnico dove il nome della libreria e il numero di stato ci devono essere:
 *    sono la sola cosa su cui si possa lavorare quando arriva una segnalazione.
 *    L'esclusione è scritta in `testoVisibile` e non nascosta in un'asserzione;
 *  - **non si verifica che la frase sia UTILE**, solo che ci sia, che sia
 *    italiana, e che non porti nomi di sotto.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NOMI_INTERNI } from '../src/core/ble/causaGuasto';
import type { BleFoundDevice, DownloadEvent } from '../src/core/ble/types';
import type { Dive } from '../src/core/model';
import type { ImportOutcome } from '../src/ui/state';

// ---------------------------------------------------------------------------
// Attrezzi
// ---------------------------------------------------------------------------

function senzaNomiInterni(testo: string, dove: string) {
  const minuscolo = testo.toLowerCase();
  for (const nome of NOMI_INTERNI) {
    expect(minuscolo.includes(nome), `«${nome}» è arrivato sullo schermo (${dove}): «${testo}»`).toBe(false);
  }
}

/**
 * Quello che si legge a schermo, SENZA il diario tecnico.
 *
 * Il diario è l'unico posto dell'applicazione in cui il nome della libreria e
 * il numero di stato ci devono essere: è il blocco che si allega a una
 * segnalazione, e senza quelle righe non contiene niente su cui lavorare. Sta
 * dentro un `<details>` chiuso, che `textContent` legge lo stesso — quindi lo
 * si toglie QUI, in un punto solo e con un nome, invece di lasciare che le
 * asserzioni inciampino ogni volta nell'unica eccezione voluta.
 */
function testoVisibile(host: HTMLElement): string {
  const copia = host.cloneNode(true) as HTMLElement;
  for (const dettagli of copia.querySelectorAll('details')) dettagli.remove();
  return copia.textContent ?? '';
}

/** Gli stessi errori finti dell'altra guardia, scritti come li scrive chi sta sotto. */
const ERRORI_FINTI = {
  archivio: () => new Error('Libsql error: no available storage method found'),
  scrittura: () => new Error('Libsql error: database is locked'),
  ricerca: () => new Error('Btleplug error: internal btleplug failure'),
  /** Copiata da `src-tauri/src/trasporto_ldc.rs`, non inventata. */
  trasporto: 'libdivecomputer non ha aperto il trasporto (stato 3)',
};

// ---------------------------------------------------------------------------
// I finti dei moduli
// ---------------------------------------------------------------------------

const finto = vi.hoisted(() => ({
  /** Il contesto che i componenti leggono. Lo riempie ogni prova. */
  contesto: {} as Record<string, unknown>,
  /** Come si comporta la scansione Bluetooth. */
  cerca: (_a: (d: unknown[]) => void, _s: AbortSignal): Promise<void> => Promise.resolve(),
  /** Come risponde il trasferimento. */
  scarico: (): Promise<unknown> => Promise.reject(new Error('scarico non impostato')),
}));

vi.mock('../src/ui/state', () => ({ useDiveLog: () => finto.contesto }));

vi.mock('../src/storage/ble', async (originale) => ({
  ...(await originale<typeof import('../src/storage/ble')>()),
  TauriBleTransport: class {
    available() {
      return Promise.resolve(true as const);
    }
    scan(onUpdate: (d: BleFoundDevice[]) => void, signal: AbortSignal) {
      return finto.cerca(onUpdate as (d: unknown[]) => void, signal);
    }
    open() {
      return Promise.reject(new Error('qui non si apre niente'));
    }
  },
}));

vi.mock('../src/core/ble/download', () => ({
  downloadFromComputer: (
    _t: unknown,
    _d: unknown,
    _driver: unknown,
    opzioni: { onEvent: (e: DownloadEvent) => void },
  ) => {
    opzioni.onEvent({ kind: 'counted', total: 2 });
    return finto.scarico();
  },
}));

const { BleDownload } = await import('../src/ui/components/BleDownload');
const { ImportPage } = await import('../src/ui/pages/ImportPage');

// ---------------------------------------------------------------------------
// Montaggio
// ---------------------------------------------------------------------------

async function monta(nodo: React.ReactNode) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(nodo);
  });
  return { host, smonta: () => act(() => root.unmount()) };
}

function premi(host: HTMLElement, etichetta: string) {
  const bottone = [...host.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes(etichetta));
  if (!bottone) throw new Error(`nessun pulsante con «${etichetta}»`);
  return bottone;
}

async function clic(host: HTMLElement, etichetta: string) {
  await act(async () => {
    premi(host, etichetta).dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

const immersioni = (): Dive[] =>
  [1, 2].map((n) => ({
    id: `imm-${n}`,
    startTime: `2026-06-1${n}T10:00:00+02:00`,
    durationS: 2400,
    maxDepth: 25,
    mode: 'oc' as const,
    cylinders: [],
    source: { format: 'shearwater-ble' as const, file: 'ble', importedAt: '2026-06-20T10:00:00Z' },
    tags: [],
  }));

const esitoCompleto = (over: Record<string, unknown> = {}) => ({
  dives: immersioni(),
  warnings: [],
  status: 'complete' as const,
  trace: ['0001 → richiesta identificazione'],
  records: [],
  newestKey: 'impronta',
  model: 'Peregrine',
  serial: '988B023F',
  ...over,
});

/**
 * Una ricerca che trova e poi ASPETTA di essere annullata.
 *
 * È il contratto di `scan()`: non torna da sola. Il segnale glielo dà la
 * schermata quando si preme «Scarica», ed è il motivo per cui questa funzione
 * non ha bisogno di scadenze — la prova che deve fallire fallisce su
 * un'asserzione, non dopo trenta secondi.
 */
const ricercaCheTrova =
  (dispositivi: BleFoundDevice[]) => (annuncia: (d: unknown[]) => void, segnale: AbortSignal) => {
    annuncia(dispositivi);
    return new Promise<void>((risolvi) => {
      segnale.addEventListener('abort', () => risolvi(), { once: true });
    });
  };

const PEREGRINE: BleFoundDevice = { id: 'dev-1', name: 'Peregrine', rssi: -55, serviceUuids: [] };

beforeEach(() => {
  finto.contesto = {
    dives: [],
    storeLocation: 'archivio finto',
    bleMarkers: {},
    importFiles: async () => [],
    importDives: async (): Promise<ImportOutcome> => ({
      fileName: 'ble',
      ok: true,
      found: 2,
      added: 2,
      merged: 0,
      duplicates: 0,
      warnings: [],
    }),
    clearAll: async () => undefined,
    saveBleMarker: async () => undefined,
    forgetBleMarker: async () => undefined,
  };
  finto.cerca = ricercaCheTrova([PEREGRINE]);
  finto.scarico = () => Promise.resolve(esitoCompleto());
});

afterEach(() => {
  document.body.innerHTML = '';
});

// ---------------------------------------------------------------------------
// La ricerca
// ---------------------------------------------------------------------------

describe('la ricerca del computer che non parte', () => {
  it('► il riquadro rosso non porta il nome del plugin, che è il difetto originale ◄', async () => {
    finto.cerca = () => Promise.reject(ERRORI_FINTI.ricerca());
    const vista = await monta(<BleDownload />);
    await clic(vista.host, 'Cerca il computer');

    const detto = vista.host.querySelector('.notice-error')?.textContent ?? '';
    expect(detto).not.toBe('');
    senzaNomiInterni(detto, 'la ricerca fallita');
    expect(detto).toContain('La ricerca non è partita');
    vista.smonta();
  });

  it('e il riquadro dei dodici secondi non afferma più la cosa smentita', () => {
    /*
     * ► LA PREMESSA CROLLATA IL 28 AGOSTO ERA ANCORA A SCHERMO. ◄ «Un permesso
     * negato non dà errore: la ricerca sembra solo non trovare niente.» Non è
     * vero da quando si è scoperto che `scan()` lancia, e mandava a controllare
     * un permesso che c'è già — cioè a cercare dove il problema non è.
     *
     * Il sorgente è la sola strada per questa prova: il riquadro compare dopo
     * dodici secondi di ricerca a vuoto, e aspettarli davvero renderebbe la
     * guardia lenta esattamente come quelle che poi nessuno guarda più.
     */
    // Dalla radice del progetto e non da `import.meta.url`: sotto jsdom quella
    // non è sempre un indirizzo `file:`, e `fileURLToPath` lo rifiuta. La
    // lunghezza controllata qui sotto è la prova che il percorso è quello vero.
    const sorgente = readFileSync(join(process.cwd(), 'src/ui/components/BleDownload.tsx'), 'utf8');
    expect(sorgente.length).toBeGreaterThan(500);
    expect(sorgente).toContain("t('Un permesso negato lo diremmo con un messaggio");
    expect(sorgente).not.toContain("t('Un permesso negato non dà errore");
  });
});

// ---------------------------------------------------------------------------
// Lo scarico
// ---------------------------------------------------------------------------

describe('lo scarico Bluetooth che va male', () => {
  it('► il guasto dell’archivio non arriva a schermo col nome del motore ◄', async () => {
    finto.scarico = () => Promise.reject(ERRORI_FINTI.scrittura());
    const vista = await monta(<BleDownload />);
    await clic(vista.host, 'Cerca il computer');
    expect(vista.host.textContent).toContain('Peregrine');
    await clic(vista.host, 'Scarica');

    const detto = testoVisibile(vista.host);
    senzaNomiInterni(detto, 'lo scarico rotto');
    expect(detto).toContain('Lo scarico si è interrotto');
    expect(detto).toContain('Non è stata salvata nessuna immersione');
    expect(detto).toContain('Spegni e riaccendi');
    // Il motivo grezzo resta dov'è utile: nel diario, che `testoVisibile` toglie.
    expect(vista.host.textContent).toContain('Libsql error: database is locked');
    vista.smonta();
  });

  it('il motivo riportato dal trasferimento passa dal filtro, non dal crudo', async () => {
    // La stringa è quella che il Rust manda su davvero: porta il nome della
    // libreria e un numero di stato che non insegna niente a nessuno.
    finto.scarico = () =>
      Promise.resolve(
        esitoCompleto({ dives: [], status: 'partial', error: ERRORI_FINTI.trasporto, newestKey: undefined }),
      );
    const vista = await monta(<BleDownload />);
    await clic(vista.host, 'Cerca il computer');
    await clic(vista.host, 'Scarica');

    const detto = testoVisibile(vista.host);
    senzaNomiInterni(detto, 'il motivo del trasferimento');
    expect(detto).not.toContain('stato 3');
    expect(detto).toContain('Lo scarico si è interrotto');
    vista.smonta();
  });

  it('quando il salvataggio rifiuta, dice che non si è salvato e che cosa fare', async () => {
    // `error: undefined` è l'esito che `state.tsx` produce quando il motivo non
    // si poteva ripulire: qui si verifica che non diventi «undefined» a schermo.
    finto.contesto.importDives = async (): Promise<ImportOutcome> => ({
      fileName: 'ble',
      ok: false,
      found: 2,
      added: 0,
      merged: 0,
      duplicates: 0,
      warnings: [],
    });
    const vista = await monta(<BleDownload />);
    await clic(vista.host, 'Cerca il computer');
    await clic(vista.host, 'Scarica');

    const detto = testoVisibile(vista.host);
    senzaNomiInterni(detto, 'il salvataggio rifiutato');
    expect(detto).not.toContain('undefined');
    expect(detto).toContain('non si sono potute salvare');
    expect(detto).toContain('Controlla lo spazio libero');
    vista.smonta();
  });
});

// ---------------------------------------------------------------------------
// L'import
// ---------------------------------------------------------------------------

describe('la pagina di import quando l’archivio rifiuta', () => {
  it('► l’allarme dice che fare e che fine hanno fatto i dati, senza nomi di sotto ◄', async () => {
    finto.contesto.importFiles = () => Promise.reject(ERRORI_FINTI.archivio());
    const vista = await monta(<ImportPage onDone={() => undefined} />);

    const zona = vista.host.querySelector('.dropzone');
    if (!zona) throw new Error('la pagina di import non ha la zona di trascinamento');
    const evento = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(evento, 'dataTransfer', {
      value: { files: [new File(['contenuto'], 'log.uddf')] },
    });
    await act(async () => {
      zona.dispatchEvent(evento);
    });

    const detto = vista.host.querySelector('[role="alert"]')?.textContent ?? '';
    expect(detto).not.toBe('');
    senzaNomiInterni(detto, 'l’allarme della pagina di import');
    expect(detto).toContain('Import fallito');
    expect(detto).toContain('potrebbe non essere in archivio');
    /*
     * ► L'ORDINE, che è metà della correzione. ◄ Il consiglio prima, il tecnico
     * dopo e fra parentesi: è la forma che `describeSyncError` usava da sempre
     * in `sync/turso.ts` e che qui mancava. Prima si leggeva «Import fallito:
     * <riga in inglese>» e basta, cioè si era obbligati a passare dal tecnico
     * per non arrivare da nessuna parte.
     */
    expect(detto.indexOf('riprova')).toBeGreaterThan(0);
    expect(detto.indexOf('riprova')).toBeLessThan(detto.indexOf('(no available storage method'));
    vista.smonta();
  });
});
