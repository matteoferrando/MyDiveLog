/**
 * QUATTRO DIFETTI DEI LETTORI DI FORMATO, TROVATI IL 14 SETTEMBRE 2026.
 *
 * Hanno tutti la stessa forma: **un dato che c'è nel file e arriva sbagliato**,
 * senza che niente si lamenti. Sono peggio di un dato mancante, perché un
 * trattino si vede e un numero sbagliato no.
 */

import { describe, expect, it } from 'vitest';
import { exportUddf } from '../src/core/export/uddf';
import { parseFile } from '../src/core/parsers';
import { computeMetrics } from '../src/core/analysis/metrics';
import { analyseProfile } from '../src/core/analysis/tissues';
import { surfacedTissues } from '../src/core/analysis/buhlmann';
import { AIR, type Dive, type Sample } from '../src/core/model';

const base = (over: Partial<Dive> = {}): Dive => {
  const d: Dive = {
    id: 'a',
    startTime: '2026-06-14T10:00:00.000Z',
    durationS: 2400,
    maxDepth: 20,
    mode: 'oc',
    cylinders: [
      { mix: AIR, sizeL: 12, startBar: 200, endBar: 80 },
      { mix: { o2: 0.5, he: 0 }, sizeL: 7, startBar: 200, endBar: 160 },
    ],
    source: { format: 'uddf', file: 'x', importedAt: '2026-06-14T12:00:00.000Z' },
    tags: [],
    samples: Array.from({ length: 41 }, (_, i) => ({ t: i * 60, depth: 20, tempC: 18 })),
    ...over,
  };
  d.metrics = computeMetrics(d);
  return d;
};

const giroUddf = async (d: Dive): Promise<Dive> => {
  const { xml } = exportUddf([d], { now: '2026-09-15T00:00:00Z' });
  const back = await parseFile({ fileName: 'giro.uddf', text: xml });
  return back.dives[0]!;
};

describe('UDDF: le pressioni bombola nel profilo', () => {
  it('sopravvivono al giro esporta-reimporta, tutte', async () => {
    /*
     * ► SPARIVANO TUTTE, E NON SOLO QUALCUNA. ◄ La riga era
     * `num(child(wp, 'tankpressure'))`: con più di una `<tankpressure>` per
     * waypoint — che è quello che scrive la nostra stessa esportazione, una per
     * bombola — `child` restituisce un array e `num` su un array dà
     * `undefined`. Quarantuno campioni su quarantuno perdevano la pressione, e
     * la perdita non compariva nemmeno fra quelle che l'esportazione dichiara.
     */
    const samples: Sample[] = Array.from({ length: 41 }, (_, i) => ({
      t: i * 60,
      depth: 20,
      tempC: 18,
      pressureBar: [200 - i * 3, 200 - i],
    }));
    const dopo = await giroUddf(base({ samples }));
    const conPressione = (dopo.samples ?? []).filter((s) => s.pressureBar?.some((v) => v != null));
    expect(conPressione).toHaveLength(41);
  });

  it('e ognuna torna sulla PROPRIA bombola, non su quella del gas respirato', async () => {
    /*
     * Con un trasmettitore sulla principale e uno stage da decompressione, i
     * 130 bar della principale finivano sullo stage: la principale sembrava
     * ferma a inizio immersione e lo stage sembrava consumato senza essere
     * mai stato respirato.
     */
    const samples: Sample[] = [
      { t: 0, depth: 0, pressureBar: [200, 200], gasIndex: 0 },
      { t: 1200, depth: 20, pressureBar: [130, 200], gasIndex: 0 },
      { t: 2400, depth: 0, pressureBar: [120, 160], gasIndex: 1 },
    ];
    const dopo = await giroUddf(base({ samples }));
    const ultimo = dopo.samples![dopo.samples!.length - 1]!;
    expect(ultimo.pressureBar?.[0]).toBeCloseTo(120, 0);
    expect(ultimo.pressureBar?.[1]).toBeCloseTo(160, 0);
  });
});

