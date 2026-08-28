// @vitest-environment jsdom
/**
 * Quando lo scarico Bluetooth si rompe a metà, lo schermo lo DICE — e dice
 * anche che cosa è già in archivio.
 *
 * ► I DUE DIFETTI CHE QUESTO FILE ESISTE PER NON FAR TORNARE. ◄
 *
 * *Il primo*: `scarica` non aveva un `try`. Nel Bluetooth si lancia — il
 * computer si addormenta, il permesso cade, l'archivio rifiuta una scrittura —
 * e un'eccezione a metà lasciava la schermata su «Lettura in corso…» per sempre: nessun
 * messaggio, nessun pulsante che riporti indietro. Il caso peggiore è quello
 * provato qui: il guasto arriva DOPO che le immersioni sono state salvate, che
 * è anche il più probabile, perché il segnalibro si scrive per ultimo. Chi
 * guarda non ha modo di sapere se le sue immersioni ci sono, e riscarica tutto
 * per scoprirlo — minuti di radio e di batteria per un'informazione che
 * l'applicazione aveva già in mano. Per questo il messaggio deve dire due cose
 * insieme: che si è interrotto, e quante ne sono entrate.
 *
 * *Il secondo*: «Interrompi» che non interrompe. Il controllore veniva azzerato
 * appena il trasferimento finiva, cioè PRIMA della fase in cui si scrive in
 * archivio: in quella finestra il pulsante chiamava `abort()` su `null` e non
 * faceva niente, davanti a una schermata che diceva ancora «Lettura in corso…».
 *
 * Il Bluetooth qui è finto fin dove serve: il trasporto trova un Peregrine, il
 * trasferimento e l'archivio rispondono quello che la prova decide. Quello che
 * si verifica non è il protocollo — ci pensano `shearwaterBle` e `uwatecBle` —
 * ma cosa resta a schermo quando qualcosa esplode.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Dive } from '../src/core/model';
import type { BleFoundDevice, DownloadEvent } from '../src/core/ble/types';

/**
 * Le risposte che ogni prova decide, in un contenitore issato sopra gli import.
 *
 * Le fabbriche dei mock vengono sollevate prima di tutto il resto: il
 * contenitore deve esistere prima, il contenuto glielo mette ogni `it`.
 */
const finto = vi.hoisted(() => ({
  /** Il segnale passato al trasferimento: serve per vedere se «Interrompi» arriva. */
  segnale: null as AbortSignal | null,
  scarico: (): Promise<unknown> => Promise.reject(new Error('scarico non impostato')),
  importa: (): Promise<unknown> => Promise.reject(new Error('import non impostato')),
  salvaSegnalibro: (): Promise<void> => Promise.resolve(),
}));

vi.mock('../src/core/ble/download', () => ({
  downloadFromComputer: (
    _trasporto: unknown,
    _dispositivo: unknown,
    _driver: unknown,
    opzioni: { signal: AbortSignal; onEvent: (e: DownloadEvent) => void },
  ) => {
    finto.segnale = opzioni.signal;
    // Un evento vero prima di rispondere: è quello che porta la schermata su
    // «Lettura in corso…», cioè sullo stato da cui il difetto non usciva più.
    opzioni.onEvent({ kind: 'counted', total: 3 });
    return finto.scarico();
  },
}));

vi.mock('../src/storage/ble', () => ({
  TauriBleTransport: class {
    available() {
      return Promise.resolve(true as const);
    }
    /*
     * Un Peregrine e basta: il nome è quello che `shearwaterDriver` riconosce,
     * ed è l'unica cosa che serve perché nell'elenco compaia il pulsante
     * «Scarica». La ricerca poi resta aperta finché non la si annulla, come
     * quella vera — è `scarica` stessa a fermarla.
     */
    scan(onUpdate: (d: BleFoundDevice[]) => void, signal: AbortSignal) {
      onUpdate([{ id: 'dev-1', name: 'Peregrine', rssi: -55, serviceUuids: [] }]);
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
    importDives: () => finto.importa(),
    bleMarkers: {},
    saveBleMarker: () => finto.salvaSegnalibro(),
    forgetBleMarker: () => Promise.resolve(),
  }),
}));

const { BleDownload } = await import('../src/ui/components/BleDownload');

