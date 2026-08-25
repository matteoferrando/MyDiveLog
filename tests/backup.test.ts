/**
 * Backup completo e ripristino.
 *
 * Il test che conta più di tutti è il giro chiuso: costruire un backup da un
 * archivio, ripristinarlo su un archivio vuoto, e ritrovare ESATTAMENTE quello
 * che c'era — profili compresi. Un backup che non si sa ripristinare non è un
 * backup, è un file, e la differenza si scopre nel momento peggiore.
 *
 * Subito dopo viene la sicurezza dei controlli: il file sbagliato deve essere
 * rifiutato PRIMA che l'archivio venga toccato, perché un ripristino a metà
 * lascia un archivio peggiore di come si era partiti.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  BACKUP_VERSION,
  SECRET_KEYS,
  SETTING_KEYS,
  backupFileName,
  buildBackup,
  checkBackup,
  planRestore,
  restoreBlockers,
  type ArchiveSource,
  type BackupFile,
} from '../src/core/export/backup';
import { SHARED_SETTINGS, TOMBSTONE_KEY } from '../src/sync/turso';
import { TRASH_KEY } from '../src/storage/trash';
import { BLE_MARKERS_KEY } from '../src/core/ble/types';
import { computeMetrics } from '../src/core/analysis/metrics';
import type { Dive, Sample } from '../src/core/model';
import { synthesise } from './fixtures';

/** Un archivio finto che si comporta come `DiveStore` per quel che serve qui. */
function fakeStore(dives: Dive[], settings: Record<string, unknown> = {}): ArchiveSource {
  return {
    kind: 'test',
    listDives: async () => dives.map(({ samples: _s, altSamples: _a, ...rest }) => rest as Dive),
    getSamples: async (id) => dives.find((d) => d.id === id)?.samples ?? [],
    getAltSamples: async (id) => dives.find((d) => d.id === id)?.altSamples ?? [],
    getSetting: async <T>(key: string) => settings[key] as T | undefined,
  };
}

function dive(id: string, startTime: string, conProfilo = true): Dive {
  const s = synthesise({ startTime: new Date(startTime) });
  const samples: Sample[] = s.samples.map((w) => ({ t: w.t, depth: w.depth, tempC: w.tempC }));
  const base: Dive = {
    id,
    startTime,
    durationS: s.spec.durationS,
    maxDepth: Math.max(...s.samples.map((w) => w.depth)),
    mode: 'oc',
    salinity: 'salt',
    cylinders: [{ mix: { o2: 0.21, he: 0 }, sizeL: 12, startBar: 200, endBar: 60 }],
    source: { format: 'uddf', file: 'x', importedAt: startTime },
    tags: [],
    buddy: 'Marco',
    ...(conProfilo ? { samples } : {}),
  };
  return { ...base, metrics: computeMetrics(base) };
}

