// @vitest-environment jsdom
/**
 * L'ELENCO DEGLI AVVISI A FINE SCARICO, DISEGNATO NELLA LINGUA GIUSTA.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * ► IL DIFETTO. ◄ Finito uno scarico, sotto la riga verde col riepilogo,
 * `BleDownload` disegnava gli avvisi così com'erano:
 *
 *     {stato.avvisi.map((a, i) => <li key={i}>{a}</li>)}
 *
 * Le frasi però nascono in `core` — i motivi di scarto di `ble/esterni.ts`, gli
 * avvisi di `ble/download.ts` e dei driver — e in `core` la lingua non si sa:
 * **con l'applicazione in inglese comparivano in italiano**, sotto un riepilogo
 * inglese.
 *
 * Non è un elenco qualsiasi: è *la spiegazione del perché mancano delle
 * immersioni*. Chi ha appena aspettato tre minuti di trasferimento conta quello
 * che è entrato, e se il conto non torna queste righe sono l'unica cosa che
 * glielo dice.
 *
 * ► PERCHÉ SI MONTA LA SCHERMATA. ◄ Perché nessuna guardia sul sorgente può
 * vedere questo canale: la chiave arriva al dizionario come variabile, e
 * `chiaviDi` vede solo le stringhe letterali. L'unico modo di sapere che cosa
 * c'è a schermo è guardarlo. La metà che il nucleo compone da sé — le frasi col
 * numero dentro — sta in `avvisiScaricoTradotti.test.ts`.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

import { SCARTO_SENZA_DATA, SCARTO_SENZA_PROFONDITA_NE_DURATA } from '../src/core/ble/esterni';
import type { Dive } from '../src/core/model';
import type { BleFoundDevice } from '../src/core/ble/types';

const finto = vi.hoisted(() => ({
  scarico: (): Promise<unknown> => Promise.reject(new Error('scarico non impostato')),
  /** Le opzioni con cui la schermata ha chiamato il nucleo: ci si legge la `t`. */
  opzioni: null as { t?: (s: string) => string } | null,
}));

vi.mock('../src/core/ble/download', () => ({
  downloadFromComputer: (
    _trasporto: unknown,
    _dispositivo: unknown,
    _driver: unknown,
    opzioni: { onEvent: (e: { kind: 'counted'; total: number }) => void; t?: (s: string) => string },
  ) => {
    finto.opzioni = opzioni;
    opzioni.onEvent({ kind: 'counted', total: 2 });
    return finto.scarico();
  },
}));

vi.mock('../src/storage/ble', () => ({
  TauriBleTransport: class {
    available() {
      return Promise.resolve(true as const);
    }
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
    importDives: () =>
      Promise.resolve({ ok: true, found: 2, added: 2, merged: 0, duplicates: 0, warnings: [] }),
    bleMarkers: {},
    saveBleMarker: () => Promise.resolve(),
    forgetBleMarker: () => Promise.resolve(),
  }),
}));

const { BleDownload } = await import('../src/ui/components/BleDownload');
const { ProvvedituraLingua } = await import('../src/ui/lingua');
/*
 * ► IL DIZIONARIO SI PRECARICA. ◄ `ProvvedituraLingua` lo chiede con un
 * `import()` dinamico, e la prima volta Vitest deve anche trasformare il modulo:
 * sotto carico sono centinaia di millisecondi, durante i quali `t()` restituisce
 * la chiave — cioè l'italiano. Caricandolo qui, prima di montare, il modulo è
 * già in cache e la provveditura lo riceve in un giro di eventi.
 */
await import('../src/ui/traduzioni');

const immersione = (n: number): Dive => ({
  id: `imm-${n}`,
  startTime: `2026-06-1${n}T10:00:00+02:00`,
  durationS: 2400,
  maxDepth: 25,
  mode: 'oc',
  cylinders: [],
  source: { format: 'shearwater-ble', file: 'ble', importedAt: '2026-06-20T10:00:00Z' },
  tags: [],
});

function premi(host: HTMLElement, etichetta: string) {
  const b = [...host.querySelectorAll('button')].find((x) => (x.textContent ?? '').includes(etichetta));
  if (!b) {
    const tutti = [...host.querySelectorAll('button')].map((x) => x.textContent).join(' | ');
    throw new Error(`nessun pulsante con «${etichetta}». Ci sono: ${tutti}`);
  }
  return b;
}

