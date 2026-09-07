// @vitest-environment jsdom
/**
 * ► «QUAD CI — NON RICONOSCIUTO COME COMPUTER SUBACQUEO», VENTI VOLTE. ◄
 *
 * È la schermata che un centro immersioni ha visto davanti a un Mares, con
 * sotto un solo pulsante — «Che computer è?» — e dietro un elenco di
 * centocinque modelli. Il nome lo diceva già; l'applicazione non lo sapeva
 * leggere perché i due driver di casa conoscono solo i propri nomi.
 *
 * Qui si monta la schermata VERA, le si fa trovare un dispositivo senza driver
 * di casa, e si guarda il DOM: la riga deve dire «Mares Quad Ci» e avere un
 * «Scarica» che parte SENZA passare dal selettore. Il riconoscimento è finto
 * — risponde quello che il guscio Rust risponde per «Quad Ci», cioè tutti i
 * Mares con il Bluetooth — e stringere a un modello è compito di `proponi`,
 * che qui gira per davvero sul catalogo vero.
 *
 * ► COSA NON COPRE. ◄ Che il guscio riconosca davvero «Quad Ci»: quello lo
 * prova `computer_esterni.rs` contro `dc_descriptor_filter`. Qui si prova che,
 * DATA quella risposta, la schermata la usi — che è il pezzo che mancava.
 */

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BleFoundDevice } from '../src/core/ble/types';
import type { ImportOutcome } from '../src/ui/state';

// ---------------------------------------------------------------------------
// I finti dei moduli
// ---------------------------------------------------------------------------

const finto = vi.hoisted(() => ({
  contesto: {} as Record<string, unknown>,
  cerca: (_a: (d: unknown[]) => void, _s: AbortSignal): Promise<void> => Promise.resolve(),
  /** I candidati che il guscio restituirebbe per un nome. */
  riconosci: (_nome: string): Promise<{ marca: string; modello: string }[]> => Promise.resolve([]),
  /** I nomi per cui il riconoscimento è stato chiesto, in ordine. */
  chiesti: [] as string[],
  /** Le chiamate allo scarico via libdivecomputer. */
  scarichi: [] as { dispositivo: string; nome?: string; marca: string; modello: string }[],
  /** Se questa copia «ha dentro» libdivecomputer. */
  conLibdivecomputer: true,
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

vi.mock('../src/storage/computerEsterni', () => ({
  riconosciComputerEsterno: (nome: string) => {
    finto.chiesti.push(nome);
    return finto.riconosci(nome);
  },
  scaricaDaComputerEsterno: (richiesta: {
    dispositivo: string;
    nome?: string;
    marca: string;
    modello: string;
  }) => {
    finto.scarichi.push(richiesta);
    // Non torna: lo scarico «in corso» basta a questa prova, e una promessa che
    // resta sospesa non fa fallire niente perché si asserisce sulla chiamata.
    return new Promise(() => undefined);
  },
}));

// `conLibdivecomputer` lo decide `elenca_computer_supportati`: senza questo
// finto la schermata crederebbe di essere una copia senza libreria e non
// mostrerebbe «Scarica» a nessun Mares, per onestà.
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (comando: string) => {
    if (comando === 'elenca_computer_supportati')
      return Promise.resolve(finto.conLibdivecomputer ? [{}] : []);
    return Promise.reject(new Error(`comando non previsto dalla prova: ${comando}`));
  },
}));

const { BleDownload } = await import('../src/ui/components/BleDownload');

// ---------------------------------------------------------------------------
// Attrezzi
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

function pulsanti(host: HTMLElement, etichetta: string) {
  return [...host.querySelectorAll('button')].filter((b) => (b.textContent ?? '').trim() === etichetta);
}

