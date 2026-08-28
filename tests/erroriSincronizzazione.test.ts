/**
 * Gli errori della sincronizzazione, e il resoconto di cosa si è mosso.
 *
 * ► IL DIFETTO CHE QUESTO FILE RENDE VISIBILE. ◄ L'errore più probabile
 * dell'intera scheda «Sincronizza» — la chiave del database che scade — diceva a
 * tutti la stessa cosa: «generane uno nuovo su Turso e reincollalo». Chi è
 * entrato con Apple o con Google su Turso non ha nessun conto, nessun token da
 * rigenerare e nessun campo dove reincollarlo: metà delle persone riceveva
 * un'istruzione impossibile da eseguire proprio nel momento in cui qualcosa non
 * andava. Un consiglio sbagliato è peggio di nessun consiglio, perché chi lo
 * legge smette di cercare.
 *
 * Il difetto non si vedeva rileggendo `turso.ts`, perché lì la frase è giusta:
 * quel file la strada manuale la conosce. Si vedeva solo guardando CHI la mostra
 * — `state.tsx`, che avvolge tutte e due le strade nella stessa riga — cioè
 * seguendo il messaggio fino a schermo. Da qui in poi lo segue una prova.
 */
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

import type { Dive, Sample } from '../src/core/model';
import type { DiveStore } from '../src/storage';
import { BLE_MARKERS_KEY } from '../src/core/ble/types';
import {
  SHARED_SETTINGS,
  describeSyncError,
  frasePerErroreSync,
  genereErroreSync,
  nomeImpostazione,
  syncArchive,
  traduciErroreSync,
  type SqlExecutor,
} from '../src/sync/turso';

/** Un errore come lo lancia il client libSQL quando la chiave non è più buona. */
const scaduto = () => new Error('SERVER_ERROR: 401 Unauthorized');
const staccato = () => new TypeError('Failed to fetch');

describe('il rimedio dipende dalla strada, e non manda mai a fare l’impossibile', () => {
  it('componendo senza sapere la strada, nomina tutte e due le vie d’uscita', () => {
    const messaggio = describeSyncError(scaduto());
    // Chi ha l'account deve trovarci il suo gesto...
    expect(messaggio).toMatch(/esci e rientra/i);
    // ...e chi ha incollato il token a mano il suo.
    expect(messaggio).toMatch(/Turso/);
    // Il testo della libreria resta, ed è quello che serve a chi segnala.
    expect(messaggio).toContain('401 Unauthorized');
  });

  it('a chi è entrato con un account non nomina Turso', () => {
    const conAccount = traduciErroreSync(describeSyncError(scaduto()), (s) => s, 'account');
    expect(conAccount).toMatch(/rientra con lo stesso account/);
    /*
     * ► QUESTA È LA RIGA CHE VALE TUTTO IL FILE. ◄ Non c'è niente da fare su
     * Turso per chi è entrato con Google: il database gliel'ha creato il
     * servizio di accesso e la chiave se la rinnova l'app da sola.
     */
    expect(conAccount).not.toMatch(/Turso/);
  });

  it('a chi ha incollato indirizzo e token manda a rigenerare il token', () => {
    const aMano = traduciErroreSync(describeSyncError(scaduto()), (s) => s, 'manuale');
    expect(aMano).toMatch(/Turso/);
    // E dice DOVE si reincolla, che è l'altra metà dell'istruzione.
    expect(aMano).toMatch(/Avanzate/);
    /*
     * E non gli parla di uscire da un account che non ha. Il confronto è
     * insensibile alle maiuscole di proposito: con `/Esci/` questa riga restava
     * verde anche togliendo del tutto il ramo manuale, perché il messaggio
     * generico dice «esci e rientra» in minuscolo. Una guardia che non si accende
     * quando le si toglie sotto quello che sorveglia non è una guardia — provata
     * al contrario, e corretta.
     */
    expect(aMano).not.toMatch(/esci e rientra/i);
  });

  it('traduce la frase e lascia stare il testo della libreria', () => {
    // Un dizionario finto: risponde in inglese a qualunque cosa gli si chieda.
    const inInglese = traduciErroreSync(describeSyncError(scaduto()), () => 'Your key expired.', 'account');
    expect(inInglese).toBe('Your key expired. (SERVER_ERROR: 401 Unauthorized)');
  });

  it('un messaggio che non ha composto lui passa intatto', () => {
    /*
     * Nessun riconoscimento a occhio: se il prefisso non è esattamente quello
     * che `describeSyncError` scrive, il testo non si tocca.
     *
     * Il messaggio scelto è di quelli che il CLASSIFICATORE riconosce — «401» c'è
     * dentro — ma che nessuno ha composto qui. È l'unico caso in cui la
     * differenza fra «lo riconosco» e «l'ho scritto io» si vede: con un
     * «Il disco è pieno.» qualunque questa riga restava verde anche togliendo il
     * confronto sul prefisso, cioè sorvegliava il vuoto.
     */
    const altrui = 'Errore 401 dal proxy aziendale.';
    expect(traduciErroreSync(altrui, () => 'MAI', 'account')).toBe(altrui);
  });

  it('l’errore di rete non cambia rimedio con la strada: la rete è una sola', () => {
    const messaggio = describeSyncError(staccato());
    expect(genereErroreSync(staccato())).toBe('rete');
    expect(traduciErroreSync(messaggio, (s) => s, 'account')).toBe(messaggio);
    expect(traduciErroreSync(messaggio, (s) => s, 'manuale')).toBe(messaggio);
    expect(messaggio).toContain('Failed to fetch');
  });

  it('un errore che non riconosce non si inventa una frase', () => {
    expect(frasePerErroreSync('altro', 'account')).toBe('');
    expect(describeSyncError(new Error('boh'))).toBe('boh');
  });
});

