/**
 * Test della geometria dei grafici.
 *
 * Non testano l'aspetto: testano gli invarianti che, se rotti, producono un
 * grafico sbagliato in modo SILENZIOSO — una curva che esce dall'area di
 * disegno, una barra che sfonda la carta. Sono esattamente i difetti che non
 * fanno fallire nulla e si notano solo guardando lo schermo.
 */

import { describe, expect, it } from 'vitest';
import {
  aggregaPerPeriodo,
  campionaCurva,
  niceTicks,
  numeroBreve,
  quartili,
  riassuntoCurva,
  riassuntoDispersione,
  riassuntoDistribuzione,
  riassuntoSerie,
  roundedRightBar,
  roundedTopBar,
  versoTendenza,
} from '../src/ui/components/Charts';

describe('niceTicks', () => {
  it('usa passi tondi', () => {
    expect(niceTicks(0, 10, 4)).toEqual([0, 5, 10]);
    expect(niceTicks(0, 3, 3)).toEqual([0, 2, 4]);
    expect(niceTicks(0, 47, 4)).toEqual([0, 20, 40, 60]);
  });

  it('l\'ultima tacca non è MAI sotto il massimo', () => {
    // Questo è il bug che ha fatto uscire il profilo dal grafico: con hi = 28 e
    // passo 10 la sequenza si fermava a 20, e una profondità di 26 m veniva
    // disegnata fuori dall'area.
    for (const hi of [3, 7, 12, 26.4, 28, 33, 41, 99, 101, 0.7, 1.3]) {
      const ticks = niceTicks(0, hi, 4);
      expect(ticks[ticks.length - 1], `massimo ${hi}`).toBeGreaterThanOrEqual(hi);
    }
  });

  it('la prima tacca non è mai sopra il minimo', () => {
    for (const [lo, hi] of [
      [15, 24],
      [3.2, 9.8],
      [180, 220],
    ]) {
      const ticks = niceTicks(lo, hi, 3);
      expect(ticks[0]).toBeLessThanOrEqual(lo);
      expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(hi);
    }
  });

  it('è crescente e senza duplicati', () => {
    const ticks = niceTicks(0, 47, 4);
    for (let i = 1; i < ticks.length; i++) expect(ticks[i]).toBeGreaterThan(ticks[i - 1]);
  });

  it('non esplode sui casi degeneri', () => {
    expect(niceTicks(NaN, 10)).toEqual([0, 1]);
    // Serie a valore costante: l'intervallo si apre ATTORNO al valore. Prima
    // ripiegava su [0, 1] e il punto finiva fuori dal riquadro, con l'asse
    // etichettato 0–1 e il grafico apparentemente vuoto.
    for (const v of [0, 5, 18.4, -3]) {
      const ticks = niceTicks(v, v);
      expect(ticks.length).toBeGreaterThanOrEqual(2);
      expect(ticks[0]).toBeLessThanOrEqual(v);
      expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(v);
    }
  });
});

describe('geometria delle marche', () => {
  it('la colonna parte dalla base e arriva alla cima indicata', () => {
    const d = roundedTopBar(10, 40, 20, 60, 4);
    // Parte dalla base (y + h = 100) e il raggio non supera metà larghezza.
    expect(d.startsWith('M10 100')).toBe(true);
    expect(d).toContain('Q');
  });

  it('la colonna non si deforma quando è più bassa del raggio', () => {
    const d = roundedTopBar(0, 98, 20, 2, 4);
    expect(d).not.toContain('NaN');
    expect(d.startsWith('M0 100')).toBe(true);
  });

  it('la barra orizzontale arrotonda solo l\'estremo del dato', () => {
    const d = roundedRightBar(50, 10, 100, 14, 4);
    expect(d.startsWith('M50 10')).toBe(true);
    expect(d).not.toContain('NaN');
  });

  it('nessuna marca produce coordinate non finite', () => {
    for (const w of [0, 1, 3, 24]) {
      for (const h of [0, 1, 5, 60]) {
        expect(roundedTopBar(0, 0, w, h, 4)).not.toContain('NaN');
        expect(roundedRightBar(0, 0, w, h, 4)).not.toContain('NaN');
      }
    }
  });
});

// ---------------------------------------------------------------------------
// I riassunti letti dagli screen reader
// ---------------------------------------------------------------------------

/**
 * Questi test esistono perché la descrizione di un grafico è un'affermazione sui
 * dati, e un'affermazione sbagliata detta a chi non può verificarla guardando è
 * peggio del silenzio: chi ascolta non ha nessun modo di accorgersene. I numeri
 * attesi qui sotto sono calcolati a mano proprio per questo — se li generasse la
 * stessa funzione che si sta verificando, il test direbbe soltanto che il codice
 * è uguale a sé stesso.
 */

