/**
 * La temperatura c'era, e l'applicazione diceva «—».
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ► IL DIFETTO, TROVATO DA UN SUBACQUEO GUARDANDO IL PROPRIO SCHERMO. ◄
 *
 * Nella scheda il riquadro «Temperatura minima» era vuoto, e trenta centimetri
 * più sotto il grafico della temperatura disegnava una riga piatta a 30,0 °C.
 * *Lo stesso schermo, lo stesso dato, due risposte diverse.*
 *
 * `Dive.minTempC` è la temperatura dichiarata nel **riepilogo**, e ci sono
 * formati che non la scrivono. Il profilo però porta `tempC` su ogni campione, e
 * `computeMetrics` lo sapeva da sempre — `dive.minTempC ?? minOf(samples)`. Il
 * valore calcolato finiva in `metrics` e **non lo leggeva nessuno**.
 *
 * ► NON ERA UN RIQUADRO VUOTO: ERA UN DATO CHE SPARIVA DAPPERTUTTO. ◄ La
 * scheda, il PDF del libretto, il CSV, l'esportazione UDDF, il conteggio delle
 * immersioni fredde, la media mensile, il confronto e le statistiche
 * dell'attrezzatura: tutti pescavano dal campo dichiarato. Le due conseguenze
 * peggiori non si vedevano affatto — un'immersione fredda **non veniva mai
 * contata fredda**, e riesportando in UDDF la temperatura **si perdeva**.
 *
 * Queste prove partono dall'immersione come arriva davvero: nessun riepilogo,
 * il profilo pieno di letture.
 */

import { describe, expect, it } from 'vitest';
import { computeMetrics } from '../src/core/analysis/metrics';
import { aggregate } from '../src/core/analysis/aggregate';
import { temperaturaMinimaC } from '../src/core/temperatura';
import { exportUddf } from '../src/core/export/uddf';
import { schedePdf } from '../src/core/export/pdf';
import type { Dive, Sample } from '../src/core/model';

/** Profilo quadro con la temperatura su ogni campione. */
function campioni(tempC: number): Sample[] {
  const out: Sample[] = [];
  for (let t = 0; t <= 1800; t += 10) {
    const depth = t < 120 ? (t / 120) * 18 : t > 1680 ? ((1800 - t) / 120) * 18 : 18;
    out.push({ t, depth: Math.max(0, depth), tempC });
  }
  return out;
}

/** Un'immersione **senza** temperatura nel riepilogo: è il caso che rompeva tutto. */
function senzaRiepilogo(tempC: number, over: Partial<Dive> = {}): Dive {
  const d = {
    id: 'x',
    startTime: '2026-08-21T10:15:00Z',
    durationS: 1800,
    maxDepth: 18,
    mode: 'oc',
    cylinders: [],
    samples: campioni(tempC),
    ...over,
  } as unknown as Dive;
  return { ...d, metrics: computeMetrics(d) };
}

describe('la temperatura si prende da dove c’è', () => {
  it('un’immersione senza riepilogo la trova sul profilo', () => {
    const d = senzaRiepilogo(30);
    expect(d.minTempC).toBeUndefined();
    expect(temperaturaMinimaC(d)).toBe(30);
  });

  /*
   * ► E IL DICHIARATO VINCE SUL CALCOLATO, in un caso che capita davvero. ◄
   *
   * Non è deferenza verso il computer: quel numero l'apparecchio l'ha calcolato
   * su tutti i suoi campionamenti interni, non sui pochi che ha salvato nel
   * file. Ma il caso che rende l'ordine **verificabile** è un altro, ed è
   * quotidiano: **si scrive la temperatura a mano** nella scheda, e le metriche
   * non sono ancora state ricalcolate. In quell'istante `metrics.minTempC` porta
   * ancora il minimo dei campioni e `minTempC` porta quello che hai appena
   * scritto tu.
   *
   * *Invertendo l'ordine questa prova diventa rossa, ed è l'unico modo di
   * accorgersi che l'ordine è stato invertito: quando i due valori coincidono —
   * cioè quasi sempre — nessuna prova li distingue.*
   */
  it('quello scritto a mano vince su quello vecchio nelle metriche', () => {
    const conProfilo = senzaRiepilogo(30);
    expect(conProfilo.metrics?.minTempC).toBe(30);
    // La correzione a mano arriva dopo, e le metriche sono ancora quelle di prima.
    const corretta = { ...conProfilo, minTempC: 28.5 };
    expect(temperaturaMinimaC(corretta)).toBe(28.5);
  });

  it('senza né riepilogo né profilo resta ignota, e non si inventa', () => {
    const d = {
      id: 'y',
      startTime: '2026-08-21T10:15:00Z',
      durationS: 1800,
      maxDepth: 18,
      mode: 'oc',
      cylinders: [],
    } as unknown as Dive;
    expect(temperaturaMinimaC(d)).toBeUndefined();
  });

  /*
   * ► LA CONSEGUENZA INVISIBILE NUMERO UNO: il freddo che non contava. ◄
   * `coldDives` guarda `<= 14 °C`. Con il solo campo dichiarato, un'immersione
   * a otto gradi importata da un formato senza riepilogo passava per temperata.
   */
  it('un’immersione fredda senza riepilogo viene contata fredda', () => {
    const fredda = senzaRiepilogo(8);
    expect(aggregate([fredda]).coldDives).toBe(1);
  });

  /*
   * ► E LA NUMERO DUE, che è la peggiore: il dato che si perde riesportando. ◄
   * Un'immersione importata, riesportata in UDDF, usciva senza
   * `<lowesttemperature>` — cioè l'archivio perdeva un dato che aveva.
   */
  it('l’esportazione UDDF non perde più la temperatura', () => {
    const xml = exportUddf([senzaRiepilogo(30)]).xml;
    expect(xml).toContain('<lowesttemperature>');
    // 30 °C in kelvin: il formato UDDF vuole i kelvin, ed è già così per il
    // campo dichiarato — qui si verifica che il valore ricavato faccia la
    // stessa strada, conversione compresa.
    expect(xml).toMatch(/<lowesttemperature>303\.1[0-9]?/);
  });

  it('il PDF del libretto la stampa invece di un trattino', () => {
    const d = senzaRiepilogo(30);
    const pdf = schedePdf([d], new Map([[d.id, d.samples!]]), {});
    expect(pdf).toContain('30.0 \\260C');
  });
});
