// @vitest-environment jsdom
/**
 * LA SCHEDA DELL'IMMERSIONE, SU UN FILE SCRITTO FUORI ORDINE.
 *
 * ► COS'È SUCCESSO. ◄ `disegniFuoriOrdine.test.tsx` ha insegnato l'ordine del
 * tempo al profilo stampato e al profilo a schermo. Due disegni della scheda
 * erano rimasti fuori, e li ha trovati il 21 settembre 2026 il giro con
 * `noUncheckedIndexedAccess`, leggendo chi indicizzava cosa:
 *
 *   - **la velocità verticale**: `windowedRates` restituisce un valore per
 *     campione NELL'ORDINE IN CUI LO RICEVE, e la scheda gli passava i campioni
 *     come stanno nel file; `MiniSeries` invece chiede il valore `i` del
 *     campione `i` in ordine di tempo. Col blocco di risalita scritto per
 *     primo, 88 punti su 91 mostravano la velocità di un altro istante;
 *   - **la linea della decompressione**: `decoTimeline` integrava i tessuti da
 *     un campione al successivo del file, cioè anche all'indietro nel tempo, con
 *     intervalli negativi.
 *
 * ► COME SI MISURA. ◄ Come nell'altra prova: il disegno dei campioni mescolati
 * deve essere LO STESSO di quello dei campioni in ordine. Un disegno che cambia a
 * seconda di come era scritto il file non descrive l'immersione.
 */

import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

import { decoTimeline } from '../src/core/analysis/tissues';
import { AIR, type Dive, type Sample } from '../src/core/model';

const finto = vi.hoisted(() => ({ valore: {} as Record<string, unknown> }));
vi.mock('../src/ui/state', () => ({ useDiveLog: () => finto.valore }));

import { DiveDetail } from '../src/ui/pages/DiveDetail';

/** Un profilo quadro a 30 m, un campione ogni venti secondi: discesa, fondo, risalita. */
const IN_ORDINE: Sample[] = Array.from({ length: 91 }, (_, i) => {
  const t = i * 20;
  return { t, depth: t < 180 ? (t / 180) * 30 : t < 1500 ? 30 : Math.max(0, 30 - (t - 1500) / 10) };
});

/** Gli stessi campioni con il blocco di risalita scritto per primo. */
const MESCOLATI: Sample[] = [...IN_ORDINE.slice(75), ...IN_ORDINE.slice(0, 75)];

const immersione = (samples?: Sample[]): Dive => ({
  id: 'x',
  startTime: '2026-06-14T10:38:00.000Z',
  durationS: 1800,
  maxDepth: 30,
  mode: 'oc',
  salinity: 'salt',
  cylinders: [{ mix: AIR, sizeL: 12, startBar: 200, endBar: 80 }],
  source: { format: 'uddf', file: 'test', importedAt: '2026-06-14T12:00:00.000Z' },
  tags: [],
  ...(samples ? { samples } : {}),
});

function monta(nodo: ReactNode) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(nodo));
  return { host, smonta: () => act(() => root.unmount()) };
}

/** I tracciati del grafico con quell'unità, dalla scheda montata con quei campioni. */
async function tracciato(samples: Sample[], unita: string): Promise<string> {
  finto.valore = {
    dives: [immersione()],
    loadProfiles: async () => ({ samples, altSamples: undefined }),
    saveDive: async () => {},
    removeDive: async () => {},
    gear: { equipment: [], sets: [] },
    saveGear: async () => {},
    subacqueo: {},
    numeri: new Map([['x', 1]]),
  };
  const { host, smonta } = monta(<DiveDetail id="x" onBack={() => {}} />);
  await act(async () => {});
  const grafico = [...host.querySelectorAll('svg[role="img"]')].find((s) =>
    (s.getAttribute('aria-label') ?? '').endsWith(`(${unita})`),
  );
  const d = [...(grafico?.querySelectorAll('path, polyline') ?? [])]
    .map((p) => p.getAttribute('d') ?? p.getAttribute('points') ?? '')
    .join(' | ');
  smonta();
  return d;
}

describe('la scheda di un’immersione scritta fuori ordine', () => {
  it('la velocità verticale disegnata è la stessa, comunque sia scritto il file', async () => {
    const inOrdine = await tracciato(IN_ORDINE, 'm/min');
    // Una guardia che non trova il grafico confronterebbe due stringhe vuote.
    expect(inOrdine.length, 'il grafico della velocità verticale non c’è').toBeGreaterThan(20);
    expect(await tracciato(MESCOLATI, 'm/min')).toBe(inOrdine);
  });

  it('la linea della decompressione è la stessa, e non integra all’indietro', () => {
    const inOrdine = decoTimeline(immersione(IN_ORDINE), IN_ORDINE);
    expect(inOrdine.length).toBeGreaterThan(10);
    expect(decoTimeline(immersione(MESCOLATI), MESCOLATI)).toEqual(inOrdine);
  });
});
