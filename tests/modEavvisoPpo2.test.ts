/**
 * La MOD arrotondata in su, e l'avviso che la contraddiceva.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ► IL DIFETTO CHE QUESTO FILE HA PRESO. ◄
 *
 * `switchDepthOf` arrotonda la MOD **al metro, anche in su**, di proposito: con
 * l'ossigeno puro la MOD sta a 5,8 m e troncando in giù la sosta dei sei metri
 * resterebbe senza il gas che tutti ci respirano. Il commento lo dice e lo
 * difende — «il mezzo metro vale 1,61 bar invece di 1,60, che è la tolleranza
 * con cui le tabelle sono scritte».
 *
 * L'avviso sulla PPO2 in fase di lavoro concedeva però **0,001 bar**: cinquanta
 * volte meno dell'arrotondamento che avrebbe dovuto assorbire. Risultato,
 * riprodotto chiamando `planDeco`: **un piano EAN35 a 30 metri** — il piano
 * nitrox più banale che esista — riceveva «a questa quota non hai una miscela
 * respirabile», mentre era l'app stessa ad aver messo la quota di cambio
 * dell'EAN35 a 30 metri.
 *
 * *Un avviso di sicurezza falso su un piano corrente è peggio di nessun avviso:
 * insegna a saltarli tutti, compresi quelli veri.* Il ramo della
 * decompressione, tre righe sopra, la tolleranza di 0,05 ce l'aveva già.
 *
 * ► E LA METÀ CHE CONTA DAVVERO: L'AVVISO VERO DEVE RESTARE. ◄ Le prove qui
 * sotto sono due, e la seconda è quella che impedisce di «risolvere» il falso
 * positivo spegnendo l'avviso.
 */

import { describe, expect, it } from 'vitest';
import { planDeco, switchDepthOf } from '../src/core/analysis/deco';
import { DEFAULT_PLAN, planGas } from '../src/core/analysis/gasPlan';
import type { PlanGas } from '../src/core/analysis/deco';

const IMPOSTAZIONI = {
  gfLow: 40,
  gfHigh: 85,
  ascentRateMpm: 9,
  descentRateMpm: 18,
  lastStopM: 3,
  stopIntervalM: 3,
  salinity: 'salt' as const,
  surfacePressureBar: 1.013,
  maxPpo2Work: 1.4,
  maxPpo2Deco: 1.6,
  rmvLpm: 18,
  decoRmvLpm: 15,
  switchMin: 1,
  safetyStop: { depthM: 5, minutes: 3 },
};

function gasDa(o2: number): PlanGas {
  return { mix: { o2, he: 0 }, role: 'bottom', tankL: 12, startBar: 200 } as PlanGas;
}

/** Gli avvisi che nominano la PPO2 in fase di lavoro. */
function avvisiPpo2Lavoro(o2: number, quotaM: number): string[] {
  const res = planDeco([{ depthM: quotaM, minutes: 20 }] as never, [gasDa(o2)], IMPOSTAZIONI);
  return res.warnings.filter((w) => w.text.includes('in fase di lavoro')).map((w) => w.text);
}

describe('la MOD arrotondata e l’avviso sulla PPO2', () => {
  /*
   * Le tre miscele ricreative in cui l'arrotondamento morde: la MOD vera cade
   * appena sotto il metro tondo, e l'app stessa autorizza il gas fino a quel
   * metro tondo. Pianificare lì non è un errore del subacqueo: è la quota che
   * l'app gli ha appena scritto.
   */
  it.each([
    [0.35, 30],
    [0.4, 25],
    [0.32, 33],
  ])(
    'una miscela al %s pianificata alla sua quota di cambio (%s m) non fa scattare nessun avviso',
    (o2, quotaM) => {
      // La premessa della prova: è davvero l'app a mettere il cambio a quella quota.
      expect(switchDepthOf(gasDa(o2), IMPOSTAZIONI as never)).toBe(quotaM);
      expect(avvisiPpo2Lavoro(o2, quotaM)).toEqual([]);
    },
  );

  /*
   * ► E QUI L'AVVISO DEVE ESSERCI. ◄ Due metri oltre la MOD non sono un
   * arrotondamento, sono un piano sbagliato: 1,49 bar contro 1,4. Senza questa
   * prova, allargare la tolleranza fino a spegnere l'avviso passerebbe verde.
   */
  it.each([
    [0.35, 32],
    [0.4, 28],
    [0.21, 60],
  ])('una miscela al %s pianificata a %s m, oltre la sua MOD, avvisa', (o2, quotaM) => {
    expect(avvisiPpo2Lavoro(o2, quotaM)).toHaveLength(1);
  });
});

/*
 * ════════════════════════════════════════════════════════════════════════════
 * LO STESSO GUASTO NEL PIANIFICATORE DEL GAS, che è un file diverso e una
 * frase diversa ma la stessa forma: **il confronto usava la MOD piena, la
 * frase mostrava quella arrotondata.** Con l'EAN32 a 1,4 bar la MOD è 33,28 m,
 * la scheda scrive 33,3 — e chi pianificava a 33,3 leggeva «A 33.3 m superi il
 * limite: la profondità massima operativa è 33.3 m».
 */
describe('la MOD mostrata e l’avviso del pianificatore del gas', () => {
  const base = {
    ...DEFAULT_PLAN,
    depthM: 33.3,
    mix: { o2: 0.32, he: 0 },
    rmvLpm: 18,
  };

  it('pianificare alla MOD mostrata non fa scattare l’avviso che la nomina', () => {
    const piano = planGas(base as never);
    expect(piano.modM).toBe(33.3);
    expect(piano.warnings.filter((w) => w.text.includes('profondità massima operativa'))).toEqual([]);
  });

  it('ma un metro più giù sì', () => {
    const piano = planGas({ ...base, depthM: 34.3 } as never);
    expect(piano.warnings.filter((w) => w.text.includes('profondità massima operativa'))).toHaveLength(1);
  });
});
