// @vitest-environment jsdom
/**
 * COL CIRCUITO CHIUSO, LA BOMBOLA DI BAILOUT SI PUÒ DICHIARARE.
 *
 * ► IL DIFETTO, visto il 22 settembre 2026. ◄ Il nucleo sa cos'è un gas di
 * bailout: lo tiene fuori dal piano sul loop, e quando ce n'è uno toglie il
 * diluente dalla risalita d'emergenza — il diluente sta in tre litri, e a
 * circuito aperto dura pochi minuti. La pagina invece non lo lasciava
 * scegliere: il menu del ruolo aveva fondo, transito e decompressione, mentre
 * il suggerimento sotto la casella del rebreather diceva che «i gas di bailout
 * non entrano nel piano ma nella risalita d'emergenza». Un invito che non si
 * può accettare. E senza quel ruolo il bailout respirava anche il diluente.
 */

import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';

import type { PlanGas } from '../src/core/analysis/deco';
import { AIR } from '../src/core/model';
import { DecoPlanner, type DecoPlanState, type DecoSeed } from '../src/ui/components/DecoPlan';

function monta(nodo: ReactNode) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(nodo));
  return {
    host,
    smonta: () => {
      act(() => root.unmount());
      host.remove();
    },
  };
}

const SEME: DecoSeed = {
  depthM: 30,
  bottomMin: 20,
  mix: AIR,
  tankL: 12,
  startBar: 200,
  rmvLpm: 18,
  salinity: 'salt',
  maxPpo2: 1.4,
};

const DILUENTE: PlanGas = { mix: { o2: 0.21, he: 0.35 }, role: 'bottom', tankL: 3, startBar: 200 };
const TRIMIX: PlanGas = { mix: { o2: 0.18, he: 0.45 }, role: 'deco', tankL: 11, startBar: 200 };
const EAN50: PlanGas = { mix: { o2: 0.5, he: 0 }, role: 'deco', tankL: 11, startBar: 200 };

const CHIUSO = {
  ccr: true,
  setpoint: 1.3,
  levels: [{ depthM: 60, minutes: 25 }],
  gases: [DILUENTE, TRIMIX, EAN50],
} as unknown as DecoPlanState;

const ruoloDi = (host: HTMLElement, gas: string) => {
  const menu = host.querySelector<HTMLSelectElement>(`select[aria-label="Ruolo di ${gas}"]`);
  if (!menu) throw new Error(`nessun menu del ruolo per ${gas}`);
  return menu;
};
const voci = (menu: HTMLSelectElement) => [...menu.options].filter((o) => !o.disabled).map((o) => o.value);

/** Le etichette dei riquadri «Ti serve …» della risalita d'emergenza. */
const tiServe = (host: HTMLElement) =>
  [...host.querySelectorAll('*')]
    .filter((el) => el.children.length === 0 && /^Ti serve /.test(el.textContent ?? ''))
    .map((el) => el.textContent ?? '');

describe('il ruolo «bailout» nel pianificatore', () => {
  it('a circuito aperto non si offre: non ci sarebbe nessuna risalita d’emergenza a usarlo', () => {
    const { host, smonta } = monta(<DecoPlanner seed={SEME} />);
    expect(voci(ruoloDi(host, 'EAN50'))).not.toContain('bailout');
    smonta();
  });

  it('col circuito chiuso si offre, tranne che al diluente', () => {
    const { host, smonta } = monta(<DecoPlanner seed={SEME} saved={CHIUSO} />);
    expect(voci(ruoloDi(host, 'Tx18/45'))).toContain('bailout');
    // Il primo gas è il diluente: dichiararlo bailout lascerebbe il loop senza.
    expect(voci(ruoloDi(host, 'Tx21/35'))).not.toContain('bailout');
    smonta();
  });

  it('scelto il bailout, la risalita d’emergenza respira quella bombola e non il diluente', () => {
    const { host, smonta } = monta(<DecoPlanner seed={SEME} saved={CHIUSO} />);
    // Prima: senza bombola di bailout, il diluente è tutto quello che c'è.
    expect(tiServe(host).join(' | ')).toContain('Tx21/35');

    const menu = ruoloDi(host, 'Tx18/45');
    act(() => {
      menu.value = 'bailout';
      menu.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const dopo = tiServe(host).join(' | ');
    expect(dopo).toContain('Ti serve Tx18/45');
    expect(dopo).not.toContain('Tx21/35');
    smonta();
  });

  it('e se il circuito si riapre, la bombola di bailout lo dice invece di sparire in silenzio', () => {
    const aperto = {
      ccr: false,
      gases: [
        { ...DILUENTE, mix: AIR, tankL: 12 },
        { ...TRIMIX, role: 'bailout' },
      ],
    };
    const { host, smonta } = monta(<DecoPlanner seed={SEME} saved={aperto as unknown as DecoPlanState} />);
    expect(host.textContent).toContain('Col circuito aperto il bailout non si usa');
    smonta();
  });
});
