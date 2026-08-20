/**
 * Le correzioni della revisione avversariale del 20 agosto 2026.
 *
 * Sei fronti in parallelo — motore decompressivo, dati e persistenza, parser e
 * driver, analisi, interfaccia, contesti e stampa — con la stessa regola di
 * sempre: nessuna opinione, solo difetti riprodotti eseguendo il codice. Questo
 * file inchioda quelli corretti nel motore, nei dati e nei lettori; per ognuno
 * il commento dice COSA succedeva, perché i test verdi non se ne accorgevano, e
 * quale numero era sbagliato.
 *
 * Va letto insieme a `revisione-20agosto-interfaccia.test.tsx`, che copre la
 * parte che si riproduce solo con l'app in mano.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DECO,
  planDeco,
  bestGasAt,
  quotaDiCambioTra,
  breathedAt,
  barometric,
  switchDepthOf,
} from '../src/core/analysis/deco';
import { DEFAULT_PLAN, planGas } from '../src/core/analysis/gasPlan';
import { oxygenLoad } from '../src/core/analysis/oxygen';
import { computeMetrics } from '../src/core/analysis/metrics';
import { aggregate } from '../src/core/analysis/aggregate';
import { ambientBar, mod, ppo2At } from '../src/core/units';
import { inferClockOffsets, likelySame, mergeDive, mergeImports, dedupeComputers } from '../src/core/dedupe';
import { parseTankSize } from '../src/core/parsers/shearwaterCloud';
import { csvParser } from '../src/core/parsers/csv';
import type { Dive, Sample } from '../src/core/model';

// ---------------------------------------------------------------------------
// Motore decompressivo
// ---------------------------------------------------------------------------

const GAS_FONDO = { mix: { o2: 0.21, he: 0 }, role: 'bottom' as const, tankL: 24, startBar: 200 };
const EAN50 = { mix: { o2: 0.5, he: 0 }, role: 'deco' as const, tankL: 11, startBar: 200 };
const OSSIGENO = { mix: { o2: 1, he: 0 }, role: 'deco' as const, tankL: 11, startBar: 200 };

describe('circuito chiuso: gli stage di deco non entrano nel loop', () => {
  /*
   * IL DIFETTO. Con un setpoint sul livello, la scelta del gas era la stessa del
   * circuito aperto: in risalita prendeva lo stage più ricco d'ossigeno e il
   * motore lo trattava comunque come diluente, perché «chiuso» lo decideva il
   * setpoint del livello e non il gas. Misurato su 60 m × 25 min a setpoint 1.3:
   * la decompressione scendeva da 40 a 33 minuti e quelle bombole registravano
   * ZERO litri. Un piano che guadagna sette minuti restando sul circuito e senza
   * aprire lo stage — ineseguibile, e più corto del vero. Bastava spuntare
   * «circuito chiuso» con i gas che la pagina propone da sola.
   */
  const diluente = { mix: { o2: 0.1, he: 0.5 }, role: 'bottom' as const, tankL: 3, startBar: 200 };
  const livello = { depthM: 60, minutes: 25, setpointBar: 1.3 };
  const s = { ...DEFAULT_DECO, gfLow: 40, gfHigh: 85 };

  it('la decompressione è la stessa con o senza gli stage in lista', () => {
    const soloLoop = planDeco([livello], [diluente], s);
    const conStage = planDeco([livello], [diluente, EAN50, OSSIGENO], s);
    expect(conStage.decoMin).toBe(soloLoop.decoMin);
    expect(conStage.gf99EndPct).toBeCloseTo(soloLoop.gf99EndPct, 5);
  });

  it('e nessun tratto del piano viene respirato su uno stage', () => {
    const p = planDeco([livello], [diluente, EAN50, OSSIGENO], s);
    const indiciUsati = new Set(p.segments.map((x) => x.gasIndex));
    expect([...indiciUsati]).toEqual([0]);
  });

  it('bestGasAt su circuito chiuso ignora i gas di deco', () => {
    const gases = [diluente, EAN50, OSSIGENO];
    expect(bestGasAt(6, gases, s, false)).toBe(2); // aperto: l'ossigeno
    expect(bestGasAt(6, gases, s, true)).toBe(0); // chiuso: il diluente
  });

  it('un diluente senza inerte non inventa azoto', () => {
    const respirata = breathedAt(6, { ...OSSIGENO, setpointBar: 1.3 }, 1.3, s);
    expect(respirata.o2).toBe(1);
    expect(1 - respirata.o2 - respirata.he).toBeCloseTo(0, 9);
  });
});

