// @vitest-environment jsdom
/**
 * Il computer chiede un PIN, e lo scarico è fermo finché non gli si risponde.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ► PERCHÉ QUESTO FILE ESISTE. ◄
 *
 * Il 7 settembre 2026 un Aqualung i330R prestato da un centro sub si è fermato
 * con «Failed to get the PIN code»: la famiglia Pelagic accende sul proprio
 * schermo un numero di sei cifre al primo comando e non va avanti senza. È
 * l'unica `ioctl` di `pelagic_i330r_init` il cui «non supportato» non viene
 * tollerato, e l'applicazione non la sapeva chiedere.
 *
 * La parte Rust si prova di là, contro libdivecomputer vera. Quello che si
 * prova QUI è il pezzo che nessun test Rust può vedere: che il riquadro
 * compaia, che accetti solo cifre, che «Conferma» mandi indietro quelle cifre
 * e che **una rinuncia sia una risposta**.
 *
 * ► L'ASSERZIONE CHE VALE PIÙ DI TUTTE. ◄ Che a scarico finito non resti
 * nessuna domanda aperta, e che chi rinuncia risponda `null` invece di
 * chiudere e basta. Il guscio Rust, in quel momento, è dentro una chiamata di
 * libdivecomputer e aspetta: una finestra chiusa senza risposta lascia
 * l'applicazione ferma tre minuti — e un'applicazione ferma per tre minuti è
 * rotta, qualunque cosa stia facendo davvero.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { BleFoundDevice, DownloadEvent } from '../src/core/ble/types';

const finto = vi.hoisted(() => ({
  /** Come lo scarico esterno viene chiamato: serve a vedere il codice conservato. */
  chiamata: null as Record<string, unknown> | null,
  /** L'emettitore che il componente passa: da qui si finge il computer. */
  emit: null as ((e: DownloadEvent) => void) | null,
  /** Le risposte al PIN arrivate al guscio, nell'ordine. */
  risposte: [] as (string | null)[],
  /** Come finisce lo scarico. La prova la sostituisce quando serve. */
  finisci: null as ((v: unknown) => void) | null,
  /** E come fallisce, che è l'altro modo in cui finisce. */
  fallisci: null as ((e: unknown) => void) | null,
  /** Finisce con delle immersioni in mano E un guasto: lo scarico rotto a metà. */
  aMeta: null as ((v: unknown, guasto: string) => void) | null,
  /** Quante volte lo scarico è stato chiesto: da quando l'app riprova da sola, conta. */
  quante: 0,
}));

vi.mock('../src/storage/computerEsterni', () => ({
  riconosciComputerEsterno: () => Promise.resolve([{ marca: 'Aqualung', modello: 'i330R' }]),
  rispondiCodicePin: (pin: string | null) => {
    finto.risposte.push(pin);
    return Promise.resolve();
  },
  scaricaDaComputerEsterno: (opzioni: Record<string, unknown>) => {
    finto.chiamata = opzioni;
    finto.quante += 1;
    finto.emit = opzioni.emit as (e: DownloadEvent) => void;
    return new Promise((risolvi, rifiuta) => {
      // `finisci` resta com'era per chi la usa — un elenco di immersioni — e
      // qui sotto diventa la forma nuova: quello che è arrivato PIÙ com'è
      // andata. `aMeta` è il caso che prima non si poteva nemmeno esprimere:
      // immersioni buone e un guasto, insieme.
      finto.finisci = (v: unknown) => risolvi({ dives: v });
      finto.aMeta = (v: unknown, guasto: string) => risolvi({ dives: v, guasto });
      finto.fallisci = rifiuta;
    });
  },
}));

vi.mock('@tauri-apps/api/core', () => ({
  // Un elenco non vuoto: è così che il componente sa di avere libdivecomputer
  // sotto, ed è la condizione perché per l'i330R proponga quella strada.
  invoke: () => Promise.resolve([{ marca: 'Aqualung', prodotto: 'i330R' }]),
}));

