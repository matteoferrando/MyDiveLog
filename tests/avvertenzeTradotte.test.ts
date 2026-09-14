/**
 * LE AVVERTENZE DELLE METRICHE, IN TUTTE E DUE LE LINGUE.
 *
 * ► IL TERZO CANALE CHE LA GUARDIA DEL DIZIONARIO NON POTEVA VEDERE. ◄
 * `tests/dizionario.test.ts` scorre il sorgente e pretende una voce per ogni
 * frase passata a `t()` o a `frase()`. Le avvertenze non passavano né dall'uno
 * né dall'altro: nascevano in `core`, dove la lingua non si sa, e venivano
 * disegnate così com'erano — `{m.quality.caveats.map((c) => <div>{c}</div>)}`.
 *
 * Risultato: fino al 14 settembre 2026 **nove avvertenze uscivano in italiano
 * anche con l'applicazione in inglese**, e nessuna prova se ne lamentava.
 *
 * È la terza volta in una settimana con la stessa forma — il piano di
 * miglioramento, le righe dell'avanzamento, e adesso queste — quindi anche la
 * cura è la terza copia della stessa: costanti esportate apposta, `frase()` per
 * quelle col numero dentro, e questo file che le scorre tutte.
 */

import { describe, expect, it } from 'vitest';
import { TESTI_DELLE_AVVERTENZE, testoAvvertenza } from '../src/core/analysis/avvertenze';
import { INGLESE as DIZIONARIO_EN } from '../src/ui/traduzioni';

const segnaposti = (s: string) => (s.match(/\{(\d+)\}/g) ?? []).sort();
const inglese = (s: string) => DIZIONARIO_EN[s] ?? s;

describe('ogni avvertenza', () => {
  it('sono dieci, o questo file sta guardando un elenco che si è svuotato', () => {
    // ► LA GUARDIA DELLA GUARDIA. ◄ `it.each` su un elenco vuoto non esegue
    // niente e chiude verde: è il modo più silenzioso di perdere un controllo.
    expect(TESTI_DELLE_AVVERTENZE.length).toBeGreaterThanOrEqual(10);
  });

  it.each(TESTI_DELLE_AVVERTENZE)('«%s» ha la sua voce in inglese', (modello) => {
    expect(DIZIONARIO_EN[modello], `manca la traduzione di «${modello}»`).toBeDefined();
  });

  it.each(TESTI_DELLE_AVVERTENZE)('«%s» tiene gli stessi segnaposti', (modello) => {
    /*
     * Una traduzione che perde un `{0}` non sembra rotta: la frase resta
     * grammaticale e sparisce soltanto il numero — «Sampled every s». È lo
     * stesso controllo di `pianoTradotto.test.ts` e di
     * `avanzamentoTradotto.test.ts`, ed è il genere di difetto che si trova con
     * una riga di prova e non si trova mai rileggendo.
     */
    const en = DIZIONARIO_EN[modello];
    if (!en) return; // lo dice già la prova sopra
    expect(segnaposti(en), `segnaposti diversi in «${en}»`).toEqual(segnaposti(modello));
  });
});

describe('composte, le avvertenze portano davvero i numeri', () => {
  it('quella col numero esce in inglese col numero dentro', () => {
    const riga = testoAvvertenza({ testo: TESTI_DELLE_AVVERTENZE[1], valori: [30] }, inglese);
    expect(riga).toContain('30');
    expect(riga).not.toContain('{0}');
    expect(riga).not.toMatch(/Campionamento/);
  });

  it('quella senza numeri si traduce lo stesso', () => {
    const riga = testoAvvertenza({ testo: TESTI_DELLE_AVVERTENZE[0] }, inglese);
    expect(riga).toBe(DIZIONARIO_EN[TESTI_DELLE_AVVERTENZE[0]]);
  });

  it('e una stringa nuda dell’archivio vecchio si legge ancora', () => {
    /*
     * ► IL PEZZO CHE NON SI PUÒ MIGRARE. ◄ Le metriche sono salvate con
     * l'immersione: negli archivi scritti prima del 14 settembre 2026 le
     * avvertenze sono frasi italiane già composte, coi numeri dentro. Il
     * ricalcolo le rifà, ma solo per le immersioni con un profilo. *Quello che
     * non si può migrare si continua a saperlo leggere*, e la prova sta qui
     * perché la prossima persona non pensi che il ramo `typeof === 'string'`
     * sia un residuo da togliere.
     */
    const vecchia = 'Campionamento a 30 s: velocità verticali e sosta di sicurezza sono approssimate.';
    expect(testoAvvertenza(vecchia, inglese)).toBe(vecchia);
  });
});