describe('costruzione del backup', () => {
  it('porta i profili, non solo i riepiloghi', async () => {
    // È l'unica cosa che non si può ricostruire: le migliaia di campioni.
    const a = dive('a', '2026-06-01T09:00:00Z');
    const file = await buildBackup(fakeStore([a]), new Date('2026-08-18T10:00:00Z'));
    expect(file.dives[0].samples?.length).toBe(a.samples!.length);
    expect(file.summary.samples).toBe(a.samples!.length);
    expect(file.summary.withProfile).toBe(1);
  });

  it('porta le impostazioni, comprese attrezzatura e analisi', async () => {
    const file = await buildBackup(
      fakeStore([dive('a', '2026-06-01T09:00:00Z')], {
        gear: { equipment: [{ id: 'e1' }], certifications: [] },
        analyses: { 'dive:a': { text: 'x' } },
        goal: 'tech',
      }),
    );
    expect(file.settings.goal).toBe('tech');
    expect(file.settings.gear).toBeDefined();
    expect(file.settings.analyses).toBeDefined();
    expect(file.summary.settings).toContain('gear');
  });

  it('NON porta le credenziali', async () => {
    // Un backup finisce su un disco esterno o in Download. Se contiene il token
    // di sincronizzazione e la chiave API, ogni copia è una copia dei segreti, e
    // chi ripristina non se ne accorge perché tutto funziona lo stesso.
    const file = await buildBackup(
      fakeStore([dive('a', '2026-06-01T09:00:00Z')], {
        sync: { url: 'libsql://x', authToken: 'SEGRETO' },
        ai: { apiKey: 'sk-ant-SEGRETO' },
        goal: 'general',
      }),
    );
    const testo = JSON.stringify(file);
    for (const k of SECRET_KEYS) expect(file.settings[k]).toBeUndefined();
    expect(testo).not.toContain('SEGRETO');
    expect(testo).not.toContain('sk-ant');
  });

  it('dichiara versione, data e riepilogo leggibile', async () => {
    const file = await buildBackup(
      fakeStore([dive('a', '2026-06-01T09:00:00Z'), dive('b', '2026-07-01T09:00:00Z')]),
      new Date('2026-08-18T10:00:00Z'),
    );
    expect(file.format).toBe('mydivelog-backup');
    expect(file.version).toBe(BACKUP_VERSION);
    expect(file.createdAt).toBe('2026-08-18T10:00:00.000Z');
    expect(file.summary.dives).toBe(2);
    expect(file.summary.firstDive).toBe('2026-06-01T09:00:00Z');
    expect(file.summary.lastDive).toBe('2026-07-01T09:00:00Z');
  });

  it('il nome del file porta la data, perché in una cartella l’ordine è tutto', () => {
    expect(backupFileName(new Date('2026-08-18T22:00:00Z'))).toBe('mydivelog-backup-2026-08-18.json');
  });
});

describe('controllo del file prima di toccare l’archivio', () => {
  const buono = async () => buildBackup(fakeStore([dive('a', '2026-06-01T09:00:00Z')]));

  it('accetta un backup vero', async () => {
    const c = checkBackup(JSON.parse(JSON.stringify(await buono())));
    expect(c.ok).toBe(true);
    expect(c.errors).toEqual([]);
    expect(c.file).toBeDefined();
  });

  it('rifiuta quello che non è un backup, e dice dove andare', () => {
    // L'errore più probabile è che qualcuno provi a ripristinare un UDDF.
    const c = checkBackup({ format: 'uddf', dives: [] });
    expect(c.ok).toBe(false);
    expect(c.errors[0]).toMatch(/Importa/);
  });

  it('rifiuta il JSON che non è nemmeno un oggetto', () => {
    expect(checkBackup(null).ok).toBe(false);
    expect(checkBackup('ciao').ok).toBe(false);
    expect(checkBackup(42).ok).toBe(false);
  });

  it('rifiuta un formato più recente invece di leggerlo a metà', async () => {
    const f = { ...(await buono()), version: BACKUP_VERSION + 1 };
    const c = checkBackup(f);
    expect(c.ok).toBe(false);
    expect(c.errors[0]).toMatch(/più recente/);
  });

  it('rifiuta un file danneggiato senza id o senza data', async () => {
    const f = await buono();
    const c = checkBackup({ ...f, dives: [{ ...f.dives[0], id: '' }] });
    expect(c.ok).toBe(false);
    expect(c.errors[0]).toMatch(/danneggiato/);
  });

  it('avvisa, senza rifiutare, su un backup vecchio che conteneva le credenziali', async () => {
    const f = await buono();
    const c = checkBackup({ ...f, settings: { ...f.settings, sync: { authToken: 'x' } } });
    expect(c.ok).toBe(true);
    expect(c.warnings.join(' ')).toMatch(/credenziale/);
  });

  it('avvisa su un backup vuoto: probabilmente non è quello che si voleva', async () => {
    const f = await buildBackup(fakeStore([]));
    const c = checkBackup(f);
    expect(c.ok).toBe(true);
    expect(c.warnings.join(' ')).toMatch(/nessuna immersione/);
  });
});

