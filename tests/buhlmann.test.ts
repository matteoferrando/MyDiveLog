/**
 * Bühlmann ZH-L16C con gradient factor.
 *
 * Un modello decompressivo non si verifica con "il numero sembra giusto". Qui ci
 * sono tre generi di controllo:
 *
 *  1. **Valori noti**: i limiti di non decompressione del modello nudo, che sono
 *     pubblicati e stanno in un intervallo stretto;
 *  2. **Proprietà che devono valere sempre**: più profondo carica di più, l'elio
 *     satura e desatura più in fretta dell'azoto, i gradient factor bassi
 *     producono tetti più profondi;
 *  3. **Il riscontro esterno**, che è quello che conta davvero e non sta qui:
 *     `npm run validate:gf` confronta i nostri GF99 con quelli che Shearwater
 *     calcola sulle stesse immersioni. Trentotto valori di controllo su dati veri.
 */

import { describe, expect, it } from 'vitest';
import {
  ceilingM,
  gf99,
  noDecoLimitMin,
  runProfile,
  step,
  surfacedTissues,
  COMPARTMENTS,
  compartments,
} from '../src/core/analysis/buhlmann';
import { ambientBar } from '../src/core/units';
import type { Sample } from '../src/core/model';

const AIR = { o2: 0.21, he: 0 };

/** Profilo quadro: discesa, fondo, risalita a 9 m/min, con passo di 10 secondi. */
function square(depthM: number, bottomMin: number, ascentRate = 9): Sample[] {
  const out: Sample[] = [];
  let t = 0;
  const descentS = Math.round((depthM / 18) * 60);
  for (; t <= descentS; t += 10) out.push({ t, depth: (t / descentS) * depthM });
  const bottomEnd = descentS + bottomMin * 60;
  for (; t <= bottomEnd; t += 10) out.push({ t, depth: depthM });
  const ascentS = Math.round((depthM / ascentRate) * 60);
  for (let k = 10; k <= ascentS; k += 10) {
    out.push({ t: bottomEnd + k, depth: Math.max(0, depthM * (1 - k / ascentS)) });
  }
  return out;
}

describe('saturazione dei tessuti', () => {
  it('in superficie i compartimenti sono in equilibrio con l’aria', () => {
    const s = surfacedTissues();
    expect(s.n2).toHaveLength(COMPARTMENTS);
    // (1.01325 − 0.0627) × 0.79 ≈ 0.751 bar di azoto, in tutti e sedici.
    for (const p of s.n2) expect(p).toBeCloseTo(0.751, 2);
    for (const p of s.he) expect(p).toBe(0);
    // E in superficie non c'è sovrasaturazione.
    expect(gf99(s, 1.01325).percent).toBe(0);
  });

  it('i compartimenti veloci si caricano prima dei lenti', () => {
    const amb = ambientBar(30);
    const after10 = step(surfacedTissues(), amb, AIR, 10);
    // Il primo compartimento (4 minuti) è oltre metà strada verso la saturazione,
    // il sedicesimo (635 minuti) si è appena mosso.
    const target = (amb - 0.0627) * 0.79;
    const fast = (after10.n2[0] - 0.751) / (target - 0.751);
    const slow = (after10.n2[15] - 0.751) / (target - 0.751);
    expect(fast).toBeGreaterThan(0.8);
    expect(slow).toBeLessThan(0.05);
  });

  it('l’elio entra ed esce più in fretta dell’azoto', () => {
    const amb = ambientBar(30);
    const trimix = { o2: 0.21, he: 0.35 };
    const loaded = step(surfacedTissues(), amb, trimix, 10);
    // A parità di tempo, l'elio del compartimento 5 è più vicino al suo obiettivo
    // dell'azoto, perché l'emitempo è tre volte più corto.
    const targetHe = (amb - 0.0627) * 0.35;
    const targetN2 = (amb - 0.0627) * 0.44;
    expect(loaded.he[4] / targetHe).toBeGreaterThan((loaded.n2[4] - 0.751) / (targetN2 - 0.751));
  });
});

