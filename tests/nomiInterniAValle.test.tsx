// @vitest-environment jsdom
/**
 * ► LA GUARDIA CHE IMPEDISCE ALLA CLASSE DI RICRESCERE. ◄
 *
 * ════════════════════════════════════════════════════════════════════════════
 * PERCHÉ QUESTO FILE ESISTE, VISTO CHE `permessoBluetooth.test.ts` C'È GIÀ.
 *
 * Quel file verifica **l'elenco**: che `NOMI_INTERNI` contenga `btleplug` e non
 * `garmin`, che `dettaglioLeggibile` tolga il prefisso, che il dizionario non
 * si porti dentro il nome di una libreria. Sono tutte proprietà vere e tutte
 * utili, e nessuna delle tre avrebbe preso il difetto del 28 agosto 2026:
 * `btleplug` era già a zero nel dizionario quel giorno, mentre stava sullo
 * schermo di una persona. **Non passava di lì.**
 *
 * Il buco è che si verificava l'elenco e non **chi lo usa**. E infatti, a
 * correzione fatta, `causaDelGuasto` e `dettaglioLeggibile` avevano un solo
 * chiamante su dodici punti che ne avevano bisogno.
 *
 * ► QUELLO CHE QUESTA GUARDIA FA. ◄ Prende un errore finto che porta dentro un
 * nome di `NOMI_INTERNI` — scritto come lo scriverebbe davvero il livello di
 * sotto, «Libsql error: …», «libdivecomputer non ha aperto il trasporto (stato
 * 3)» — lo fa entrare da dove entrerebbe nella vita vera, e pretende che **a
 * valle, nella stringa che una persona legge, quel nome non ci sia**. Non
 * controlla che il codice sia scritto in un certo modo: controlla il risultato.
 *
 * ► E QUELLO CHE NON FA, che va detto qui e non scoperto fra un anno. ◄
 *
 *  - **non dice se il messaggio è BUONO.** Che dica cosa fare, e che dica che
 *    fine hanno fatto i dati, resta una scelta di chi scrive: qui si verifica
 *    solo che ci sia una frase italiana e che non porti nomi di libreria. Un
 *    messaggio inutile ma pulito passa;
 *  - **non copre i punti che non guida.** La scheda dell'immersione (esporta
 *    PDF) e il pianificatore (esporta piano) hanno solo la guardia strutturale
 *    in fondo, perché montarli davvero costerebbe più di quanto renda;
 *  - **la guardia strutturale riconosce UNA espressione sola**, quella che
 *    c'era: `x instanceof Error ? x.message : String(x)`. La ammette solo
 *    quando finisce in una variabile — è così che il diario dello scarico tiene
 *    il motivo intero — e la vieta ovunque altro. Chi scriverà `${String(err)}`,
 *    o chi metterà il crudo in una variabile e POI la interpolerà in un
 *    messaggio, la passa liscia. Serve a impedire che la riga di prima torni per
 *    copia-incolla, non a impedire ogni modo di sbagliare;
 *  - **non vede il Rust.** «stato 5» e «libdivecomputer» nascono in
 *    `src-tauri/src/trasporto_ldc.rs` e continuano a nascere lì: si filtrano
 *    quando entrano nell'interfaccia. Se un giorno un errore del Rust arrivasse
 *    a schermo per una strada che questo file non guida, non se ne accorgerebbe
 *    nessuno;
 *  - **il diario e la console sono esclusi apposta**, e devono restarlo: là il
 *    nome della libreria e il numero di stato sono l'informazione, non il
 *    rumore.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { conDettaglio, NOMI_INTERNI } from '../src/core/ble/causaGuasto';
import type { Dive, Sample } from '../src/core/model';

// ---------------------------------------------------------------------------
// Attrezzi
// ---------------------------------------------------------------------------

const leggi = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');

/**
 * Nessuno dei nomi di sotto, comunque sia scritto.
 *
 * Il confronto è in minuscolo perché nella vita vera il nome arriva con
 * l'iniziale maiuscola — «Libsql error: …» è la forma con cui le librerie Rust
 * presentano i propri errori — e una guardia che cerca solo `libsql` lascerebbe
 * passare esattamente la stringa che si vede in produzione.
 */
