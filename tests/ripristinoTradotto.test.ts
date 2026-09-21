/**
 * IL RIPRISTINO DI UN BACKUP, IN TUTTE E DUE LE LINGUE E CON I PLURALI GIUSTI.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ► IL DIFETTO. ◄ `core/export/backup.ts` produce tre famiglie di frasi — gli
 * errori che impediscono di leggere il file, gli avvisi da sapere prima di
 * procedere, e gli impedimenti che dipendono dal modo scelto — e `SyncPage` le
 * disegnava così com'erano: `setErrore(check.errors.join(' '))`.
 *
 * Con l'applicazione in inglese e un file sbagliato usciva **un riquadro rosso
 * in italiano**. Ed è il ripristino: l'operazione che si fa quando le cose sono
 * già andate male, quando il file di partenza non c'è più e chi legge ha appena
 * perso qualcosa. Non è il momento di trovarsi davanti una lingua che non si
 * capisce.
 *
 * ► E IL PLURALE. ◄ «1 immersioni compaiono più di una volta» era sbagliato
 * anche in italiano. `plural()` di `ui/format.ts` sa mettere il sostantivo al
 * singolare, ma la frase intorno continua a dire «compaiono»: in italiano
 * cambia il verbo, in inglese verbo e sostantivo. L'unica cosa che funziona sono
 * due frasi intere, ognuna traducibile per conto suo — la stessa scelta di
 * `analysis/avvertenze.ts`.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import {
  BACKUP_VERSION,
  IMMERSIONI_DOPPIE,
  IMMERSIONI_INCOMPLETE,
  RICOSTRUZIONE_A_VUOTO,
  RICOSTRUZIONE_A_VUOTO_UNA,
  UNA_IMMERSIONE_DOPPIA,
  UNA_IMMERSIONE_INCOMPLETA,
  checkBackup,
  restoreBlockers,
  type BackupFile,
} from '../src/core/export/backup';
import { INGLESE as EN } from '../src/ui/traduzioni';
import type { Dive } from '../src/core/model';

const inglese = (s: string) => EN[s] ?? s;
const segnaposti = (s: string) => (s.match(/\{(\d+)\}/g) ?? []).sort();

/** Un'immersione completa: quella che passa tutti i controlli del ripristino. */
const immersione = (id: string): Dive => ({
  id,
  startTime: '2026-05-01T10:00:00Z',
  durationS: 2400,
  maxDepth: 25,
  mode: 'oc',
  cylinders: [],
  tags: [],
  source: { format: 'uddf', file: 'x', importedAt: '2026-05-01T12:00:00Z' },
});

const backup = (dives: Dive[], settings: Record<string, unknown> = {}): BackupFile =>
  ({
    format: 'mydivelog-backup',
    version: BACKUP_VERSION,
    createdAt: '2026-05-02T08:00:00Z',
    dives,
    settings,
    summary: { dives: dives.length, withProfile: 0, samples: 0, settings: [] },
  }) as unknown as BackupFile;

describe('le quattro coppie singolare/plurale', () => {
  const COPPIE = [
    [UNA_IMMERSIONE_INCOMPLETA, IMMERSIONI_INCOMPLETE],
    [UNA_IMMERSIONE_DOPPIA, IMMERSIONI_DOPPIE],
    [RICOSTRUZIONE_A_VUOTO_UNA, RICOSTRUZIONE_A_VUOTO],
  ] as const;

  it.each(COPPIE.flat())('«%s» ha la sua voce in inglese', (modello) => {
    /*
     * Queste tre frasi NON passano da `t('…')` scritto per esteso: arrivano a
     * `t` come costante, e `chiaviDi` vede solo una stringa letterale. Sono
     * quindi invisibili a `dizionario.test.ts`, ed è per questo che stanno qui.
     */
    expect(EN[modello], `manca la traduzione di «${modello}»`).toBeDefined();
  });

  it.each(COPPIE.flat())('«%s» tiene gli stessi segnaposti', (modello) => {
    const en = EN[modello];
    if (!en) return; // lo dice già la prova sopra
    expect(segnaposti(en), `segnaposti diversi in «${en}»`).toEqual(segnaposti(modello));
  });

  it('la forma singolare non ha nessun segnaposto, o non sarebbe una forma singolare', () => {
    for (const [uno] of COPPIE) expect(segnaposti(uno), `«${uno}» porta un numero`).toEqual([]);
  });
});

