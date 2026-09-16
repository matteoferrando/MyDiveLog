// @vitest-environment jsdom
/**
 * I DUE DISEGNI CHE DAVANO PER SCONTATO L'ORDINE DEL FILE.
 *
 * ► COS'È SUCCESSO. ◄ Il 15 settembre 2026 `runProfile` ha imparato a ordinare
 * i campioni: nessuno garantisce che arrivino in ordine di tempo — `uddf.ts`
 * legge i `<waypoint>` come stanno scritti, un orologio che salta indietro a
 * metà immersione produce `t` decrescenti, un lettore può consegnare la
 * risalita prima del fondo — e col blocco di risalita scritto per primo il
 * motore dichiarava 60.7 minuti di obbligo su un'immersione di 34.3.
 *
 * I DISEGNI erano rimasti fuori. Misurato il 16 settembre:
 *
 *   - `diveProfileSvg`, il profilo stampato sul libretto che qualcuno
 *     controfirma, prendeva l'istante iniziale da `punti[0].t`, cioè dal primo
 *     campione DEL FILE: su 31 punti, **quindici finivano fuori dal riquadro**
 *     con ascisse negative, e quello che restava dentro era un disegno
 *     plausibile e falso;
 *   - `DepthProfile` prendeva la durata da `samples[samples.length - 1].t` e
 *     dava per scontato che il primo istante fosse zero.
 *
 * *Un disegno sbagliato è peggio di un disegno assente: il posto dove manca si
 * vede, il posto dove mente no.*
 *
 * ► COME SI MISURA UN DISEGNO. ◄ Contando i punti fuori dal riquadro, e
 * chiedendo che il disegno dei campioni mescolati sia **lo stesso** di quello
 * dei campioni in ordine. La seconda è la domanda che conta: un disegno che
 * cambia a seconda di come il file era scritto non descrive l'immersione.
 */

import { describe, expect, it, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { diveProfileSvg } from '../src/core/export/logbookPrint';
import { DepthProfile, riassuntoProfilo } from '../src/ui/components/DepthProfile';
import { inOrdineDiTempo } from '../src/core/campioni';
import { AIR, type Dive, type Sample } from '../src/core/model';

/** Un profilo quadro a 30 m: discesa, fondo, risalita. In ordine. */
const IN_ORDINE: Sample[] = Array.from({ length: 31 }, (_, i) => {
  const t = i * 60;
  return { t, depth: t < 180 ? (t / 180) * 30 : t < 1500 ? 30 : Math.max(0, 30 - (t - 1500) / 20) };
});

/**
 * Gli stessi campioni con il blocco di risalita scritto per primo.
 *
 * Non è un caso inventato: è l'ordine che un lettore produce quando consegna i
 * blocchi nell'ordine del documento invece che nell'ordine del tempo, ed è
 * esattamente quello su cui `runProfile` misurava 60.7 minuti di obbligo.
 */
const MESCOLATI: Sample[] = [...IN_ORDINE.slice(25), ...IN_ORDINE.slice(0, 25)];

const immersione = (samples: Sample[]): Dive => ({
  id: 'x',
  startTime: '2026-06-14T10:38:00.000Z',
  durationS: 1800,
  maxDepth: 30,
  mode: 'oc',
  salinity: 'salt',
  cylinders: [{ mix: AIR, sizeL: 12, startBar: 200, endBar: 80 }],
  source: { format: 'uddf', file: 'test', importedAt: '2026-06-14T12:00:00.000Z' },
  tags: [],
  samples,
});

describe('la regola dell’ordine', () => {
  it('rimette in ordine e non tocca l’originale', () => {
    const copia = [...MESCOLATI];
    const ordinati = inOrdineDiTempo(MESCOLATI);
    expect(ordinati.map((s) => s.t)).toEqual(IN_ORDINE.map((s) => s.t));
    expect(MESCOLATI).toEqual(copia);
  });

  it('butta i campioni non numerici invece di disegnarli', () => {
    const sporchi = [...IN_ORDINE, { t: Number.NaN, depth: 5 }, { t: 100, depth: Number.NaN }];
    expect(inOrdineDiTempo(sporchi)).toHaveLength(IN_ORDINE.length);
  });
});

describe('il profilo stampato sul libretto', () => {
  /** Le ascisse dei punti del tracciato, lette dall'attributo `points`/`d`. */
  const ascisse = (svg: string): number[] => {
    const coppie = svg.match(/[-\d.]+,[-\d.]+/g) ?? [];
    return coppie.map((c) => Number(c.split(',')[0]));
  };

  it('il disegno in ordine sta tutto dentro il riquadro', () => {
    // Se questa cade, il conteggio qui sotto confronta con un riferimento rotto.
    const fuori = ascisse(diveProfileSvg(IN_ORDINE)).filter((x) => x < 0 || x > 660);
    expect(fuori).toHaveLength(0);
  });

  it('e quello dei campioni mescolati è lo stesso disegno', () => {
    // ► IL CUORE. ◄ Prima della correzione, quindici punti su trentuno
    // uscivano dal riquadro con ascisse negative.
    expect(diveProfileSvg(MESCOLATI)).toBe(diveProfileSvg(IN_ORDINE));
    expect(ascisse(diveProfileSvg(MESCOLATI)).filter((x) => x < 0)).toHaveLength(0);
  });

  it('un profilo che non comincia da zero parte comunque dal bordo sinistro', () => {
    // I lettori che tengono il tempo assoluto esistono: il primo istante è
    // l'origine, non lo zero.
    const spostati = IN_ORDINE.map((s) => ({ ...s, t: s.t + 7200 }));
    expect(diveProfileSvg(spostati)).toBe(diveProfileSvg(IN_ORDINE));
  });
});

let root: Root | undefined;
let host: HTMLDivElement | undefined;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
});

function tracciato(samples: Sample[]): string {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(<DepthProfile dive={immersione(samples)} />);
  });
  const path = host.querySelector('path[d]');
  if (!path) throw new Error('il profilo non è stato disegnato');
  return path.getAttribute('d') ?? '';
}

describe('il profilo a schermo', () => {
  it('disegna la stessa curva comunque fossero scritti i campioni', () => {
    const atteso = tracciato(IN_ORDINE);
    expect(atteso).toContain('M');
    act(() => root?.unmount());
    host?.remove();
    expect(tracciato(MESCOLATI)).toBe(atteso);
  });

  it('e la frase che legge lo screen reader descrive lo stesso grafico', () => {
    // Una durata negativa e un «dal minuto 25 al minuto 3» erano il risultato
    // di prima, letti ad alta voce a chi il grafico non lo vede.
    expect(riassuntoProfilo(immersione(MESCOLATI))).toBe(riassuntoProfilo(immersione(IN_ORDINE)));
    expect(riassuntoProfilo(immersione(IN_ORDINE))).toContain('30 minuti');
  });
});
