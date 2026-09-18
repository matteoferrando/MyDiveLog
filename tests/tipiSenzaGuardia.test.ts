/**
 * NESSUN SORGENTE TYPESCRIPT STA FUORI DAL CONTROLLO DEI TIPI.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * ► IL DIFETTO, trovato il 18 settembre 2026 col debug a tappeto. ◄
 *
 * `tsconfig.json` diceva `"include": ["src", "tests"]`. Nella cartella
 * `scripts/` però vivono **nove programmi TypeScript**, e uno di loro —
 * `generate-demo-data.ts` — sta dentro `npm run play`, cioè dentro la catena
 * che prepara il rilascio su Google Play. Nessuno di quei nove è mai stato
 * controllato da `tsc`: né da `npm run typecheck`, né da `npm run build`, né
 * dalla catena verde che questa suite dichiara a ogni giro.
 *
 * Controllandoli a mano è saltato fuori subito un errore vero:
 * `perche-non-unite.ts` filtrava le immersioni su `d.deletedAt`, **un campo che
 * il modello non ha** e non ha mai avuto. Non faceva danni — `undefined` è
 * falso, quindi il filtro non toglieva niente — ed è esattamente il tipo di
 * cosa che sopravvive per mesi: sbagliata, innocua, invisibile.
 *
 * ► PERCHÉ NON BASTA AVER AGGIUNTO `scripts` ALL'ELENCO. ◄ Perché la prossima
 * cartella nuova sarà fuori anche lei, e nessuno se ne accorgerà per gli stessi
 * mesi. *Una correzione che vale per le cartelle di oggi non è una regola.*
 * Questa prova guarda il disco e il `tsconfig`, e chiede che ogni `.ts` e ogni
 * `.tsx` del progetto ricada sotto una radice inclusa.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Cartelle che non sono nostre o che non contengono sorgenti dell'applicazione. */
const FUORI = new Set([
  'node_modules',
  'dist',
  'dist-dev',
  'src-tauri',
  'consegna',
  'sito',
  '_transfer',
  '_privato',
  '_da-cancellare',
  'coverage',
]);

function sorgenti(radice: string): string[] {
  let fuori: string[] = [];
  let voci: string[] = [];
  try {
    voci = readdirSync(radice);
  } catch {
    return [];
  }
  for (const voce of voci) {
    if (voce.startsWith('.') || FUORI.has(voce)) continue;
    const percorso = radice === '.' ? voce : join(radice, voce);
    let st;
    try {
      st = statSync(percorso);
    } catch {
      continue;
    }
    if (st.isDirectory()) fuori = fuori.concat(sorgenti(percorso));
    else if (/\.tsx?$/.test(voce) && !/\.d\.ts$/.test(voce)) fuori.push(percorso);
  }
  return fuori;
}

describe('il controllo dei tipi non lascia fuori nessuno', () => {
  it('ogni .ts e .tsx del progetto ricade sotto una radice inclusa nel tsconfig', () => {
    // Il `tsconfig` ha i commenti? No, ma leggerlo con `JSON.parse` è comunque
    // la lettura onesta: se un giorno ne avesse, questa riga romperebbe e si
    // saprebbe subito, invece di leggere per sbaglio un elenco vuoto.
    const conf = JSON.parse(readFileSync('tsconfig.json', 'utf8')) as { include?: string[] };
    const radici = conf.include ?? [];
    expect(radici.length, 'il tsconfig non include niente').toBeGreaterThan(0);

    const tutti = sorgenti('.');
    // Una guardia che non guarda niente è verde per sempre.
    expect(tutti.length, 'nessun sorgente trovato: il giro delle cartelle è rotto').toBeGreaterThan(100);

    const scoperti = tutti
      .filter((f) => !radici.some((r) => f === r || f.startsWith(r.replace(/\/$/, '') + '/')))
      .sort();
    expect(
      scoperti,
      'sorgenti TypeScript che nessun tsc guarda: aggiungi la loro cartella a "include" nel tsconfig',
    ).toEqual([]);
  });
});
