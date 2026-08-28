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
import { decodePnf, decodePnfBlob, improntaPnf, isPnfBlob } from '../src/core/parsers/shearwaterPnf';
import { likelySame } from '../src/core/dedupe';
import type { Dive } from '../src/core/model';
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
    expect(log.computer.serial).toBe('A1B2C3D4');
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

/**
 * L'impronta del profilo per il log PNF.
 *
 * PERCHÉ SERVE QUI E NON SOLO PER Uwatec. Lo stesso tuffo arriva da due strade —
 * il blob dentro il database di Shearwater Cloud e lo scarico Bluetooth dal
 * computer — e le due NON concordano sull'istante. Il database porta l'epoch
 * vero più il fuso; il log nativo porta solo la lettura dell'orologio, cioè
 * l'ora a parete, e chi scarica ci mette sopra il fuso DEL TELEFONO alla data
 * dell'immersione (`fusoDelDispositivo` in `BleDownload.tsx`). Immersione fatta
 * a +5 e scaricata a casa a +2: tre ore di scarto, contro una finestra di
 * riconoscimento che per un'immersione di quaranta minuti è di venti.
 *
 * Senza impronta quel tuffo entra due volte, e a ogni scarico successivo di
 * nuovo. È lo stesso guasto già visto sui Uwatec (`tests/scheda.test.ts`), con
 * un'altra causa per lo scarto: lì la data corretta a mano, qui il fuso.
 */
describe('impronta del profilo del log PNF', () => {
  // Un profilo abbastanza lungo da avere un'impronta: sotto i sedici campioni
  // non se ne calcola apposta, e con nove non ci si arriva.
  const profilo = [3, 9, 16, 22, 27, 30, 31, 30, 28, 24, 19, 15, 11, 8, 6, 5, 5, 5, 3, 1];
  const cns = profilo.map((_, i) => i);
  const log = (over = {}) => encodePnf({ depths: profilo, cnsPct: cns, ...over });

  it('la calcola, e la calcola sempre uguale sugli stessi byte', () => {
    const raw = log();
    expect(decodePnf(raw).profileFingerprint).toBe(improntaPnf(raw));
    expect(decodePnf(raw).profileFingerprint).toBeTruthy();
    // Il log confezionato come lo salva Shearwater Cloud contiene gli stessi
    // byte: se le due strade non dessero la stessa impronta, l'impronta non
    // servirebbe a niente, perché è esattamente fra quelle due che deve
    // riconoscere la copia.
    expect(decodePnfBlob(packPnfBlob(raw)).profileFingerprint).toBe(decodePnf(raw).profileFingerprint);
  });

  it('guarda i campioni e non l’intestazione', () => {
    /*
     * SI CONFRONTA SOLO IL FLUSSO DEI CAMPIONI, e non è un dettaglio: è la
     * ragione per cui l'impronta riconosce la copia. I campioni sono la misura,
     * e quella non la riscrive nessuno. L'intestazione invece porta l'orologio,
     * che è proprio il campo su cui le due strade litigano, e il record finale
     * porta il seriale; agganciare l'impronta a quei byte significherebbe
     * cambiarla ogni volta che cambia il motivo per cui serve.
     */
    const a = improntaPnf(log({ startTimeS: 1_780_000_000, gfLow: 30, gfHigh: 70 }));
    const b = improntaPnf(log({ startTimeS: 1_760_000_000, gfLow: 45, gfHigh: 95 }));
    expect(a).toBeTruthy();
    expect(a).toBe(b);
  });

  it('cambia se cambia un solo campione', () => {
    // L'impronta vale solo in positivo, ma deve valere dove è vera: due profili
    // diversi devono restare due immersioni. Un falso positivo qui fonde due
    // immersioni in una e ne fa sparire una dall'archivio.
    const diverso = profilo.map((x, i) => (i === 7 ? x + 2 : x));
    expect(improntaPnf(log())).not.toBe(improntaPnf(encodePnf({ depths: diverso, cnsPct: cns })));
  });

  it('non la produce su un profilo troppo corto', () => {
    // Meglio nessuna impronta che un'impronta che collide: con pochi record di
    // campioni due immersioni brevi e simili possono avere gli stessi byte, e
    // l'impronta le fonderebbe senza appello.
    expect(improntaPnf(encodePnf({ depths: [4, 8, 12, 8, 4] }))).toBeUndefined();
    expect(decodePnf(encodePnf({ depths: [4, 8, 12, 8, 4] })).profileFingerprint).toBeUndefined();
  });

  it('riconosce la stessa immersione a tre ore di scarto', () => {
    const impronta = decodePnf(log()).profileFingerprint;
    const dive = (startTime: string): Dive =>
      ({
        id: startTime,
        startTime,
        durationS: 2400,
        maxDepth: 31,
        mode: 'oc',
        cylinders: [],
        source: { format: 'shearwater-cloud', file: '', importedAt: '' },
        tags: [],
        computer: { model: 'Shearwater Peregrine', profileFingerprint: impronta },
      }) as Dive;
    const daCloud = dive('2026-06-14T00:07:00.000Z');
    const daBluetooth = dive('2026-06-14T03:07:00.000Z');
    // Tre ore: la finestra di riconoscimento per un'immersione di quaranta
    // minuti è di venti, quindi senza impronta queste due sono due immersioni.
    expect(Date.parse(daBluetooth.startTime) - Date.parse(daCloud.startTime)).toBe(3 * 3600 * 1000);
    expect(likelySame(daCloud, daBluetooth)).toBe(true);
  });
});