vi.mock('../src/storage/ble', () => ({
  TauriBleTransport: class {
    available() {
      return Promise.resolve(true as const);
    }
    scan(onUpdate: (d: BleFoundDevice[]) => void, signal: AbortSignal) {
      onUpdate([{ id: 'dev-i330r', name: 'i330R', rssi: -51, serviceUuids: [] }]);
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
      Promise.resolve({ ok: true, found: 0, added: 0, merged: 0, duplicates: 0, warnings: [] }),
    bleMarkers: {},
    saveBleMarker: () => Promise.resolve(),
    forgetBleMarker: () => Promise.resolve(),
  }),
}));

const { BleDownload } = await import('../src/ui/components/BleDownload');
const { codiceAccoppiamento, salvaCodiceAccoppiamento } = await import('../src/core/accoppiamento');

/*
 * ► UN `localStorage` NOSTRO, E NON QUELLO DELL'AMBIENTE DI PROVA. ◄
 *
 * Questo file è girato verde per ore su una macchina e rosso undici volte sulla
 * prima altra macchina su cui è stato lanciato: stesso vitest 3.2.7, stesso
 * jsdom 30.0.1, stesso `// @vitest-environment jsdom` in testa, `document`
 * presente e `location.href` giusto — e `localStorage` **non definito**. La
 * differenza era la versione di Node, che di suo dichiara un `localStorage`
 * globale, e quel che jsdom mette a disposizione non arriva più fino a qui.
 *
 * Inseguire quella differenza sarebbe stato tempo speso su un dettaglio
 * dell'ambiente. Quello che queste prove devono verificare è **il nostro
 * codice**, non se jsdom espone un archivio: quindi l'archivio lo portiamo noi,
 * ed è lo stesso su qualunque macchina. `core/accoppiamento.ts` legge il
 * globale al momento della chiamata, apposta, e trova questo.
 */
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

function premi(host: HTMLElement, etichetta: string) {
  const b = [...host.querySelectorAll('button')].find((x) => (x.textContent ?? '').includes(etichetta));
  if (!b) throw new Error(`nessun pulsante con «${etichetta}»`);
  return b;
}

function campoPin(host: HTMLElement): HTMLInputElement {
  const campo = host.querySelector<HTMLInputElement>('input[inputmode="numeric"]');
  if (!campo) throw new Error('il campo delle sei cifre non c’è');
  return campo;
}

/** Scrive nel campo come farebbe una persona: React ascolta `input`. */
async function digita(campo: HTMLInputElement, testo: string) {
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    set?.call(campo, testo);
    campo.dispatchEvent(new Event('input', { bubbles: true }));
  });
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

