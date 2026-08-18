/**
 * Il test che conta di più del progetto: la STESSA immersione sintetica,
 * scritta in cinque formati diversi con cinque convenzioni di unità diverse,
 * deve tornare identica nel modello canonico.
 *
 * Se un giorno qualcuno dimentifica il fattore 2 dei mezzi PSI di Shearwater, o
 * legge i Pascal UDDF come bar, questi test lo prendono prima dell'utente.
 */

import { describe, expect, it } from 'vitest';
import { detectParser, parseFile } from '../src/core/parsers';
import { parseFit } from '../src/core/parsers/garminFit';
import { detectTimeScale } from '../src/core/parsers/shearwater';
import { parseDateTime, parseDurationCell, splitRow } from '../src/core/parsers/csv';
import { synthesise, toCsv, toFit, toShearwaterXml, toSubsurface, toUddf } from './fixtures';

const synth = synthesise();
const maxDepth = Math.max(...synth.samples.map((s) => s.depth));

describe('riconoscimento del formato', () => {
  it('distingue UDDF, Subsurface e Shearwater pur avendo tutti estensione .xml', () => {
    expect(detectParser({ fileName: 'a.xml', text: toUddf(synth) })?.format).toBe('uddf');
    expect(detectParser({ fileName: 'b.xml', text: toSubsurface(synth) })?.format).toBe('subsurface');
    expect(detectParser({ fileName: 'c.xml', text: toShearwaterXml(synth) })?.format).toBe('shearwater-xml');
  });

  it("riconosce il FIT dalla firma binaria, non dall'estensione", () => {
    const bytes = toFit(synth);
    expect(detectParser({ fileName: 'senza-estensione', bytes })?.format).toBe('garmin-fit');
  });

  it('riconosce un CSV di riepilogo dalle intestazioni', () => {
    expect(detectParser({ fileName: 'log.csv', text: toCsv([synth]) })?.format).toBe('csv');
  });
});

describe('UDDF', () => {
  it('converte correttamente le unità SI', async () => {
    const { dives, warnings } = await parseFile({ fileName: 'test.uddf', text: toUddf(synth) });
    expect(warnings.filter((w) => w.includes('scartata'))).toHaveLength(0);
    expect(dives).toHaveLength(1);
    const d = dives[0];

    expect(d.maxDepth).toBeCloseTo(maxDepth, 1);
    expect(d.durationS).toBe(synth.spec.durationS);
    // Kelvin → Celsius.
    expect(d.minTempC).toBeCloseTo(synth.spec.minTempC, 0);
    // Pascal → bar.
    expect(d.cylinders[0].startBar).toBe(synth.spec.startBar);
    // Metri cubi → litri.
    expect(d.cylinders[0].sizeL).toBeCloseTo(synth.spec.tankSizeL, 1);
    // Frazione, non percentuale.
    expect(d.cylinders[0].mix.o2).toBeCloseTo(synth.spec.o2, 3);
    expect(d.site?.name).toBe(synth.spec.siteName);
    expect(d.samples?.length).toBe(synth.samples.length);
    // La pressione nei campioni è in bar, non in Pascal.
    const pressures = d.samples!.map((s) => s.pressureBar?.[0]).filter((p): p is number => p !== undefined);
    expect(Math.max(...pressures)).toBeLessThan(400);
  });
});

