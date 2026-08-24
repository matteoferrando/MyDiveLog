/**
 * Formato Uwatec Smart e LogTRAK.
 *
 * Il decoder del bitstream Uwatec è il pezzo di codice che può sbagliare in
 * silenzio: un delta con segno letto male non solleva errori, produce un profilo
 * plausibile e falso. Questi test lo chiudono in due modi — un round-trip su
 * profili generati con valori scelti, e i controlli di coerenza interna che
 * valgono su qualunque file (byte consumati, campi dell'intestazione, unità).
 */

import {
  conSegno,
  preparaTabella,
  ALADIN,
  GALILEO,
  SMART_COM,
  SMART_PRO,
  SMART_TEC,
} from '../src/core/parsers/uwatecBitstream';
import { describe, expect, it } from 'vitest';
import {
  decodeUwatecSmart,
  hasUwatecMagic,
  splitUwatecRecords,
  trimSurface,
  UWATEC_MODELS,
} from '../src/core/parsers/uwatecSmart';
import { logtrakParser, normaliseSiteName, parseTankSize } from '../src/core/parsers/logtrak';
import { condizioniTesto, conditionsOf } from '../src/core/conditions';
import { detectParser, parseFile } from '../src/core/parsers';
import { depthSeries, encodeUwatecSmart, synthesise, toLogtrak, toUddf } from './fixtures';

const PROFILE = [0, 5, 12, 20, 26, 30, 31, 30.5, 31, 30, 29, 28, 20, 12, 6, 5, 5, 5, 3, 1, 0];
const TEMPS = [24, 23, 21, 19, 18, 17.6, 17.6, 17.6, 17.6, 17.6, 18, 18, 19, 21, 22, 22, 22, 22, 23, 24, 24];

const spec = {
  startTime: new Date('2026-07-11T08:59:40Z'),
  utcOffsetMinutes: 120,
  depths: PROFILE,
  temps: TEMPS,
  o2: 0.21,
  startBar: 240,
  endBar: 60,
};

describe('i delta col segno', () => {
  it('un numero oltre la metà dell’intervallo è negativo', () => {
    // 7 bit: 0x7F vale -1, non 127. È l'errore che scombina tutto il profilo da
    // lì in poi, senza dare nessun errore.
    expect(conSegno(0x7f, 7)).toBe(-1);
    expect(conSegno(0x40, 7)).toBe(-64);
    expect(conSegno(0x3f, 7)).toBe(63);
    expect(conSegno(0x0f, 4)).toBe(-1);
    expect(conSegno(0x08, 4)).toBe(-8);
    expect(conSegno(0x07, 4)).toBe(7);
  });

  it('con zero bit vale zero, non un segno letto a caso', () => {
    expect(conSegno(0xff, 0)).toBe(0);
    expect(conSegno(0, 0)).toBe(0);
  });

  it('regge anche sulle larghezze grandi del formato', () => {
    // Il record più largo è 8 bit di tipo più due byte: sedici bit di dato.
    expect(conSegno(0xffff, 16)).toBe(-1);
    expect(conSegno(0x8000, 16)).toBe(-32768);
    expect(conSegno(0x7fff, 16)).toBe(32767);
  });
});

describe('i disegni di bit', () => {
  /*
   * Le tabelle sono un codice a prefissi: nessun disegno può essere l'inizio di
   * un altro. Se lo fosse, il riconoscimento sceglierebbe sempre il più corto e
   * l'altro non verrebbe mai letto — e il sintomo non sarebbe un errore, sarebbe
   * un profilo sbagliato. `preparaTabella` lo verifica; qui si verifica che
   * verifichi.
   */
  it('tutte le famiglie sono codici leggibili', () => {
    for (const tabella of [GALILEO, SMART_PRO, ALADIN, SMART_COM, SMART_TEC]) {
      expect(() => preparaTabella(tabella)).not.toThrow();
    }
  });

  it('un disegno che è prefisso di un altro viene rifiutato', () => {
    expect(() =>
      preparaTabella([
        { disegno: '10dddddd', grandezza: 'profondita', assoluto: false, indice: 0, byteExtra: 0 },
        { disegno: '100ddddd', grandezza: 'rbt', assoluto: false, indice: 0, byteExtra: 0 },
      ]),
    ).toThrow(/prefisso/);
  });

  it('ogni record occupa un numero intero di byte', () => {
    // Il formato lo garantisce, e il decoder ci conta: se un disegno finisse a
    // metà byte, il record dopo comincerebbe disallineato.
    for (const tabella of [GALILEO, SMART_PRO, ALADIN, SMART_COM, SMART_TEC]) {
      for (const voce of tabella) {
        const bit = voce.disegno.length + voce.byteExtra * 8;
        expect(bit % 8, `${voce.disegno} + ${voce.byteExtra}`).toBe(0);
      }
    }
  });
});

