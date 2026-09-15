/**
 * LE TRE PROPRIETÀ CHE UN PIANIFICATORE NON PUÒ VIOLARE.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ► PERCHÉ ESISTE QUESTO FILE. ◄
 *
 * `tests/proprieta.test.ts` prova già la monotonia del motore, ma la prova su
 * `decoMin` soltanto, a passi di sei metri e dieci minuti. Quei passi
 * scavalcano la soglia della curva — che è dove vivono i difetti trovati il 15
 * settembre 2026 — e `decoMin` non è il numero che si porta in acqua: quello è
 * il runtime, ed è quello che deve comportarsi bene.
 *
 * Qui si cammina la griglia metro per metro e minuto per minuto, e si guardano
 * i numeri che l'utente legge davvero: **il verdetto «in curva», il GF99 con
 * cui si esce, il tempo totale**.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * I TRE DIFETTI CHE HANNO FATTO NASCERE QUESTO FILE.
 *
 *  A. **«In curva» che usciva sopra il valore M.** La risalita si sceglieva
 *     guardando il tetto sui tessuti del momento; su un rimbalzo profondo il
 *     tetto a fine fondo è zero, e il piano saliva da 80 metri alla superficie
 *     in una gamba sola da otto minuti, durante la quale i compartimenti medi
 *     caricavano. Arrivati a zero non ricontrollava nessuno: `decoMin` restava
 *     0 e la schermata stampava `0 min` **in verde**, con GF99 132.3.
 *     Cinquantuno combinazioni fra 10 e 90 metri, sette sopra il 100%.
 *
 *  B e C. **Un minuto in più, o un metro più giù, che ACCORCIAVANO il piano.**
 *     Nel momento esatto in cui l'immersione usciva dalla curva, i tre minuti
 *     di sosta di sicurezza sparivano sostituiti da un minuto di obbligo.
 *     Quarantatré violazioni sul tempo, sessantasei sulla profondità, fino a
 *     1.9 minuti e 19 punti di GF99.
 *
 * ► A è chiusa e resta chiusa: zero, e zero deve restare. ◄ B e C sono **ridotte
 * ma non chiuse**, e questo file conta le violazioni residue invece di far
 * finta che non ci siano: quel che resta è il limite dell'ancora arrotondata
 * alla griglia, documentato in `deco.ts` con i numeri e le due soluzioni
 * provate e scartate. *Un buco dichiarato è pur sempre un buco*, ma un buco
 * contato si accorge quando cresce.
 */

import { describe, expect, it } from 'vitest';
import { planDeco, DEFAULT_DECO, type PlanGas } from '../src/core/analysis/deco';

const ARIA: PlanGas[] = [{ mix: { o2: 0.21, he: 0 }, role: 'bottom' }];
const piano = (profondita: number, minuti: number) =>
  planDeco([{ depthM: profondita, minutes: minuti }], ARIA, {});

describe('la curva dichiarata è la curva vera', () => {
  it('nessun piano «in curva» esce sopra il proprio gfHigh', () => {
    /*
     * La proprietà, in una riga: se la tabella non impone nessuna sosta, allora
     * seguendola si arriva in superficie dentro il limite che l'utente ha
     * scelto. Se questa prova diventa rossa, da qualche parte c'è di nuovo uno
     * zero verde al posto di un obbligo — e *lo zero è il valore più
     * rassicurante che un numero possa avere, e l'ultimo che deve comparire
     * quando il dato manca*.
     *
     * La griglia è fitta apposta: a passi di sei metri e dieci minuti, come
     * altrove, il difetto dell'80 × 5 non si vedeva.
     */
    const limite = DEFAULT_DECO.gfHigh * 100;
    const colpevoli: string[] = [];
    for (let p = 10; p <= 90; p += 1) {
      for (let m = 3; m <= 60; m += 1) {
        const r = piano(p, m);
        if (r.noDeco && (r.gf99EndPct ?? 0) > limite + 1e-6) {
          colpevoli.push(`${p}m × ${m}min → GF99 ${(r.gf99EndPct ?? 0).toFixed(1)}`);
        }
      }
    }
    expect(colpevoli).toEqual([]);
  });

  it('«in curva» e «zero minuti di obbligo» dicono la stessa cosa', () => {
    // Due campi che raccontano lo stesso fatto: se divergono, la schermata
    // mostra un verdetto e una tabella che non concordano.
    for (let p = 12; p <= 80; p += 4) {
      for (let m = 4; m <= 40; m += 4) {
        const r = piano(p, m);
        expect(r.noDeco).toBe(r.decoMin === 0);
      }
    }
  });

  it('la curva mostrata include la risalita, e il piano a quel tempo la rispetta', () => {
    /*
     * Il riquadro «Curva al primo livello» diceva 2.1 minuti a 90 metri, e il
     * piano a due minuti — sulla stessa schermata — mostrava quindici minuti di
     * soste obbligate. La curva rispondeva alla domanda della tabella («potrei
     * emergere in questo istante?») invece che a quella del pianificatore
     * («posso uscirne risalendo?»).
     *
     * Adesso: restando al fondo per i minuti che la curva dichiara, il piano
     * non deve imporre soste.
     */
    const bugie: string[] = [];
    for (let p = 12; p <= 90; p += 2) {
      // Il numero è sull'orologio della casella accanto — discesa compresa —
      // quindi si scrive tale e quale, senza aggiustamenti.
      const dichiarata = piano(p, 10).ndlMin ?? 0;
      if (dichiarata <= 0) continue; // «zero» è una risposta, non un piano da provare
      const r = piano(p, dichiarata);
      if (r.decoMin > 0) bugie.push(`${p}m: curva ${dichiarata.toFixed(2)} → ${r.decoMin} min d'obbligo`);
    }
    expect(bugie).toEqual([]);
  });
});