describe('piano del ripristino', () => {
  it('su un archivio vuoto è tutto da aggiungere', async () => {
    const f = await buildBackup(fakeStore([dive('a', '2026-06-01T09:00:00Z')]));
    const p = planRestore(f, []);
    expect(p.added).toHaveLength(1);
    expect(p.merged).toHaveLength(0);
    expect(p.onlyLocal).toBe(0);
  });

  it('fondendo, quello che hai scritto a mano NON viene sovrascritto', async () => {
    // È la differenza fra un ripristino e una cancellazione con passi extra.
    const vecchia = dive('a', '2026-06-01T09:00:00Z');
    const f = await buildBackup(fakeStore([vecchia]));
    const locale: Dive = { ...vecchia, notes: 'aggiunte dopo il backup', site: { name: 'Punta Chiappa' } };
    const p = planRestore(f, [locale], 'merge');
    /*
     * Non viene nemmeno RISCRITTA. `mergeDive` restituisce lo stesso
     * riferimento quando non c'è niente da aggiungere, e da oggi il piano non
     * la mette in `merged`: metterla comunque faceva riscrivere l'immersione
     * con il timbro di adesso, e da lì la versione locale — vecchia quanto il
     * backup — vinceva sulla sincronizzazione contro le modifiche fatte
     * altrove. Un ripristino in modalità «Fondi» cancellava la nota scritta
     * sull'iPhone.
     */
    expect(p.merged).toHaveLength(0);
    // E quello che c'era scritto a mano è ancora lì, perché nessuno l'ha toccato.
    const daScrivere = [...p.added, ...p.merged];
    expect(daScrivere).toHaveLength(0);
  });

  it('fondendo, quello che manca in locale invece entra', async () => {
    const completa = dive('a', '2026-06-01T09:00:00Z');
    const f = await buildBackup(fakeStore([{ ...completa, notes: 'la nota del backup' }]));
    const p = planRestore(f, [completa], 'merge');
    expect(p.merged).toHaveLength(1);
    expect(p.merged[0].notes).toBe('la nota del backup');
  });

  it('ricostruendo da zero, vince il file', async () => {
    const vecchia = dive('a', '2026-06-01T09:00:00Z');
    const f = await buildBackup(fakeStore([vecchia]));
    const locale: Dive = { ...vecchia, notes: 'aggiunte dopo il backup' };
    const p = planRestore(f, [locale], 'replace');
    expect(p.merged[0].notes).toBeUndefined();
  });

  it('conta quelle che esistono solo qui: sono quelle che si perdono', async () => {
    const f = await buildBackup(fakeStore([dive('a', '2026-06-01T09:00:00Z')]));
    const p = planRestore(f, [dive('a', '2026-06-01T09:00:00Z'), dive('z', '2026-08-01T09:00:00Z')]);
    expect(p.onlyLocal).toBe(1);
  });

  it('le credenziali eventualmente presenti in un file vecchio non vengono riscritte', async () => {
    const f = await buildBackup(fakeStore([dive('a', '2026-06-01T09:00:00Z')], { goal: 'tech' }));
    const sporco: BackupFile = {
      ...f,
      settings: { ...f.settings, sync: { authToken: 'x' }, ai: { apiKey: 'y' } },
    };
    const p = planRestore(sporco, []);
    expect(p.settings.goal).toBe('tech');
    expect(p.settings.sync).toBeUndefined();
    expect(p.settings.ai).toBeUndefined();
  });
});