/** Cerca, trova l'i330R e avvia lo scarico via libdivecomputer. */
async function avvia(host: HTMLElement) {
  await act(async () => {
    premi(host, 'Cerca il computer').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  expect(host.textContent).toContain('i330R');
  await act(async () => {
    premi(host, 'Scarica').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

beforeEach(() => {
  finto.chiamata = null;
  finto.emit = null;
  finto.risposte = [];
  finto.finisci = null;
  finto.fallisci = null;
  finto.aMeta = null;
  finto.quante = 0;
  localStorage.clear();
});

afterEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
});

describe('il PIN che il computer mostra sul proprio schermo', () => {
  it('compare, accetta solo cifre, e le manda indietro', async () => {
    const { host, smonta } = await apri();
    try {
      await avvia(host);
      expect(finto.emit, 'lo scarico esterno deve essere partito').not.toBeNull();

      // Prima della domanda non c'è nessun campo: il PIN non si chiede
      // preventivamente, perché prima del primo comando il numero sullo
      // schermo del computer non c'è ancora.
      expect(host.querySelector('input[inputmode="numeric"]')).toBeNull();

      await act(async () => finto.emit!({ kind: 'pinRequired' }));
      expect(host.textContent).toContain('Il computer chiede un codice');

      const campo = campoPin(host);
      // Lettere e segni si perdono scrivendo, non al momento di confermare:
      // chi digita per sbaglio lo vede subito, invece di scoprire alla fine
      // che il codice non andava bene.
      await digita(campo, '4a8-2 91 5');
      expect(campoPin(host).value).toBe('482915');
      // E non si va oltre le sei: il buffer di `pelagic_i330r.c` ne tiene sei
      // più lo zero finale, e una settima cifra diventerebbe un errore.
      await digita(campoPin(host), '4829157');
      expect(campoPin(host).value).toBe('482915');

      await act(async () => {
        premi(host, 'Conferma').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      expect(finto.risposte).toEqual(['482915']);
      // Il riquadro sparisce PRIMA che la risposta finisca il suo giro: uno
      // che resta lì invita a premere «Conferma» una seconda volta, cioè a
      // rispondere a una domanda che non c'è più.
      expect(host.querySelector('input[inputmode="numeric"]')).toBeNull();
    } finally {
      smonta();
    }
  });

  it('rinunciare è una risposta, non una finestra chiusa', async () => {
    /*
     * ► L'ASSERZIONE CHE PROTEGGE DALL'APPLICAZIONE FERMA. ◄ Se «Annulla»
     * chiudesse soltanto il riquadro, il guscio Rust resterebbe dentro la
     * `ioctl` fino alla scadenza — tre minuti senza niente a schermo.
     */
    const { host, smonta } = await apri();
    try {
      await avvia(host);
      await act(async () => finto.emit!({ kind: 'pinRequired' }));
      await act(async () => {
        premi(host, 'Annulla lo scarico').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      expect(finto.risposte).toEqual([null]);
      expect(host.querySelector('input[inputmode="numeric"]')).toBeNull();
    } finally {
      smonta();
    }
  });

  it('non si conferma un campo vuoto', async () => {
    // Sei cifre o niente: una stringa vuota è un PIN di zero cifre, cioè una
    // risposta diversa da una rinuncia, e il computer la rifiuterebbe.
    const { host, smonta } = await apri();
    try {
      await avvia(host);
      await act(async () => finto.emit!({ kind: 'pinRequired' }));
      expect(premi(host, 'Conferma').disabled).toBe(true);
      await digita(campoPin(host), '4');
      expect(premi(host, 'Conferma').disabled).toBe(false);
    } finally {
      smonta();
    }
  });

  it('cambiare pagina mentre il computer aspetta è una rinuncia, non un silenzio', async () => {
    /*
     * ► LA PORTA DI SERVIZIO DELLO STESSO GUASTO. ◄ Basta toccare
     * «Immersioni» mentre si legge il numero sul polso: React smonta questa
     * scheda e il riquadro sparisce. Se nessuno rispondesse, il guscio Rust
     * resterebbe fermo dentro la `ioctl` per i tre minuti pieni, e in quei tre
     * minuti ogni nuovo tentativo troverebbe «uno scarico è già in corso» —
     * senza che nulla a schermo spieghi perché.
     */
    const { host, smonta } = await apri();
    await avvia(host);
    await act(async () => finto.emit!({ kind: 'pinRequired' }));
    expect(host.querySelector('input[inputmode="numeric"]')).not.toBeNull();

    smonta();
    expect(finto.risposte).toEqual([null]);
  });

  it('smontare senza nessuna domanda aperta non risponde niente', async () => {
    // Il gemello: una risposta mandata quando nessuno chiede resterebbe in
    // una busta per lo scarico dopo, ed è il difetto che il guscio Rust
    // evita togliendo la busta. Meglio non mandarla affatto.
    const { host, smonta } = await apri();
    await avvia(host);
    smonta();
    expect(finto.risposte).toEqual([]);
  });

  it('la domanda non resta aperta quando lo scarico finisce comunque', async () => {
    /*
     * Il collegamento può cadere mentre la persona sta ancora leggendo il
     * numero sullo schermo del computer. Da quel momento nessuno aspetta più
     * quelle cifre, e un riquadro che le chiede sotto il risultato è una
     * domanda a cui rispondere non serve a niente.
     */
    const { host, smonta } = await apri();
    try {
      await avvia(host);
      await act(async () => finto.emit!({ kind: 'pinRequired' }));
      expect(host.querySelector('input[inputmode="numeric"]')).not.toBeNull();

      await act(async () => finto.finisci!([]));
      expect(host.querySelector('input[inputmode="numeric"]')).toBeNull();
      expect(host.textContent).not.toContain('Il computer chiede un codice');
    } finally {
      smonta();
    }
  });
});

describe('il codice di accoppiamento', () => {
  it('si conserva quando arriva, e si ripresenta allo scarico dopo', async () => {
    const { host, smonta } = await apri();
    try {
      await avvia(host);
      // La prima volta non c'è niente da mandare: il PIN è l'unica strada.
      expect(finto.chiamata?.codiceAccesso).toBeUndefined();

      await act(async () => finto.emit!({ kind: 'accessCode', hex: '0a1b2c3d4e5f60718293a4b5c6d7e8f9' }));
      expect(codiceAccoppiamento('dev-i330r')).toBe('0a1b2c3d4e5f60718293a4b5c6d7e8f9');

      /*
       * Il guscio dice con quale modo stava provando. Serve perché adesso,
       * quando uno scarico finisce male, l'applicazione riprova **da sola**:
       * senza questa riga non saprebbe nemmeno che il ponte si era aperto, lo
       * leggerebbe come un collegamento caduto e ripartirebbe da capo — che è
       * il comportamento giusto per quel caso e non per questo.
       */
      await act(async () =>
        finto.emit!({ kind: 'method', index: 1, total: 1, name: 'senza conferma', key: 'k' }),
      );
      // E adesso il giro dopo: si riparte dall'elenco e si riscarica.
      await act(async () => finto.finisci!([]));
      await act(async () => {
        premi(host, 'Cerca il computer').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      await act(async () => {
        premi(host, 'Scarica').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      expect(finto.chiamata?.codiceAccesso).toBe('0a1b2c3d4e5f60718293a4b5c6d7e8f9');
    } finally {
      smonta();
    }
  });

  it('non finisce nel diario tecnico, che si allega alle segnalazioni', async () => {
    const { host, smonta } = await apri();
    try {
      await avvia(host);
      await act(async () => finto.emit!({ kind: 'accessCode', hex: 'aabbccddeeff00112233445566778899' }));
      await act(async () => finto.finisci!([]));
      const testo = host.textContent ?? '';
      expect(testo).not.toContain('aabbccddeeff');
    } finally {
      smonta();
    }
  });

  it('una chiave che non funziona più si dimentica, invece di bloccare per sempre', async () => {
    /*
     * ► IL VICOLO CIECO CHE QUESTA PROVA CHIUDE. ◄ Con una chiave in mano
     * `pelagic_i330r_init` **salta del tutto il ramo del PIN**: se quella
     * chiave non vale più — computer azzerato, oppure accoppiato con il
     * telefono di qualcun altro — lo scarico fallisce e continuerà a fallire
     * identico a ogni tentativo. Senza dimenticarla, l'unica uscita sarebbe
     * disinstallare l'applicazione.
     */
    salvaCodiceAccoppiamento('dev-i330r', '0a1b2c3d4e5f60718293a4b5c6d7e8f9');
    const { host, smonta } = await apri();
    try {
      await avvia(host);
      expect(finto.chiamata?.codiceAccesso).toBe('0a1b2c3d4e5f60718293a4b5c6d7e8f9');
      await act(async () => finto.fallisci!(new Error('il computer ha chiuso il collegamento')));
      expect(codiceAccoppiamento('dev-i330r')).toBeUndefined();
    } finally {
      smonta();
    }
  });

  it('uno scarico riuscito NON dimentica la chiave', async () => {
    // Il gemello della prova sopra: dimenticarla sempre vorrebbe dire
    // richiedere il PIN a ogni scarico, cioè non averla conservata affatto.
    salvaCodiceAccoppiamento('dev-i330r', '0a1b2c3d4e5f60718293a4b5c6d7e8f9');
    const { host, smonta } = await apri();
    try {
      await avvia(host);
      await act(async () => finto.finisci!([]));
      expect(codiceAccoppiamento('dev-i330r')).toBe('0a1b2c3d4e5f60718293a4b5c6d7e8f9');
    } finally {
      smonta();
    }
  });

  it('un codice conservato illeggibile vale come assente', async () => {
    /*
     * Riempirlo a metà darebbe al computer una chiave inventata, e il computer
     * chiuderebbe il collegamento senza dire perché. «Non ce l'ho» invece fa
     * ripartire dal PIN, che funziona sempre.
     *
     * ► SI SCRIVE DIRITTO NELL'ARCHIVIO, SCAVALCANDO CHI SALVA. ◄ Passando da
     * `salvaCodiceAccoppiamento` la porcheria verrebbe rifiutata in scrittura,
     * e questa prova diventerebbe verde perché la chiave non esiste — non
     * perché la LETTURA abbia controllato qualcosa. Sarebbe una guardia che
     * resta verde anche cancellando tutta la validazione che dice di
     * sorvegliare.
     */
    localStorage.setItem('mydivelog.accoppiamento.dev-i330r', 'non-esadecimale');
    expect(codiceAccoppiamento('dev-i330r')).toBeUndefined();

    const { host, smonta } = await apri();
    try {
      await avvia(host);
      expect(finto.chiamata?.codiceAccesso).toBeUndefined();
    } finally {
      smonta();
    }
  });
});

describe('la rinuncia al PIN ferma anche i tentativi automatici', () => {
  it('chi dice di no non se lo sente richiedere due volte', async () => {
    /*
     * ════════════════════════════════════════════════════════════════════════
     * ► UN DIFETTO NATO LA NOTTE STESSA IN CUI È NATA L'INSISTENZA. ◄
     *
     * Da quando l'applicazione riprova da sola, un fallimento dopo la rinuncia
     * al PIN sembra — ai numeri — il caso buono: il computer aveva risposto
     * (l'ha fatto, prima di chiedere il codice), quindi «il modo funziona,
     * riprova uguale». E riprovare uguale vuol dire **richiedere il PIN** a chi
     * ha appena detto di no.
     *
     * Un'insistenza che non distingue «non ha funzionato» da «non ho voluto»
     * non è tenacia: è non ascoltare.
     */
    const { host, smonta } = await apri();
    try {
      await avvia(host);
      await act(async () =>
        finto.emit!({ kind: 'method', index: 1, total: 8, name: 'senza conferma', key: 'k' }),
      );
      await act(async () => finto.emit!({ kind: 'pinRequired' }));
      expect(host.textContent).toContain('Il computer chiede un codice');

      // La persona rinuncia.
      await act(async () => {
        premi(host, 'Annulla lo scarico').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      // Il computer aveva risposto: senza la regola, questo sarebbe il caso
      // «riprova allo stesso modo».
      await act(async () => finto.emit!({ kind: 'exchange', writes: 4, notifications: 3, bytes: 300 }));
      await act(async () => finto.fallisci!(new Error('PIN non fornito')));

      expect(finto.quante, 'dopo una rinuncia non si riprova da soli').toBe(1);
    } finally {
      smonta();
    }
  });

  it('ma chi il codice lo dà, i tentativi automatici se li tiene', async () => {
    /*
     * L'altra metà della regola, e serve tanto quanto la prima: fermare
     * l'insistenza su QUALUNQUE risposta al PIN sarebbe stato più semplice da
     * scrivere e avrebbe tolto il ritentativo proprio a chi ha fatto tutto
     * quello che gli era stato chiesto. *Una regola che si applica anche dove
     * non serve non è prudenza: è una funzione in meno, nascosta dentro una
     * riga che sembra ragionevole.*
     */
    const { host, smonta } = await apri();
    try {
      await avvia(host);
      await act(async () =>
        finto.emit!({ kind: 'method', index: 1, total: 8, name: 'senza conferma', key: 'k' }),
      );
      await act(async () => finto.emit!({ kind: 'pinRequired' }));
      await digita(campoPin(host), '123456');
      await act(async () => {
        premi(host, 'Conferma').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      expect(finto.risposte).toEqual(['123456']);

      await act(async () => finto.emit!({ kind: 'exchange', writes: 4, notifications: 3, bytes: 300 }));
      await act(async () => finto.fallisci!(new Error('il collegamento è caduto')));
      expect(finto.quante, 'il computer aveva risposto: si riprova').toBe(2);
    } finally {
      smonta();
    }
  });
});
