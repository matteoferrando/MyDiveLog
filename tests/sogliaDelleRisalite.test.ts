/**
 * Statistiche e piano dicono la stessa cosa sullo stesso numero.
 *
 * ► IL DIFETTO. ◄ La riga «Immersioni con risalite fuori limite» di Statistiche
 * giudica con `BENCHMARK.fastAscentRate` — il **10%**, che è anche il numero
 * scritto accanto al criterio di prontezza e dentro l'obiettivo del piano — e il
 * piano di miglioramento chiamava «buono» solo sotto il **2%**. Chi stava in
 * mezzo leggeva un pallino verde e «nei limiti» da una parte, e una scheda di
 * avviso dall'altra, *con in mezzo un numero che l'applicazione gli aveva appena
 * detto essere il limite.*
 *
 * È l'ultima della famiglia chiusa nella notte del 15 settembre — il GF99, le
 * soste, la riserva — e la regola è sempre quella: **il numero che decide
 * dev'essere il numero che si mostra**, e due schermate della stessa
 * applicazione non possono dire il contrario l'una dell'altra.
 */

import { describe, expect, it } from 'vitest';

import { BENCHMARK, buildPlan } from '../src/core/analysis/coaching';
import { aggregate } from '../src/core/analysis/aggregate';
import { computeMetrics } from '../src/core/analysis/metrics';
import type { Dive } from '../src/core/model';

/**
 * Un archivio con una frazione voluta di immersioni che sforano.
 *
 * La risalita «veloce» è a 15 m/min per quaranta metri: sopra il limite per più
 * di due minuti di fila, quindi ben oltre i trenta secondi che la regola conta.
 * Quella lenta è a 6 m/min, dentro il limite per tutta la salita. *I numeri sono
 * scelti così perché la regola guarda i SECONDI fuori limite, non la velocità
 * media: una risalita fulminea ma corta non la fa scattare, e una prova
 * costruita a occhio resterebbe verde per il motivo sbagliato.*
 */
function archivio(quante: number, suQuante: number): Dive[] {
  const profilo = (veloce: boolean) => {
    const punti = [{ t: 0, depth: 0 }];
    for (let i = 1; i <= 30; i++) punti.push({ t: i * 10, depth: 40 });
    const mpm = veloce ? 15 : 6;
    const durata = Math.round((40 / mpm) * 60);
    for (let s = 10; s <= durata; s += 10)
      punti.push({ t: 300 + s, depth: Math.max(0, 40 - mpm * (s / 60)) });
    return punti;
  };
  return Array.from({ length: suQuante }, (_, i) => {
    const d: Dive = {
      id: `d${i}`,
      startTime: new Date(Date.UTC(2026, 0, i + 1, 9)).toISOString(),
      durationS: 1800,
      maxDepth: 40,
      mode: 'oc',
      cylinders: [{ mix: { o2: 0.21, he: 0 } }],
      source: { format: 'uddf', file: 'a.uddf', importedAt: '2026-01-01T20:00:00Z' },
      tags: [],
      samples: profilo(i < quante),
    };
    return { ...d, metrics: computeMetrics(d) };
  });
}

/** Il verdetto della riga di Statistiche, ricostruito com'è scritto nella pagina. */
const statisticheDiconoBuono = (rate: number) =>
  Math.round(rate * 100) <= Math.round(BENCHMARK.fastAscentRate * 100);

const schedaRisalite = (dives: Dive[]) =>
  buildPlan(dives, aggregate(dives), 'general', undefined, (x: string) => x).findings.find(
    // Per identificativo e non per area: nell'area «risalita» ci sono anche gli
    // ultimi metri, che è un'altra regola con un'altra soglia.
    (f) => f.id === 'ascent-good' || f.id === 'ascent-rate',
  );

describe('la soglia delle risalite', () => {
  it('è la stessa nel piano e in Statistiche, su tutta la scala', () => {
    // Si attraversa la soglia da sotto e da sopra: dove il pallino di
    // Statistiche è verde, la scheda del piano dev'essere un punto di forza.
    for (const [quante, suQuante] of [
      [0, 20],
      [1, 20],
      [2, 20],
      [3, 20],
      [5, 20],
      [9, 20],
    ] as const) {
      const dives = archivio(quante, suQuante);
      const a = aggregate(dives);
      const rate = a.fastAscentRate ?? 0;
      const scheda = schedaRisalite(dives);
      expect(scheda, `nessuna scheda con ${quante}/${suQuante}`).toBeTruthy();
      expect(
        scheda!.severity === 'good',
        `${quante}/${suQuante} → ${(rate * 100).toFixed(0)}%: Statistiche dice ` +
          `${statisticheDiconoBuono(rate) ? 'buono' : 'da guardare'}, il piano dice ${scheda!.severity}`,
      ).toBe(statisticheDiconoBuono(rate));
    }
  });

  it('e dentro il ramo buono l’elogio è più forte solo quando il numero lo merita', () => {
    const impeccabile = schedaRisalite(archivio(0, 20));
    const accettabile = schedaRisalite(archivio(1, 20));
    expect(impeccabile?.severity).toBe('good');
    expect(accettabile?.severity).toBe('good');
    // Stesso verdetto, parole diverse: è la differenza fra «sotto controllo» e
    // «dentro il limite», e non contraddice nessun pallino.
    expect(impeccabile?.headline).not.toBe(accettabile?.headline);
  });
});
