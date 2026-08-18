// @vitest-environment jsdom
/**
 * Resa dei componenti che disegnano un'immersione.
 *
 * Questo file nasce da un bug che nessun test unitario poteva prendere e che ha
 * rotto l'app in mano all'utente: un `useMemo` messo DOPO un return anticipato.
 * React conta gli hook a ogni render, e la scheda di un'immersione fa due render —
 * prima senza profilo (non è ancora stato caricato) e poi con il profilo. Il
 * conteggio passava da 2 a 3 hook e il componente cadeva: nessuna scheda si apriva
 * più.
 *
 * Il test riproduce esattamente quella sequenza: render senza campioni, poi con i
 * campioni, sullo stesso componente. È la forma minima di verifica che un test dei
 * tipi non può dare.
 */

import { describe, expect, it } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { DepthProfile, MiniSeries } from '../src/ui/components/DepthProfile';
import { CurveChart } from '../src/ui/components/Charts';
import { planGas, DEFAULT_PLAN } from '../src/core/analysis/gasPlan';
import { computeMetrics } from '../src/core/analysis/metrics';
import type { Dive, Sample } from '../src/core/model';

function profile(n: number): Sample[] {
  return Array.from({ length: n }, (_, i) => ({
    t: i * 10,
    depth: Math.max(0, 25 - Math.abs(n / 2 - i) * 0.4),
    tempC: 18 + (i % 3),
    ndlS: 600,
  }));
}

function dive(samples?: Sample[]): Dive {
  const base: Dive = {
    id: 'render-test-1',
    startTime: '2026-06-14T10:38:00+02:00',
    durationS: 2400,
    maxDepth: 25,
    mode: 'oc',
    cylinders: [{ mix: { o2: 0.21, he: 0 }, sizeL: 12, startBar: 200, endBar: 60 }],
    source: { format: 'logtrak', file: 'a.logtrak', importedAt: '2026-06-14T20:00:00Z' },
    tags: [],
    samples,
  };
  return { ...base, metrics: computeMetrics(base) };
}

/** Monta un componente in un DOM finto e restituisce il contenitore. */
function mount(node: React.ReactNode) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(node));
  return {
    host,
    update: (next: React.ReactNode) => act(() => root.render(next)),
    unmount: () => act(() => root.unmount()),
  };
}

describe('profilo di profondità', () => {
  it('regge il passaggio da immersione senza profilo a immersione con profilo', () => {
    // La sequenza esatta della scheda: i campioni arrivano dopo il primo render.
    const view = mount(<DepthProfile dive={dive()} />);
    expect(view.host.textContent).toMatch(/non ha un profilo campionato/);
    expect(() => view.update(<DepthProfile dive={dive(profile(240))} />)).not.toThrow();
    expect(view.host.querySelector('svg')).not.toBeNull();
    // E anche il ritorno all'indietro, che è l'altra metà dello stesso errore.
    expect(() => view.update(<DepthProfile dive={dive()} />)).not.toThrow();
    view.unmount();
  });

  it('disegna la curva della profondità e gli assi', () => {
    const view = mount(<DepthProfile dive={dive(profile(120))} />);
    const paths = view.host.querySelectorAll('path');
    expect(paths.length).toBeGreaterThan(1);
    expect(view.host.textContent).toContain('sosta di sicurezza');
    view.unmount();
  });

  it('mostra i segnalibri quando ci sono', () => {
    const d = { ...dive(profile(120)), events: [{ t: 300, bearing: 275 }] };
    const view = mount(<DepthProfile dive={d} />);
    expect(view.host.textContent).toContain('Segnalibri');
    view.unmount();
  });
});

describe('serie secondaria', () => {
  it('non disegna niente quando la misura non c’è', () => {
    const view = mount(<MiniSeries samples={profile(50)} pick={() => undefined} label="Assente" unit="x" />);
    expect(view.host.querySelector('svg')).toBeNull();
    view.unmount();
  });

  it('riceve l’indice del campione, per non cercarlo nell’array', () => {
    const seen: number[] = [];
    const view = mount(
      <MiniSeries
        samples={profile(10)}
        pick={(_s, i) => {
          seen.push(i);
          return i;
        }}
        label="Indice"
        unit="n"
      />,
    );
    // Il componente può renderizzare più di una volta (la misura della larghezza
    // aggiorna lo stato): conta quali indici sono stati visti, non quante volte.
    expect([...new Set(seen)].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    view.unmount();
  });
});

describe('curva del pianificatore', () => {
  /**
   * Il pianificatore ridisegna la curva a ogni tasto premuto nel modulo: il
   * componente passa da due punti a cinquanta e viceversa nella vita di un solo
   * nodo. È la stessa sequenza che aveva rotto la scheda immersione.
   */
  const curve = (n: number) =>
    Array.from({ length: n }, (_, i) => {
      const plan = planGas({ ...DEFAULT_PLAN, rmvLpm: 18, depthM: 10 + i * 2 });
      return { x: 10 + i * 2, y: plan.gasLimitedBottomMin };
    });

  it('regge il cambio di numero di punti senza cadere', () => {
    const view = mount(<CurveChart points={curve(1)} xLabel="m" yLabel="min" />);
    // Con un punto solo non c'è curva: lo dice invece di disegnare una riga.
    expect(view.host.textContent).toMatch(/insufficienti/);
    expect(() =>
      view.update(<CurveChart points={curve(26)} xLabel="m" yLabel="min" marker={30} />),
    ).not.toThrow();
    expect(view.host.querySelector('svg')).not.toBeNull();
    expect(() => view.update(<CurveChart points={curve(1)} xLabel="m" yLabel="min" />)).not.toThrow();
    view.unmount();
  });

  it('marca il punto pianificato e la riga di riferimento', () => {
    const view = mount(
      <CurveChart
        points={curve(26)}
        xLabel="m"
        yLabel="min"
        marker={30}
        markerLabel="qui"
        reference={20}
        referenceLabel="pianificati"
      />,
    );
    expect(view.host.textContent).toMatch(/qui/);
    expect(view.host.textContent).toMatch(/pianificati/);
    view.unmount();
  });
});
