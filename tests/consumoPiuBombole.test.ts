/**
 * IL CONSUMO DI SUPERFICIE CON PIÙ DI UNA BOMBOLA.
 *
 * ► PERCHÉ ESISTE. ◄ *«Puoi verificare che quando metto due gas il calcolo sia
 * corretto, e anche se metto due bombole in aria, anche con litraggio
 * diverso.»* Chiesto il 14 settembre 2026. La risposta non si dà rileggendo la
 * formula: si dà facendola girare su configurazioni scelte perché i conti si
 * possano rifare a mano.
 *
 * ► LA FORMULA, E PERCHÉ FUNZIONA ANCHE CON DUE GAS. ◄
 *
 *     consumo = Σ(Δbar_i × litri_i) / (durata × pressione media)
 *
 * La parte che sembra sbagliata e non lo è: i litri di TUTTE le bombole si
 * dividono per la pressione media dell'immersione INTERA, anche quando una
 * delle due — una stage di decompressione — è stata respirata solo a sei metri.
 * Torna perché `durata × pressione media` **è** l'integrale della pressione nel
 * tempo: la media è pesata sul tempo, quindi quel prodotto vale ∫P·dt, che è
 * per definizione il divisore giusto di un consumo di superficie. Nessuna
 * approssimazione, nessuna assunzione su quando sia stato respirato cosa.
 *
 * ► QUELLO CHE INVECE NON TORNAVA. ◄ Vedi l'ultimo blocco: una bombola che ha
 * consumato gas senza dichiarare il litraggio faceva uscire un consumo **più
 * basso del vero**, senza che niente lo dicesse.
 */

import { describe, expect, it } from 'vitest';
import { computeMetrics } from '../src/core/analysis/metrics';
import { AIR, type Cylinder, type Dive, type Sample } from '../src/core/model';

/** Quaranta minuti a 20 m, discesa e risalita di due minuti. */
const profilo = (): Sample[] => {
  const s: Sample[] = [];
  for (let t = 0; t <= 2400; t += 30) {
    s.push({ t, depth: t < 120 ? (20 * t) / 120 : t > 2280 ? (20 * (2400 - t)) / 120 : 20, tempC: 18 });
  }
  return s;
};

const EAN50 = { o2: 0.5, he: 0 };

function consumo(cylinders: Cylinder[]) {
  const dive: Dive = {
    id: 'x',
    startTime: '2026-06-14T10:38:00.000Z',
    durationS: 2400,
    maxDepth: 20,
    mode: 'oc',
    cylinders,
    source: { format: 'uddf', file: 'sintetico', importedAt: '2026-06-14T12:00:00.000Z' },
    tags: [],
    samples: profilo(),
  };
  const m = computeMetrics(dive);
  return { rmv: m.rmvLpm, avvertenze: m.quality.caveats.join(' | ') };
}

const DODICI = { mix: AIR, sizeL: 12, startBar: 200, endBar: 70 };

describe('due bombole uguali', () => {
  it('raddoppiano il consumo, esattamente', () => {
    /*
     * ► IL CONTROLLO PIÙ SEVERO È QUELLO CHE SI RIFÀ A MENTE. ◄ Stesse
     * pressioni, stesso volume, stessa immersione: i litri sono il doppio e il
     * divisore è identico, quindi il consumo deve essere il doppio **esatto**,
     * non «circa». Se qualcuno un giorno mediasse le bombole invece di
     * sommarle, questa riga diventerebbe rossa e le altre no.
     */
    const una = consumo([DODICI]).rmv!;
    const due = consumo([DODICI, { ...DODICI }]).rmv!;
    expect(una).toBeCloseTo(13.3, 1);
    expect(due).toBeCloseTo(una * 2, 1);
  });
});