describe('limiti di non decompressione del modello nudo', () => {
  /**
   * Con GF 100/100 il modello dà i limiti "puri" di Bühlmann. Non esistono due
   * implementazioni che diano lo stesso minuto — dipende dalla velocità di
   * discesa, dal vapore acqueo, dalla densità dell'acqua — ma l'ordine di
   * grandezza è fissato dalla letteratura, e valori fuori da questi intervalli
   * significherebbero un errore nei coefficienti.
   */
  const cases: [depth: number, min: number, max: number][] = [
    [18, 45, 90],
    [21, 30, 60],
    [24, 22, 45],
    [30, 12, 26],
    [40, 5, 13],
  ];

  for (const [depth, min, max] of cases) {
    it(`a ${depth} m sta fra ${min} e ${max} minuti`, () => {
      const ndl = noDecoLimitMin(depth, AIR, { gfHigh: 1 });
      expect(ndl).toBeGreaterThanOrEqual(min);
      expect(ndl).toBeLessThanOrEqual(max);
    });
  }

  it('più profondo significa sempre meno tempo', () => {
    const limits = [15, 18, 21, 24, 27, 30, 35, 40].map((d) => noDecoLimitMin(d, AIR, { gfHigh: 1 }));
    for (let i = 1; i < limits.length; i++) expect(limits[i]).toBeLessThan(limits[i - 1]);
  });

  it('il nitrox allunga il limite, e di quanto lo dice l’EAD', () => {
    // EAN32 a 30 m respira l'azoto di ~24 m in aria: il limite deve somigliare a
    // quello di 24 m, non a quello di 30.
    const nitroxAt30 = noDecoLimitMin(30, { o2: 0.32, he: 0 }, { gfHigh: 1 });
    const airAt24 = noDecoLimitMin(24, AIR, { gfHigh: 1 });
    const airAt30 = noDecoLimitMin(30, AIR, { gfHigh: 1 });
    expect(nitroxAt30).toBeGreaterThan(airAt30);
    expect(Math.abs(nitroxAt30 - airAt24)).toBeLessThan(airAt24 * 0.25);
  });

  it('i gradient factor stringono il limite', () => {
    const nudo = noDecoLimitMin(30, AIR, { gfHigh: 1 });
    const conservativo = noDecoLimitMin(30, AIR, { gfHigh: 0.85 });
    const moltoConservativo = noDecoLimitMin(30, AIR, { gfHigh: 0.7 });
    expect(conservativo).toBeLessThan(nudo);
    expect(moltoConservativo).toBeLessThan(conservativo);
  });
});

/**
 * I coefficienti, uno per uno, contro la tabella pubblicata.
 *
 * PERCHÉ QUESTO TEST ESISTE. Perché per mesi il file ha portato i coefficienti
 * della variante B dichiarando di essere la C, e nessun test se n'è accorto: i
 * controlli sui limiti di non decompressione hanno intervalli abbastanza larghi da
 * accogliere entrambe le tabelle, e le proprietà — più profondo carica di più —
 * valgono con qualunque serie di numeri plausibili. Se n'è accorto il confronto
 * con Shearwater, che però ha bisogno di un archivio vero e non gira in CI.
 *
 * Qui i valori sono inchiodati: la tabella si legge indietro dal comportamento di
 * `gf99` caricando un compartimento alla volta, così un coefficiente cambiato di
 * nascosto rompe il test invece di spostare silenziosamente ogni numero dell'app.
 */
describe('coefficienti ZH-L16C', () => {
  // Bühlmann, Tauchmedizin, tabella ZH-L16C per l'azoto. La serie `b` è comune
  // alle tre varianti; è la `a` che distingue A, B e C.
  const A = [
    1.2599, 1.0, 0.8618, 0.7562, 0.62, 0.5043, 0.441, 0.4, 0.375, 0.35, 0.3295, 0.3065, 0.2835,
    0.261, 0.248, 0.2327,
  ];
  const B = [
    0.505, 0.6514, 0.7222, 0.7825, 0.8126, 0.8434, 0.8693, 0.891, 0.9092, 0.9222, 0.9319, 0.9403,
    0.9477, 0.9544, 0.9602, 0.9653,
  ];

  it('ha sedici compartimenti', () => {
    expect(COMPARTMENTS).toBe(16);
    expect(A).toHaveLength(16);
  });

  for (let i = 0; i < 16; i++) {
    it(`compartimento ${i + 1}: a = ${A[i]}, b = ${B[i]}`, () => {
      // Un solo compartimento carico: è quello che comanda, quindi il GF99 che
      // esce dipende solo dai suoi due coefficienti e si può invertire.
      const amb = 1.01325;
      const loaded = 2.5;
      const state = {
        n2: Array.from({ length: 16 }, (_, k) => (k === i ? loaded : 0)),
        he: new Array(16).fill(0),
      };
      const atteso = ((loaded - amb) / (amb / B[i] + A[i] - amb)) * 100;
      const { percent, leading } = gf99(state, amb);
      expect(leading).toBe(i);
      expect(percent).toBeCloseTo(atteso, 1);
    });
  }

  it('non è la variante B, che è quella che avevamo per sbaglio', () => {
    // Il quinto e il sesto compartimento sono dove B e C divergono di più: con la
    // B il GF99 esce più basso, cioè l'app racconterebbe più margine di quello che
    // c'è. È esattamente l'errore che il confronto con Shearwater ha scoperto.
    const B_VARIANT_A5 = 0.6667;
    const amb = 1.01325;
    const state = {
      n2: Array.from({ length: 16 }, (_, k) => (k === 4 ? 2.5 : 0)),
      he: new Array(16).fill(0),
    };
    const conB = ((2.5 - amb) / (amb / B[4] + B_VARIANT_A5 - amb)) * 100;
    expect(gf99(state, amb).percent).toBeGreaterThan(conB + 1);
  });
});