describe('UDDF: la CNS oltre il 100%', () => {
  it('non crolla a un centesimo proprio quando si sfora il limite', async () => {
    /*
     * ► LA DISCONTINUITÀ ERA AL 100% ESATTO. ◄ La regola `v <= 1 ? v*100 : v`
     * è continua sotto e rotta sopra: `0.98` → 98, `1.02` → **1.02**.
     * L'orologio dell'ossigeno si azzerava nell'istante in cui si supera il
     * limite NOAA, cioè l'unico istante in cui quella colonna serve.
     */
    // Il file si scrive a mano: la nostra esportazione UDDF la CNS non la
    // scrive, quindi il giro esporta-reimporta qui non proverebbe niente.
    const wp = (t: number, cns: string) =>
      `<waypoint><divetime>${t}</divetime><depth>30</depth><cns>${cns}</cns></waypoint>`;
    const xml = `<?xml version="1.0"?>
<uddf version="3.2.0"><gasdefinitions><mix id="m1"><o2>0.32</o2></mix></gasdefinitions>
<profiledata><repetitiongroup><dive>
  <informationbeforedive><datetime>2026-06-14T10:00:00</datetime></informationbeforedive>
  <tankdata id="t1"><link ref="m1"/></tankdata>
  <samples>${wp(0, '0.98')}${wp(600, '1.00')}${wp(1200, '1.20')}</samples>
  <informationafterdive><greatestdepth>30</greatestdepth><diveduration>1200</diveduration></informationafterdive>
</dive></repetitiongroup></profiledata></uddf>`;
    const { dives } = await parseFile({ fileName: 'cns.uddf', text: xml });
    expect(dives[0]!.samples?.map((s) => s.cns)).toEqual([98, 100, 120]);
  });
});

describe('UDDF: la miscela scritta in percentuale', () => {
  it('non fa uscire un’immersione decompressiva come la più tranquilla dell’archivio', async () => {
    /*
     * ► È IL DIFETTO PIÙ PERICOLOSO DI TUTTI QUESTI. ◄ Con `<o2>21</o2>` — che
     * i file scritti a mano scrivono di continuo — la frazione inerte diventa
     * zero, i tessuti non caricano mai, e GF99, tetto e minuti di obbligo
     * escono tutti e tre **zero**. Non un errore: uno zero rassicurante.
     */
    const xml = `<?xml version="1.0"?>
<uddf version="3.2.0"><gasdefinitions>
  <mix id="m1"><name>Aria</name><o2>21</o2><he>0</he></mix>
</gasdefinitions>
<profiledata><repetitiongroup><dive>
  <informationbeforedive><datetime>2026-06-14T10:00:00</datetime></informationbeforedive>
  <tankdata id="t1"><link ref="m1"/></tankdata>
  <samples>
    <waypoint><divetime>0</divetime><depth>0</depth></waypoint>
    <waypoint><divetime>1800</divetime><depth>40</depth></waypoint>
    <waypoint><divetime>3600</divetime><depth>0</depth></waypoint>
  </samples>
  <informationafterdive><greatestdepth>40</greatestdepth><diveduration>3600</diveduration></informationafterdive>
</dive></repetitiongroup></profiledata></uddf>`;
    const { dives } = await parseFile({ fileName: 'percentuale.uddf', text: xml });
    const d = dives[0]!;
    expect(d.cylinders[0]!.mix.o2).toBeCloseTo(0.21, 3);
    /*
     * E il rovescio, che è quello che conta: con `o2 = 21` i tessuti non
     * caricavano affatto e **GF99, tetto e minuti di obbligo uscivano tutti e
     * tre zero**. Quaranta metri per mezz'ora ad aria un obbligo ce l'hanno.
     */
    const esito = analyseProfile(d, d.samples!, surfacedTissues());
    expect(esito.gf99End, 'i tessuti non hanno caricato: la miscela è fuori scala').toBeGreaterThan(50);
    expect(esito.maxCeilingM).toBeGreaterThan(0);
  });

  it('e una frazione vera resta una frazione', async () => {
    const dopo = await giroUddf(base());
    expect(dopo.cylinders[0]!.mix.o2).toBeCloseTo(0.21, 3);
    expect(dopo.cylinders[1]!.mix.o2).toBeCloseTo(0.5, 3);
  });
});

describe('UDDF: il voto', () => {
  it('si legge anche nella forma annidata, che è quella dello standard', async () => {
    const xml = `<?xml version="1.0"?>
<uddf version="3.2.0"><gasdefinitions><mix id="m1"><o2>0.21</o2></mix></gasdefinitions>
<profiledata><repetitiongroup><dive>
  <informationbeforedive><datetime>2026-06-14T10:00:00</datetime></informationbeforedive>
  <tankdata id="t1"><link ref="m1"/></tankdata>
  <samples><waypoint><divetime>0</divetime><depth>0</depth></waypoint>
  <waypoint><divetime>1200</divetime><depth>18</depth></waypoint></samples>
  <informationafterdive><greatestdepth>18</greatestdepth><diveduration>1200</diveduration>
    <rating><ratingvalue>4</ratingvalue></rating><visibility>12</visibility>
  </informationafterdive>
</dive></repetitiongroup></profiledata></uddf>`;
    const { dives } = await parseFile({ fileName: 'voto.uddf', text: xml });
    expect(dives[0]!.rating).toBe(4);
    expect(dives[0]!.visibilityM).toBe(12);
  });
});
