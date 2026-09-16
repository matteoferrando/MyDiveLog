/**
 * IL NUMERO CHE DECIDE DEV'ESSERE IL NUMERO CHE SI MOSTRA — L'ORA DEL CNS.
 *
 * ► COS'È SUCCESSO. ◄ Il CNS si mostra dappertutto con `toFixed(0)` e si
 * confrontava dappertutto col valore pieno. Misurato il 16 settembre 2026 sul
 * pianificatore, con EAN32 a 42 m:
 *
 *   CNS 79.9 % → a schermo **«80%»**, e **nessun avviso**, perché la soglia
 *                degli avvisi è 80 e il valore pieno non ci arriva;
 *   CNS 99.9 % → a schermo **«100%»**, classificato `caution`: il lettore vede
 *                il numero del limite e accanto un avviso che dice che il
 *                limite non è superato.
 *
 * È lo stesso guasto della MOD che diceva «a 33.3 m superi il limite: la
 * massima operativa è 33.3 m», chiuso il 15 settembre con la stessa medicina —
 * *la soglia si confronta con la cosa mostrata* — e rimasto aperto qui, nel
 * posto dove il numero parla di tossicità.
 *
 * ► PERCHÉ LA PROVA CERCA I VALORI INVECE DI SCRIVERLI. ◄ Un `bottomMin`
 * copiato a mano (34.82125) è un numero che vale finché il modello non cambia
 * di un decimale, e il giorno che cambia la prova diventa verde perché non sta
 * più misurando il bordo. La bisezione trova il bordo qualunque sia: cerca il
 * tempo di fondo più lungo che sta ancora **sotto** la soglia col valore pieno,
 * cioè esattamente il caso in cui i due numeri divergono.
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_PLAN, planGas, type GasPlanInput } from '../src/core/analysis/gasPlan';
import * as A from '../src/core/analysis/avvisiDelPiano';
import { cnsMostrato } from '../src/core/units';

/** EAN32 a 42 m con una bombola grande: il CNS sale, il gas non finisce prima. */
const BASE: GasPlanInput = {
  ...DEFAULT_PLAN,
  rmvLpm: 18,
  depthM: 42,
  avgDepthM: 40,
  maxTimeMin: 0,
  mix: { o2: 0.32, he: 0 },
  maxPpo2: 1.6,
  tankL: 24,
  startBar: 300,
};

const pianoDa = (bottomMin: number) => planGas({ ...BASE, bottomMin, totalMin: bottomMin + 10 });

/**
 * Il tempo di fondo più lungo che lascia il CNS PIENO sotto `soglia`.
 *
 * È il punto in cui il valore mostrato ha già raggiunto la soglia e quello
 * pieno no: se le due cose decidono insieme, qui non succede niente di strano;
 * se decidono separate, qui si vede.
 */
function bordoSotto(soglia: number): number {
  let lo = 1;
  let hi = 400;
  for (let k = 0; k < 60; k++) {
    const mid = (lo + hi) / 2;
    if (pianoDa(mid).oxygen.cnsPercent < soglia) lo = mid;
    else hi = mid;
  }
  return lo;
}

describe('la regola, da sola', () => {
  it('arrotonda come `toFixed(0)`, che è quello che si stampa', () => {
    for (const v of [0, 79.4, 79.5, 79.9, 99.4, 99.5, 99.9, 100.4, 123.45]) {
      expect(String(cnsMostrato(v))).toBe(v.toFixed(0));
    }
  });
});

describe('pianificatore: la soglia del CNS guarda il numero mostrato', () => {
  for (const soglia of [80, 100]) {
    it(`al bordo dei ${soglia}% il numero a schermo e il livello dicono la stessa cosa`, () => {
      const piano = pianoDa(bordoSotto(soglia));
      const pieno = piano.oxygen.cnsPercent;

      // Il bordo è quello che si credeva: pieno sotto la soglia, mostrato sopra.
      // Senza questa riga la prova potrebbe passare su un caso che non è il caso.
      expect(pieno).toBeLessThan(soglia);
      expect(cnsMostrato(pieno)).toBeGreaterThanOrEqual(soglia);

      const avviso = piano.warnings.find((w) => w.testo === A.CNS_ALTO || w.testo === A.CNS_ALTO_CON_MINUTI);
      expect(avviso, `a ${pieno}% mostrato come ${cnsMostrato(pieno)}% l'avviso deve esserci`).toBeDefined();

      // ► IL CUORE. ◄ Il numero scritto nell'avviso è quello su cui l'avviso ha
      // deciso: il livello e la cifra non possono contraddirsi.
      const mostrato = Number(avviso!.valori![0]);
      expect(mostrato).toBe(cnsMostrato(pieno));
      expect(avviso!.level).toBe(mostrato >= 100 ? 'critical' : 'caution');
    });
  }

  it('e sotto la soglia non compare niente, altrimenti avrei solo spostato il bordo', () => {
    // Un tempo di fondo che mostra 79%: nessun avviso di CNS. Se la correzione
    // avesse abbassato la soglia invece di accordare i due numeri, questa
    // sarebbe rossa.
    let piano = pianoDa(bordoSotto(80));
    let passo = 0.5;
    while (cnsMostrato(piano.oxygen.cnsPercent) >= 80 && passo < 40) {
      piano = pianoDa(bordoSotto(80) - passo);
      passo += 0.5;
    }
    expect(cnsMostrato(piano.oxygen.cnsPercent)).toBeLessThan(80);
    expect(piano.warnings.some((w) => w.testo === A.CNS_ALTO || w.testo === A.CNS_ALTO_CON_MINUTI)).toBe(
      false,
    );
  });
});