describe('Subsurface', () => {
  it('interpreta le unità nella stringa e i tempi mm:ss', async () => {
    const { dives } = await parseFile({ fileName: 'test.ssrf', text: toSubsurface(synth) });
    expect(dives).toHaveLength(1);
    const d = dives[0];
    expect(d.maxDepth).toBeCloseTo(maxDepth, 1);
    // duration='42:00 min' sono 42 minuti, non 42 secondi né 42 minuti e 0 secondi male interpretati.
    expect(d.durationS).toBe(synth.spec.durationS);
    expect(d.cylinders[0].sizeL).toBeCloseTo(synth.spec.tankSizeL, 1);
    expect(d.cylinders[0].mix.o2).toBeCloseTo(synth.spec.o2, 2);
    expect(d.tags).toContain('nitrox');
    expect(d.computer?.model).toBe('Shearwater Peregrine');
  });

  it('riporta avanti i valori omessi nei campioni delta-codificati', async () => {
    const { dives } = await parseFile({ fileName: 'test.ssrf', text: toSubsurface(synth) });
    const samples = dives[0].samples!;
    // Nel fixture la temperatura è scritta solo quando cambia di un grado:
    // senza carry-forward la maggior parte dei campioni sarebbe senza temperatura.
    const withTemp = samples.filter((s) => s.tempC !== undefined).length;
    expect(withTemp).toBe(samples.length);
    const withPressure = samples.filter((s) => s.pressureBar?.[0] !== undefined).length;
    expect(withPressure).toBe(samples.length);
  });
});

describe('Shearwater XML', () => {
  it('legge i mezzi PSI, i millibar e i millisecondi', async () => {
    const { dives } = await parseFile({ fileName: 'sw.xml', text: toShearwaterXml(synth) });
    expect(dives).toHaveLength(1);
    const d = dives[0];
    expect(d.maxDepth).toBeCloseTo(maxDepth, 0);
    expect(d.durationS).toBe(synth.spec.durationS);
    // startSurfacePressure in millibar → ~1.013 bar, non 1013.
    expect(d.surfacePressureBar).toBeCloseTo(1.013, 2);
    // Mezzi PSI → bar: se il fattore 2 mancasse, sarebbe ~110 invece di ~220.
    expect(d.cylinders[0].startBar).toBeGreaterThan(synth.spec.startBar - 3);
    expect(d.cylinders[0].startBar).toBeLessThan(synth.spec.startBar + 3);
    // currentTime in millisecondi → i campioni non devono finire a 25.000 secondi.
    expect(d.samples![d.samples!.length - 1].t).toBe(synth.spec.durationS);
    expect(d.computer?.gfHigh).toBe(85);
  });

  it('rispetta il flag imperialUnits', async () => {
    const metric = await parseFile({ fileName: 'm.xml', text: toShearwaterXml(synth, { imperial: false }) });
    const imperial = await parseFile({ fileName: 'i.xml', text: toShearwaterXml(synth, { imperial: true }) });
    // Lo stesso profilo scritto in piedi e in metri deve dare la stessa profondità.
    expect(imperial.dives[0].maxDepth).toBeCloseTo(metric.dives[0].maxDepth, 0);
    expect(imperial.dives[0].minTempC!).toBeCloseTo(metric.dives[0].minTempC!, 0);
  });

  it('ricava la scala dei tempi dal passo fra campioni', () => {
    expect(detectTimeScale([0, 10_000, 20_000, 30_000])).toBe(1000);
    expect(detectTimeScale([0, 10, 20, 30])).toBe(1);
    expect(detectTimeScale([0, 2, 4, 6])).toBe(1);
    expect(detectTimeScale([0, 7777, 15_554])).toBeNull();
  });
});

describe('Garmin FIT', () => {
  it('legge profilo, gas e pressione dai trasmettitori', async () => {
    const { dives, warnings } = await parseFit({ fileName: 'dive.fit', bytes: toFit(synth) });
    expect(warnings.filter((w) => w.includes('Nessuna immersione'))).toHaveLength(0);
    expect(dives).toHaveLength(1);
    const d = dives[0];
    expect(d.maxDepth).toBeCloseTo(maxDepth, 0);
    expect(d.durationS).toBe(synth.spec.durationS);
    expect(d.mode).toBe('oc');
    expect(d.cylinders[0].mix.o2).toBeCloseTo(synth.spec.o2, 2);
    // La pressione non sta nei record: va agganciata dai messaggi tank_update.
    const pressures = d.samples!.map((s) => s.pressureBar?.[0]).filter((p): p is number => p !== undefined);
    expect(pressures.length).toBeGreaterThan(synth.samples.length * 0.9);
    // Il volume bombola non esiste nel FIT: viene dedotto da tank_summary.
    expect(d.cylinders[0].sizeL).toBeCloseTo(synth.spec.tankSizeL, 0);
  });
});