function senzaNomiInterni(testo: string, dove: string) {
  const minuscolo = testo.toLowerCase();
  for (const nome of NOMI_INTERNI) {
    expect(minuscolo.includes(nome), `«${nome}» è arrivato fino a ${dove}: «${testo}»`).toBe(false);
  }
}

/**
 * Gli errori finti, scritti come li scrive davvero il livello di sotto.
 *
 * Non inventati: `Libsql error:` è il prefisso del client di sincronizzazione,
 * `no available storage method found` è la frase che ha visto chi ha aperto
 * l'app senza archivio disponibile, e la riga di libdivecomputer è copiata da
 * `src-tauri/src/trasporto_ldc.rs`.
 */
export const ERRORI_FINTI = {
  archivio: () => new Error('Libsql error: no available storage method found'),
  scrittura: () => new Error('Libsql error: database is locked'),
  rete: () => new Error('Tauri error: TypeError: Failed to fetch'),
  lettore: () => new Error('Sqlite error: file is not a database'),
  /**
   * Il caso in cui il nome NON si può togliere: sta nel corpo, non nel prefisso.
   *
   * La distinzione conta ed è la ragione per cui `dettaglioLeggibile` a volte
   * restituisce qualcosa e a volte niente. «Libsql error: database is locked»
   * perde il prefisso e lascia una frase del sistema che si può leggere e che
   * serve; «btleplug internal state corrupted» non ha niente da salvare, e
   * allora non si mostra affatto.
   */
  inseparabile: () => new Error('Btleplug error: btleplug internal state corrupted'),
  trasporto: () => new Error('libdivecomputer non ha aperto il trasporto (stato 3)'),
};

// ---------------------------------------------------------------------------
// I finti dei moduli
// ---------------------------------------------------------------------------

const finto = vi.hoisted(() => ({
  /** Che cosa risponde `getStore()`: un archivio, o un guasto. */
  apriArchivio: (): Promise<unknown> => Promise.reject(new Error('non impostato')),
  /** Che cosa fa la scrittura delle immersioni. */
  scrivi: (): Promise<void> => Promise.resolve(),
}));

vi.mock('../src/storage', async (originale) => ({
  ...(await originale<typeof import('../src/storage')>()),
  getStore: () => finto.apriArchivio(),
}));

/*
 * Il lettore SQLite lancia sempre, in questo file.
 *
 * È l'unico modo di far entrare un errore col nome del motore dentro il parser
 * di Shearwater Cloud senza avere un file rotto vero da portarsi dietro — e un
 * file rotto vero non sarebbe nemmeno meglio: darebbe l'errore che dà oggi
 * quella versione della libreria, non quello che si vuole provare.
 */
vi.mock('../src/core/parsers/sqliteReader', async (originale) => ({
  ...(await originale<typeof import('../src/core/parsers/sqliteReader')>()),
  readSqliteTables: () => {
    throw ERRORI_FINTI.lettore();
  },
}));

const { IndexedDbStore } = await import('../src/storage/indexeddb');
const { SqliteStore } = await import('../src/storage/sqlite');
const { accedi } = await import('../src/sync/account');
const { shearwaterCloudParser } = await import('../src/core/parsers/shearwaterCloud');
const { DiveLogProvider, useDiveLog } = await import('../src/ui/state');

// ---------------------------------------------------------------------------
// Il filtro, da solo
// ---------------------------------------------------------------------------

describe('il filtro che decide che cosa si può mostrare', () => {
  it('mette il dettaglio fra parentesi quando è leggibile', () => {
    expect(conDettaglio('Non è stato salvato.', new Error('No space left on device'))).toBe(
      'Non è stato salvato. (No space left on device)',
    );
  });

  it('► e non mette NIENTE quando il dettaglio porta un nome di sotto ◄', () => {
    // La frase resta sola: è la scelta di `dettaglioLeggibile`, e questa
    // funzione esiste per non farla ripetere a dodici punti di chiamata.
    expect(conDettaglio('Non è stato salvato.', ERRORI_FINTI.inseparabile())).toBe('Non è stato salvato.');
  });
});

