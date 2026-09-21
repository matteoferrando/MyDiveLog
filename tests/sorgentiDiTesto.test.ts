/**
 * UN SORGENTE CHE `grep` CHIAMA «BINARIO» È UN SORGENTE CHE LE RICERCHE SALTANO.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ► PERCHÉ QUESTA PROVA ESISTE, dal 16 settembre 2026. ◄
 *
 * `src/ui/components/Brevetti.tsx` conteneva il byte zero — quello vero, non
 * l'escape — dentro una costante: il valore della voce «questo corso non è in
 * elenco». Il valore serviva e serve ancora: un testo che nessun nome di corso
 * potrà mai avere, così quella voce non può collidere con un corso vero.
 *
 * Il danno non era nel valore, era nel FILE. Con un byte di controllo dentro,
 * gli strumenti smettono di trattarlo come testo:
 *
 *   - `grep -rn qualcosa src/` stampa «binary file matches» e non la riga: ogni
 *     ricerca fatta nel progetto saltava quel file **in silenzio**;
 *   - `git diff` scrive «Binary files differ»: tre settimane di modifiche a quel
 *     file non si potevano rileggere;
 *   - un editor o uno strumento che «ripulisce» i file può toglierlo senza
 *     dirlo, e il valore cambia sotto i piedi.
 *
 * Nessuna di queste cose fallisce: si limitano a non mostrare niente. *Uno
 * strumento che tace non è uno strumento che approva.*
 *
 * ► COSA CONTROLLA. ◄ Che nessun sorgente contenga byte di controllo diversi da
 * tabulazione, a capo e ritorno a capo. L'escape scritto con la barra rovesciata
 * passa: è testo, e a runtime vale esattamente lo stesso carattere.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Le cartelle dove sta il codice scritto a mano. */
const RADICI = ['src', 'tests', 'scripts', 'src-tauri/src', 'server/src'];
const ESTENSIONI = /\.(ts|tsx|js|mjs|cjs|jsx|rs|css|html|json|md|toml|sh|yml|yaml)$/;
/** Tabulazione (9), a capo (10) e ritorno a capo (13) sono testo. Il resto no. */
const AMMESSI = new Set([9, 10, 13]);

function sorgenti(radice: string): string[] {
  let trovati: string[] = [];
  let voci: string[] = [];
  try {
    voci = readdirSync(radice);
  } catch {
    // Una radice che non c'è non è un errore: è un pezzo di progetto che in
    // questa copia non è stato scaricato.
    return [];
  }
  for (const voce of voci) {
    if (voce === 'node_modules' || voce === 'target' || voce === 'gen' || voce.startsWith('.')) continue;
    const percorso = join(radice, voce);
    if (statSync(percorso).isDirectory()) trovati = trovati.concat(sorgenti(percorso));
    else if (ESTENSIONI.test(voce)) trovati.push(percorso);
  }
  return trovati;
}

describe('i sorgenti sono testo', () => {
  it('nessun file contiene byte di controllo', () => {
    const colpevoli: string[] = [];
    let quanti = 0;
    for (const radice of RADICI) {
      for (const file of sorgenti(radice)) {
        quanti += 1;
        const dati = readFileSync(file);
        for (let i = 0; i < dati.length; i += 1) {
          const b = dati[i]!;
          if (b < 32 && !AMMESSI.has(b)) {
            const riga = dati.subarray(0, i).toString('utf8').split('\n').length;
            colpevoli.push(`${file}:${riga} byte 0x${b.toString(16).padStart(2, '0')}`);
            break;
          }
        }
      }
    }
    /*
     * Il conteggio serve a far ROMPERE questa prova se un giorno il giro delle
     * cartelle non trovasse più niente: un elenco vuoto passerebbe sempre, ed è
     * il modo in cui una guardia muore senza che nessuno se ne accorga.
     */
    expect(quanti, 'nessun sorgente esaminato: il giro delle cartelle è rotto').toBeGreaterThan(200);
    expect(colpevoli, 'scrivi il carattere come escape, non come byte').toEqual([]);
  });
});