describe('CSV di riepilogo', () => {
  it('mappa le intestazioni italiane e le date europee', async () => {
    const two = [synthesise(), synthesise({ startTime: new Date('2026-06-15T09:10:00Z'), maxDepth: 18 })];
    const { dives, warnings } = await parseFile({ fileName: 'logbook.csv', text: toCsv(two) });
    expect(dives).toHaveLength(2);
    expect(dives[0].site?.name).toBe(synth.spec.siteName);
    expect(dives[0].maxDepth).toBeCloseTo(maxDepth, 1);
    expect(dives[0].buddy).toBe('Marco');
    expect(dives[0].cylinders[0].mix.o2).toBeCloseTo(synth.spec.o2, 2);
    // Deve dire chiaramente che senza profilo alcune metriche non ci sono.
    expect(warnings.some((w) => w.includes('senza profilo'))).toBe(true);
  });

  it('legge le celle quotate', () => {
    expect(splitRow('a,"b,c",d', ',')).toEqual(['a', 'b,c', 'd']);
    expect(splitRow('a,"dice ""ciao""",b', ',')).toEqual(['a', 'dice "ciao"', 'b']);
  });

  it('preferisce il formato data europeo', () => {
    // 03/07/2026 per un logbook italiano è 3 luglio, non 7 marzo.
    //
    // Il confronto è sulla stringa e non su `new Date(iso).getMonth()`: quei
    // getter leggono nel fuso della macchina, e `parseDateTime` costruisce
    // l'istante in UTC apposta — un foglio di calcolo non porta il fuso. A
    // Kiritimati (UTC+14) le 10:30 UTC del 3 sono già il 4, e il test falliva
    // pur essendo il parser corretto. È il motivo per cui esiste `npm run
    // test:tz`.
    expect(parseDateTime('03/07/2026', '10:30')).toBe('2026-07-03T10:30:00.000Z');
    // E la disambiguazione americana, che sulla stessa riga cambia risposta.
    expect(parseDateTime('03/25/2026', '10:30')).toBe('2026-03-25T10:30:00.000Z');
  });

  it('interpreta le durate', () => {
    expect(parseDurationCell('45')).toBe(45 * 60);
    expect(parseDurationCell('45 min')).toBe(45 * 60);
    expect(parseDurationCell('45:30')).toBe(45 * 60 + 30);
  });
});

describe('coerenza fra formati', () => {
  it('lo stesso profilo scritto in quattro formati produce la stessa immersione', async () => {
    const results = await Promise.all([
      parseFile({ fileName: 'a.uddf', text: toUddf(synth) }),
      parseFile({ fileName: 'b.ssrf', text: toSubsurface(synth) }),
      parseFile({ fileName: 'c.xml', text: toShearwaterXml(synth) }),
      parseFit({ fileName: 'd.fit', bytes: toFit(synth) }),
    ]);

    const dives = results.map((r) => r.dives[0]);
    for (const d of dives) {
      expect(d.maxDepth).toBeCloseTo(maxDepth, 0);
      expect(d.durationS).toBeCloseTo(synth.spec.durationS, -1);
      expect(d.metrics!.avgDepth).toBeCloseTo(synth.avgDepth, 0);
      // La pressione bombola si ricostruisce da tutti e quattro.
      expect(d.metrics!.sacBarPerMin).toBeDefined();
    }
  });

  it('ricostruisce il consumo in L/min dove il formato porta il volume bombola', async () => {
    // UDDF ha <tankvolume>, Subsurface ha size='… l', il FIT lo deduce da
    // tank_summary. Tre su quattro, quindi.
    const results = await Promise.all([
      parseFile({ fileName: 'a.uddf', text: toUddf(synth) }),
      parseFile({ fileName: 'b.ssrf', text: toSubsurface(synth) }),
      parseFit({ fileName: 'd.fit', bytes: toFit(synth) }),
    ]);
    for (const r of results) {
      const rmv = r.dives[0].metrics!.rmvLpm;
      expect(rmv, `${r.format} dovrebbe calcolare il consumo`).toBeDefined();
      expect(rmv!).toBeGreaterThan(synth.spec.rmvLpm - 3);
      expect(rmv!).toBeLessThan(synth.spec.rmvLpm + 3);
    }
  });

  it("l'XML Shearwater non porta il volume bombola e lo dichiara", async () => {
    // Il formato non ha un campo per i litri: la scelta corretta è dirlo,
    // non inventare un valore plausibile.
    const { dives } = await parseFile({ fileName: 'c.xml', text: toShearwaterXml(synth) });
    const m = dives[0].metrics!;
    expect(m.rmvLpm).toBeUndefined();
    expect(m.sacBarPerMin).toBeDefined();
    expect(m.quality.hasTankPressure).toBe(true);
    expect(m.quality.hasCylinderVolume).toBe(false);
    expect(m.quality.caveats.join(' ')).toContain('Volume bombola');
  });
});