// ---------------------------------------------------------------------------
// Gli archivi
// ---------------------------------------------------------------------------

describe('gli archivi non parlano più da programmatori', () => {
  /*
   * «Store non inizializzato.» e «Database non inizializzato.» erano asserzioni
   * scritte per chi legge il codice, in un punto il cui testo arriva a schermo:
   * queste due guardie in teoria non scattano mai, ma quando scattano il
   * messaggio esce dal `catch` di chi ha chiamato e finisce in un riquadro
   * rosso. «Store» non è nemmeno una parola italiana.
   */
  it('l’archivio del browser dice cosa fare, non lo stato di un oggetto', async () => {
    const archivio = new IndexedDbStore();
    const guasto = await archivio.listDives().then(
      () => {
        throw new Error('la lettura è riuscita: la guardia non è stata provata');
      },
      (err: unknown) => (err instanceof Error ? err.message : String(err)),
    );
    senzaNomiInterni(guasto, 'IndexedDbStore');
    expect(guasto).not.toContain('Store non inizializzato');
    expect(guasto).toContain('Chiudi e riapri');
    expect(guasto).toContain('non è stato scritto');
  });

  it('e quello dell’app desktop dice la stessa cosa, con le stesse parole', async () => {
    const archivio = new SqliteStore();
    const guasto = await archivio.listDives().then(
      () => {
        throw new Error('la lettura è riuscita: la guardia non è stata provata');
      },
      (err: unknown) => (err instanceof Error ? err.message : String(err)),
    );
    senzaNomiInterni(guasto, 'SqliteStore');
    expect(guasto).not.toContain('Database non inizializzato');
    expect(guasto).toContain('Chiudi e riapri');
  });
});

// ---------------------------------------------------------------------------
// Il servizio di accesso
// ---------------------------------------------------------------------------

describe('il servizio di accesso irraggiungibile', () => {
  it('► non mostra più «TypeError: Failed to fetch», e dice che la sessione resta ◄', async () => {
    const guasto = await accedi(
      { servizio: 'https://esempio.invalido', fetchImpl: () => Promise.reject(ERRORI_FINTI.rete()) },
      'google',
      { clientId: 'c', codice: 'x', verificatore: 'y', ritorno: 'https://esempio.invalido/ritorno' },
    ).then(
      () => {
        throw new Error('l’accesso è riuscito: il guasto di rete non è stato simulato');
      },
      (err: unknown) => (err instanceof Error ? err.message : String(err)),
    );
    senzaNomiInterni(guasto, 'account.ts');
    // Il commento sopra quella riga prometteva due cose, e la riga non ne
    // manteneva nessuna: che si dica che fare, e che NON è una sessione scaduta.
    expect(guasto).toContain('non raggiungibile');
    expect(guasto).toContain('riprova');
    expect(guasto).toContain('sessione');
  });
});

// ---------------------------------------------------------------------------
// Il file di Shearwater Cloud
// ---------------------------------------------------------------------------

describe('un file di Shearwater Cloud che non si legge', () => {
  it('non nomina il motore che ha provato a leggerlo', () => {
    const esito = shearwaterCloudParser.parse({
      fileName: 'shearwater.db',
      bytes: new Uint8Array([1, 2, 3, 4]),
    });
    expect(esito.dives).toHaveLength(0);
    expect(esito.warnings).toHaveLength(1);
    senzaNomiInterni(esito.warnings[0], 'gli avvisi dell’import');
    expect(esito.warnings[0]).toContain('Riesporta');
    expect(esito.warnings[0]).toContain('niente è stato aggiunto');
  });
});

// ---------------------------------------------------------------------------
// L'archivio che non si apre, e la scrittura che fallisce
// ---------------------------------------------------------------------------