describe('il cambio gas avviene alla MOD, non alla prima sosta più in alto', () => {
  /*
   * IL DIFETTO. Il gas si sceglieva alla quota di PARTENZA del tratto e poi si
   * saliva fino al target in un colpo solo: se il target era più in alto della
   * MOD di uno stage, quello stage veniva scavalcato. Rompeva la monotonia in
   * modo grossolano — a 30 m × 10 min la risalita tirava dritta fino a 3 m sul
   * trimix, a 31 m si spezzava a 6 m e prendeva l'ossigeno, e il GF99 all'uscita
   * scendeva da 52.3 a 38.6. Un metro più giù, meno decompressione.
   */
  const trimix = { mix: { o2: 0.21, he: 0.35 }, role: 'bottom' as const, tankL: 24, startBar: 200 };
  const s = { ...DEFAULT_DECO, gfLow: 35, gfHigh: 75 };
  const gases = [trimix, EAN50, OSSIGENO];

  it('la risalita si ferma alla quota di cambio', () => {
    const p = planDeco([{ depthM: 40, minutes: 20 }], [GAS_FONDO, EAN50], DEFAULT_DECO);
    const primaRisalita = p.segments.find((x) => x.kind === 'ascent' && x.fromM > 30);
    expect(primaRisalita?.toM).toBeCloseTo(22, 0);
  });

  it('e il GF99 all’uscita cresce con la profondità, come deve', () => {
    const gf = [29, 30, 31, 32].map((d) => planDeco([{ depthM: d, minutes: 10 }], gases, s).gf99EndPct);
    for (let i = 1; i < gf.length; i++) expect(gf[i]).toBeGreaterThanOrEqual(gf[i - 1]);
  });

  it('quotaDiCambioTra trova la più profonda per strada, e niente quando non ce n’è', () => {
    expect(quotaDiCambioTra(40, 3, gases, DEFAULT_DECO)).toBe(22);
    expect(quotaDiCambioTra(20, 15, [trimix], DEFAULT_DECO)).toBeUndefined();
    // Su circuito chiuso non ci si ferma per un cambio che non avverrà.
    expect(quotaDiCambioTra(40, 3, gases, DEFAULT_DECO, true)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Dati e fusione
// ---------------------------------------------------------------------------

const imm = (o: Partial<Dive>): Dive =>
  ({
    id: 'x',
    startTime: '2026-05-03T09:00:00Z',
    durationS: 2700,
    maxDepth: 28,
    mode: 'oc',
    cylinders: [],
    tags: [],
    source: { format: 'logtrak', file: 'a', importedAt: 'x' },
    ...o,
  }) as Dive;

describe('la deduplica non inghiotte un’immersione intera', () => {
  /*
   * IL DIFETTO, il più grave di tutta la revisione. Il commento di
   * `inferClockOffsets` sosteneva che uno sfasamento «sistematico» non può
   * nascere per caso perché le ripetitive producono differenze isolate. Non è
   * vero: un ORARIO DI BORDO REGOLARE le rende sistematiche. Con tre tuffi al
   * giorno alle 09:00, 11:30 e 14:30 per cinque giorni, le differenze fra tuffi
   * diversi dello stesso giorno si accumulano su −2h30, −3h e −5h30 e superano
   * la soglia. Da lì un'immersione che una sola fonte possiede — la notturna,
   * fatta con un computer solo perché all'altro era finita la batteria — veniva
   * fusa dentro una ripetitiva: l'archivio non cresceva, e il rapporto
   * dell'import diceva «arricchita».
   */
  const giorni = ['01', '02', '03', '04', '05'];
  const ore = ['09:00', '11:30', '14:30'];
  const crociera = giorni.flatMap((g, i) =>
    ore.map((h, j) =>
      imm({
        id: `c-${i}-${j}`,
        startTime: `2026-05-${g}T${h}:00Z`,
        maxDepth: 28 + j,
        durationS: 2700 + j * 60,
        computer: { model: 'Aladin', deviceId: 'A1', diveId: `${100 + i * 3 + j}` },
      }),
    ),
  );
  const notturna = imm({
    id: 'notturna',
    startTime: '2026-05-03T17:00:00Z',
    maxDepth: 28,
    durationS: 2700,
    computer: { model: 'Aladin', deviceId: 'A1', diveId: '199' },
  });

  it('un orario di bordo regolare non produce più sfasamenti d’orologio finti', () => {
    expect(inferClockOffsets(crociera, [...crociera, notturna])).toEqual([]);
  });

  it('e la notturna entra in archivio invece di sparire', () => {
    const r = mergeImports(crociera, [...crociera, notturna]);
    expect(r.added).toBe(1);
    expect(r.dives).toHaveLength(crociera.length + 1);
    expect(r.dives.some((d) => d.id === 'notturna')).toBe(true);
  });

  it('lo stesso computer con due identificativi interni diversi mette il veto', () => {
    const a = crociera[7];
    expect(likelySame(a, notturna, -5.5 * 3600_000)).toBe(false);
  });

  it('ma uno sfasamento VERO si continua a dedurre', () => {
    // Tutto l'archivio spostato di un'ora: a zero non combacia niente, quindi
    // ogni coppia continua a votare ed esce lo sfasamento giusto.
    const spostate = crociera.map((d) => ({
      ...d,
      id: `s-${d.id}`,
      startTime: new Date(Date.parse(d.startTime) + 3600_000).toISOString(),
      computer: { ...d.computer!, diveId: undefined },
    }));
    const off = inferClockOffsets(crociera, spostate);
    expect(off[0]?.offsetMs).toBe(-3600_000);
  });
});

describe('reimportare lo stesso file non tocca niente', () => {
  /*
   * IL DIFETTO. Con due profili identici, `denserOf` restituiva comunque quello
   * in arrivo, `200 > 0` accendeva il secondo profilo e con lui `changed`; più
   * sotto il secondo profilo veniva ributtato via ma `changed` restava acceso.
   * Da lì l'immersione veniva riscritta con metriche ricalcolate da
   * `computeMetrics`, che della catena dei tessuti non sa niente: la saturazione
   * spariva da TUTTO l'archivio a ogni reimport — e con lo scarico Bluetooth,
   * che ripresenta sempre l'intera memoria del computer, a ogni collegamento.
   */
  const campioni: Sample[] = Array.from({ length: 200 }, (_, i) => ({ t: i * 10, depth: 20, tempC: 18 }));
  const conProfilo = imm({ samples: campioni, metrics: { gf99Pct: 83 } as Dive['metrics'] });

  it('mergeDive restituisce l’immersione invariata, non una copia', () => {
    expect(mergeDive(conProfilo, { ...conProfilo, id: 'y' })).toBe(conProfilo);
  });

  it('e non fabbrica un secondo profilo lungo quanto il primo', () => {
    const fusa = mergeDive(conProfilo, { ...conProfilo, id: 'y', notes: 'nuova' });
    expect(fusa.altSamples).toBeUndefined();
  });

  it('il secondo profilo nasce ancora quando è davvero più fitto', () => {
    const fitti: Sample[] = Array.from({ length: 500 }, (_, i) => ({ t: i * 4, depth: 20 }));
    const ricco = imm({ samples: campioni.map((c) => ({ ...c, ndlMin: 5 })) });
    const fusa = mergeDive(ricco, imm({ id: 'y', samples: fitti }));
    expect(fusa.altSamples).toHaveLength(500);
  });
});

describe('il blocco computer non perde pezzi', () => {
  it('l’arricchimento entra anche quando la voce si fonde invece di aggiungersi', () => {
    /*
     * Il rilevatore di modifica era `merged.length !== otherComputers.length`:
     * quando il computer in arrivo si FONDE con una voce già presente la
     * lunghezza non cambia, l'assegnazione non avveniva, e seriale e firmware
     * venivano scartati — mentre `extraSources` dichiarava che quella fonte
     * aveva contribuito.
     */
    const archivio = imm({
      computer: { model: 'Aladin', serial: '63034502' },
      otherComputers: [{ model: 'Peregrine', diveId: '118' }],
    });
    const arrivo = imm({ id: 'y', computer: { model: 'Peregrine', serial: '3B0016A2', firmware: '92' } });
    const fusa = mergeDive(archivio, arrivo);
    expect(fusa.otherComputers?.[0]).toMatchObject({ serial: '3B0016A2', firmware: '92', diveId: '118' });
  });

  it('dedupeComputers non lascia che un `undefined` esplicito cancelli un seriale', () => {
    // `{ ...c, ...existing }` copiava anche le chiavi a `undefined` esplicito, e
    // tutti i lettori costruiscono il blocco con le chiavi sempre presenti: il
    // risultato dipendeva dall'ordine dell'elenco.
    const senza = { model: 'Peregrine', serial: undefined, firmware: '92' };
    const con = { model: 'Peregrine', serial: 'SW-1', deviceId: 'SW-1' };
    expect(dedupeComputers([senza, con])[0]).toMatchObject({ serial: 'SW-1', firmware: '92' });
    expect(dedupeComputers([con, senza])[0]).toMatchObject({ serial: 'SW-1', firmware: '92' });
  });

  it('l’impronta del profilo si riconosce anche quando è finita fra gli altri computer', () => {
    /*
     * Quando il profilo in arrivo vince, il blocco `computer` viene sostituito
     * in blocco e quello vecchio finisce fra gli «altri», impronta compresa.
     * Guardando solo il principale, l'unico criterio capace di riconoscere
     * l'immersione con la data corretta a mano si spegneva appena si importava
     * un secondo computer: la copia con 118 giorni di scarto rientrava come
     * nuova a ogni scarico Bluetooth, per sempre.
     */
    const inArchivio = imm({
      startTime: '2026-02-14T09:52:00Z',
      computer: { model: 'Peregrine', serial: 'SW-1' },
      otherComputers: [{ model: 'Aladin', serial: '63034502', profileFingerprint: 'f1-b7b8c6f2' }],
    });
    const daBluetooth = imm({
      id: 'ble',
      startTime: '2025-10-19T09:52:00Z',
      computer: { model: 'Aladin', serial: '63034502', profileFingerprint: 'f1-b7b8c6f2' },
    });
    expect(likelySame(inArchivio, daBluetooth)).toBe(true);
  });
});

describe('conditions e gear si fondono guardando i valori, non le chiavi', () => {
  /*
   * `{ ...incoming, ...out }` fa vincere l'`undefined` ESPLICITO, e il confronto
   * sul numero di chiavi non se ne accorge. La modifica in blocco del logbook
   * scrive sempre `weather` E `waves`, anche a `undefined`: bastava impostare in
   * blocco il solo meteo perché il mare portato dal file non entrasse più.
   */
  it('il mare entra anche se la casella era stata scritta vuota', () => {
    const conMeteo = imm({ conditions: { weather: 'sunny', waves: undefined } });
    const conMare = imm({ id: 'y', conditions: { waves: 'moderate' } });
    const fusa = mergeDive(conMeteo, conMare);
    expect(fusa.conditions).toEqual({ weather: 'sunny', waves: 'moderate' });
  });

  it('e il GAV anche se la scheda l’aveva lasciato indefinito', () => {
    const conMuta = imm({ gear: { suit: { name: 'stagna' }, bcd: undefined } });
    const conGav = imm({ id: 'y', gear: { bcd: { name: 'Zeagle Ranger' } } });
    expect(mergeDive(conMuta, conGav).gear).toEqual({
      suit: { name: 'stagna' },
      bcd: { name: 'Zeagle Ranger' },
    });
  });
});

// ---------------------------------------------------------------------------
// Lettori
// ---------------------------------------------------------------------------

describe('«AL80» non è una misura, nemmeno in Shearwater Cloud', () => {
  /*
   * `TankSize` è testo libero digitato dall'utente, e il lettore prendeva la
   * prima cifra che trovava: 80 litri per «AL80», sette volte il volume vero, e
   * un consumo di 93 L/min al posto di 13. È lo stesso difetto già documentato e
   * corretto nel lettore LogTRAK, rimasto vivo qui.
   */
  it('passa dalla tabella delle bombole', () => {
    expect(parseTankSize('AL80')).toBe(11.1);
    expect(parseTankSize('S80')).toBe(11.1);
    expect(parseTankSize('15 lt')).toBe(15);
  });

  it('e preferisce non rispondere invece di inventare', () => {
    expect(parseTankSize('3000 psi')).toBeUndefined();
    expect(parseTankSize('X7-100')).toBeUndefined();
  });
});

describe('CSV: l’unità dichiarata nell’intestazione vale per tutta la colonna', () => {
  /*
   * `parseMeasure` cercava l'unità solo dentro la cella, mentre `resolveField`
   * l'aveva già vista — è grazie a «max depth ft» che riconosce la colonna. Un
   * export imperiale con le unità in intestazione (la forma normale in Diving
   * Log, MacDive, divelogs.de) entrava tutto in metrico SENZA UN AVVISO: 98
   * piedi diventavano 98 metri, 3000 psi diventavano 3000 bar, e il consumo
   * usciva a 613 L/min.
   */
  const imperiale = [
    'Date,Time,Max Depth (ft),Average Depth (ft),Duration (min),Water Temp (F),Start Pressure (psi),End Pressure (psi),Tank Size,Site',
    '2026-03-14,10:05,98,54,47,52,3000,700,AL80,Monterey',
  ].join('\n');

  it('converte profondità, temperatura e pressioni', () => {
    const r = csvParser.parse({ fileName: 'a.csv', text: imperiale });
    const d = r.dives[0];
    expect(d.maxDepth).toBeCloseTo(29.9, 1);
    expect(d.avgDepth).toBeCloseTo(16.5, 1);
    expect(d.minTempC).toBeCloseTo(11.1, 1);
    expect(d.cylinders[0].startBar).toBe(207);
    expect(d.cylinders[0].endBar).toBe(48);
    expect(d.cylinders[0].sizeL).toBe(11.1);
  });

  it('e lo dichiara, invece di convertire in silenzio', () => {
    const r = csvParser.parse({ fileName: 'a.csv', text: imperiale });
    expect(r.warnings.some((w) => w.includes("nell'intestazione"))).toBe(true);
  });

  it('l’unità scritta nella cella vince su quella della colonna', () => {
    const misto = ['Date,Time,Max Depth (ft),Duration (min)', '2026-03-14,10:05,12 m,47'].join('\n');
    expect(csvParser.parse({ fileName: 'a.csv', text: misto }).dives[0].maxDepth).toBe(12);
  });
});

// ---------------------------------------------------------------------------
// Secondo giro: quota, ossigeno, prontezza, e le perdite silenziose
// ---------------------------------------------------------------------------

describe('la quota entra in tutti i conti, non solo in alcuni', () => {
  /*
   * IL DIFETTO. I litri si calcolavano sugli ATA locali (`ambientBar /
   * pressioneDiSuperficie`) mentre il contenuto della bombola è in bar·litro
   * assoluti: al livello del mare i due differiscono dell'1.3%, in quota il
   * divisore cala e il consumo si GONFIA — a 2000 m il piano chiedeva 142 bar
   * dove ne servono 113. E la documentazione di `altitudeM` prometteva
   * l'opposto. In parallelo, MOD, PPO2, END, EAD e CNS ignoravano del tutto la
   * pressione di superficie: tre riquadri della stessa schermata usavano due
   * pressioni diverse.
   */
  const base = { ...DEFAULT_PLAN, depthM: 30, avgDepthM: 24, bottomMin: 25, rmvLpm: 18, tankL: 15 };

  it('il gas consumato CALA salendo di quota', () => {
    const mare = planGas({ ...base, altitudeM: 0 });
    const lago = planGas({ ...base, altitudeM: 2000 });
    expect(lago.plannedL).toBeLessThan(mare.plannedL);
  });

  it('e corrisponde alla fisica: rmv × minuti × pressione ambiente', () => {
    const p = planGas({ ...base, altitudeM: 2000, salinity: 'fresh' });
    const superficie = barometric(2000);
    const atteso = p.planned.reduce(
      (a, ph) => a + ph.minutes * ambientBar(ph.meanDepthM, 'fresh', superficie) * ph.rmvLpm * ph.divers,
      0,
    );
    expect(p.plannedL).toBeCloseTo(Math.round(atteso), -1);
  });

  it('MOD e PPO2 tengono conto della quota', () => {
    const mare = planGas({ ...base, depthM: 40, mix: { o2: 0.32, he: 0 } });
    const lago = planGas({
      ...base,
      depthM: 40,
      mix: { o2: 0.32, he: 0 },
      altitudeM: 2000,
      salinity: 'fresh',
    });
    // In quota la pressione a quaranta metri è più bassa: la MOD si sposta in giù
    // e la PPO2 scende. Prima le due righe erano identiche.
    expect(lago.modM).toBeGreaterThan(mare.modM);
    expect(lago.ppo2AtDepth).toBeLessThan(mare.ppo2AtDepth);
  });

  it('la stessa pressione di superficie in `units`, se gliela si passa', () => {
    expect(mod({ o2: 0.32, he: 0 }, 1.4, 'fresh', barometric(2000))).toBeGreaterThan(
      mod({ o2: 0.32, he: 0 }, 1.4, 'fresh'),
    );
    expect(ppo2At({ o2: 0.32, he: 0 }, 40, 'fresh', barometric(2000))).toBeLessThan(
      ppo2At({ o2: 0.32, he: 0 }, 40, 'fresh'),
    );
  });
});

describe('il gas di transito e la PPO2 minima', () => {
  /*
   * `GasRole` prevede `'travel'` e l'interfaccia lo offre, ma nessun ramo del
   * motore lo usava per la discesa: 0 → 80 m si pianificavano sull'ipossica,
   * cioè PPO2 0.10 bar in superficie, e il piano usciva con zero avvisi
   * sull'ossigeno perché esistevano solo i limiti superiori.
   */
  const ipossica = { mix: { o2: 0.1, he: 0.7 }, role: 'bottom' as const, tankL: 24, startBar: 200 };
  const transito = { mix: { o2: 0.32, he: 0 }, role: 'travel' as const, tankL: 11, startBar: 200 };

  it('la discesa parte sul gas di transito e cambia alla sua MOD', () => {
    const p = planDeco([{ depthM: 80, minutes: 20 }], [ipossica, transito, EAN50, OSSIGENO], DEFAULT_DECO);
    const primo = p.segments[0];
    expect(primo.kind).toBe('descent');
    expect(primo.gasIndex).toBe(1);
    expect(primo.toM).toBeCloseTo(switchDepthOf(transito, DEFAULT_DECO), 0);
  });

  it('e non si inventa un cambio a zero metri al minuto zero', () => {
    const p = planDeco([{ depthM: 80, minutes: 20 }], [ipossica, transito], DEFAULT_DECO);
    expect(p.segments.some((x) => x.kind === 'switch' && x.fromM < 0.01)).toBe(false);
  });

  it('senza gas di transito, l’ipossica in superficie è un avviso critico', () => {
    const p = planDeco([{ depthM: 80, minutes: 20 }], [ipossica], DEFAULT_DECO);
    const avviso = p.warnings.find((w) => w.text.includes('non è respirabile'));
    expect(avviso?.level).toBe('critical');
  });

  it('e un gas senza ossigeno a quaranta metri non passa più pulito', () => {
    const senzaO2 = { mix: { o2: 0, he: 0.8 }, role: 'bottom' as const, tankL: 24, startBar: 200 };
    const p = planDeco([{ depthM: 40, minutes: 15 }], [senzaO2], DEFAULT_DECO);
    expect(p.warnings.some((w) => w.level === 'critical')).toBe(true);
  });
});

describe('l’ossigeno si accumula per giornata del LUOGO', () => {
  /*
   * La giornata si costruiva sui primi dieci caratteri dell'istante UTC, e una
   * giornata di immersioni la mezzanotte UTC la attraversa spesso. Quattro
   * immersioni dello stesso giovedì a Kiritimati diventavano due giornate da
   * 160 OTU invece di una da 320 — sotto invece che sopra la dose di
   * riferimento. L'errore è sempre verso il basso, e questo è un limite di
   * esposizione.
   */
  const tuffo = (startTime: string) => ({
    startTime,
    durationS: 2400,
    utcOffsetMinutes: 14 * 60,
    metrics: { otu: 80, cnsPct: 8 },
  });

  it('quattro immersioni dello stesso giovedì sono una giornata sola', () => {
    const load = oxygenLoad([
      tuffo('2026-03-11T18:00:00Z'),
      tuffo('2026-03-11T20:00:00Z'),
      tuffo('2026-03-12T02:00:00Z'),
      tuffo('2026-03-12T04:00:00Z'),
    ]);
    expect(load.days).toHaveLength(1);
    expect(load.days[0].date).toBe('2026-03-12');
    expect(load.days[0].otu).toBe(320);
    expect(load.daysOverOtu300).toBe(1);
  });
});

describe('la sosta di sicurezza è una permanenza, non una somma di passaggi', () => {
  /*
   * Due transiti da cento secondi fra tre e sei metri diventavano «sosta di
   * sicurezza di 5:05» con il pallino verde, senza che ci fosse stata nessuna
   * sosta di tre minuti. La sosta profonda, nella stessa funzione, il tratto
   * contiguo lo cercava già.
   */
  it('due passaggi non fanno una sosta', () => {
    const campioni: Sample[] = [];
    let t = 0;
    const scendi = (da: number, a: number, secondi: number) => {
      const passi = secondi / 10;
      for (let i = 1; i <= passi; i++) campioni.push({ t: (t += 10), depth: da + ((a - da) * i) / passi });
    };
    campioni.push({ t: 0, depth: 0 });
    scendi(0, 30, 120);
    campioni.push(...Array.from({ length: 60 }, () => ({ t: (t += 10), depth: 30 })));
    scendi(30, 4, 180);
    campioni.push(...Array.from({ length: 10 }, () => ({ t: (t += 10), depth: 4 })));
    scendi(4, 12, 60);
    scendi(12, 4, 60);
    campioni.push(...Array.from({ length: 10 }, () => ({ t: (t += 10), depth: 4 })));
    scendi(4, 0, 40);
    const m = computeMetrics({
      ...imm({ samples: campioni, maxDepth: 30, durationS: t }),
    });
    expect(m.safetyStopS).toBeLessThan(180);
    expect(m.didSafetyStop).toBe(false);
  });
});

describe('anni e mesi sono quelli del luogo, come nel logbook', () => {
  it('un’immersione alle Maldive l’1 gennaio non finisce nell’anno prima', () => {
    const dives = [
      imm({ id: 'a', startTime: '2025-12-31T23:30:00Z', utcOffsetMinutes: 300, minTempC: 29 }),
      imm({ id: 'b', startTime: '2026-01-02T05:00:00Z', utcOffsetMinutes: 300, minTempC: 29 }),
    ];
    const a = aggregate(dives);
    expect(a.byYear.find((x) => x.key === '2026')?.value).toBe(2);
    expect(a.byYear.find((x) => x.key === '2025')).toBeUndefined();
  });
});