/** Tre immersioni qualsiasi: qui contano solo perché sono tre. */
const immersioni = (): Dive[] =>
  [1, 2, 3].map((n) => ({
    id: `imm-${n}`,
    startTime: `2026-06-1${n}T10:00:00+02:00`,
    durationS: 2400,
    maxDepth: 25,
    mode: 'oc' as const,
    cylinders: [],
    source: { format: 'shearwater-ble' as const, file: 'ble', importedAt: '2026-06-20T10:00:00Z' },
    tags: [],
  }));

const esitoCompleto = () => ({
  dives: immersioni(),
  warnings: [],
  status: 'complete' as const,
  trace: ['0001 → richiesta identificazione', '0002 ← Peregrine'],
  records: [],
  newestKey: 'impronta-piu-recente',
  model: 'Peregrine',
  serial: '988B023F',
});

/** Una promessa che la prova decide quando risolvere. */
function differita<T>() {
  let risolvi!: (v: T) => void;
  const promessa = new Promise<T>((res) => {
    risolvi = res;
  });
  return { promessa, risolvi };
}

function premi(host: HTMLElement, etichetta: string) {
  const bottone = [...host.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes(etichetta));
  if (!bottone) throw new Error(`nessun pulsante con «${etichetta}»`);
  return bottone;
}

async function apri() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<BleDownload />);
  });
  return { host, smonta: () => act(() => root.unmount()) };
}

/** Cerca, trova il Peregrine, e preme «Scarica». */
async function scarica(host: HTMLElement) {
  await act(async () => {
    premi(host, 'Cerca il computer').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  expect(host.textContent).toContain('Peregrine');
  await act(async () => {
    premi(host, 'Scarica').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

beforeEach(() => {
  finto.segnale = null;
  finto.scarico = () => Promise.resolve(esitoCompleto());
  finto.importa = () =>
    Promise.resolve({ ok: true, found: 3, added: 2, merged: 1, duplicates: 0, warnings: [] });
  finto.salvaSegnalibro = () => Promise.resolve();
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('lo scarico Bluetooth che si rompe a metà', () => {
  it('non resta appeso a «Lettura in corso…», e dice quante immersioni sono già in archivio', async () => {
    // Il guasto arriva dopo l'import: le immersioni ci sono già, il segnalibro no.
    finto.salvaSegnalibro = () => Promise.reject(new Error('archivio non scrivibile'));

    const { host, smonta } = await apri();
    try {
      await scarica(host);

      const testo = host.textContent ?? '';
      // Non è più fermo sull'avanzamento…
      expect(testo).not.toContain('Lettura in corso…');
      expect(testo).toContain('Lo scarico si è interrotto');
      // …dice PERCHÉ…
      expect(testo).toContain('archivio non scrivibile');
      // …e soprattutto dice cosa è stato salvato: due nuove più una arricchita.
      expect(testo).toContain('3 immersioni');
      // Il riquadro è quello rosso, ed è tornato il pulsante per ricominciare.
      expect(host.querySelector('.notice-error')).not.toBeNull();
      expect(premi(host, 'Cerca il computer')).toBeTruthy();
    } finally {
      smonta();
    }
  });

  it('non tace su cosa è stato salvato nemmeno quando non è stato salvato niente', async () => {
    finto.scarico = () => Promise.reject(new Error('il computer si è scollegato'));

    const { host, smonta } = await apri();
    try {
      await scarica(host);
      const testo = host.textContent ?? '';
      expect(testo).toContain('Lo scarico si è interrotto');
      expect(testo).toContain('il computer si è scollegato');
      expect(testo).toContain('Non è stata salvata nessuna immersione');
    } finally {
      smonta();
    }
  });

  it('«Interrompi» arriva al trasferimento anche mentre si sta scrivendo in archivio', async () => {
    /*
     * L'import resta appeso: è esattamente la finestra in cui il controllore
     * veniva azzerato in anticipo, e in cui il pulsante non faceva niente.
     */
    const inCorso = differita<unknown>();
    finto.importa = () => inCorso.promessa;

    const { host, smonta } = await apri();
    try {
      await scarica(host);
      expect(host.textContent).toContain('Lettura in corso…');
      expect(premi(host, 'Interrompi')).toBeTruthy();
      expect(finto.segnale?.aborted).toBe(false);

      await act(async () => {
        premi(host, 'Interrompi').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      expect(finto.segnale?.aborted).toBe(true);

      // Lasciato finire, per non lasciare in giro una promessa appesa.
      await act(async () => {
        inCorso.risolvi({ ok: true, found: 3, added: 3, merged: 0, duplicates: 0, warnings: [] });
      });
    } finally {
      smonta();
    }
  });
});