describe('tetto e gradient factor', () => {
  it('un’immersione in curva non produce nessun tetto', () => {
    const r = runProfile(square(18, 30), { mix: AIR, gfLow: 0.3, gfHigh: 0.85 });
    expect(r.maxCeilingM).toBe(0);
    expect(r.decoMinutes).toBe(0);
    expect(r.gf99End).toBeLessThan(85);
  });

  it('un’immersione lunga e profonda lo produce', () => {
    const r = runProfile(square(40, 30), { mix: AIR, gfLow: 0.3, gfHigh: 0.85 });
    expect(r.maxCeilingM).toBeGreaterThan(0);
    expect(r.decoMinutes).toBeGreaterThan(0);
  });

  it('un GF basso impone un tetto più profondo, a parità di tessuti', () => {
    const loaded = step(surfacedTissues(), ambientBar(40), AIR, 25);
    const conservativo = ceilingM(loaded, 0.3);
    const permissivo = ceilingM(loaded, 0.85);
    expect(conservativo).toBeGreaterThan(permissivo);
  });

  it('il GF99 all’uscita cresce con l’esposizione', () => {
    const breve = runProfile(square(20, 20));
    const lunga = runProfile(square(30, 35));
    expect(lunga.gf99End).toBeGreaterThan(breve.gf99End);
    // E il compartimento che comanda all'uscita è più lento in quella lunga.
    expect(lunga.leadingCompartment).toBeGreaterThanOrEqual(breve.leadingCompartment);
  });

  it('una risalita lenta scarica più di una veloce', () => {
    const veloce = runProfile(square(30, 25, 18));
    const lenta = runProfile(square(30, 25, 6));
    expect(lenta.gf99End).toBeLessThan(veloce.gf99End);
  });

  it('il GF99 non dipende dai gradient factor impostati', () => {
    // È la proprietà che rende il numero confrontabile fra implementazioni
    // diverse: misura la sovrasaturazione rispetto al modello, non al conservatorismo.
    const a = runProfile(square(30, 25), { gfLow: 0.2, gfHigh: 0.85 });
    const b = runProfile(square(30, 25), { gfLow: 0.45, gfHigh: 0.95 });
    expect(a.gf99End).toBe(b.gf99End);
  });

  it('l’immersione ripetitiva parte dai tessuti della prima', () => {
    const prima = runProfile(square(30, 25));
    const seconda = runProfile(square(30, 25), { initial: prima.state });
    expect(seconda.gf99End).toBeGreaterThan(prima.gf99End);
  });
});

/**
 * Lo stato dei compartimenti pronto da disegnare.
 *
 * Il grafico delle sedici barre legge da qui, e se questi numeri non tornano il
 * disegno è una decorazione che sembra un dato — la cosa peggiore che possa esserci
 * in una schermata di decompressione.
 */
describe('compartimenti per il grafico', () => {
  const amb = 1.01325;

  it('sono sedici, numerati come nei manuali, con i loro emitempi', () => {
    const list = compartments(surfacedTissues(), amb);
    expect(list).toHaveLength(16);
    expect(list[0]).toMatchObject({ index: 1, halfTimeMin: 4 });
    expect(list[15]).toMatchObject({ index: 16, halfTimeMin: 635 });
  });

  it('a riposo nessun compartimento è sopra la pressione ambiente', () => {
    for (const c of compartments(surfacedTissues(), amb)) {
      expect(c.total).toBeLessThan(amb);
      expect(c.percent).toBe(0);
    }
  });

  it('il limite con i gradient factor sta fra l’ambiente e il valore M', () => {
    const loaded = step(surfacedTissues(), ambientBar(40), AIR, 25);
    for (const c of compartments(loaded, amb, 0.7)) {
      expect(c.limit).toBeGreaterThan(amb);
      expect(c.limit).toBeLessThan(c.mValue);
    }
    // Con gf = 1 il limite È il valore M: è la definizione.
    for (const c of compartments(loaded, amb, 1)) expect(c.limit).toBeCloseTo(c.mValue, 6);
  });

  it('la percentuale più alta corrisponde al compartimento che comanda', () => {
    const loaded = step(surfacedTissues(), ambientBar(40), AIR, 25);
    const list = compartments(loaded, amb);
    const worst = list.reduce((a, b) => (b.percent > a.percent ? b : a));
    expect(worst.index - 1).toBe(gf99(loaded, amb).leading);
    expect(worst.percent).toBeCloseTo(gf99(loaded, amb).percent, 0);
  });
})