/**
 * I difetti dei confini trovati dalla revisione ostile.
 *
 * Tutti e tre condividono la stessa forma: il parser non capiva qualcosa e
 * proseguiva in silenzio, producendo un'immersione plausibile e falsa. Un file che
 * non si riesce a leggere deve dirlo.
 */
describe('confini dei file, difetti della revisione', () => {
  const parse = (text: string) =>
    parseFile({ fileName: 'x.uddf', bytes: new TextEncoder().encode(text), text });

  const uddf = (datetime: string, extra = '') => `<?xml version="1.0"?>
<uddf version="3.2.0"><generator><name>QualcheProgramma</name></generator>
<gasdefinitions><mix id="m1"><o2>0.21</o2><he>0</he></mix></gasdefinitions>
<profiledata><repetitiongroup id="r1"><dive id="d1">
<informationbeforedive><datetime>${datetime}</datetime></informationbeforedive>
<samples>${Array.from({ length: 20 }, (_, i) => `<waypoint><divetime>${i * 60}</divetime><depth>${10 + i}</depth></waypoint>`).join('')}</samples>
<informationafterdive>${extra}</informationafterdive>
</dive></repetitiongroup></profiledata></uddf>`;

  it('una data illeggibile scarta l’immersione e lo dice, invece di mandarla al 1970', async () => {
    // Prima: `14.06.2026 10:38:00` diventava il 1° gennaio 1970 — e con TUTTE le
    // immersioni del file allo stesso istante, la deduplica ne fondeva a due a due.
    const r = await parse(
      uddf('14.06.2026 10:38:00', '<diveduration>1200</diveduration><greatestdepth>30</greatestdepth>'),
    );
    expect(r.dives).toHaveLength(0);
    expect(r.warnings.some((w) => w.includes('data') && w.includes('14.06.2026'))).toBe(true);
  });

  it('una data valida passa come prima', async () => {
    const r = await parse(
      uddf('2026-06-14T10:38:00', '<diveduration>1200</diveduration><greatestdepth>30</greatestdepth>'),
    );
    expect(r.dives).toHaveLength(1);
    expect(r.dives[0].startTime).toContain('2026-06-14');
  });

  it('quando durata e profondità sono dedotte dai campioni lo dichiara', async () => {
    // È il segnale di un file troncato: senza, l'immersione a metà entrava in
    // archivio ACCANTO a quella intera, perché la durata diversa impedisce alla
    // deduplica di riconoscerle come la stessa.
    const r = await parse(uddf('2026-06-14T10:38:00'));
    expect(r.dives).toHaveLength(1);
    expect(r.warnings.some((w) => w.includes('ricavate dai campioni'))).toBe(true);
  });

  it('il generatore del file non diventa un computer subacqueo', async () => {
    // Reimportando un nostro export, ogni immersione si portava dietro un secondo
    // «computer» chiamato MyDiveLog.
    const r = await parse(
      uddf('2026-06-14T10:38:00', '<diveduration>1200</diveduration><greatestdepth>30</greatestdepth>'),
    );
    expect(r.dives[0].computer?.model).toBeUndefined();
    expect(r.warnings.some((w) => w.includes('QualcheProgramma'))).toBe(true);
  });
});