/** Un archivio che risponde a tutto e scrive quello che il test decide. */
function archivioFinto() {
  return {
    kind: 'indexeddb' as const,
    location: 'archivio finto',
    init: () => Promise.resolve(),
    listDives: () => Promise.resolve([] as Dive[]),
    getDive: () => Promise.resolve(undefined),
    getSamples: () => Promise.resolve([] as Sample[]),
    getAltSamples: () => Promise.resolve([] as Sample[]),
    sampleCounts: () => Promise.resolve(new Map<string, number>()),
    altSampleCounts: () => Promise.resolve(new Map<string, number>()),
    putDives: () => finto.scrivi(),
    deleteDive: () => Promise.resolve(),
    clear: () => Promise.resolve(),
    getSetting: () => Promise.resolve(undefined),
    setSetting: () => Promise.resolve(),
  };
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

/**
 * La sonda: un componente che non disegna niente e tiene il contesto a portata.
 *
 * Serve perché `initError` e `importDives` vivono dentro la provveditura, e
 * l'unico modo onesto di provarli è passare da lì — costruire a mano lo stesso
 * messaggio in un test proverebbe il test, non l'applicazione.
 */
let contesto: ReturnType<typeof useDiveLog> | null = null;
function Sonda() {
  const valore = useDiveLog();
  // In un effetto e non nel corpo del render: scrivere su qualcosa che sta
  // fuori dal componente mentre si disegna è ciò che `react-hooks/globals`
  // segnala, e qui non serve — il contesto lo si usa dopo il montaggio.
  useEffect(() => {
    contesto = valore;
  }, [valore]);
  return <p className="errore">{valore.initError ?? ''}</p>;
}

async function montaProvveditura() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <DiveLogProvider>
        <Sonda />
      </DiveLogProvider>,
    );
  });
  return { host, smonta: () => act(() => root.unmount()) };
}