describe('monotonia: quello che resta, contato', () => {
  /**
   * Conta le coppie in cui un'immersione PIÙ impegnativa produce un piano più
   * corto. I due tetti non sono obiettivi: sono la misura di oggi, e servono a
   * far scattare la prova se qualcuno li fa risalire.
   */
  const conta = (coppia: (p: number, m: number) => [number, number][]) => {
    let n = 0;
    for (let p = 11; p <= 60; p++) {
      for (let m = 4; m <= 90; m++) {
        for (const [p2, m2] of coppia(p, m)) {
          if (piano(p2, m2).runtimeMin < piano(p, m).runtimeMin - 1e-9) n++;
        }
      }
    }
    return n;
  };

  it('un minuto in più al fondo accorcia il piano al massimo 6 volte', () => {
    // Misurato il 15 settembre 2026: 6 violazioni su 4 386 coppie, erano 43.
    // Tutte valgono circa un minuto e vengono dall'ancora arrotondata alla
    // griglia — vedi il riquadro «LIMITE NOTO E MISURATO» in `deco.ts`.
    expect(conta((p, m) => [[p, m + 1]])).toBeLessThanOrEqual(6);
  });

  it('un metro più giù non accorcia il piano più di 2 volte', () => {
    // Misurato: 2 violazioni, erano 66. Stessa causa.
    expect(conta((p, m) => [[p + 1, m]])).toBeLessThanOrEqual(2);
  });
});

describe('la tabella somma', () => {
  /**
   * ► UN FOGLIO IN CUI LE RIGHE NON FANNO IL TOTALE È UN FOGLIO CHE NON SI PUÒ
   *   USARE. ◄
   *
   * La frase è di questo stesso modulo, scritta accanto alle soste. Valeva per
   * metà della tabella: i TRATTI arrotondavano i propri minuti per conto loro
   * mentre il totale arrotondava la somma non arrotondata.
   *
   * Misurato il 15 settembre 2026 su 1 470 piani: **898 con righe che non
   * facevano il totale**, fino a 0.60 minuti di scarto. Adesso i minuti di ogni
   * tratto si ricavano dalla differenza fra due runtime consecutivi, quindi la
   * somma è esatta per costruzione e non per fortuna.
   */
  it('la somma dei tratti stampati fa il runtime stampato, su tutta la griglia', () => {
    const colpevoli: string[] = [];
    for (let p = 10; p <= 80; p += 5) {
      for (let m = 5; m <= 70; m += 5) {
        const r = piano(p, m);
        const somma = r.segments.reduce((a, x) => a + x.minutes, 0);
        if (Math.abs(somma - r.runtimeMin) > 1e-9) {
          colpevoli.push(`${p}m × ${m}min: righe ${somma.toFixed(2)} vs totale ${r.runtimeMin}`);
        }
      }
    }
    expect(colpevoli).toEqual([]);
  });

  it('e i minuti dei tratti restano quelli veri, non zeri di comodo', () => {
    // La correzione ovvia sbagliata sarebbe azzerare tutto tranne l'ultimo.
    const r = piano(40, 25);
    expect(r.segments.every((x) => x.minutes >= 0)).toBe(true);
    expect(r.segments.filter((x) => x.minutes > 0).length).toBeGreaterThan(3);
  });
});