describe('quartili', () => {
  it('sui dispari cade su valori esistenti', () => {
    expect(quartili([3, 1, 5, 4, 2])).toEqual({ min: 1, q1: 2, mediana: 3, q3: 4, max: 5 });
  });

  it('sui pari interpola, come i fogli di calcolo', () => {
    // [1, 2, 3, 4]: q1 sta a 0.75 di posizione fra 1 e 2, q3 a 0.25 fra 3 e 4.
    expect(quartili([4, 1, 3, 2])).toEqual({ min: 1, q1: 1.75, mediana: 2.5, q3: 3.25, max: 4 });
  });

  it('un valore solo è tutti e cinque i numeri, e nessun valore è «niente»', () => {
    expect(quartili([7])).toEqual({ min: 7, q1: 7, mediana: 7, q3: 7, max: 7 });
    // `undefined` e non zero: una serie vuota non ha mediana zero, non ha mediana.
    expect(quartili([])).toBeUndefined();
  });
});

describe('numeroBreve', () => {
  it('non mette decimali dove non ce ne sono', () => {
    // «12 immersioni», non «12.0 immersioni»: il decimale finto su un conteggio
    // fa sembrare stimato un numero che è esatto.
    expect(numeroBreve(12)).toBe('12');
    expect(numeroBreve(3.0)).toBe('3');
    expect(numeroBreve(17.44)).toBe('17.4');
    expect(numeroBreve(2.55)).toBe('2.6');
  });
});

describe('versoTendenza', () => {
  it('chiama stabile ciò che si muove meno del 5% dell’escursione', () => {
    expect(versoTendenza(10, 10.2, 10)).toBe('stabile');
    expect(versoTendenza(10, 12, 10)).toBe('aumento');
    expect(versoTendenza(10, 8, 10)).toBe('diminuzione');
  });
});

describe('riassuntoDistribuzione', () => {
  it('dice totale, picco, minimo e colonne vuote', () => {
    const dati = [
      { key: 'g', label: 'gennaio', value: 0 },
      { key: 'f', label: 'febbraio', value: 4 },
      { key: 'm', label: 'marzo', value: 8 },
    ];
    expect(riassuntoDistribuzione(dati, { unita: 'immersioni' })).toBe(
      '3 colonne, totale 12 immersioni, media 4 immersioni. ' +
        'Massimo marzo con 8 immersioni, minimo gennaio con 0 immersioni. A zero: 1 su 3.',
    );
  });

  it('tace sulle colonne vuote quando non ce ne sono', () => {
    const dati = [
      { key: 'a', label: '2024', value: 30 },
      { key: 'b', label: '2025', value: 45 },
    ];
    expect(riassuntoDistribuzione(dati, { unita: 'immersioni' })).not.toContain('A zero');
  });

  it('non inventa niente su un elenco vuoto', () => {
    expect(riassuntoDistribuzione([])).toBe('Nessun dato da mostrare.');
  });
});

describe('riassuntoSerie', () => {
  const punti = [
    { at: Date.UTC(2024, 2, 15, 12), value: 20 },
    { at: Date.UTC(2024, 5, 15, 12), value: 18 },
    { at: Date.UTC(2025, 2, 15, 12), value: 16 },
    { at: Date.UTC(2025, 5, 15, 12), value: 14 },
  ];

  it('mediana, estremi, ultimo valore e direzione', () => {
    const testo = riassuntoSerie(punti, { unita: 'L/min' });
    // Mediana di [14, 16, 18, 20] = 17; prima metà (20 e 18) = 19, seconda (16 e
    // 14) = 15, cioè una discesa che vale molto più della soglia di stabilità.
    expect(testo).toContain('4 rilevazioni dal');
    expect(testo).toContain('Mediana 17.0 L/min, da 14.0 a 20.0; ultimo valore 14.0.');
    expect(testo).toContain('Prima metà 19.0, seconda metà 15.0: in diminuzione.');
    // Le date sono formattate nel fuso locale: il test non le fissa parola per
    // parola, ma l'anno di inizio e di fine devono comparire.
    expect(testo).toMatch(/2024.*2025/);
  });

  it('conta quanti valori stanno sopra il riferimento', () => {
    const testo = riassuntoSerie(punti, {
      unita: 'L/min',
      riferimento: 16,
      etichettaRiferimento: 'obiettivo 16',
    });
    expect(testo).toContain('2 su 4 sopra obiettivo 16.');
  });

  it('non parla di tendenza quando i punti sono troppo pochi', () => {
    const testo = riassuntoSerie(punti.slice(0, 3), { unita: 'L/min' });
    expect(testo).not.toContain('Prima metà');
  });

  it('resta ordinato anche se i punti arrivano in disordine', () => {
    const disordinati = [punti[3], punti[0], punti[2], punti[1]];
    expect(riassuntoSerie(disordinati, { unita: 'L/min' })).toBe(
      riassuntoSerie(punti, { unita: 'L/min' }),
    );
  });

  it('dichiara l’assenza di dati invece di stampare NaN', () => {
    expect(riassuntoSerie([], { unita: 'L/min' })).toBe('Nessun dato disponibile per questa serie.');
  });
});

