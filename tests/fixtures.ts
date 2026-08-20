/**
 * Generatore di immersioni sintetiche e dei relativi file in ogni formato.
 *
 * Serve a due cose: i test dei parser (lo stesso profilo scritto in cinque
 * formati diversi deve tornare identico nel modello canonico) e la generazione
 * dei dati dimostrativi con cui provare l'app senza esporre il proprio logbook.
 *
 * Il profilo è costruito per esercitare i casi che contano: una discesa, un
 * fondo con oscillazione controllabile, una sosta deco opzionale, una sosta di
 * sicurezza, e un consumo bombola coerente con la profondità.
 */

import { Encoder, Profile } from '@garmin/fitsdk';
import { gzipSync } from 'node:zlib';

export interface SyntheticSpec {
  startTime: Date;
  /** Profondità massima in metri. */
  maxDepth: number;
  /** Durata totale in secondi. */
  durationS: number;
  /** Passo di campionamento in secondi. */
  intervalS: number;
  /** Ampiezza dell'oscillazione in fase di fondo, metri. 0 = assetto perfetto. */
  wobbleM: number;
  /** Periodo dell'oscillazione, secondi. */
  wobblePeriodS: number;
  /** Velocità di risalita finale, m/min. */
  ascentRateMpm: number;
  /** Durata della sosta di sicurezza a 5 m, secondi. */
  safetyStopS: number;
  /** Consumo di superficie desiderato, L/min. */
  rmvLpm: number;
  tankSizeL: number;
  startBar: number;
  o2: number;
  he: number;
  siteName: string;
  /** Coordinate del sito: senza, i file dimostrativi finiscono tutti sullo stesso punto. */
  lat?: number;
  lon?: number;
  minTempC: number;
  surfaceTempC: number;
  /** Se > 0, genera un tetto deco che si abbassa e va rispettato. */
  decoCeilingM: number;
}

export const DEFAULT_SPEC: SyntheticSpec = {
  startTime: new Date('2026-06-14T10:38:00Z'),
  maxDepth: 32,
  durationS: 42 * 60,
  intervalS: 10,
  wobbleM: 0.6,
  wobblePeriodS: 180,
  ascentRateMpm: 9,
  safetyStopS: 240,
  rmvLpm: 18,
  tankSizeL: 12,
  startBar: 220,
  o2: 0.32,
  he: 0,
  siteName: 'Punta Chiappa',
  lat: 44.3167,
  lon: 9.15,
  minTempC: 15,
  surfaceTempC: 24,
  decoCeilingM: 0,
};

export interface SyntheticSample {
  t: number;
  depth: number;
  tempC: number;
  bar: number;
  ceiling: number;
  ndlS: number;
}

export interface Synthetic {
  spec: SyntheticSpec;
  samples: SyntheticSample[];
  endBar: number;
  avgDepth: number;
}

const G_DENSITY = (1030 * 9.80665) / 100_000; // bar per metro, acqua salata
const ATM = 1.01325;