describe('decodifica del blob Uwatec', () => {
  const bytes = encodeUwatecSmart(spec);

  it('riconosce la firma', () => {
    expect(hasUwatecMagic(bytes)).toBe(true);
    expect(hasUwatecMagic(new Uint8Array([1, 2, 3, 4]))).toBe(false);
  });

  it('consuma esattamente i byte dichiarati', () => {
    const d = decodeUwatecSmart(bytes, { model: 0x17 });
    // È il controllo che prende un disallineamento di un solo byte: se una
    // larghezza di record fosse sbagliata, qui i conti non tornerebbero.
    expect(d.bytesConsumed).toBe(d.bytesDeclared);
    expect(d.bytesDeclared).toBe(bytes.length);
    expect(d.warnings).toHaveLength(0);
  });

  it('ricostruisce il profilo di profondità', () => {
    const d = decodeUwatecSmart(bytes, { model: 0x17 });
    expect(d.samples).toHaveLength(PROFILE.length);
    d.samples.forEach((s, i) => {
      expect(s.depth, `campione ${i}`).toBeCloseTo(PROFILE[i], 1);
    });
    // Passo fisso di 4 secondi, non dichiarato nel formato.
    expect(d.intervalS).toBe(4);
    expect(d.samples[1].t - d.samples[0].t).toBe(4);
  });

  it('ricostruisce la temperatura', () => {
    const d = decodeUwatecSmart(bytes, { model: 0x17 });
    d.samples.forEach((s, i) => {
      // Il sensore quantizza a 0.4 °C: è la risoluzione del formato, non un errore.
      expect(s.tempC!, `campione ${i}`).toBeCloseTo(TEMPS[i], 0);
    });
  });

  it("legge i campi dell'intestazione nelle unità giuste", () => {
    const d = decodeUwatecSmart(bytes, { model: 0x17 });
    expect(d.maxDepth).toBeCloseTo(Math.max(...PROFILE), 1);
    // La durata è in minuti nell'intestazione, in secondi nel modello.
    expect(d.durationS).toBe(Math.round(((PROFILE.length - 1) * 4) / 60) * 60);
    expect(d.tempMinC).toBeCloseTo(Math.min(...TEMPS), 1);
    expect(d.tempMaxC).toBeCloseTo(Math.max(...TEMPS), 1);
    // Il tempo del dispositivo è in MEZZI secondi dal 2000-01-01.
    expect(new Date(d.startMs).toISOString()).toBe(spec.startTime.toISOString());
    expect(d.utcOffsetMinutes).toBe(120);
    expect(d.salinity).toBe('salt');
    expect(d.mode).toBe('oc');
  });

  it("la profondità media dell'intestazione coincide con la media dei campioni", () => {
    // libdivecomputer marca l'offset 24 come sconosciuto: questo test è la
    // verifica dell'inferenza, e vale anche come regressione se cambiasse.
    const d = decodeUwatecSmart(bytes, { model: 0x17 });
    let area = 0;
    for (let i = 1; i < d.samples.length; i++) {
      area += ((d.samples[i].depth! + d.samples[i - 1].depth!) / 2) * 4;
    }
    const mean = area / ((d.samples.length - 1) * 4);
    expect(d.avgDepth!).toBeCloseTo(mean, 0);
  });

  it('legge la miscela dal record MISC', () => {
    const d = decodeUwatecSmart(bytes, { model: 0x17 });
    expect(d.gasMixes).toHaveLength(1);
    expect(d.gasMixes[0].o2).toBeCloseTo(0.21, 2);
    expect(d.gasMixes[0].he).toBe(0);
    // Le pressioni del record MISC usano la scala /128 bar.
    expect(d.gasMixes[0].startBar!).toBeCloseTo(240, 0);
  });

  it("gestisce l'acqua dolce", () => {
    const fresh = encodeUwatecSmart({ ...spec, salt: false });
    const d = decodeUwatecSmart(fresh, { model: 0x17 });
    expect(d.salinity).toBe('fresh');
    expect(d.maxDepth).toBeCloseTo(Math.max(...PROFILE), 1);
  });

  it('rifiuta un blob senza firma', () => {
    expect(() => decodeUwatecSmart(new Uint8Array(200), { model: 0x17 })).toThrow(/Firma Uwatec/);
  });

  it("deduce la dimensione dell'intestazione se il modello è ignoto", () => {
    const d = decodeUwatecSmart(bytes);
    expect(d.samples.length).toBe(PROFILE.length);
    expect(d.warnings.join(' ')).toContain('84 byte');
  });

  it('separa più record concatenati', () => {
    const a = encodeUwatecSmart(spec);
    const b = encodeUwatecSmart({ ...spec, depths: PROFILE.map((x) => x / 2) });
    const joined = new Uint8Array(a.length + b.length);
    joined.set(a, 0);
    joined.set(b, a.length);
    const parts = splitUwatecRecords(joined);
    expect(parts).toHaveLength(2);
    expect(parts[0].length).toBe(a.length);
  });

  it('copre i modelli Scubapro moderni', () => {
    // Gli offset del layout "trimix" da 84 byte valgono per tutta la famiglia
    // G2/G3/Aladin Matrix: se uno sparisse dalla tabella, gli export di quel
    // computer verrebbero letti dall'offset sbagliato.
    for (const model of [0x17, 0x25, 0x28, 0x31, 0x32, 0x34, 0x50, 0x51]) {
      expect(UWATEC_MODELS[model], `modello 0x${model.toString(16)}`).toBeDefined();
      expect(UWATEC_MODELS[model].size).toBe(84);
    }
    // I Galileo usano 152 byte: confonderli è l'errore più facile del formato.
    for (const model of [0x11, 0x15, 0x19, 0x20, 0x22, 0x24, 0x26]) {
      expect(UWATEC_MODELS[model].size).toBe(152);
    }
  });
});

