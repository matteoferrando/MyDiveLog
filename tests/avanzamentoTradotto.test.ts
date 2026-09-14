/**
 * LE RIGHE DELLO SCARICO, IN TUTTE E DUE LE LINGUE.
 *
 * ► IL CANALE CHE LA GUARDIA DEL DIZIONARIO NON PUÒ VEDERE. ◄
 * `tests/dizionario.test.ts` scorre il codice e pretende una voce per ogni
 * frase passata a `t()` o a `frase()`. Le righe dell'avanzamento non passano né
 * dall'uno né dall'altro dove vengono **scritte**: nascono in `core`, dove la
 * lingua non si sa, viaggiano dentro un evento e vengono composte
 * dall'interfaccia con una variabile — `frase(t, e.label, …)` — che nessuna
 * ricerca nel sorgente può risolvere.
 *
 * Risultato: fino al 14 settembre 2026 la riga più letta di tutto lo scarico —
 * sette minuti e quarantaquattro secondi, sul Puck 4 — usciva in italiano anche
 * con l'applicazione in inglese, e **nessuna prova se ne lamentava**.
 *
 * Da qui le due metà di questo file: le etichette dei driver di casa, che sono
 * costanti esportate apposta per poterle scorrere, e quelle fisse che il ponte
 * Rust manda su per conto suo, lette dal sorgente `.rs` come fa
 * `esterniLdc.test.ts` con le costanti del C.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { TESTI_DELL_AVANZAMENTO } from '../src/core/ble/avanzamentoTesti';
import { INGLESE as DIZIONARIO_EN } from '../src/ui/traduzioni';
import { frase } from '../src/core/frase';

const segnaposti = (s: string) => (s.match(/\{(\d+)\}/g) ?? []).sort();

describe('le etichette dei driver di casa', () => {
  it.each(TESTI_DELL_AVANZAMENTO)('«%s» ha la sua voce in inglese', (modello) => {
    expect(DIZIONARIO_EN[modello], `manca la traduzione di «${modello}»`).toBeDefined();
  });

  it.each(TESTI_DELL_AVANZAMENTO)('«%s» tiene gli stessi segnaposti', (modello) => {
    /*
     * ► UNA TRADUZIONE CHE PERDE UN `{0}` NON SEMBRA ROTTA. ◄ La frase resta
     * grammaticale e sparisce soltanto il numero: «Receiving the computer's
     * memory: of 512 kB». È lo stesso controllo che `pianoTradotto.test.ts` fa
     * sul piano di miglioramento, ed è il genere di difetto che si trova con una
     * riga di prova e non si trova mai rileggendo.
     */
    const inglese = DIZIONARIO_EN[modello];
    if (!inglese) return; // lo dice già la prova sopra
    expect(segnaposti(inglese), `segnaposti diversi in «${inglese}»`).toEqual(segnaposti(modello));
  });

  it('composta, la frase inglese porta davvero i numeri', () => {
    // Il rovescio: non basta che i segnaposti ci siano nel dizionario, devono
    // arrivare fino alla riga che si legge.
    const t = (s: string) => DIZIONARIO_EN[s] ?? s;
    const riga = frase(t, TESTI_DELL_AVANZAMENTO[0], 128, 512);
    expect(riga).toContain('128');
    expect(riga).toContain('512');
    expect(riga).not.toContain('{0}');
    expect(riga).not.toMatch(/Ricevo/);
  });
});

describe('le etichette fisse del ponte Rust', () => {
  /*
   * Lette dal sorgente `.rs`, come `esterniLdc.test.ts` fa con le costanti
   * copiate dalle intestazioni C: non c'è nessun altro modo di legare due
   * linguaggi diversi, e una riga aggiunta di là senza voce di qua uscirebbe in
   * italiano senza che niente si lamenti.
   */
  const RUST = readFileSync('src-tauri/src/ponte_blec.rs', 'utf8');
  const dalRust = [...RUST.matchAll(/label:\s*"([^"]+)"\.into\(\)/g)].map((m) => m[1]);

  it('sono almeno due, o questa prova sta guardando il posto sbagliato', () => {
    // ► LA GUARDIA DELLA GUARDIA. ◄ Se l'espressione regolare smettesse di
    // trovare niente — un `format!` al posto di una stringa, un altro modo di
    // costruire l'evento — le due prove qui sotto passerebbero a vuoto sopra un
    // elenco vuoto, che è il modo più silenzioso di perdere una guardia.
    expect(dalRust.length).toBeGreaterThanOrEqual(2);
  });

  it('hanno tutte la loro voce in inglese', () => {
    const senzaVoce = dalRust.filter((s) => DIZIONARIO_EN[s] === undefined);
    expect(senzaVoce, `etichette del ponte senza traduzione: ${senzaVoce.join(' | ')}`).toEqual([]);
  });
});