describe('aggregaPerPeriodo', () => {
  it('raggruppa per mese e riporta la mediana del periodo', () => {
    const righe = aggregaPerPeriodo([
      { at: Date.UTC(2025, 4, 10, 12), value: 10 },
      { at: Date.UTC(2025, 4, 20, 12), value: 20 },
      { at: Date.UTC(2025, 5, 10, 12), value: 30 },
    ]);
    expect(righe).toEqual([
      { periodo: '2025-05', conteggio: 2, mediana: 15 },
      { periodo: '2025-06', conteggio: 1, mediana: 30 },
    ]);
  });

  it('sale agli anni invece di troncare quando i mesi sono troppi', () => {
    // Trenta mesi di fila: per mese sarebbero trenta righe da ascoltare, e
    // troncarle nasconderebbe proprio la coda recente della serie.
    const punti = Array.from({ length: 30 }, (_, i) => ({
      at: Date.UTC(2023, i, 15, 12),
      value: i,
    }));
    const righe = aggregaPerPeriodo(punti);
    expect(righe.map((r) => r.periodo)).toEqual(['2023', '2024', '2025']);
    expect(righe[0].conteggio).toBe(12);
  });
});

describe('riassuntoDispersione', () => {
  const punti = [
    { x: 1, y: 2 },
    { x: 2, y: 4 },
    { x: 3, y: 6 },
    { x: 4, y: 8 },
    { x: 5, y: 10 },
  ];

  it('descrive i due assi con i quartili e la correlazione', () => {
    const testo = riassuntoDispersione(punti, { xLabel: 'profondità (m)', yLabel: 'consumo (L/min)' });
    expect(testo).toContain('5 immersioni.');
    expect(testo).toContain('In orizzontale profondità (m) da 1 a 5, metà dei punti fra 2 e 4.');
    expect(testo).toContain('In verticale consumo (L/min) da 2.0 a 10.0, metà dei punti fra 4.0 e 8.0.');
    expect(testo).toContain('Correlazione +1.00, forte:');
  });

  it('dice che la correlazione non si può calcolare, invece di calcolarla male', () => {
    // Sotto le cinque coppie qualunque coefficiente esce alto e non significa
    // niente: è la stessa soglia usata dall'analisi, e la frase lo dichiara.
    const testo = riassuntoDispersione(punti.slice(0, 3), { xLabel: 'x', yLabel: 'y' });
    expect(testo).toContain('Correlazione non calcolabile');
  });
});

describe('riassuntoCurva', () => {
  const punti = [
    { x: 20, y: 60 },
    { x: 30, y: 30 },
    { x: 40, y: 12 },
  ];

  it('dice gli estremi, il verso e il punto marcato', () => {
    expect(riassuntoCurva(punti, { xLabel: 'm', yLabel: 'min', marcatore: { x: 30, y: 30 } })).toBe(
      'min al variare di m, da 20 a 40. Si va da 60 a 12 (in diminuzione). ' +
        'Minimo 12, massimo 60. Nel punto marcato, 30: 30.',
    );
  });

  it('non promette una curva che non c’è', () => {
    expect(riassuntoCurva([{ x: 1, y: 1 }], { xLabel: 'm', yLabel: 'min' })).toBe(
      'Dati insufficienti per disegnare la curva.',
    );
  });
});

describe('campionaCurva', () => {
  it('tiene sempre i due estremi', () => {
    const punti = Array.from({ length: 10 }, (_, i) => ({ x: i, y: i * i }));
    const scelti = campionaCurva(punti, 6);
    expect(scelti).toHaveLength(6);
    expect(scelti[0].x).toBe(0);
    expect(scelti[scelti.length - 1].x).toBe(9);
    expect(scelti.map((p) => p.x)).toEqual([0, 2, 4, 5, 7, 9]);
  });

  it('non duplica niente quando i punti sono già pochi', () => {
    const punti = [{ x: 1, y: 1 }, { x: 2, y: 2 }];
    expect(campionaCurva(punti, 6)).toEqual(punti);
  });
});