beforeEach(() => {
  contesto = null;
  finto.apriArchivio = () => Promise.resolve(archivioFinto());
  finto.scrivi = () => Promise.resolve();
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('► il primo schermo possibile: l’archivio che non si apre ◄', () => {
  it('non mostra «no available storage method found», e dice che cosa succede a quello che scrivi', async () => {
    finto.apriArchivio = () => Promise.reject(ERRORI_FINTI.archivio());
    const vista = await montaProvveditura();

    const detto = vista.host.querySelector('.errore')?.textContent ?? '';
    expect(detto).not.toBe('');
    senzaNomiInterni(detto, 'il riquadro d’avvio');
    // La coda inglese dell'errore non deve arrivare nemmeno senza il nome:
    // era la metà che faceva sembrare rotta l'applicazione.
    expect(detto.toLowerCase()).not.toContain('no available storage method');
    expect(detto).toContain('non viene salvato');
    expect(detto).toContain('Chiudi e riapri');
    vista.smonta();
  });
});

describe('quello che l’archivio racconta quando la scrittura fallisce', () => {
  it('► l’esito dell’import non porta il nome del motore che ha rifiutato ◄', async () => {
    finto.scrivi = () => Promise.reject(ERRORI_FINTI.scrittura());
    const vista = await montaProvveditura();
    expect(contesto).not.toBeNull();

    let esito: Awaited<ReturnType<NonNullable<typeof contesto>['importDives']>> | undefined;
    await act(async () => {
      esito = await contesto!.importDives(immersioni(), 'prova');
    });

    expect(esito?.ok).toBe(false);
    /*
     * IL MOTIVO C'È ANCORA, MA RIPULITO — ed è la distinzione che questa
     * guardia deve difendere. Del crudo «Libsql error: database is locked»
     * resta la frase del sistema, che a chi legge dice qualcosa di vero, e se
     * ne va il nome del motore, che non dice niente a nessuno. Quando invece
     * non c'è niente da salvare, il campo resta scoperto e chi mostra l'esito
     * scrive «motivo non riportato».
     */
    senzaNomiInterni(esito?.error ?? '', 'l’esito dell’import');
    expect(esito?.error).toBe('database is locked');

    finto.scrivi = () => Promise.reject(ERRORI_FINTI.inseparabile());
    let secondo: typeof esito;
    await act(async () => {
      secondo = await contesto!.importDives(immersioni(), 'prova');
    });
    expect(secondo?.error).toBeUndefined();
    vista.smonta();
  });
});

// ---------------------------------------------------------------------------
// La guardia strutturale
// ---------------------------------------------------------------------------

describe('► nessun errore grezzo torna dentro un messaggio, in nessuno dei punti corretti ◄', () => {
  /*
   * QUESTA È LA METÀ CHE COPRE I PUNTI CHE NON SI GUIDANO, e guarda la FORMA
   * del codice invece del risultato. Sa fare una cosa sola: accorgersi che
   * `err.message` è tornato dentro qualcosa che una persona legge.
   *
   * ► LA REGOLA È AL CONTRARIO, ED È UNA CORREZIONE. ◄ La prima versione
   * cercava il crudo dentro un modello di stringa — `${…}` — perché quella era
   * la forma che aveva undici punti su dodici. Il dodicesimo era la scheda
   * dell'immersione, dove l'errore grezzo NON stava dentro un guscio: era tutto
   * il messaggio, passato dritto a `setEsitoPdf`. Cercando la forma sbagliata,
   * la guardia restava verde proprio sul caso peggiore — quello senza nemmeno
   * una frase intorno. *Provata a rovescio è venuto fuori questo, e non
   * provandola non sarebbe venuto fuori niente.*
   *
   * Adesso si vieta tutto e si ammette una forma sola: **mettere il crudo in
   * una variabile**. È quello che fa il diario dello scarico, dove il motivo
   * intero è l'informazione e non il rumore. Il prezzo è dichiarato: chi mette
   * il crudo in una variabile e poi la interpola in un messaggio passa liscio,
   * e per quei due punti a difendere resta la metà comportamentale — che
   * infatti li guida entrambi.
   */
  const SORGENTI = [
    '../src/ui/state.tsx',
    '../src/ui/pages/DiveDetail.tsx',
    '../src/ui/pages/ImportPage.tsx',
    '../src/ui/components/BleDownload.tsx',
    '../src/ui/components/DecoPlan.tsx',
    '../src/sync/account.ts',
    '../src/core/parsers/shearwaterCloud.ts',
    '../src/storage/indexeddb.ts',
    '../src/storage/sqlite.ts',
  ];

  /** L'errore grezzo, comunque venga scritto. */
  const CRUDO = /\w+\s+instanceof\s+Error\s*\?/;
  /** L'unica forma ammessa: finire in una variabile, come nel diario. */
  const IN_UNA_VARIABILE =
    /^\s*(?:const|let|var)?\s*\w+(?:\s*:\s*[\w<>|[\]\s]+)?\s*=\s*\w+\s+instanceof\s+Error\s*\?/;
  /** E la stessa cosa spezzata su più righe dentro un modello di stringa. */
  const CRUDO_SU_PIU_RIGHE = /\$\{[\s\S]{0,120}?\w+\s+instanceof\s+Error\s*\?/;

  it('legge davvero i sorgenti', () => {
    // Senza questa, un percorso sbagliato renderebbe la guardia qui sotto
    // sempre verde e nessuno se ne accorgerebbe.
    for (const p of SORGENTI) expect(leggi(p).length, p).toBeGreaterThan(500);
  });

  for (const p of SORGENTI) {
    it(`${p.replace('../src/', '')} non interpola l’errore grezzo in un messaggio`, () => {
      const sorgente = leggi(p);
      const colpevoli = sorgente
        .split('\n')
        .map((r, i) => [i + 1, r] as const)
        .filter(([, r]) => CRUDO.test(r) && !IN_UNA_VARIABILE.test(r))
        .map(([n, r]) => `${n}: ${r.trim()}`);
      expect(colpevoli, `${p} rimette l’errore grezzo dove lo si legge`).toEqual([]);
      // La stessa cosa scritta su più righe: `prettier` spezza volentieri un
      // ternario lungo dentro un modello di stringa, e riga per riga non si
      // vedrebbe più niente.
      expect(CRUDO_SU_PIU_RIGHE.test(sorgente), `${p} spezza l’errore grezzo dentro un messaggio`).toBe(
        false,
      );
    });
  }
});