export function synthesise(overrides: Partial<SyntheticSpec> = {}): Synthetic {
  const spec = { ...DEFAULT_SPEC, ...overrides };

  const descentS = Math.round((spec.maxDepth / 18) * 60); // 18 m/min di discesa
  // Risalita realistica in tre tratti: `ascentRateMpm` fino a 10 m, poi mai più
  // di 5 m/min fino alla sosta, poi 3 m/min per uscire. Un profilo generato con
  // una velocità costante fino in superficie violerebbe da solo il limite dei
  // 6 m/min sopra i 10 m, e i test sull'immersione "ben eseguita" mentirebbero.
  const deepAscentS = Math.max(0, ((spec.maxDepth - 10) / spec.ascentRateMpm) * 60);
  const shallowRate = Math.min(spec.ascentRateMpm, 5);
  const toStopS = (Math.min(5, spec.maxDepth) / shallowRate) * 60;
  const finalS = (5 / 3) * 60;
  const ascentTotal = deepAscentS + toStopS + spec.safetyStopS + finalS;
  const stopS = spec.safetyStopS;
  const bottomS = Math.max(60, spec.durationS - descentS - ascentTotal);

  const depthAt = (t: number): number => {
    if (t <= descentS) return (t / Math.max(1, descentS)) * spec.maxDepth;
    if (t <= descentS + bottomS) {
      const phase = ((t - descentS) / spec.wobblePeriodS) * 2 * Math.PI;
      return spec.maxDepth + Math.sin(phase) * spec.wobbleM;
    }
    const a = t - descentS - bottomS;
    if (a <= deepAscentS) return spec.maxDepth - (a / Math.max(1, deepAscentS)) * (spec.maxDepth - 10);
    if (a <= deepAscentS + toStopS) return 10 - ((a - deepAscentS) / toStopS) * 5;
    if (a <= deepAscentS + toStopS + stopS) return 5;
    const out = a - deepAscentS - toStopS - stopS;
    return Math.max(0, 5 - (out / finalS) * 5);
  };

  // Primo passaggio: il profilo e i litri consumati, per poter dimensionare la
  // bombola in modo che il gas NON finisca. Se finisse, la pressione si
  // appiattirebbe sul minimo e il consumo ricostruito dai test non
  // corrisponderebbe più a quello con cui il profilo è stato generato.
  const profile: { t: number; depth: number; litres: number }[] = [];
  let litres = 0;
  let prevT = 0;
  for (let t = 0; t <= spec.durationS; t += spec.intervalS) {
    const depth = Math.max(0, depthAt(t));
    const ata = (ATM + depth * G_DENSITY) / ATM;
    litres += spec.rmvLpm * ata * ((t - prevT) / 60);
    prevT = t;
    profile.push({ t, depth, litres });
  }

  const totalLitres = profile[profile.length - 1].litres;
  const RESERVE_BAR = 60; // resta sopra la riserva di 50 bar
  let tankSizeL = spec.tankSizeL;
  if (spec.startBar - totalLitres / tankSizeL < RESERVE_BAR) {
    tankSizeL = Math.ceil((totalLitres / (spec.startBar - RESERVE_BAR)) * 10) / 10;
  }
  spec.tankSizeL = tankSizeL;

  const samples: SyntheticSample[] = profile.map((p) => {
    const frac = p.depth / Math.max(1, spec.maxDepth);
    const tempC = spec.surfaceTempC - (spec.surfaceTempC - spec.minTempC) * Math.min(1, frac * 1.15);
    const inAscent = p.t > descentS + bottomS;
    const ceiling =
      spec.decoCeilingM > 0 && inAscent
        ? Math.max(0, spec.decoCeilingM - (p.t - descentS - bottomS) / 120)
        : 0;
    return {
      t: p.t,
      depth: Math.round(p.depth * 10) / 10,
      tempC: Math.round(tempC * 10) / 10,
      bar: Math.round((spec.startBar - p.litres / tankSizeL) * 10) / 10,
      ceiling: Math.round(ceiling * 10) / 10,
      ndlS: spec.decoCeilingM > 0 ? 0 : Math.max(0, 99 - Math.round(frac * 90)) * 60,
    };
  });

  const endBar = samples[samples.length - 1].bar;
  let area = 0;
  for (let i = 1; i < samples.length; i++) {
    area += ((samples[i].depth + samples[i - 1].depth) / 2) * (samples[i].t - samples[i - 1].t);
  }
  const avgDepth = area / (samples[samples.length - 1].t || 1);

  return { spec, samples, endBar: Math.round(endBar), avgDepth: Math.round(avgDepth * 100) / 100 };
}

// ---------------------------------------------------------------------------
// UDDF — tutto in SI: metri, secondi, Kelvin, Pascal, frazioni.
// ---------------------------------------------------------------------------

