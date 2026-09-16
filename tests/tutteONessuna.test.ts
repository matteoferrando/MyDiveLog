// @vitest-environment jsdom
/**
 * «TUTTE O NESSUNA» ERA SCRITTO SOPRA `putDives`, E NON ERA VERO.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Trovato da una verifica esterna il 16 settembre 2026. Il metodo faceva:
 *
 *     await this.sql.execute('BEGIN');
 *     …gli inserimenti…
 *     await this.sql.execute('COMMIT');
 *
 * Sembra una transazione e non lo è. `tauri-plugin-sql` non tiene una
 * connessione: tiene un **pool** SQLx, e ogni `execute` ne prende una qualunque,
 * la usa e la restituisce. `BEGIN` apriva una transazione su una connessione che
 * tornava subito nel pool — dove SQLx annulla da sé le transazioni rimaste
 * aperte — gli inserimenti arrivavano altrove in auto-commit, e `COMMIT` non
 * trovava niente da chiudere.
 *
 * La verifica l'ha riprodotto con SQLx 0.8.6: `BEGIN`, `INSERT`, `ROLLBACK`
 * rispondono tutti **Ok** e la riga resta. *Tre esiti senza errore su
 * un'operazione che non stava succedendo.*
 *
 * ► COSA PROVA QUESTO FILE, E COSA NO. ◄ Che l'archivio **non manda più le
 * istruzioni una per una al plugin**, e che tutto quello che deve essere
 * indivisibile parte come una chiamata sola con l'elenco dentro. Che quella
 * chiamata apra davvero una transazione lo provano le prove Rust in
 * `src-tauri/src/archivio.rs`, dove c'è un archivio vero — e fra quelle ce n'è
 * una che misura il difetto: `begin_e_rollback_sul_pool_non_annullano_niente`.
 *
 * *Le due metà vanno lette insieme: qui si guarda cosa esce, di là cosa
 * succede.*
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

/** Quello che il plugin SQL riceve: qui NON deve passare niente di transazionale. */
const alPlugin: { sql: string; valori?: unknown[] }[] = [];
/** Quello che il comando Rust riceve. */
const alMotore: { comando: string; argomenti: Record<string, unknown> }[] = [];

vi.mock('@tauri-apps/plugin-sql', () => ({
  default: {
    load: async () => ({
      execute: async (sql: string, valori?: unknown[]) => {
        alPlugin.push({ sql, valori });
        return undefined;
      },
      select: async (sql: string) => (sql.includes('user_version') ? [{ user_version: 0 }] : ([] as unknown)),
    }),
  },
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: async (comando: string, argomenti: Record<string, unknown>) => {
    alMotore.push({ comando, argomenti });
    return undefined;
  },
}));

import { SqliteStore } from '../src/storage/sqlite';
import type { Dive } from '../src/core/model';

function imm(id: string, campioni = 0, alternativi = 0): Dive {
  return {
    id,
    startTime: '2026-01-01T10:00:00Z',
    durationS: 600,
    maxDepth: 20,
    mode: 'oc',
    cylinders: [],
    tags: [],
    source: { format: 'manual', file: '', importedAt: '2026-01-01T10:00:00Z' },
    ...(campioni ? { samples: Array.from({ length: campioni }, (_, t) => ({ t, depth: 1 })) } : {}),
    ...(alternativi ? { altSamples: Array.from({ length: alternativi }, (_, t) => ({ t, depth: 2 })) } : {}),
  } as unknown as Dive;
}

async function archivioPronto(): Promise<SqliteStore> {
  const store = new SqliteStore();
  await store.init();
  // Lo schema e i pragma dell'avvio non c'entrano con quello che si misura qui.
  alPlugin.length = 0;
  alMotore.length = 0;
  return store;
}

beforeEach(() => {
  alPlugin.length = 0;
  alMotore.length = 0;
});