describe('due bombole di litraggio diverso', () => {
  it('ognuna pesa per il proprio volume, non per la media dei due', () => {
    /*
     * 12 L e 7 L, stesso Δ di 130 bar: 1560 + 910 = 2470 bar·litro. Con la
     * media dei volumi (9,5 L) verrebbero 2470 lo stesso — quindi il caso
     * simmetrico NON distingue le due formule. Per questo i Δ sono diversi
     * nella prova qui sotto, dove la media dei volumi darebbe un numero
     * sbagliato.
     */
    const m = consumo([DODICI, { mix: AIR, sizeL: 7, startBar: 200, endBar: 70 }]);
    expect(m.rmv).toBeCloseTo(21.1, 1); // 2470 / (40 × 2.932 bar)
  });

  it('e il volume conta davvero, bombola per bombola', () => {
    // 12 L × 130 bar = 1560; 7 L × 50 bar = 350. Totale 1910.
    // Con i volumi scambiati (7 e 12) verrebbero 910 + 600 = 1510: un altro numero.
    const m = consumo([DODICI, { mix: AIR, sizeL: 7, startBar: 200, endBar: 150 }]);
    expect(m.rmv).toBeCloseTo(16.3, 1);

    const scambiate = consumo([
      { mix: AIR, sizeL: 7, startBar: 200, endBar: 70 },
      { mix: AIR, sizeL: 12, startBar: 200, endBar: 150 },
    ]);
    expect(scambiate.rmv).not.toBeCloseTo(16.3, 1);
  });
});

describe('due gas diversi', () => {
  it('danno lo stesso numero di due bombole d’aria con le stesse pressioni', () => {
    /*
     * ► È LA RISPOSTA ALLA DOMANDA, ED È UN «NON CAMBIA NIENTE». ◄ La miscela
     * non entra nel conto del consumo, e non è una dimenticanza: un litro di
     * EAN50 e un litro d'aria occupano lo stesso litro. La miscela conta per
     * l'ossigeno e per la narcosi, che si calcolano altrove. Se un giorno
     * qualcuno infilasse la frazione di ossigeno in questa formula, questa riga
     * lo direbbe.
     */
    const aria = consumo([DODICI, { mix: AIR, sizeL: 7, startBar: 200, endBar: 150 }]);
    const misto = consumo([DODICI, { mix: EAN50, sizeL: 7, startBar: 200, endBar: 150 }]);
    expect(misto.rmv).toBe(aria.rmv);
  });
});

describe('► una bombola che consuma senza dichiarare il litraggio ◄', () => {
  const zoppa = [DODICI, { mix: EAN50, startBar: 200, endBar: 150 }];

  it('non fa uscire lo stesso numero di quando non c’è affatto', () => {
    /*
     * ► IL DIFETTO, RIPRODOTTO. ◄ Prima del 14 settembre 2026 questa
     * configurazione dava **13,3 L/min**: identico alla sola 12 L. I 50 bar
     * della seconda venivano letti, riconosciuti come consumo, e poi buttati,
     * perché senza volume non diventano litri — mentre il divisore restava
     * l'immersione intera.
     *
     * Il numero resta 13,3, e va bene: senza il volume non c'è modo di fare di
     * meglio. Quello che non va bene è dirlo con la stessa faccia di un conto
     * completo. *Un consumo più basso del vero è l'errore che fa piacere, ed è
     * quello su cui si pianifica la riserva.*
     */
    const m = consumo(zoppa);
    expect(m.rmv).toBeCloseTo(13.3, 1);
    expect(m.avvertenze).toContain('non ha il litraggio');
    expect(m.avvertenze).toContain('più basso del vero');
  });

  it('e quando le bombole cieche sono due, lo dice al plurale', () => {
    const m = consumo([
      DODICI,
      { mix: EAN50, startBar: 200, endBar: 150 },
      { mix: AIR, startBar: 200, endBar: 100 },
    ]);
    expect(m.avvertenze).toContain('2 bombole hanno consumato gas');
  });

  it('ma non si lamenta di una bombola che non ha consumato niente', () => {
    /*
     * Una stage portata e non toccata non ha litri da contare: avvisare
     * sarebbe rumore, e un'avvertenza che compare quando non serve insegna a
     * non leggerle.
     */
    const m = consumo([DODICI, { mix: EAN50 }]);
    expect(m.avvertenze).not.toContain('non ha il litraggio');
  });

  it('né quando il litraggio c’è su tutte', () => {
    const m = consumo([DODICI, { mix: EAN50, sizeL: 7, startBar: 200, endBar: 150 }]);
    expect(m.avvertenze).not.toContain('non ha il litraggio');
  });
});