describe('ritaglio della superficie', () => {
  it('toglie i minuti passati a galla dopo la risalita', () => {
    // Il computer continua a registrare in superficie: su un'immersione vera ho
    // trovato 5 minuti di zeri in coda, che abbassavano la profondità media.
    const samples = [
      { t: 0, depth: 0 },
      { t: 4, depth: 0 },
      { t: 8, depth: 5 },
      { t: 12, depth: 20 },
      { t: 16, depth: 4 },
      { t: 20, depth: 0 },
      { t: 24, depth: 0 },
      { t: 28, depth: 0 },
    ];
    const trimmed = trimSurface(samples);
    expect(trimmed[0].t).toBe(4);
    expect(trimmed[trimmed.length - 1].t).toBe(20);
  });

  it('non tocca un profilo che non risale mai in superficie', () => {
    const samples = [
      { t: 0, depth: 10 },
      { t: 4, depth: 12 },
    ];
    expect(trimSurface(samples)).toHaveLength(2);
  });

  it('lascia intatto un profilo tutto in superficie invece di svuotarlo', () => {
    const samples = [
      { t: 0, depth: 0 },
      { t: 4, depth: 0.2 },
    ];
    expect(trimSurface(samples)).toHaveLength(2);
  });
});

describe('parser LogTRAK', () => {
  const text = toLogtrak([
    spec,
    { ...spec, startTime: new Date('2026-07-11T13:20:00Z'), depths: PROFILE.map((x) => x * 0.6) },
  ]);

  it('viene riconosciuto e non confuso con altri formati', () => {
    expect(detectParser({ fileName: 'export.logtrak', text })?.format).toBe('logtrak');
    // Un UDDF non deve finire nel parser LogTRAK e viceversa.
    const uddf = toUddf(synthesise());
    expect(detectParser({ fileName: 'a.xml', text: uddf })?.format).toBe('uddf');
    expect(logtrakParser.detect({ fileName: 'a.xml', text: uddf })).toBe(false);
  });

  it('importa immersioni complete', async () => {
    const { dives, warnings } = await parseFile({ fileName: 'export.logtrak', text });
    expect(dives).toHaveLength(2);
    expect(warnings.filter((w) => w.includes('illeggibile'))).toHaveLength(0);

    const d = dives[0];
    expect(d.maxDepth).toBeCloseTo(Math.max(...PROFILE), 1);
    expect(d.samples!.length).toBeGreaterThan(10);
    // Il volume della bombola viene dal JSON: è ciò che sblocca i L/min.
    expect(d.cylinders[0].sizeL).toBe(15);
    expect(d.cylinders[0].startBar).toBe(240);
    expect(d.cylinders[0].mix.o2).toBeCloseTo(0.21, 2);
    expect(d.metrics!.rmvLpm).toBeDefined();
    expect(d.weightKg).toBe(8);
    expect(d.visibilityM).toBe(12);
    expect(d.utcOffsetMinutes).toBe(120);
    expect(d.buddy).toBe('Marco');
    expect(d.computer?.model).toContain('Aladin Sport Matrix');
    // Meteo e mare non sono più tag: sono un campo che si può contare.
    expect(d.conditions?.weather).toBe('sunny');
    expect(conditionsOf(d).weather).toBe('sunny');
    expect(condizioniTesto(d)).toContain('sole');
  });

  it('NON numera le immersioni: il numero è la posizione nel logbook', async () => {
    /*
     * Questo test diceva il contrario, e il contrario era il difetto.
     *
     * Il lettore assegnava un progressivo contando le immersioni DI QUESTO
     * FILE. Funzionava finché l'archivio nasceva da un unico file letto tutto
     * insieme, e si rompeva in due modi opposti: le immersioni scaricate via
     * Bluetooth non passano di qui e restavano senza numero — un trattino nel
     * logbook accanto a righe numerate — e un secondo import dava alle sue
     * immersioni i numeri da 1 in su SOPRA a quelli già in archivio.
     *
     * Il numero è la posizione nel logbook e si calcola sull'archivio:
     * `core/numerazione.ts`, verificato in `tests/numerazione.test.ts`.
     */
    const { dives } = await parseFile({ fileName: 'export.logtrak', text });
    expect(dives.map((d) => d.number)).toEqual([undefined, undefined]);
    // L'ordine di lettura resta cronologico: serve al resto della catena.
    const tempi = dives.map((d) => Date.parse(d.startTime));
    expect(tempi).toEqual([...tempi].sort((a, b) => a - b));
  });

  it('non calcola il consumo quando manca il profilo', async () => {
    // Senza profilo la profondità media non esiste: stimarla darebbe un consumo
    // credibile e inventato, quindi la metrica deve restare assente.
    const noProfile = toLogtrak([spec], { withProfile: false });
    const { dives, warnings } = await parseFile({ fileName: 'manuale.logtrak', text: noProfile });
    expect(dives).toHaveLength(1);
    expect(dives[0].samples).toHaveLength(0);
    expect(dives[0].metrics!.avgDepth).toBeUndefined();
    expect(dives[0].metrics!.rmvLpm).toBeUndefined();
    // Il SAC in bar/min invece si calcola: le pressioni ci sono.
    expect(dives[0].metrics!.sacBarPerMin).toBeDefined();
    expect(warnings.join(' ')).toContain('non hanno il profilo');
  });

  it("importa comunque l'immersione se il profilo è corrotto", async () => {
    const broken = JSON.parse(toLogtrak([spec]));
    broken.dives[0].diveLogBase64 = 'QUJDREVGRw==';
    const { dives, warnings } = await parseFile({
      fileName: 'rotto.logtrak',
      text: JSON.stringify(broken),
    });
    expect(dives).toHaveLength(1);
    expect(dives[0].maxDepth).toBeGreaterThan(0);
    expect(warnings.join(' ')).toContain('illeggibile');
  });

  it('normalizza i nomi dei siti scritti in maiuscolo', () => {
    // LogTRAK conserva le maiuscole: senza normalizzare, "RECCO, GONZATTI" e
    // "Recco, Gonzatti" diventerebbero due siti diversi nelle statistiche.
    expect(normaliseSiteName('RECCO, GONZATTI')).toBe('Recco, Gonzatti');
    expect(normaliseSiteName("NUMANA, SECCA DELL'OSPEDALE")).toBe("Numana, Secca Dell'Ospedale");
    expect(normaliseSiteName('Punta Chiappa')).toBe('Punta Chiappa');
    expect(normaliseSiteName('Camogli, Dragone')).toBe('Camogli, Dragone');
  });

  it('interpreta le taglie delle bombole', () => {
    expect(parseTankSize('l_15')).toBe(15);
    expect(parseTankSize('l_11.1')).toBe(11.1);
    // Le imperiali sono dichiarate in piedi cubi di GAS, non in volume d'acqua.
    expect(parseTankSize('cuft_80')!).toBeCloseTo(11, 0);
    expect(parseTankSize(null)).toBeUndefined();
    expect(parseTankSize('')).toBeUndefined();
  });

  it('un profilo reale a 4 s produce metriche coerenti', async () => {
    const synth = synthesise({ intervalS: 4, ascentRateMpm: 8, safetyStopS: 300, wobbleM: 0.3 });
    const long = toLogtrak([
      { ...spec, depths: depthSeries(synth), temps: undefined, startBar: 220, endBar: 70 },
    ]);
    const { dives } = await parseFile({ fileName: 'long.logtrak', text: long });
    const m = dives[0].metrics!;
    expect(m.quality.sampleIntervalS).toBe(4);
    expect(m.didSafetyStop).toBe(true);
    expect(m.bottomVerticalTravelMpm!).toBeLessThan(2);
    expect(m.maxAscentRateMpm!).toBeLessThan(12);
  });
});