describe('quello che deve essere indivisibile parte come una chiamata sola', () => {
  it('putDives non manda più `BEGIN` al plugin, e non manda nemmeno gli inserimenti', async () => {
    /*
     * ► IL CUORE. ◄ Non basta che ci sia la chiamata nuova: finché le
     * istruzioni passano ANCHE di là, passano su connessioni diverse — ed è
     * esattamente il difetto. Quindi si misura il silenzio del plugin.
     */
    const store = await archivioPronto();
    await store.putDives([imm('a', 3, 2), imm('b')]);

    expect(alPlugin, 'nessuna istruzione deve passare dal plugin').toEqual([]);
    expect(alMotore).toHaveLength(1);
    expect(alMotore[0].comando).toBe('tutte_o_nessuna');
  });

  it('e l’elenco arriva intero: il riepilogo e i due profili di ogni immersione', async () => {
    const store = await archivioPronto();
    await store.putDives([imm('a', 3, 2), imm('b')]);

    const passi = alMotore[0].argomenti.passi as { sql: string; valori: unknown[] }[];
    // a: riepilogo + profilo + secondo profilo; b: solo riepilogo.
    expect(passi).toHaveLength(4);
    expect(passi.filter((p) => p.sql.includes('INSERT INTO dives'))).toHaveLength(2);
    expect(passi.filter((p) => p.sql.includes('dive_samples'))).toHaveLength(1);
    expect(passi.filter((p) => p.sql.includes('dive_alt_samples'))).toHaveLength(1);
  });

  it('e il riepilogo viene PRIMA dei suoi profili, o la chiave esterna li respinge', async () => {
    // `dive_samples` ha una chiave esterna su `dives(id)`: dentro una
    // transazione con i vincoli accesi — e adesso lo sono — un profilo che
    // arrivasse prima del suo riepilogo farebbe fallire tutto il blocco.
    const store = await archivioPronto();
    await store.putDives([imm('a', 3, 2)]);

    const passi = alMotore[0].argomenti.passi as { sql: string }[];
    expect(passi[0].sql).toContain('INSERT INTO dives');
    expect(passi[1].sql).toContain('dive_samples');
    expect(passi[2].sql).toContain('dive_alt_samples');
  });

  it('un elenco vuoto non chiama nessuno', async () => {
    // Chiamare il motore per non fare niente non è un errore, ma è un giro a
    // vuoto che si vede nei log e fa dubitare di quello che sta succedendo.
    const store = await archivioPronto();
    await store.putDives([]);
    expect(alMotore).toEqual([]);
    expect(alPlugin).toEqual([]);
  });

  it('e l’archivio da aprire è nominato, perché è la chiave del pool', async () => {
    // Il comando ritrova il pool da questa stringa. Se divergesse da quella di
    // `Database.load` non aprirebbe un secondo archivio: risponderebbe
    // «archivio non aperto» e non scriverebbe niente.
    const store = await archivioPronto();
    await store.putDives([imm('a')]);
    expect(alMotore[0].argomenti.archivio).toBe('sqlite:mydivelog.db');
  });
});

describe('le altre due che nessuno aveva guardato', () => {
  it('deleteDive: tre cancellazioni, una chiamata', async () => {
    /*
     * Non nominava nessuna transazione, quindi era sfuggita. Ma tre `DELETE`
     * separati hanno lo stesso difetto visto dall'altro verso: l'applicazione
     * che muore in mezzo lascia in archivio i profili di un'immersione che non
     * c'è più — righe che nessuna query troverà mai.
     */
    const store = await archivioPronto();
    await store.deleteDive('a');

    expect(alPlugin).toEqual([]);
    expect(alMotore).toHaveLength(1);
    const passi = alMotore[0].argomenti.passi as { sql: string; valori: unknown[] }[];
    expect(passi.map((p) => p.sql.match(/FROM (\w+)/)?.[1])).toEqual([
      'dive_samples',
      'dive_alt_samples',
      'dives',
    ]);
    expect(passi.every((p) => p.valori[0] === 'a')).toBe(true);
  });

  it('clear: quattro, e i profili prima dei riepiloghi', async () => {
    const store = await archivioPronto();
    await store.clear();

    expect(alPlugin).toEqual([]);
    const passi = alMotore[0].argomenti.passi as { sql: string }[];
    expect(passi.map((p) => p.sql.match(/FROM (\w+)/)?.[1])).toEqual([
      'dive_alt_samples',
      'dive_samples',
      'dives',
      'settings',
    ]);
  });
});

describe('la metà Rust è nominata, e le due si tengono per mano', () => {
  it('il comando che l’archivio chiama è quello che il motore registra', async () => {
    /*
     * ► LA PROVA CHE PRENDE LO SCOLLAMENTO. ◄ Il 16 settembre 2026 un comando
     * registrato in un gestore ma non compilato per quella piattaforma ha fatto
     * morire la build di Android. Qui il rischio speculare: il lato TypeScript
     * chiama un nome, il lato Rust ne espone un altro, e l'unica cosa che si
     * vede è «comando sconosciuto» mentre si salva un'immersione.
     */
    const { readFileSync } = await import('node:fs');
    const rust = readFileSync('src-tauri/src/archivio.rs', 'utf8');
    expect(rust).toContain('pub async fn tutte_o_nessuna(');
    // E i nomi degli argomenti, che Tauri passa per nome e non per posizione.
    expect(rust).toContain('archivio: String');
    expect(rust).toContain('passi: Vec<Passo>');
    expect(rust).toContain('pub sql: String');
    expect(rust).toContain('pub valori: Vec<serde_json::Value>');
  });
});