describe('le impostazioni condivise hanno tutte un nome da mostrare', () => {
  /*
   * La guardia vera è questa: `SHARED_SETTINGS` e `nomeImpostazione` sono due
   * elenchi affiancati, e una chiave aggiunta al primo e dimenticata nel secondo
   * finisce a schermo col suo nome tecnico — `bleMarkers` — dentro il resoconto
   * di una sincronizzazione riuscita.
   */
  it('nessuna chiave condivisa esce col proprio nome tecnico', () => {
    const nude = SHARED_SETTINGS.filter((k) => nomeImpostazione(k) === k);
    expect(nude).toEqual([]);
  });

  it('una chiave che nessuno ha battezzato resta riconoscibile, non diventa «Altro»', () => {
    expect(nomeImpostazione('inventata')).toBe('inventata');
  });
});

// ---------------------------------------------------------------------------
// Il resoconto dice QUALI impostazioni si sono mosse
// ---------------------------------------------------------------------------

function sqliteExecutor(): SqlExecutor {
  const db = new DatabaseSync(':memory:');
  return {
    async execute(sql: string, args: unknown[] = []) {
      if (!/^\s*select/i.test(sql)) {
        db.prepare(sql).run(...(args as never[]));
        return { rows: [] };
      }
      return { rows: db.prepare(sql).all(...(args as never[])) as Record<string, unknown>[] };
    },
    close: () => db.close(),
  };
}

/** Il minimo indispensabile: qui interessano solo le impostazioni. */
function storeVuoto(): DiveStore {
  const settings = new Map<string, unknown>();
  return {
    kind: 'indexeddb',
    location: 'memoria (test)',
    async init() {},
    async listDives(): Promise<Dive[]> {
      return [];
    },
    async getDive() {
      return undefined;
    },
    async getSamples(): Promise<Sample[]> {
      return [];
    },
    async getAltSamples(): Promise<Sample[]> {
      return [];
    },
    async sampleCounts() {
      return new Map<string, number>();
    },
    async altSampleCounts() {
      return new Map<string, number>();
    },
    async putDives() {},
    async deleteDive() {},
    async clear() {},
    async getSetting<T>(key: string) {
      return settings.get(key) as T | undefined;
    },
    async setSetting<T>(key: string, value: T) {
      settings.set(key, value);
    },
  };
}

describe('il resoconto dice quali impostazioni si sono mosse, non solo quante', () => {
  it('nomina quelle caricate e quelle scaricate', async () => {
    const sql = sqliteExecutor();

    const primo = storeVuoto();
    /*
     * L'attrezzatura con DENTRO qualcosa, e non due liste vuote: `gear` si
     * fonde pezzo per pezzo, e fondere il vuoto col vuoto non cambia niente da
     * nessuna delle due parti — cioè non si muove, che è il caso opposto a
     * quello che questa prova vuole misurare. È esattamente l'errore in cui
     * questa prova è caduta la prima volta che l'ho scritta.
     */
    await primo.setSetting('gear', {
      equipment: [{ id: 'g1', name: 'Muta 7mm', savedAt: '2026-08-01T00:00:00Z' }],
      certifications: [],
    });
    await primo.setSetting('gear:at', '2026-08-01T00:00:00Z');
    await primo.setSetting('period', '12m');
    await primo.setSetting('period:at', '2026-08-01T00:00:00Z');

    const salita = await syncArchive(primo, sql);
    expect(salita.settingsPushed).toBe(2);
    expect([...salita.settingsPushedKeys].sort()).toEqual(['gear', 'period']);
    expect(salita.settingsPulledKeys).toEqual([]);

    const secondo = storeVuoto();
    const discesa = await syncArchive(secondo, sql);
    expect([...discesa.settingsPulledKeys].sort()).toEqual(['gear', 'period']);

    // E i numeri continuano a corrispondere agli elenchi.
    expect(discesa.settingsPulled).toBe(discesa.settingsPulledKeys.length);
  });

  it('quando non si muove niente gli elenchi sono vuoti, non assenti', async () => {
    const sql = sqliteExecutor();
    const report = await syncArchive(storeVuoto(), sql);
    expect(report.settingsPushedKeys).toEqual([]);
    expect(report.settingsPulledKeys).toEqual([]);
  });

  it('i nomi mostrati sono quelli di `nomeImpostazione`, segnalibri compresi', () => {
    expect(nomeImpostazione(BLE_MARKERS_KEY)).toBe('fin dove sei arrivato con ogni computer');
  });
});