describe('il giro chiuso', () => {
  it('backup e ripristino su un archivio vuoto restituiscono esattamente quello che c’era', async () => {
    // Il test che vale per tutti gli altri: se questo passa, il file serve
    // davvero a quello per cui esiste.
    const originali = [
      dive('a', '2026-06-01T09:00:00Z'),
      dive('b', '2026-07-15T10:30:00Z'),
      dive('c', '2026-08-01T08:00:00Z', false),
    ];
    const impostazioni = {
      goal: 'tech',
      period: '24m',
      gear: { equipment: [{ id: 'e1' }], certifications: [] },
    };

    // Il viaggio vero: JSON.stringify e ritorno, come nel file scaricato.
    const file = await buildBackup(fakeStore(originali, impostazioni));
    const riletto = checkBackup(JSON.parse(JSON.stringify(file)));
    expect(riletto.ok).toBe(true);

    const p = planRestore(riletto.file!, []);
    expect(p.added).toHaveLength(3);
    expect(p.merged).toHaveLength(0);

    for (const originale of originali) {
      const tornata = p.added.find((d) => d.id === originale.id)!;
      expect(tornata.startTime).toBe(originale.startTime);
      expect(tornata.maxDepth).toBe(originale.maxDepth);
      expect(tornata.buddy).toBe(originale.buddy);
      expect(tornata.cylinders).toEqual(originale.cylinders);
      // I profili: campione per campione, non «più o meno».
      expect(tornata.samples?.length ?? 0).toBe(originale.samples?.length ?? 0);
      if (originale.samples?.length) {
        expect(tornata.samples![0]).toEqual(originale.samples![0]);
        expect(tornata.samples![originale.samples!.length - 1]).toEqual(
          originale.samples![originale.samples!.length - 1],
        );
      }
    }
    expect(p.settings.goal).toBe('tech');
    expect(p.settings.period).toBe('24m');
    expect(p.settings.gear).toEqual(impostazioni.gear);
  });

  it('ripristinare due volte non cambia niente la seconda', async () => {
    // Idempotenza: è la proprietà su cui insiste anche la sincronizzazione, e
    // qui vuol dire che un ripristino interrotto si può rilanciare senza paura.
    const originali = [dive('a', '2026-06-01T09:00:00Z')];
    const file = await buildBackup(fakeStore(originali));
    const primo = planRestore(file, []);
    const dopoIlPrimo = [...primo.added, ...primo.merged];
    const secondo = planRestore(file, dopoIlPrimo);
    expect(secondo.added).toHaveLength(0);
    // Idempotenza VERA: la seconda volta non c'è niente da scrivere, non
    // «niente di diverso da scrivere». È la differenza che evita di timbrare
    // tutto l'archivio con la data di adesso a ogni ripristino.
    expect(secondo.merged).toHaveLength(0);
    expect(secondo.onlyLocal).toBe(0);
    expect(dopoIlPrimo[0].samples?.length).toBe(originali[0].samples!.length);
  });
});

/**
 * Quello che il modo scelto rende impossibile.
 *
 * Un file vuoto in «ricostruisci da zero» era solo un avviso giallo, in mezzo
 * agli altri avvisi, sotto a un bottone acceso. L'operazione che ne segue è
 * «cancella tutte le immersioni» — nel momento esatto in cui chi la lancia
 * crede di star rimettendo le cose a posto.
 */
describe('impedimenti che dipendono dal modo', () => {
  const vuoto = (): BackupFile => ({
    format: 'mydivelog-backup',
    version: 1,
    createdAt: '2026-08-17T10:00:00Z',
    app: { name: 'MyDiveLog', store: 'sqlite' },
    summary: { dives: 0, withProfile: 0, samples: 0, settings: [] },
    dives: [],
    settings: {},
  });

  it('un backup vuoto NON si può usare per ricostruire da zero', () => {
    const b = restoreBlockers(vuoto(), 'replace', 42);
    expect(b).toHaveLength(1);
    expect(b[0]).toMatch(/nessuna immersione/i);
    expect(b[0]).toMatch(/42/);
  });

  it('lo stesso file si può fondere: non fa niente, e non c’è niente da impedire', () => {
    expect(restoreBlockers(vuoto(), 'merge', 42)).toEqual([]);
  });

  it('su un archivio già vuoto non c’è niente da perdere', () => {
    expect(restoreBlockers(vuoto(), 'replace', 0)).toEqual([]);
  });

  it('un backup con dentro qualcosa non è impedito da niente', async () => {
    const file = await buildBackup(fakeStore([dive('a', '2026-06-01T09:00:00Z')]));
    expect(restoreBlockers(file, 'replace', 42)).toEqual([]);
  });
});

/**
 * LE DUE LISTE BIANCHE NON DEVONO RESTARE INDIETRO.
 *
 * Un'impostazione che l'applicazione scrive e che non sta né in `SETTING_KEYS`
 * né in `SHARED_SETTINGS` non entra nel backup e non si sincronizza — e non lo
 * dice a nessuno: il backup si costruisce, il ripristino riesce, l'archivio
 * torna intero, e quel dato non c'è più. È successo con `subacqueo`, cioè nome
 * e brevetto del subacqueo, le lettere a) e b) del libretto previsto dalla
 * legge: chi cambiava telefono ritrovava tutte le immersioni e un libretto
 * senza generalità.
 *
 * Quindi non si elencano di nuovo le chiavi qui dentro: si LEGGE il sorgente e
 * si raccoglie ogni chiave passata a `setSetting`, poi si confronta con
 * l'unione delle due liste più le esclusioni dichiarate. Chi aggiunge
 * un'impostazione e dimentica le liste fa diventare rosso questo test.
 */