/*
 * IL SERIALE DEVE COMBACIARE CON QUELLO CHE IL COMPUTER DICE VIA BLUETOOTH.
 *
 * Misurato sull'archivio reale: l'Aladin Sport Matrix si presenta via Bluetooth
 * come `63034502`, e nella tabella `diveComputers` dell'export è `6303450223` —
 * le stesse cifre più il `deviceTypeNumber` (23). Finché le due scritture
 * restano diverse, `sameComputer` vede due apparecchi, il blocco `computer` non
 * si fonde, e l'impronta del profilo non passa dal file alla riga in archivio.
 */
describe('il seriale di LogTRAK', () => {
  const conSeriale = (serialNumber: string, deviceTypeNumber: number) => {
    const j = JSON.parse(toLogtrak([spec]));
    j.equipment.diveComputers[0].serialNumber = serialNumber;
    j.equipment.diveComputers[0].deviceTypeNumber = deviceTypeNumber;
    return logtrakParser.parse({ fileName: 'x.logtrak', text: JSON.stringify(j) }).dives[0];
  };

  it('perde la coda quando è esattamente il numero di tipo', () => {
    expect(conSeriale('6303450223', 23).computer?.serial).toBe('63034502');
  });

  it('resta intero quando la coda non è il numero di tipo', () => {
    // il secondo apparecchio dell'archivio di prova: finisce per 25, tipo 23
    expect(conSeriale('6305611325', 23).computer?.serial).toBe('6305611325');
  });

  it('non si accorcia sotto le sei cifre', () => {
    expect(conSeriale('123423', 23).computer?.serial).toBe('123423');
  });

  it('vale anche per deviceId, che è la chiave del segnalibro', () => {
    expect(conSeriale('6303450223', 23).computer?.deviceId).toBe('63034502');
  });
});
