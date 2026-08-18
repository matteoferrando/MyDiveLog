/**
 * Decoder del log nativo Shearwater.
 *
 * Due livelli di verifica, e servono entrambi:
 *
 *  - qui, su log costruiti con valori SCELTI: è il solo modo di verificare i campi
 *    uno per uno. Sui log veri si può confrontare solo con i valori di sintesi che
 *    calcola l'applicazione di Shearwater, e quelli non cambierebbero se leggessi
 *    male il CNS o la PPO2.
 *  - `scripts/validate-pnf.ts` sui 38 log reali dell'archivio, dove profondità
 *    media e massima, temperatura minima e massima, durata e obbligo
 *    decompressivo coincidono con i valori di Shearwater Cloud su tutti e 38.
 */

import { describe, expect, it } from 'vitest';
import { decodePnf, decodePnfBlob, isPnfBlob } from '../src/core/parsers/shearwaterPnf';
import { encodePnf, packPnfBlob } from './fixtures';

describe('log nativo Shearwater', () => {
  it('legge le impostazioni del computer', () => {
    const log = decodePnf(
      encodePnf({ depths: [5, 15, 25, 15, 5], gfLow: 30, gfHigh: 70, waterDensity: 1000 }),
    );
    expect(log.settings.gfLow).toBe(30);
    expect(log.settings.gfHigh).toBe(70);
    expect(log.settings.decoModel).toContain('Bühlmann');
    expect(log.settings.waterDensity).toBe(1000);
    expect(log.settings.surfacePressureBar).toBeCloseTo(1.013, 3);
    expect(log.settings.sampleIntervalS).toBe(10);
    expect(log.settings.units).toBe('metric');
    expect(log.computer.model).toBe('Shearwater Peregrine');
    expect(log.computer.serial).toBe('988B023F');
    expect(log.computer.firmware).toBe('v89');
  });

  it('non presenta i gradient factor quando il modello non è Bühlmann', () => {
    // Con VPM-B quei byte contengono ancora qualcosa: mostrarlo come "GF
    // impostati" sarebbe un numero inventato con l'aria di essere letto.
    const log = decodePnf(encodePnf({ depths: [10, 20], decoModelCode: 1 }));
    expect(log.settings.decoModel).toBe('VPM-B');
    expect(log.settings.gfLow).toBeUndefined();
    expect(log.settings.gfHigh).toBeUndefined();
    expect(log.settings.conservatism).toBe(3);
  });

  it('ricostruisce il profilo con profondità, temperatura e tempo', () => {
    const depths = [5.8, 12.4, 22.1, 30.6, 18.2, 9, 5, 5, 0];
    const tempC = [24, 22, 20, 19, 19, 20, 21, 21, 24];
    const log = decodePnf(encodePnf({ depths, tempC, intervalS: 10 }));
    expect(log.samples).toHaveLength(depths.length);
    expect(log.samples.map((s) => s.depth)).toEqual(depths);
    expect(log.samples.map((s) => s.tempC)).toEqual(tempC);
    expect(log.samples.map((s) => s.t)).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90]);
    // Profondità massima e durata vengono dal blocco di chiusura, che il computer
    // scrive campionando al secondo: possono superare il massimo dei campioni.
    expect(log.maxDepth).toBeCloseTo(30.6, 5);
    expect(log.durationS).toBe(90);
  });

  it('rispetta un passo di campionamento diverso da 10 s', () => {
    const log = decodePnf(encodePnf({ depths: [10, 12, 14], intervalS: 2 }));
    expect(log.settings.sampleIntervalS).toBe(2);
    expect(log.samples.map((s) => s.t)).toEqual([2, 4, 6]);
  });

  it('distingue NDL e tappa di decompressione, che condividono un byte', () => {
    // È la trappola del formato: lo stesso byte porta i minuti di NDL quando non
    // c'è tetto e la durata della tappa quando c'è. Confonderli farebbe apparire
    // "6 minuti di deco" su un'immersione tutta in curva.
    const log = decodePnf(
      encodePnf({
        depths: [20, 40, 40, 12, 6, 6],
        ceilingM: [0, 0, 6, 6, 3, 0],
        minutes: [99, 12, 4, 3, 1, 25],
        ttsMin: [1, 3, 9, 6, 2, 1],
      }),
    );
    const s = log.samples;
    expect(s[0].ndlS).toBe(99 * 60);
    expect(s[0].ceiling).toBeUndefined();
    expect(s[0].inDeco).toBe(false);
    expect(s[1].ndlS).toBe(12 * 60);
    expect(s[2].inDeco).toBe(true);
    expect(s[2].ceiling).toBe(6);
    expect(s[2].stopTimeS).toBe(4 * 60);
    expect(s[2].ndlS).toBeUndefined();
    expect(s[2].ttsS).toBe(9 * 60);
    expect(s[4].ceiling).toBe(3);
    expect(s[5].inDeco).toBe(false);
    expect(s[5].ndlS).toBe(25 * 60);
  });

  it('legge il CNS e la miscela respirata', () => {
    const log = decodePnf(
      encodePnf({ depths: [30, 30, 30], cnsPct: [3, 7, 11], o2Percent: 32, hePercent: 0 }),
    );
    expect(log.samples.map((s) => s.cns)).toEqual([3, 7, 11]);
    expect(log.gases).toEqual([{ o2: 0.32, he: 0 }]);
    expect(log.samples.every((s) => s.gasIndex === 0)).toBe(true);
  });

  it('converte la pressione della bombola dalle unità da 2 psi', () => {
    const bar = [200, 150, 90];
    const log = decodePnf(encodePnf({ depths: [10, 20, 5], tank1Bar: bar }));
    const read = log.samples.map((s) => s.pressureBar?.[0]);
    read.forEach((v, i) => expect(v).toBeCloseTo(bar[i], 0));
    expect(log.tanks[0].startBar).toBeCloseTo(200, 0);
    expect(log.tanks[0].endBar).toBeCloseTo(90, 0);
  });

  it('ignora i codici di errore del trasmettitore invece di leggerli come pressione', () => {
    // 0xFFFF significa "integrazione spenta", non 28.000 bar.
    const log = decodePnf(encodePnf({ depths: [10, 20], tank1Bar: [] }));
    expect(log.samples.every((s) => s.pressureBar?.[0] === undefined)).toBe(true);
  });

  it('legge le coordinate solo con un fix valido', () => {
    const withFix = decodePnf(
      encodePnf({ depths: [10], entry: { lat: 44.36123, lon: 9.14567 }, logVersion: 17 }),
    );
    expect(withFix.entry?.lat).toBeCloseTo(44.36123, 5);
    expect(withFix.entry?.lon).toBeCloseTo(9.14567, 5);

    // Con una versione di log che non ha il campo, niente coordinate: leggerle
    // metterebbe l'immersione a zero gradi zero.
    const older = decodePnf(
      encodePnf({ depths: [10], entry: { lat: 44.36123, lon: 9.14567 }, logVersion: 14 }),
    );
    expect(older.entry).toBeUndefined();
  });

  it('legge un blob confezionato come lo salva Shearwater Cloud', () => {
    const raw = encodePnf({ depths: [5, 15, 25, 10], cnsPct: [1, 2, 3, 4] });
    const blob = packPnfBlob(raw);
    expect(isPnfBlob(blob)).toBe(true);
    const log = decodePnfBlob(blob);
    expect(log.samples).toHaveLength(4);
    expect(log.samples[2].depth).toBe(25);
  });

  it('rifiuta un blob troncato invece di restituire mezzo profilo', () => {
    const blob = packPnfBlob(encodePnf({ depths: Array.from({ length: 100 }, (_, i) => i / 4) }));
    expect(() => decodePnfBlob(blob.subarray(0, blob.length - 60))).toThrow();
  });

  it('rifiuta un log senza blocchi di apertura', () => {
    expect(() => decodePnf(new Uint8Array(64))).toThrow(/apertura/);
  });
});