describe('nessuna impostazione resta fuori dalle liste bianche', () => {
  const SRC = fileURLToPath(new URL('../src', import.meta.url));

  const sorgenti = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? sorgenti(join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : [],
    );

  /**
   * Le costanti che il codice usa al posto di un letterale. Risolverle qui —
   * importandole, non ricopiandone il valore — è ciò che permette al controllo
   * di riconoscere `setSetting(TRASH_KEY, …)` e `setSetting(`${BLE_MARKERS_KEY}:at`, …)`.
   */
  const COSTANTI: Record<string, string> = {
    TRASH_KEY,
    TOMBSTONE_KEY,
    BLE_MARKERS_KEY,
  };

  /** Ogni chiave scritta con `setSetting` in `src/`, per quanto è determinabile leggendo. */
  const chiaviScritte = (): Set<string> => {
    const fuori = new Set<string>();
    for (const file of sorgenti(SRC)) {
      const testo = readFileSync(file, 'utf8');
      for (const m of testo.matchAll(
        /setSetting(?:<[^>]*>)?\(\s*(`[^`]*`|'[^']*'|"[^"]*"|[A-Za-z_$][\w$]*)/g,
      )) {
        const grezzo = m[1];
        if (grezzo.startsWith("'") || grezzo.startsWith('"')) {
          fuori.add(grezzo.slice(1, -1));
        } else if (grezzo.startsWith('`')) {
          const risolto = grezzo
            .slice(1, -1)
            .replace(/\$\{([A-Za-z_$][\w$]*)\}/g, (_, nome: string) => COSTANTI[nome] ?? '\u0000');
          if (!risolto.includes('\u0000')) fuori.add(risolto);
        } else if (COSTANTI[grezzo]) {
          fuori.add(COSTANTI[grezzo]);
        }
        /*
         * Un identificativo che non è una costante nota è una chiave DINAMICA
         * (`setSetting(key, …)` dentro la sincronizzazione e il negozio dei
         * segreti): il suo valore arriva già da queste liste o da `SECRET_KEYS`,
         * e non c'è niente da controllare.
         */
      }
    }
    return fuori;
  };

  it('trova davvero le chiavi nel sorgente', () => {
    // Se il codice cambiasse forma — un aiutante che avvolge `setSetting`, per
    // dire — questo controllo diventerebbe una rete vuota che passa sempre.
    const trovate = chiaviScritte();
    expect(trovate.size).toBeGreaterThan(8);
    expect(trovate).toContain('gasPlan');
    expect(trovate).toContain(TRASH_KEY);
  });

  it('ogni impostazione che l’applicazione scrive sta in una delle due liste', () => {
    const ammesse = new Set<string>([
      ...SETTING_KEYS,
      ...SHARED_SETTINGS,
      ...SHARED_SETTINGS.map((k) => `${k}:at`),
      // Le esclusioni dichiarate, e il perché di ciascuna.
      ...SECRET_KEYS, // credenziali: un backup che le contiene le sparge
      TRASH_KEY, // il cestino non viaggia: è una decisione di questo dispositivo
      TOMBSTONE_KEY, // le lapidi: ripristinarle cancellerebbe archivi altrui
    ]);
    const fuoriLista = [...chiaviScritte()].filter((k) => !ammesse.has(k)).sort();
    expect(
      fuoriLista,
      `impostazioni scritte e mai salvate né sincronizzate: ${fuoriLista.join(', ')}`,
    ).toEqual([]);
  });

  it('tutto ciò che si sincronizza sta anche nel backup, col suo timbro', () => {
    // L'asimmetria opposta è altrettanto silenziosa: una chiave che viaggia fra
    // due dispositivi ma non entra nel backup sparisce quando i dispositivi
    // diventano zero.
    for (const k of SHARED_SETTINGS) {
      expect(SETTING_KEYS, k).toContain(k);
      expect(SETTING_KEYS, `${k}:at`).toContain(`${k}:at`);
    }
  });
});