async function clic(host: HTMLElement, etichetta: string) {
  const bottone = pulsanti(host, etichetta)[0];
  if (!bottone) throw new Error(`nessun pulsante con «${etichetta}»`);
  await act(async () => {
    bottone.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

/** Lascia passare le promesse del riconoscimento e il render che ne segue. */
async function attendi() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

const ricercaCheTrova =
  (dispositivi: BleFoundDevice[]) => (annuncia: (d: unknown[]) => void, segnale: AbortSignal) => {
    annuncia(dispositivi);
    return new Promise<void>((risolvi) => {
      segnale.addEventListener('abort', () => risolvi(), { once: true });
    });
  };

const QUAD_CI: BleFoundDevice = { id: 'dev-quad', name: 'Quad Ci', rssi: -60, serviceUuids: [] };
const BLUELINK: BleFoundDevice = { id: 'dev-blp', name: 'Mares bluelink pro', rssi: -70, serviceUuids: [] };
const AURICOLARE: BleFoundDevice = {
  id: 'dev-cuffie',
  name: 'Cuffie di qualcuno',
  rssi: -80,
  serviceUuids: [],
};

/** Quello che `riconosci_computer_esterno` risponde per un nome Mares: tutta la gamma. */
const MARES = ['Quad Ci', 'Quad', 'Genius', 'Puck 4', 'Puck Lite', 'Sirius', 'Puck Air 2', 'Smart Air'].map(
  (modello) => ({ marca: 'Mares', modello }),
);

async function montaConDispositivi(dispositivi: BleFoundDevice[]) {
  finto.cerca = ricercaCheTrova(dispositivi);
  const vista = await monta(<BleDownload />);
  await clic(vista.host, 'Cerca il computer');
  await attendi();
  return vista;
}

const rigaDi = (host: HTMLElement, nome: string) =>
  [...host.querySelectorAll('ul.dispositivi > li')].find((li) => li.querySelector('b')?.textContent === nome);

beforeEach(() => {
  finto.contesto = {
    dives: [],
    storeLocation: 'archivio finto',
    bleMarkers: {},
    importFiles: async () => [],
    importDives: async (): Promise<ImportOutcome> => ({
      fileName: 'ble',
      ok: true,
      found: 0,
      added: 0,
      merged: 0,
      duplicates: 0,
      warnings: [],
    }),
    clearAll: async () => undefined,
    saveBleMarker: async () => undefined,
    forgetBleMarker: async () => undefined,
  };
  finto.chiesti = [];
  finto.scarichi = [];
  finto.conLibdivecomputer = true;
  finto.riconosci = (nome) => Promise.resolve(/mares|quad/i.test(nome) ? MARES : []);
});

afterEach(() => {
  document.body.innerHTML = '';
});

// ---------------------------------------------------------------------------

describe('un computer senza driver di casa, riconosciuto dal nome', () => {
  it('► la riga dice «Mares Quad Ci» e non «non riconosciuto», e ha «Scarica» ◄', async () => {
    const vista = await montaConDispositivi([QUAD_CI]);
    const riga = rigaDi(vista.host, 'Quad Ci');
    expect(riga, 'la riga del Quad Ci').toBeDefined();
    const testo = riga?.textContent ?? '';
    expect(testo).toContain('Mares Quad Ci');
    expect(testo).toContain('via libdivecomputer');
    expect(testo).not.toContain('non riconosciuto come computer subacqueo');
    expect(pulsanti(vista.host, 'Scarica')).toHaveLength(1);
    expect(pulsanti(vista.host, 'Non è questo?')).toHaveLength(1);
    expect(pulsanti(vista.host, 'Che computer è?')).toHaveLength(0);
    vista.smonta();
  });

  it('«Scarica» parte con marca e modello riconosciuti e il nome visto, senza selettore', async () => {
    const vista = await montaConDispositivi([QUAD_CI]);
    await clic(vista.host, 'Scarica');
    expect(finto.scarichi).toHaveLength(1);
    expect(finto.scarichi[0]).toMatchObject({
      dispositivo: 'dev-quad',
      nome: 'Quad Ci',
      marca: 'Mares',
      modello: 'Quad Ci',
    });
    // Il selettore non si è mai aperto: nessun campo di ricerca del catalogo.
    expect(vista.host.querySelector('.catalogo-computer')).toBeNull();
    vista.smonta();
  });

  it('«Non è questo?» apre il selettore di sempre, senza riproporre in cima quello rifiutato', async () => {
    const vista = await montaConDispositivi([QUAD_CI]);
    await clic(vista.host, 'Non è questo?');
    expect(vista.host.querySelector('.catalogo-computer')).not.toBeNull();
    expect(vista.host.querySelector('.proposte-dal-nome')).toBeNull();
    vista.smonta();
  });

  it('con la famiglia ma non il modello, la riga dice la marca e il selettore propone i candidati in cima', async () => {
    const vista = await montaConDispositivi([BLUELINK]);
    const riga = rigaDi(vista.host, 'Mares bluelink pro');
    const testo = riga?.textContent ?? '';
    expect(testo).toContain('Mares');
    expect(testo).toContain('scegli il modello');
    expect(testo).not.toContain('non riconosciuto come computer subacqueo');
    // Niente «Scarica» diretto: non si sa verso quale protocollo.
    expect(pulsanti(vista.host, 'Scarica')).toHaveLength(0);
    await clic(vista.host, 'Che computer è?');
    const proposte = vista.host.querySelector('.proposte-dal-nome');
    expect(proposte, 'il blocco delle proposte').not.toBeNull();
    const nomi = [...(proposte?.querySelectorAll('ul.modelli button span:first-child') ?? [])].map(
      (s) => s.textContent,
    );
    expect(nomi).toContain('Mares Genius');
    expect(nomi).toHaveLength(MARES.length);
    // L'elenco intero resta sotto, per chi ha un altro computer.
    expect(vista.host.querySelector('ul.marche')).not.toBeNull();
    vista.smonta();
  });

  it('un nome che nessun filtro reclama resta «non riconosciuto», con «Che computer è?»', async () => {
    const vista = await montaConDispositivi([AURICOLARE]);
    const riga = rigaDi(vista.host, 'Cuffie di qualcuno');
    expect(riga?.textContent).toContain('non riconosciuto come computer subacqueo');
    expect(pulsanti(vista.host, 'Che computer è?')).toHaveLength(1);
    expect(pulsanti(vista.host, 'Scarica')).toHaveLength(0);
    vista.smonta();
  });

  it('il riconoscimento si chiede una volta per nome, anche se la scansione gira mentre la risposta tarda', async () => {
    /*
     * ► LA RISPOSTA ARRIVA DOPO I GIRI, NON PRIMA. ◄ Con la risposta già
     * arrivata la proposta esiste e nessuno richiede niente, memoria o non
     * memoria — una mutazione che toglie la memoria per nome passava lo
     * stesso. La scansione riscrive l'elenco ogni secondo e il guscio ci
     * mette il suo tempo: i giri che contano sono quelli nel mezzo.
     */
    let rispondi: ((c: { marca: string; modello: string }[]) => void) | null = null;
    finto.riconosci = () => new Promise((r) => (rispondi = r));
    let annuncia: ((d: unknown[]) => void) | null = null;
    finto.cerca = (a, segnale) => {
      annuncia = a;
      a([QUAD_CI]);
      return new Promise<void>((risolvi) =>
        segnale.addEventListener('abort', () => risolvi(), { once: true }),
      );
    };
    const vista = await monta(<BleDownload />);
    await clic(vista.host, 'Cerca il computer');
    await attendi();
    // Tre giri di scansione a risposta ancora sospesa: l'elenco si riscrive
    // con il segnale che cambia, e l'effetto riparte ogni volta.
    for (const rssi of [-61, -62, -63]) {
      await act(async () => {
        annuncia?.([{ ...QUAD_CI, rssi }]);
      });
      await attendi();
    }
    expect(finto.chiesti).toEqual(['Quad Ci']);
    // E la risposta tardiva arriva lo stesso alla riga: nessun giro l'ha persa.
    await act(async () => {
      rispondi?.(MARES);
    });
    await attendi();
    expect(rigaDi(vista.host, 'Quad Ci')?.textContent).toContain('Mares Quad Ci');
    vista.smonta();
  });

  it('in una copia senza libdivecomputer il nome si mostra lo stesso, ma «Scarica» no', async () => {
    /*
     * Non è un caso che possa accadere nei pacchetti pubblicati — sono tutti
     * compilati con la libreria, e senza, il guscio non riconoscerebbe niente.
     * Si prova perché la schermata NON deve dedurre la libreria dal
     * riconoscimento: sono due domande diverse fatte a due comandi diversi, e
     * un «Scarica» che fallisce è peggio di un «Che computer è?».
     */
    finto.conLibdivecomputer = false;
    const vista = await montaConDispositivi([QUAD_CI]);
    const riga = rigaDi(vista.host, 'Quad Ci');
    expect(riga?.textContent).toContain('Mares Quad Ci');
    expect(pulsanti(vista.host, 'Scarica')).toHaveLength(0);
    expect(pulsanti(vista.host, 'Che computer è?')).toHaveLength(1);
    vista.smonta();
  });
});