/** Monta la schermata DENTRO la provveditura, con il sistema in inglese. */
async function apriInInglese() {
  Object.defineProperty(window.navigator, 'language', { value: 'en-US', configurable: true });
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <ProvvedituraLingua>
        <BleDownload />
      </ProvvedituraLingua>,
    );
  });
  /*
   * Il dizionario arriva con un `import()` dinamico e non è pronto al primo
   * disegno: finché non arriva, `t()` restituisce la chiave — cioè l'italiano —
   * ed è esattamente il ripiego per cui questo difetto è rimasto invisibile
   * tanto a lungo. Si aspetta che sia arrivato DAVVERO, guardando lo schermo:
   * una prova che partisse prima proverebbe l'italiano credendo di provare
   * l'inglese.
   */
  for (let giro = 0; giro < 200 && !(host.textContent ?? '').includes('Find my computer'); giro++) {
    await act(async () => {
      await new Promise((risolvi) => setTimeout(risolvi, 5));
    });
  }
  expect(host.textContent, 'il dizionario inglese non è mai arrivato').toContain('Find my computer');
  return { host, smonta: () => act(() => root.unmount()) };
}

async function scarica(host: HTMLElement) {
  await act(async () => {
    premi(host, 'Find my computer').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await act(async () => {
    premi(host, 'Download').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

beforeEach(() => {
  localStorage.clear();
  finto.opzioni = null;
});

afterEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  document.documentElement.lang = 'it';
});

describe('l’elenco degli avvisi a fine scarico', () => {
  it('passa dal dizionario, qualunque sia la provenienza della frase', async () => {
    /*
     * Due frasi di due sorgenti diverse, tutte e due italiane come arrivano da
     * `core`: un motivo di scarto di `esterni.ts` e l'altro. Nessuna delle due
     * passa da `t('…')` scritto per esteso da nessuna parte, quindi nessuna
     * guardia sul sorgente poteva accorgersi che restavano in italiano.
     */
    finto.scarico = () =>
      Promise.resolve({
        dives: [immersione(1), immersione(2)],
        warnings: [SCARTO_SENZA_DATA, SCARTO_SENZA_PROFONDITA_NE_DURATA],
        status: 'complete' as const,
        trace: [],
        records: [],
        model: 'Peregrine',
        serial: '988B023F',
      });

    const { host, smonta } = await apriInInglese();
    try {
      await scarica(host);
      const voci = [...host.querySelectorAll('li')].map((li) => li.textContent ?? '');
      const testo = voci.join(' | ');

      expect(testo, 'nessun avviso disegnato: la prova guarda il posto sbagliato').toContain('dive');
      expect(testo).toContain('The computer gave no date for this dive');
      expect(testo).toContain('neither depth nor duration');
      // ► IL DIFETTO. ◄ Le frasi italiane non devono più comparire.
      expect(testo).not.toMatch(/Il computer non ha dato la data/);
      expect(testo).not.toMatch(/non ha né profondità né durata/);
    } finally {
      smonta();
    }
  });

  it('e una frase già tradotta a monte passa indenne, senza doppie traduzioni', async () => {
    /*
     * Metà dell'elenco arriva da `importDives`, che `state.tsx` traduce già.
     * Ripassarle dal dizionario non deve rovinarle: una frase inglese non è una
     * chiave italiana, quindi torna identica.
     */
    finto.scarico = () =>
      Promise.resolve({
        dives: [immersione(1)],
        warnings: ['Two dives were already in the logbook.'],
        status: 'complete' as const,
        trace: [],
        records: [],
        model: 'Peregrine',
        serial: '988B023F',
      });

    const { host, smonta } = await apriInInglese();
    try {
      await scarica(host);
      const testo = [...host.querySelectorAll('li')].map((li) => li.textContent).join(' | ');
      expect(testo).toContain('Two dives were already in the logbook.');
    } finally {
      smonta();
    }
  });
});

describe('e la lingua scende nel nucleo insieme alla richiesta', () => {
  it('lo scarico riceve una traduzione che traduce davvero', async () => {
    /*
     * ► L'ALTRA METÀ, E NON È RIDONDANTE. ◄ Le frasi col numero dentro si
     * compongono in `download.ts`, che può farlo solo se qualcuno gli passa `t`.
     * Il parametro ha un ripiego (`comeSta`) per non rompere i chiamanti
     * esistenti — e quel ripiego, proprio qui, sarebbe il difetto di partenza:
     * l'avviso arriverebbe già composto in italiano, e `frase(t, a)` sulla riga
     * che lo disegna non potrebbe più farci niente, perché col numero dentro non
     * è più una chiave.
     */
    finto.scarico = () =>
      Promise.resolve({
        dives: [immersione(1)],
        warnings: [],
        status: 'complete' as const,
        trace: [],
        records: [],
        model: 'Peregrine',
        serial: '988B023F',
      });

    const { host, smonta } = await apriInInglese();
    try {
      await scarica(host);
      const t = finto.opzioni?.t;
      expect(typeof t, 'la schermata non passa nessuna traduzione al nucleo').toBe('function');
      // E non una qualsiasi: quella della lingua in cui la schermata sta parlando.
      expect(t!('Il computer non ha dato la data di questa immersione: non è stata importata.')).toContain(
        'The computer gave no date',
      );
    } finally {
      smonta();
    }
  });
});