describe('con una sola immersione, la frase è al singolare', () => {
  it('un doppione solo non fa «1 immersioni compaiono»', () => {
    const c = checkBackup(backup([immersione('a'), immersione('a')]));
    const testo = c.warnings.join(' ');
    // Il difetto, scritto com'era: un numero attaccato a un plurale.
    expect(testo).not.toMatch(/\b1 immersioni\b/);
    expect(testo).toMatch(/Un’immersione compare più di una volta/);
  });

  it('e due doppioni tornano al plurale, col numero al suo posto', () => {
    const c = checkBackup(backup([immersione('a'), immersione('a'), immersione('b'), immersione('b')]));
    expect(c.warnings.join(' ')).toMatch(/2 immersioni compaiono più di una volta/);
  });

  it('una sola immersione rotta non fa «1 immersioni sono incomplete»', () => {
    const c = checkBackup(backup([{ ...immersione('a'), id: '' } as Dive]));
    expect(c.errors.join(' ')).not.toMatch(/\b1 immersioni\b/);
    expect(c.errors.join(' ')).toMatch(/Un’immersione è incompleta/);
  });

  it('e l’impedimento della ricostruzione conta bene anche una sola immersione', () => {
    expect(restoreBlockers(backup([]), 'replace', 1).join(' ')).toMatch(/l’unica che hai adesso/);
    expect(restoreBlockers(backup([]), 'replace', 1).join(' ')).not.toMatch(/\ble 1\b/);
    expect(restoreBlockers(backup([]), 'replace', 7).join(' ')).toMatch(/le 7 che hai adesso/);
  });
});

describe('con l’applicazione in inglese', () => {
  it('l’errore del file sbagliato esce in inglese', () => {
    const c = checkBackup({ format: 'uddf', dives: [] }, inglese);
    expect(c.ok).toBe(false);
    expect(c.errors.join(' ')).toContain('This is not a MyDiveLog backup');
    expect(c.errors.join(' ')).not.toMatch(/backup di MyDiveLog/);
  });

  it('e nemmeno un file che non è JSON resta in italiano', () => {
    expect(checkBackup(null, inglese).errors.join(' ')).not.toMatch(/oggetto JSON/);
  });

  it('gli avvisi sui doppioni escono in inglese, col numero dentro', () => {
    const c = checkBackup(
      backup([immersione('a'), immersione('a'), immersione('b'), immersione('b')]),
      inglese,
    );
    const testo = c.warnings.join(' ');
    expect(testo).toContain('2 dives appear more than once');
    expect(testo).not.toMatch(/compaiono/);
    expect(testo).not.toContain('{0}');
  });

  it('l’avviso sulla credenziale porta il nome della chiave, tradotto intorno', () => {
    const c = checkBackup(backup([immersione('a')], { sync: { authToken: 'x' } }), inglese);
    const testo = c.warnings.join(' ');
    expect(testo).toContain('sync');
    expect(testo).toContain('credential');
    expect(testo).not.toMatch(/credenziale/);
  });

  it('e l’impedimento della ricostruzione da zero pure', () => {
    const testo = restoreBlockers(backup([]), 'replace', 42, inglese).join(' ');
    expect(testo).toContain('42');
    expect(testo).toContain('rebuild from scratch');
    expect(testo).not.toMatch(/ricostruisci da zero/);
  });

  it('senza traduzione resta italiano, che è la chiave: nessun chiamante si rompe', () => {
    // La proprietà su cui è costruito tutto il dizionario del progetto: una
    // frase non tradotta è una frase corretta in italiano, mai una mutilata.
    expect(checkBackup(null).errors[0]).toBe('Il file non contiene un oggetto JSON.');
  });
});

describe('chi disegna il ripristino passa la traduzione', () => {
  it('SyncPage non chiama il nucleo senza dirgli che lingua si parla', () => {
    /*
     * ► IL PUNTO IN CUI IL DIFETTO ENTRAVA A SCHERMO. ◄ Il nucleo adesso sa
     * tradurre, ma solo se qualcuno gli passa `t`; il parametro ha un ripiego
     * (`comeSta`) apposta per non rompere i chiamanti esistenti, e quel ripiego
     * è esattamente il difetto di partenza se resta al suo posto proprio qui —
     * dove il risultato finisce in un riquadro rosso a schermo.
     */
    const sorgente = readFileSync('src/ui/pages/SyncPage.tsx', 'utf8');
    /*
     * Le parentesi si contano invece di affidarsi a un'espressione regolare:
     * `checkBackup(JSON.parse(await f.text()), t)` ne ha tre annidate, e una
     * regolare pigra chiude sulla prima — dichiarando assente proprio la `t`
     * che sta dopo. Una guardia che sbaglia a leggere è peggio di nessuna
     * guardia.
     */
    const chiamate: { nome: string; argomenti: string }[] = [];
    for (const m of sorgente.matchAll(/\b(checkBackup|restoreBlockers)\(/g)) {
      let i = m.index + m[0].length;
      let livello = 1;
      while (i < sorgente.length && livello > 0) {
        if (sorgente[i] === '(') livello += 1;
        else if (sorgente[i] === ')') livello -= 1;
        i += 1;
      }
      chiamate.push({ nome: m[1]!, argomenti: sorgente.slice(m.index + m[0].length, i - 1) });
    }
    expect(chiamate.length, 'nessuna chiamata trovata: la prova sta guardando il posto sbagliato').toBe(2);
    const senzaTraduzione = chiamate.filter((c) => !/,\s*t\s*$/.test(c.argomenti)).map((c) => c.nome);
    expect(
      senzaTraduzione,
      `disegnano le frasi del nucleo senza passargli la traduzione: ${senzaTraduzione.join(' | ')}`,
    ).toEqual([]);
  });
});
