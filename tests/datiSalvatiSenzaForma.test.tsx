// @vitest-environment jsdom
/**
 * QUELLO CHE SI RILEGGE DALL'ARCHIVIO SI GUARDA IN FACCIA PRIMA DI USARLO.
 *
 * ► I DUE DIFETTI, trovati il 21 settembre 2026 col giro su
 * `noUncheckedIndexedAccess` e lasciati aperti una notte. ◄ Tutti e due hanno
 * la stessa forma: un dato salvato — da un backup, da un'altra versione,
 * dall'altro dispositivo — che l'interfaccia usava così com'era, mentre il
 * nucleo lo stesso dato lo controllava già.
 *
 *   - **I tessuti di fine immersione.** `tissues.ts` li scarta se non sono
 *     sedici compartimenti di numeri veri (`usableTissues`), ma il grafico
 *     della saturazione e l'elenco delle immersioni da cui ripartire nel
 *     pianificatore li prendevano come venivano. Misurato con uno stato
 *     troncato a otto: il grafico mostrava 0% sui compartimenti 9–16, dove i
 *     valori veri erano 56.6, 39.2, 23.7 e 8.2 — e un pianificatore che parte
 *     da compartimenti mancanti li conta vuoti, cioè sottostima il carico di
 *     una ripetitiva. È l'errore dalla parte sbagliata.
 *   - **Lo stato del pianificatore.** Si rilegge senza nessun controllo di
 *     forma. Misurato prima di correggere: con un elenco di livelli vuoto la
 *     pagina disegnava un piano senza livelli — zero minuti, «il piano resta in
 *     curva» — e con dentro qualcosa che non è un livello cadeva al primo
 *     disegno («Cannot destructure property 'setpointBar' of null»). Con un
 *     elenco di gas vuoto, un piano senza miscele.
 */

import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';

import { AIR, type Dive } from '../src/core/model';
import { DecoPlanner, type DecoPlanState, type DecoSeed } from '../src/ui/components/DecoPlan';
import { SaturationCard } from '../src/ui/components/Saturation';

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

/** Sedici compartimenti saturi d'aria in superficie: uno stato vero. */
const SEDICI = { n2: Array.from({ length: 16 }, () => 0.745), he: Array.from({ length: 16 }, () => 0) };
/** Lo stesso, troncato a otto: quello che un backup rovinato può riportare. */
const OTTO = { n2: SEDICI.n2.slice(0, 8), he: SEDICI.he.slice(0, 8) };

const immersione = (id: string, sito: string, tessuti: { n2: number[]; he: number[] }): Dive =>
  ({
    id,
    startTime: id === 'buona' ? '2026-06-14T10:38:00.000Z' : '2026-06-15T10:38:00.000Z',
    durationS: 2400,
    maxDepth: 30,
    mode: 'oc',
    salinity: 'salt',
    cylinders: [{ mix: AIR, sizeL: 12, startBar: 200, endBar: 80 }],
    source: { format: 'uddf', file: 'test', importedAt: '2026-06-15T12:00:00.000Z' },
    tags: [],
    site: { name: sito },
    metrics: { gf99Pct: 60, gf99MaxPct: 62, leadingCompartment: 5, tissuesEnd: tessuti },
  }) as unknown as Dive;

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

const TITOLO_COMPARTIMENTI = 'I sedici compartimenti all’uscita';

describe('i tessuti salvati si usano solo se sono tessuti', () => {
  it('il grafico dei compartimenti c’è con sedici compartimenti veri', () => {
    const buona = immersione('buona', 'Punta del Faro', SEDICI);
    const { host, smonta } = monta(<SaturationCard dive={buona} dives={[buona]} />);
    // Il riferimento: se questa cade, la prova sotto non guarda niente.
    expect(host.textContent).toContain(TITOLO_COMPARTIMENTI);
    smonta();
  });

  it('e non c’è con uno stato troncato, invece di disegnare zeri inventati', () => {
    const rotta = immersione('rotta', 'Moregallo', OTTO);
    const { host, smonta } = monta(<SaturationCard dive={rotta} dives={[rotta]} />);
    expect(host.textContent).not.toContain(TITOLO_COMPARTIMENTI);
    smonta();
  });

  it('il pianificatore non offre di ripartire da tessuti troncati', () => {
    const dives = [immersione('buona', 'Punta del Faro', SEDICI), immersione('rotta', 'Moregallo', OTTO)];
    const { host, smonta } = monta(<DecoPlanner seed={SEME} dives={dives} />);
    const voci = [...host.querySelectorAll('option')].map((o) => o.textContent ?? '');
    expect(voci.some((v) => v.includes('Punta del Faro'))).toBe(true);
    expect(voci.some((v) => v.includes('Moregallo'))).toBe(false);
    smonta();
  });
});

describe('lo stato salvato del pianificatore si rilegge con un controllo di forma', () => {
  it('un elenco di livelli vuoto torna al livello di partenza, invece di un piano senza livelli', () => {
    const salvato = { levels: [] } as unknown as DecoPlanState;
    const { host, smonta } = monta(<DecoPlanner seed={SEME} saved={salvato} />);
    // Il livello di partenza è quello del seme: trenta metri.
    const campi = [...host.querySelectorAll('input')].map((i) => i.value);
    expect(campi).toContain('30');
    smonta();
  });

  it('e dei livelli che non sono livelli non fanno cadere la pagina', () => {
    const salvato = { levels: [{ profondita: 30 }, null] } as unknown as DecoPlanState;
    expect(() => monta(<DecoPlanner seed={SEME} saved={salvato} />).smonta()).not.toThrow();
  });

  it('un elenco di gas vuoto torna ai gas di partenza', () => {
    const salvato = { gases: [] } as unknown as DecoPlanState;
    const { host, smonta } = monta(<DecoPlanner seed={SEME} saved={salvato} />);
    expect(host.textContent).toContain('EAN50');
    smonta();
  });
});