export function toUddf(s: Synthetic, diveNumber = 1): string {
  const { spec, samples } = s;
  const waypoints = samples
    .map(
      (w) => `        <waypoint>
          <divetime>${w.t}</divetime>
          <depth>${w.depth}</depth>
          <temperature>${(w.tempC + 273.15).toFixed(2)}</temperature>
          <tankpressure>${Math.round(w.bar * 100_000)}</tankpressure>
${w.ceiling > 0 ? `          <decostop kind="mandatory" decodepth="${w.ceiling}" duration="60"/>\n` : ''}${w.ndlS > 0 ? `          <nodecotime>${w.ndlS}</nodecotime>\n` : ''}        </waypoint>`,
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<uddf version="3.2.3">
  <generator><name>MyDiveLog fixtures</name></generator>
  <gasdefinitions>
    <mix id="mix1">
      <name>${spec.he > 0 ? `Tx${Math.round(spec.o2 * 100)}/${Math.round(spec.he * 100)}` : `EAN${Math.round(spec.o2 * 100)}`}</name>
      <o2>${spec.o2}</o2>
      <he>${spec.he}</he>
    </mix>
  </gasdefinitions>
  <divesite>
    <site id="site1">
      <name>${spec.siteName}</name>
      <geography>
        <location>Liguria</location>
        <country>Italia</country>
        <latitude>${(spec.lat ?? 44.3167).toFixed(4)}</latitude>
        <longitude>${(spec.lon ?? 9.15).toFixed(4)}</longitude>
      </geography>
    </site>
  </divesite>
  <profiledata>
    <repetitiongroup id="rg1">
      <dive id="dive${diveNumber}">
        <informationbeforedive>
          <datetime>${spec.startTime.toISOString()}</datetime>
          <divenumber>${diveNumber}</divenumber>
          <airtemperature>${(spec.surfaceTempC + 273.15 + 2).toFixed(2)}</airtemperature>
          <surfacepressure>101325</surfacepressure>
          <link ref="site1"/>
        </informationbeforedive>
        <tankdata>
          <link ref="mix1"/>
          <tankvolume>${(spec.tankSizeL / 1000).toFixed(4)}</tankvolume>
          <tankpressurebegin>${Math.round(spec.startBar * 100_000)}</tankpressurebegin>
          <tankpressureend>${Math.round(s.endBar * 100_000)}</tankpressureend>
        </tankdata>
        <samples>
${waypoints}
        </samples>
        <informationafterdive>
          <greatestdepth>${Math.max(...samples.map((w) => w.depth))}</greatestdepth>
          <averagedepth>${s.avgDepth}</averagedepth>
          <diveduration>${spec.durationS}</diveduration>
          <lowesttemperature>${(Math.min(...samples.map((w) => w.tempC)) + 273.15).toFixed(2)}</lowesttemperature>
          <notes>Immersione sintetica per i test.</notes>
        </informationafterdive>
      </dive>
    </repetitiongroup>
  </profiledata>
</uddf>
`;
}

// ---------------------------------------------------------------------------
// Subsurface — unità nella stringa, campioni delta-codificati.
// ---------------------------------------------------------------------------

export function toSubsurface(s: Synthetic, diveNumber = 1): string {
  const { spec, samples } = s;
  let lastTemp: number | undefined;
  let lastPressure: number | undefined;

  const rows = samples
    .map((w) => {
      const parts = [`time='${mmss(w.t)} min'`, `depth='${w.depth} m'`];
      // Delta: la temperatura viene scritta solo quando cambia.
      const temp = Math.round(w.tempC);
      if (temp !== lastTemp) {
        parts.push(`temp='${temp}.0 C'`);
        lastTemp = temp;
      }
      const bar = Math.round(w.bar);
      if (bar !== lastPressure) {
        parts.push(`pressure0='${bar} bar'`);
        lastPressure = bar;
      }
      if (w.ceiling > 0) parts.push(`stopdepth='${Math.round(w.ceiling)} m'`, `in_deco='1'`);
      return `      <sample ${parts.join(' ')} />`;
    })
    .join('\n');

  const date = spec.startTime.toISOString().slice(0, 10);
  const time = spec.startTime.toISOString().slice(11, 19);

  return `<divelog program='mydivelog-fixtures' version='3'>
<divesites>
  <site uuid='a1b2c3d4' name='${spec.siteName}' gps='${(spec.lat ?? 44.3167).toFixed(6)} ${(spec.lon ?? 9.15).toFixed(6)}' description='Liguria'/>
</divesites>
<dives>
<dive number='${diveNumber}' date='${date}' time='${time}' duration='${mmss(spec.durationS)} min' divesiteid='a1b2c3d4' tags='parete,nitrox'>
  <cylinder size='${spec.tankSizeL.toFixed(1)} l' workpressure='232 bar' start='${spec.startBar} bar' end='${s.endBar} bar' o2='${(spec.o2 * 100).toFixed(1)}%' he='${(spec.he * 100).toFixed(1)}%' description='D${Math.round(spec.tankSizeL)}'/>
  <divecomputer model='Shearwater Peregrine' deviceid='0a1b2c3d' diveid='${(diveNumber * 7919).toString(16)}'>
    <depth max='${Math.max(...samples.map((w) => w.depth))} m' mean='${s.avgDepth.toFixed(3)} m'/>
${rows}
  </divecomputer>
</dive>
</dives>
</divelog>
`;
}

// ---------------------------------------------------------------------------
// Shearwater XML — mezzi PSI, millibar, e con opzione imperiale.
// ---------------------------------------------------------------------------

export function toShearwaterXml(
  s: Synthetic,
  opts: { imperial?: boolean; diveNumber?: number; gf?: { low: number; high: number } } = {},
): string {
  const { spec, samples } = s;
  const imperial = opts.imperial ?? false;
  const num = opts.diveNumber ?? 1;
  /*
   * I gradient factor si possono scegliere, e il valore predefinito resta
   * quello di prima.
   *
   * Serve a costruire un archivio in cui il computer ha CAMBIATO impostazioni
   * a un certo punto — il caso vero di questo progetto, il Peregrine passato da
   * 45/95 a 20/85. È la condizione che fa comparire la carta «Impostazioni del
   * computer nel tempo», e senza un archivio dimostrativo che la soddisfa
   * quella carta non veniva mai disegnata da nessun controllo automatico: il
   * suo difetto di larghezza è stato trovato dall'utente, sul telefono.
   */
  const gf = opts.gf ?? { low: 30, high: 85 };
  const depth = (m: number) => (imperial ? m / 0.3048 : m).toFixed(imperial ? 1 : 2);
  const temp = (c: number) => (imperial ? (c * 9) / 5 + 32 : c).toFixed(1);
  // Il campo è in MEZZI PSI: bar → psi → /2.
  const halfPsi = (bar: number) => Math.round((bar * 14.5037738007) / 2);

  const records = samples
    .map(
      (w) => `    <diveLogRecord>
      <currentTime>${w.t * 1000}</currentTime>
      <currentDepth>${depth(w.depth)}</currentDepth>
      <waterTemp>${temp(w.tempC)}</waterTemp>
      <averagePPO2>${Math.round(spec.o2 * (1.01325 + w.depth * 0.101) * 100)}</averagePPO2>
      <currentNdl>${Math.round(w.ndlS / 60)}</currentNdl>
      <firstStopDepth>${w.ceiling > 0 ? depth(w.ceiling) : '0'}</firstStopDepth>
      <firstStopTime>${w.ceiling > 0 ? 1 : 0}</firstStopTime>
      <decoCeiling>${w.ceiling > 0 ? depth(w.ceiling) : '0'}</decoCeiling>
      <fractionO2>${Math.round(spec.o2 * 100)}</fractionO2>
      <fractionHe>${Math.round(spec.he * 100)}</fractionHe>
      <currentCircuitSetting>0</currentCircuitSetting>
      <CNSPercent>${Math.min(99, Math.round((w.t / 60) * 0.4))}</CNSPercent>
      <tank0pressurePSI>${halfPsi(w.bar)}</tank0pressurePSI>
    </diveLogRecord>`,
    )
    .join('\n');

  return `<?xml version="1.0" encoding="utf-8"?>
<dive>
  <diveLog>
    <computerModel>Peregrine</computerModel>
    <computerSerial>SW${1000 + num}</computerSerial>
    <computerFirmware>92</computerFirmware>
    <number>${num}</number>
    <startDate>${spec.startTime.toISOString().slice(0, 19).replace('T', ' ')}</startDate>
    <maxTime>${spec.durationS}</maxTime>
    <maxDepth>${depth(Math.max(...samples.map((w) => w.depth)))}</maxDepth>
    <startSurfacePressure>1013</startSurfacePressure>
    <imperialUnits>${imperial ? 1 : 0}</imperialUnits>
    <decoModel>GF</decoModel>
    <gfMin>${gf.low}</gfMin>
    <gfMax>${gf.high}</gfMax>
    <diveLogRecords>
${records}
    </diveLogRecords>
  </diveLog>
</dive>
`;
}

// ---------------------------------------------------------------------------
// CSV di riepilogo — nessun profilo, intestazioni in italiano per verificare
// la mappatura per alias.
// ---------------------------------------------------------------------------

export function toCsv(dives: Synthetic[]): string {
  const header = [
    'N',
    'Data',
    'Ora',
    'Sito',
    'Profondità max',
    'Durata',
    'Temperatura acqua',
    'Pressione iniziale',
    'Pressione finale',
    'Bombola',
    'O2',
    'Compagno',
    'Note',
  ].join(',');

  const rows = dives.map((s, i) => {
    const d = s.spec.startTime;
    return [
      i + 1,
      `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`,
      `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`,
      `"${s.spec.siteName}"`,
      // La profondità effettiva raggiunta, non quella nominale: è ciò che un
      // logbook cartaceo riporta, ed è ciò che permette alla deduplica di
      // riconoscere la stessa immersione arrivata anche dal computer.
      Math.max(...s.samples.map((w) => w.depth)).toFixed(1),
      Math.round(s.spec.durationS / 60),
      s.spec.minTempC.toFixed(1),
      s.spec.startBar,
      s.endBar,
      s.spec.tankSizeL,
      Math.round(s.spec.o2 * 100),
      'Marco',
      '"Riga da foglio di calcolo"',
    ].join(',');
  });

  return [header, ...rows].join('\n');
}

// ---------------------------------------------------------------------------
// Garmin FIT — file binario vero, generato con l'Encoder ufficiale.
// ---------------------------------------------------------------------------

export function toFit(s: Synthetic): Uint8Array {
  const { spec, samples } = s;
  const encoder = new Encoder();
  const start = spec.startTime;
  const SENSOR = 1234;

  // Le dichiarazioni TypeScript dell'SDK descrivono `Mesg` in modo più stretto
  // di quanto l'implementazione accetti (i campi dei messaggi subacquei non ci
  // sono). Un unico punto di conversione invece di un cast per messaggio.
  const write = (mesgNum: number, fields: Record<string, unknown>) =>
    encoder.onMesg(mesgNum, fields as never);

  write(Profile.MesgNum.FILE_ID, {
    type: 'activity',
    manufacturer: 'garmin',
    product: 3258,
    serialNumber: 3900000001,
    timeCreated: start,
  });

  write(Profile.MesgNum.DEVICE_INFO, {
    timestamp: start,
    manufacturer: 'garmin',
    product: 3258,
    serialNumber: 3900000001,
  });

  write(Profile.MesgNum.DIVE_SETTINGS, {
    messageIndex: 0,
    waterType: 'salt',
    gfLow: 30,
    gfHigh: 85,
  });

  write(Profile.MesgNum.DIVE_GAS, {
    messageIndex: 0,
    oxygenContent: Math.round(spec.o2 * 100),
    heliumContent: Math.round(spec.he * 100),
    // L'Encoder dell'SDK vuole i nomi degli enum in camelCase, non in
    // snake_case come il Profile.xlsx di Garmin: `open_circuit` fa fallire la
    // scrittura del messaggio senza dire perché.
    status: 'enabled',
    mode: 'openCircuit',
  });

  for (const w of samples) {
    const at = new Date(start.getTime() + w.t * 1000);
    write(Profile.MesgNum.RECORD, {
      timestamp: at,
      // L'SDK applica scale e offset: qui passiamo metri e Celsius.
      depth: w.depth,
      temperature: Math.round(w.tempC),
      absolutePressure: Math.round((1.01325 + w.depth * 0.10105) * 100_000),
      nextStopDepth: w.ceiling > 0 ? w.ceiling : 0,
      nextStopTime: w.ceiling > 0 ? 60 : 0,
      ndlTime: w.ndlS,
      cnsLoad: Math.min(99, Math.round((w.t / 60) * 0.4)),
    });
    write(Profile.MesgNum.TANK_UPDATE, {
      timestamp: at,
      sensor: SENSOR,
      pressure: w.bar,
    });
  }

  const litresUsed = (spec.startBar - s.endBar) * spec.tankSizeL;
  write(Profile.MesgNum.TANK_SUMMARY, {
    timestamp: new Date(start.getTime() + spec.durationS * 1000),
    sensor: SENSOR,
    startPressure: spec.startBar,
    endPressure: s.endBar,
    volumeUsed: litresUsed,
  });

  write(Profile.MesgNum.DIVE_SUMMARY, {
    timestamp: new Date(start.getTime() + spec.durationS * 1000),
    referenceMesg: 'session',
    referenceIndex: 0,
    avgDepth: s.avgDepth,
    maxDepth: Math.max(...samples.map((w) => w.depth)),
    diveNumber: 1,
    surfaceInterval: 3600,
    bottomTime: spec.durationS,
  });

  write(Profile.MesgNum.SESSION, {
    messageIndex: 0,
    timestamp: new Date(start.getTime() + spec.durationS * 1000),
    startTime: start,
    totalElapsedTime: spec.durationS,
    totalTimerTime: spec.durationS,
    sport: 'diving',
    subSport: 'singleGasDiving',
    maxDepth: Math.max(...samples.map((w) => w.depth)),
  });

  write(Profile.MesgNum.ACTIVITY, {
    timestamp: new Date(start.getTime() + spec.durationS * 1000),
    totalTimerTime: spec.durationS,
    numSessions: 1,
    type: 'manual',
    event: 'activity',
    eventType: 'stop',
  });

  return encoder.close();
}

// ---------------------------------------------------------------------------

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

// ---------------------------------------------------------------------------
// Uwatec Smart / Scubapro LogTRAK — encoder sintetico.
//
// Serve a testare il decoder senza usare un file personale: costruiamo un blob
// valido con valori scelti e verifichiamo che tornino identici. Copre l'unica
// parte del formato che si può sbagliare in silenzio — delta con segno,
// larghezza dei record, endianness — perché la produce nello stesso modo in cui
// il decoder si aspetta di leggerla.
// ---------------------------------------------------------------------------

/** Byte per unità: l'intestazione usa 1 mbar, i campioni 2 mbar. */
const HEADER_DEPTH_PER_M = 102.5; // acqua salata
const SAMPLE_DEPTH_PER_M = 51.25;

export interface UwatecFixtureSpec {
  startTime: Date;
  utcOffsetMinutes: number;
  /** Profondità in metri, un valore ogni 4 secondi. */
  depths: number[];
  /** Temperature in °C, stessa lunghezza di `depths` (o vuoto). */
  temps?: number[];
  o2?: number;
  he?: number;
  startBar?: number;
  endBar?: number;
  salt?: boolean;
}

/** Costruisce un record Uwatec Smart nel layout "trimix" da 84 byte (modello 0x17). */
export function encodeUwatecSmart(spec: UwatecFixtureSpec): Uint8Array {
  const salt = spec.salt ?? true;
  const headerPerM = salt ? HEADER_DEPTH_PER_M : 100;
  const samplePerM = salt ? SAMPLE_DEPTH_PER_M : 50;

  const body: number[] = [];

  // Miscela, come record MISC subtype 32. È l'unica fonte di gas per questo modello.
  const o2 = Math.round((spec.o2 ?? 0.21) * 100);
  const he = Math.round((spec.he ?? 0) * 100);
  const beg = Math.round((spec.startBar ?? 0) * 128);
  const end = Math.round((spec.endBar ?? 0) * 128);
  const payload = [32, o2 & 0xff, o2 >> 8, he & 0xff, he >> 8, beg & 0xff, beg >> 8, end & 0xff, end >> 8];
  body.push(0xfb, payload.length + 1, ...payload);

  // Primo campione: profondità assoluta (0xF1) e temperatura assoluta (0xF3).
  const rawDepth = spec.depths.map((d) => Math.round(d * samplePerM));
  const rawTemp = (spec.temps ?? []).map((t) => Math.round(t * 2.5));

  // La temperatura PRIMA della profondità: è il record di profondità a chiudere
  // il campione, quindi tutto ciò che deve comparire nel primo campione va emesso
  // prima. Invertendo l'ordine, il primo campione uscirebbe senza temperatura.
  if (rawTemp.length) {
    body.push(0xf3, (rawTemp[0] >> 8) & 0xff, rawTemp[0] & 0xff);
  }
  body.push(0xf1, (rawDepth[0] >> 8) & 0xff, rawDepth[0] & 0xff);

  let prevDepth = rawDepth[0];
  let prevTemp = rawTemp.length ? rawTemp[0] : 0;
  for (let i = 1; i < rawDepth.length; i++) {
    if (rawTemp.length) {
      const dt = rawTemp[i] - prevTemp;
      if (dt !== 0) {
        if (dt >= -8 && dt <= 7)
          body.push(0xb0 | (dt & 0x0f)); // 1011dddd, 4 bit con segno
        else body.push(0xf3, (rawTemp[i] >> 8) & 0xff, rawTemp[i] & 0xff);
        prevTemp = rawTemp[i];
      }
    }
    const dd = rawDepth[i] - prevDepth;
    if (dd >= -64 && dd <= 63) {
      body.push(dd & 0x7f); // 0ddddddd, 7 bit con segno
    } else {
      body.push(0xf1, (rawDepth[i] >> 8) & 0xff, rawDepth[i] & 0xff);
    }
    prevDepth = rawDepth[i];
  }

  const total = 84 + body.length;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  out.set([0xa5, 0xa5, 0x5a, 0x5a], 0);
  view.setUint32(4, total, true);
  // Tempo del dispositivo: mezzi secondi dal 2000-01-01.
  const halfSeconds = Math.round(((spec.startTime.getTime() - 946_684_800_000) / 1000) * 2);
  view.setUint32(8, halfSeconds, true);
  view.setInt8(16, Math.round(spec.utcOffsetMinutes / 15));

  const maxDepth = Math.max(...spec.depths);
  const area = spec.depths.slice(1).reduce((a, d, i) => a + ((d + spec.depths[i]) / 2) * 4, 0);
  const span = (spec.depths.length - 1) * 4;
  view.setUint16(22, Math.round(maxDepth * headerPerM), true);
  view.setUint16(24, Math.round((span ? area / span : 0) * headerPerM), true);
  view.setUint16(26, Math.round(span / 60), true);
  if (spec.temps?.length) {
    view.setInt16(28, Math.round(Math.max(...spec.temps) * 10), true);
    view.setInt16(30, Math.round(Math.min(...spec.temps) * 10), true);
    view.setInt16(32, Math.round(spec.temps[0] * 10), true);
  }
  view.setUint32(68, salt ? 0x0010_0000 : 0, true);
  out.set(body, 84);
  return out;
}

/** Avvolge uno o più record in un file `.logtrak` plausibile. */
export function toLogtrak(specs: UwatecFixtureSpec[], opts: { withProfile?: boolean } = {}): string {
  const withProfile = opts.withProfile ?? true;
  const bytesToB64 = (b: Uint8Array) => {
    let s = '';
    for (const v of b) s += String.fromCharCode(v);
    return typeof btoa === 'function'
      ? btoa(s)
      : (
          globalThis as unknown as {
            Buffer: { from(x: Uint8Array): { toString(e: string): string } };
          }
        ).Buffer.from(b).toString('base64');
  };

  return JSON.stringify({
    checksum: 'x'.repeat(64),
    version: 3,
    dives: specs.map((spec, i) => {
      const durationS = (spec.depths.length - 1) * 4;
      return {
        id: `dive-${i}`,
        userId: 'test',
        diveLogBase64: withProfile ? bytesToB64(encodeUwatecSmart(spec)) : null,
        label: `Sito ${i + 1}, Punto`,
        rating: 4,
        buddyNames: ['Marco'],
        guideNames: [],
        notes: 'Nota di prova.',
        weight: 8,
        conditionWeather: 'sunny',
        conditionVisibility: 12,
        conditionWaves: 'calm',
        equipmentIds: [],
        diveSiteId: `site-${i}`,
        utcDifferenceMinutes: spec.utcOffsetMinutes,
        startTime: spec.startTime.toISOString(),
        endTime: new Date(spec.startTime.getTime() + durationS * 1000).toISOString(),
        diveComputerId: 'dc-1',
        saltwaterCalibrated: spec.salt ?? true,
        depthMetersMax: Math.round(Math.max(...spec.depths) * 100) / 100,
        waterTempCelsiusMin: spec.temps?.length ? Math.min(...spec.temps) : undefined,
        waterTempCelsiusMax: spec.temps?.length ? Math.max(...spec.temps) : undefined,
        diveMode: 'scuba',
        tankData: {
          tank1: {
            o2Mixture: Math.round((spec.o2 ?? 0.21) * 100),
            heMixture: spec.he ? Math.round(spec.he * 100) : null,
            startPressure: spec.startBar ?? 200,
            endPressure: spec.endBar ?? 60,
            size: 'l_15',
            type: 'steel',
          },
        },
      };
    }),
    equipment: {
      diveComputers: [
        {
          id: 'dc-1',
          serialNumber: '6305611325',
          swVersion: '2.1',
          deviceTypeNumber: 0x17,
          deviceType: 'aladin_sport',
          name: 'Aladin',
        },
      ],
      gears: [],
    },
    diveSites: specs.map((_, i) => ({
      id: `site-${i}`,
      name: i % 2 === 0 ? `RECCO, PUNTO ${i}` : `Numana, Punto ${i}`,
      lat: null,
      lng: null,
    })),
    images: {},
  });
}

/** Profilo in metri, un valore ogni 4 secondi, dalle stesse specifiche dei fixture. */
export function depthSeries(s: Synthetic): number[] {
  const out: number[] = [];
  const step = 4;
  const byT = new Map(s.samples.map((x) => [x.t, x.depth]));
  for (let t = 0; t <= s.spec.durationS; t += step) {
    // Interpolazione lineare fra i campioni del fixture.
    const exact = byT.get(t);
    if (exact !== undefined) {
      out.push(exact);
      continue;
    }
    const before = s.samples.filter((x) => x.t <= t).pop();
    const after = s.samples.find((x) => x.t > t);
    if (!before) out.push(s.samples[0].depth);
    else if (!after) out.push(before.depth);
    else {
      const f = (t - before.t) / (after.t - before.t);
      out.push(Math.round((before.depth + (after.depth - before.depth) * f) * 100) / 100);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Log nativo Shearwater ("sw-pnf")
// ---------------------------------------------------------------------------

export interface PnfFixtureSpec {
  /** Profondità in metri per ogni campione, nell'ordine. */
  depths: number[];
  /** Temperatura in gradi Celsius interi, uno per campione (o costante). */
  tempC: number | number[];
  intervalS: number;
  gfLow: number;
  gfHigh: number;
  /** 0 = Bühlmann+GF, 1 = VPM-B, 2 = VPM-B/GFS, 3 = DCIEM. */
  decoModelCode: number;
  o2Percent: number;
  hePercent: number;
  /** Densità impostata: 1000 dolce, 1020 mare. */
  waterDensity: number;
  /** Millibar. */
  surfaceMbar: number;
  /** Modello: 9 = Peregrine. */
  modelNumber: number;
  serial: number;
  /** BCD, es. 0x89 = v89. */
  firmwareBcd: number;
  logVersion: number;
  /** Tetto deco in metri per ogni campione (0 = nessuno). */
  ceilingM?: number[];
  /** Minuti: durata della tappa quando c'è un tetto, NDL quando non c'è. */
  minutes?: number[];
  /** TTS in minuti per campione. */
  ttsMin?: number[];
  /** CNS in percento per campione. */
  cnsPct?: number[];
  /** Pressione della prima bombola in bar per campione. */
  tank1Bar?: number[];
  /** Coordinate di ingresso, se il computer ha il GPS. */
  entry?: { lat: number; lon: number };
}

export const DEFAULT_PNF: PnfFixtureSpec = {
  depths: [],
  tempC: 18,
  intervalS: 10,
  gfLow: 45,
  gfHigh: 95,
  decoModelCode: 0,
  o2Percent: 21,
  hePercent: 0,
  waterDensity: 1020,
  surfaceMbar: 1013,
  modelNumber: 9,
  serial: 0xa1b2c3d4,
  firmwareBcd: 0x89,
  logVersion: 14,
};

/**
 * Costruisce un log nativo Shearwater con valori SCELTI, per verificare che il
 * decoder li ritrovi esattamente.
 *
 * Il punto di un fixture così è che i numeri sono noti in partenza: sui log reali
 * si può solo confrontare con ciò che l'applicazione di Shearwater calcola, che
 * verifica l'insieme ma non i singoli campi (una PPO2 o un CNS sbagliati non
 * cambiano la profondità media).
 */
export function encodePnf(overrides: Partial<PnfFixtureSpec> = {}): Uint8Array {
  const spec = { ...DEFAULT_PNF, ...overrides };
  const records: Uint8Array[] = [];
  const rec = (type: number, fill: (r: Uint8Array) => void = () => {}) => {
    const r = new Uint8Array(32);
    r[0] = type;
    fill(r);
    records.push(r);
    return r;
  };
  const be16 = (r: Uint8Array, at: number, v: number) => {
    r[at] = (v >> 8) & 0xff;
    r[at + 1] = v & 0xff;
  };
  const be32 = (r: Uint8Array, at: number, v: number) => {
    r[at] = (v >>> 24) & 0xff;
    r[at + 1] = (v >>> 16) & 0xff;
    r[at + 2] = (v >>> 8) & 0xff;
    r[at + 3] = v & 0xff;
  };

  // Apertura 0: GF, unità, prima miscela.
  rec(0x10, (r) => {
    r[4] = spec.gfLow;
    r[5] = spec.gfHigh;
    r[8] = 0; // metrico
    r[20] = spec.o2Percent;
    r[30] = spec.hePercent;
  });
  // Apertura 1: pressione atmosferica.
  rec(0x11, (r) => be16(r, 16, spec.surfaceMbar));
  // Apertura 2: modello decompressivo e conservatorismo.
  rec(0x12, (r) => {
    r[18] = spec.decoModelCode;
    r[19] = 3;
  });
  // Apertura 3: densità dell'acqua.
  rec(0x13, (r) => be16(r, 3, spec.waterDensity));
  // Apertura 4: versione del log, gas abilitati, modalità, integrazione aria.
  rec(0x14, (r) => {
    r[1] = 6; // oc-rec
    r[16] = spec.logVersion;
    be16(r, 17, 0x0001); // solo la prima miscela abilitata
    r[28] = spec.tank1Bar ? 1 : 0;
  });
  // Apertura 5: passo di campionamento in millisecondi.
  rec(0x15, (r) => be16(r, 23, spec.intervalS * 1000));
  if (spec.entry) {
    rec(0x19, (r) => {
      r[16] = 3; // fix 3D
      be32(r, 21, Math.round(spec.entry!.lat * 100000));
      be32(r, 25, Math.round(spec.entry!.lon * 100000));
    });
  }

  // Campioni.
  spec.depths.forEach((depth, i) => {
    rec(0x01, (r) => {
      be16(r, 1, Math.round(depth * 10));
      const ceiling = spec.ceilingM?.[i] ?? 0;
      be16(r, 3, Math.round(ceiling));
      be16(r, 5, spec.ttsMin?.[i] ?? 0);
      r[8] = spec.o2Percent;
      r[9] = spec.hePercent;
      r[10] = spec.minutes?.[i] ?? 0;
      r[12] = 0x10; // circuito aperto
      const temp = Array.isArray(spec.tempC) ? spec.tempC[i] : spec.tempC;
      r[14] = temp < 0 ? 256 + temp : temp;
      r[23] = spec.cnsPct?.[i] ?? 0;
      if (spec.tank1Bar?.[i] !== undefined) {
        // Unità di 2 psi, come le scrive il computer.
        const units = Math.round((spec.tank1Bar[i] * 100000) / (2 * 6894.75729));
        be16(r, 28, units);
      } else if (spec.tank1Bar) {
        be16(r, 28, 0xffff); // integrazione accesa ma senza comunicazione
      }
    });
  });

  // Chiusura 0: profondità massima e durata.
  const maxDepth = Math.max(...spec.depths, 0);
  const durationS = spec.depths.length * spec.intervalS;
  rec(0x20, (r) => {
    be16(r, 4, Math.round(maxDepth * 10));
    r[6] = (durationS >> 16) & 0xff;
    r[7] = (durationS >> 8) & 0xff;
    r[8] = durationS & 0xff;
  });
  // Record finale: modello, seriale, firmware.
  rec(0xff, (r) => {
    be32(r, 2, spec.serial);
    r[10] = spec.firmwareBcd;
    r[13] = spec.modelNumber;
  });
  // Spazio non usato in fondo, come nella memoria vera del computer.
  records.push(new Uint8Array(32), new Uint8Array(32));

  const out = new Uint8Array(records.length * 32);
  records.forEach((r, i) => out.set(r, i * 32));
  return out;
}

/**
 * Confeziona un log come lo salva Shearwater Cloud: 4 byte di lunghezza in
 * little-endian, poi gzip, poi del riempimento — che è la trappola su cui il
 * primo tentativo di lettura si è rotto, perché il piede del gzip non è in fondo
 * al blob.
 */
export function packPnfBlob(raw: Uint8Array, padding = 5): Uint8Array {
  const gz = gzipSync(Buffer.from(raw));
  const out = new Uint8Array(4 + gz.length + padding);
  out[0] = raw.length & 0xff;
  out[1] = (raw.length >> 8) & 0xff;
  out[2] = (raw.length >> 16) & 0xff;
  out[3] = (raw.length >> 24) & 0xff;
  out.set(gz, 4);
  return out;
}
