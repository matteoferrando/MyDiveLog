/**
 * Decodifica del formato binario Uwatec/Scubapro "Smart".
 *
 * È il blob che LogTRAK esporta in base64 dentro `diveLogBase64`, e contiene il
 * profilo che il JSON non ha. Riscritto in TypeScript da
 * `libdivecomputer/src/uwatec_smart_parser.c`, che è l'unica descrizione
 * affidabile del formato: la specifica pubblica del 2007 (progetto Diversity)
 * copre le famiglie vecchie e ha imprecisioni (dichiara "big endian" e poi dà
 * `byte0 + (byte1<<8)`, che è little endian).
 *
 * PERCHÉ QUESTO FILE È DELICATO
 *
 * Il flusso dei campioni è un bitstream a lunghezza variabile: il tipo di record
 * si legge dai bit alti del primo byte, e i valori sono DELTA con segno accumulati
 * su uno stato. Un errore in un solo punto — un'estensione del segno sbagliata,
 * un byte contato male — non produce un errore: produce un profilo plausibile e
 * falso, che scorre a caso da lì in poi. Per questo:
 *
 *  - le tabelle sono copiate verbatim, nell'ordine dei campi dell'originale
 *    (`type, absolute, index, ntypebits, ignoretype, extrabytes`);
 *  - l'intestazione è LITTLE endian, i dati dentro un record sono BIG endian.
 *    Sono davvero diversi, non è un errore di trascrizione;
 *  - `decodeUwatecSmart` restituisce quanti byte ha consumato, e il chiamante
 *    verifica che coincidano con la lunghezza dichiarata. È il controllo che
 *    prende un disallineamento di un byte.
 *
 * VERIFICATO su 85 immersioni reali di un Aladin Sport Matrix: temperature
 * minima e massima esatte al quanto del sensore (0.4 °C), profondità massima
 * entro 33 cm su tutte (l'intestazione ha risoluzione doppia rispetto ai
 * campioni), zero byte residui, zero errori di formato.
 */

/** Millisecondi fra l'epoca Uwatec (2000-01-01 UTC) e quella Unix. */
const UWATEC_EPOCH_MS = 946_684_800_000;

const BAR_PA = 100_000;
export const DENSITY_SALT = 1025;
export const DENSITY_FRESH = 1000;

/** Bit della parola di configurazione. */
const SETTING = {
  freedive: 0x0000_0080,
  gauge: 0x0000_1000,
  salinity: 0x0010_0000,
} as const;

type SampleKind =
  | 'pressureDepth'
  | 'rbt'
  | 'temperature'
  | 'pressure'
  | 'depth'
  | 'heartrate'
  | 'bearing'
  | 'alarms'
  | 'time'
  | 'apnea'
  | 'misc';

interface RecordInfo {
  kind: SampleKind;
  absolute: boolean;
  /** Indice del serbatoio o del gruppo di allarmi. */
  index: number;
  ntypebits: number;
  ignoretype: boolean;
  extrabytes: number;
}

const rec = (
  kind: SampleKind,
  absolute: number,
  index: number,
  ntypebits: number,
  ignoretype: number,
  extrabytes: number,
): RecordInfo => ({
  kind,
  absolute: absolute === 1,
  index,
  ntypebits,
  ignoretype: ignoretype === 1,
  extrabytes,
});

/**
 * `uwatec_smart_galileo_samples` — usata da Galileo, Meridian, G2/G3, Chromis,
 * Mantis, Aladin Square/A1/A2/Sport Matrix, Luna 2. È la tabella dei computer
 * moderni, quindi quella che serve per qualunque export LogTRAK recente.
 */
const GALILEO_SAMPLES: RecordInfo[] = [
  rec('depth', 0, 0, 1, 0, 0), //        0ddd dddd  delta profondità, 7 bit con segno
  rec('rbt', 0, 0, 3, 0, 0), //          100d dddd  delta RBT, 5 bit
  rec('pressure', 0, 0, 4, 0, 0), //     1010 dddd  delta pressione, 4 bit
  rec('temperature', 0, 0, 4, 0, 0), //  1011 dddd  delta temperatura, 4 bit
  rec('time', 1, 0, 4, 0, 0), //         1100 dddd  ripeti l'ultimo campione N volte
  rec('heartrate', 0, 0, 4, 0, 0), //    1101 dddd
  rec('alarms', 1, 0, 4, 0, 0), //       1110 dddd  gruppo allarmi 0
  rec('alarms', 1, 1, 8, 0, 1), //       0xF0 + 1   gruppo allarmi 1
  rec('depth', 1, 0, 8, 0, 2), //        0xF1 + 2   profondità assoluta
  rec('rbt', 1, 0, 8, 0, 1), //          0xF2 + 1
  rec('temperature', 1, 0, 8, 0, 2), //  0xF3 + 2   temperatura assoluta
  rec('pressure', 1, 0, 8, 0, 2), //     0xF4 + 2   pressione assoluta serbatoio 0
  rec('pressure', 1, 1, 8, 0, 2), //     0xF5 + 2
  rec('pressure', 1, 2, 8, 0, 2), //     0xF6 + 2
  rec('heartrate', 1, 0, 8, 0, 1), //    0xF7 + 1
  rec('bearing', 1, 0, 8, 0, 2), //      0xF8 + 2
  rec('alarms', 1, 2, 8, 0, 1), //       0xF9 + 1   gruppo allarmi 2 (gas su trimix)
  rec('apnea', 1, 0, 8, 0, 0), //        0xFA       payload di 8 byte, non documentato
  rec('misc', 1, 0, 8, 0, 1), //         0xFB + len miscele e dati vari
];

/** `uwatec_smart_pro_samples` / `uwatec_smart_aladin_samples`: famiglie vecchie. */
const SMART_PRO_SAMPLES: RecordInfo[] = [
  rec('depth', 0, 0, 1, 0, 0),
  rec('temperature', 0, 0, 2, 0, 0),
  rec('time', 1, 0, 3, 0, 0),
  rec('alarms', 1, 0, 4, 0, 0),
  rec('depth', 0, 0, 5, 0, 1),
  rec('temperature', 0, 0, 6, 0, 1),
  rec('depth', 1, 0, 7, 1, 2),
  rec('temperature', 1, 0, 8, 0, 2),
];

const ALADIN_SAMPLES: RecordInfo[] = [...SMART_PRO_SAMPLES, rec('alarms', 1, 1, 9, 0, 0)];

const SMART_COM_SAMPLES: RecordInfo[] = [
  rec('pressureDepth', 0, 0, 1, 0, 1),
  rec('rbt', 0, 0, 2, 0, 0),
  rec('temperature', 0, 0, 3, 0, 0),
  rec('pressure', 0, 0, 4, 0, 1),
  rec('depth', 0, 0, 5, 0, 1),
  rec('temperature', 0, 0, 6, 0, 1),
  rec('alarms', 1, 0, 7, 1, 1),
  rec('time', 1, 0, 8, 0, 1),
  rec('depth', 1, 0, 9, 1, 2),
  rec('pressure', 1, 0, 10, 1, 2),
  rec('temperature', 1, 0, 11, 1, 2),
  rec('rbt', 1, 0, 12, 1, 1),
];

const SMART_TEC_SAMPLES: RecordInfo[] = [
  rec('pressureDepth', 0, 0, 1, 0, 1),
  rec('rbt', 0, 0, 2, 0, 0),
  rec('temperature', 0, 0, 3, 0, 0),
  rec('pressure', 0, 0, 4, 0, 1),
  rec('depth', 0, 0, 5, 0, 1),
  rec('temperature', 0, 0, 6, 0, 1),
  rec('alarms', 1, 0, 7, 1, 1),
  rec('time', 1, 0, 8, 0, 1),
  rec('depth', 1, 0, 9, 1, 2),
  rec('temperature', 1, 0, 10, 1, 2),
  rec('pressure', 1, 0, 11, 1, 2),
  rec('pressure', 1, 1, 12, 1, 2),
  rec('pressure', 1, 2, 13, 1, 2),
  rec('rbt', 1, 0, 14, 1, 1),
];

interface HeaderLayout {
  maxDepth: number;
  diveTime: number;
  tempMin: number;
  tempMax: number;
  tempSurface?: number;
  timezone?: number;
  settings?: number;
  /** Offset in cui iniziano i campioni. */
  size: number;
  samples: RecordInfo[];
  /** Se vero, la pressione assoluta ha l'indice del serbatoio nel nibble alto. */
  trimix: boolean;
  /** Numero di byte del tipo contati a bit invece che a nibble. */
  identify: 'galileo' | 'leadingOnes';
}

/**
 * Mappatura modello → layout, dallo `switch` in `uwatec_smart_parser_create`.
 * Il numero è quello che LogTRAK esporta come `deviceTypeNumber`.
 *
 * ATTENZIONE: l'"Aladin Sport" IrDA è 0x15, l'"Aladin Sport Matrix" Bluetooth è
 * 0x17, e hanno intestazioni di dimensione diversa (152 contro 84 byte).
 * LogTRAK chiama entrambi `aladin_sport` nella stringa `deviceType`: fidarsi
 * della stringa invece del numero porta a leggere i campioni dal posto sbagliato.
 */
const GALILEO_HEADER = {
  maxDepth: 22,
  diveTime: 26,
  tempMax: 28,
  tempMin: 30,
  tempSurface: 32,
  timezone: 16,
  settings: 92,
  size: 152,
  samples: GALILEO_SAMPLES,
  trimix: false,
  identify: 'galileo' as const,
};

const TRIMIX_HEADER = {
  ...GALILEO_HEADER,
  settings: 68,
  size: 84,
  trimix: true,
};

export const UWATEC_MODELS: Record<number, HeaderLayout> = {
  0x10: {
    maxDepth: 18,
    diveTime: 20,
    tempMin: 22,
    tempMax: -1,
    size: 92,
    samples: SMART_PRO_SAMPLES,
    trimix: false,
    identify: 'leadingOnes',
  }, // Smart PRO
  0x11: GALILEO_HEADER, // Galileo Sol/Terra/Luna
  0x12: {
    maxDepth: 22,
    diveTime: 24,
    tempMin: 26,
    tempMax: 28,
    tempSurface: 32,
    timezone: 16,
    settings: 52,
    size: 108,
    samples: ALADIN_SAMPLES,
    trimix: false,
    identify: 'leadingOnes',
  }, // Aladin TEC
  0x13: {
    maxDepth: 22,
    diveTime: 26,
    tempMin: 30,
    tempMax: 28,
    tempSurface: 32,
    timezone: 16,
    settings: 60,
    size: 116,
    samples: ALADIN_SAMPLES,
    trimix: false,
    identify: 'leadingOnes',
  }, // Aladin TEC 2G
  0x14: {
    maxDepth: 18,
    diveTime: 20,
    tempMin: 22,
    tempMax: -1,
    size: 100,
    samples: SMART_COM_SAMPLES,
    trimix: false,
    identify: 'leadingOnes',
  }, // Smart COM
  0x15: GALILEO_HEADER, // Aladin 2G / Tec 3G / Aladin Sport (IrDA)
  0x17: TRIMIX_HEADER, // Aladin Sport Matrix / H Matrix (Bluetooth)
  0x18: {
    maxDepth: 18,
    diveTime: 20,
    tempMin: 22,
    tempMax: -1,
    size: 132,
    samples: SMART_TEC_SAMPLES,
    trimix: false,
    identify: 'leadingOnes',
  }, // Smart TEC
  0x19: GALILEO_HEADER, // Galileo Trimix
  0x1c: {
    maxDepth: 18,
    diveTime: 20,
    tempMin: 22,
    tempMax: -1,
    size: 132,
    samples: SMART_TEC_SAMPLES,
    trimix: false,
    identify: 'leadingOnes',
  }, // Smart Z
  0x20: GALILEO_HEADER, // Meridian
  0x22: GALILEO_HEADER, // Aladin Square
  0x24: GALILEO_HEADER, // Chromis
  0x25: TRIMIX_HEADER, // Aladin A1
  0x26: GALILEO_HEADER, // Mantis 2
  0x28: TRIMIX_HEADER, // Aladin A2
  0x31: TRIMIX_HEADER, // G2 TEK
  0x32: TRIMIX_HEADER, // G2
  0x34: TRIMIX_HEADER, // G3
  0x42: TRIMIX_HEADER, // G2 HUD
  0x50: TRIMIX_HEADER, // Luna 2 AI
  0x51: TRIMIX_HEADER, // Luna 2
};

// ---------------------------------------------------------------------------

export interface UwatecSample {
  /** Secondi dall'inizio della registrazione. */
  t: number;
  /** Metri. Assente finché non arriva il primo record di profondità assoluta. */
  depth?: number;
  /** Gradi Celsius. */
  tempC?: number;
  /** bar. */
  pressureBar?: number;
  /** Indice del serbatoio a cui si riferisce la pressione. */
  tank?: number;
  /** Remaining bottom time, minuti. */
  rbtMin?: number;
  heartRate?: number;
  /** Rilevamento della bussola, gradi. */
  bearing?: number;
}

export interface UwatecGasMix {
  index: number;
  o2: number;
  he: number;
  startBar?: number;
  endBar?: number;
}

export interface UwatecEvent {
  t: number;
  group: number;
  value: number;
}

export interface UwatecDive {
  /** Inizio immersione, millisecondi epoch Unix (UTC). */
  startMs: number;
  /** Offset del fuso orario del computer, minuti. */
  utcOffsetMinutes?: number;
  /** Profondità massima dichiarata nell'intestazione, metri. */
  maxDepth: number;
  /** Durata dichiarata nell'intestazione, secondi (multiplo di 60). */
  durationS: number;
  tempMinC?: number;
  tempMaxC?: number;
  tempSurfaceC?: number;
  /**
   * Profondità media letta a offset 24.
   *
   * libdivecomputer marca questo campo come sconosciuto e non lo legge. L'ho
   * confrontato su 85 immersioni con la media pesata sul tempo dei campioni
   * decodificati: differenza mediana 1 cm. È un'inferenza, ma verificata meglio
   * di quanto sia documentata a monte — e vale la pena, perché è l'unico modo di
   * avere il consumo in L/min sulle immersioni di cui LogTRAK non esporta il profilo.
   */
  avgDepth?: number;
  salinity: 'salt' | 'fresh';
  mode: 'oc' | 'gauge' | 'freedive';
  intervalS: number;
  samples: UwatecSample[];
  gasMixes: UwatecGasMix[];
  events: UwatecEvent[];
  /** Byte consumati e byte dichiarati: devono coincidere. */
  bytesConsumed: number;
  bytesDeclared: number;
  warnings: string[];
}

/** Firma di un record: `A5 A5 5A 5A`. */
export const UWATEC_MAGIC = [0xa5, 0xa5, 0x5a, 0x5a];

export function hasUwatecMagic(b: Uint8Array, at = 0): boolean {
  return UWATEC_MAGIC.every((v, i) => b[at + i] === v);
}

/**
 * Identificazione del record per la famiglia Galileo: a nibble, non contando
 * i bit a 1 iniziali. Sono due schemi diversi e non interscambiabili.
 */
function identifyGalileo(value: number): number {
  if ((value & 0x80) === 0) return 0;
  if ((value & 0xe0) === 0x80) return 1;
  if ((value & 0xf0) !== 0xf0) return (value & 0x70) >> 4;
  return (value & 0x0f) + 7;
}

/** Famiglie vecchie: l'indice è il numero di bit a 1 prima del primo bit a 0. */
function identifyLeadingOnes(data: Uint8Array, from: number): number {
  let count = 0;
  for (let i = from; i < data.length; i++) {
    for (let j = 0; j < 8; j++) {
      if ((data[i] & (1 << (7 - j))) === 0) return count;
      count++;
    }
  }
  return -1;
}

/** Estensione del segno su `nbits` bit. Con 0 bit il valore è 0, non un segno casuale. */
export function signExtend(value: number, nbits: number): number {
  if (nbits <= 0 || nbits > 32) return 0;
  const signBit = 1 << (nbits - 1);
  const mask = signBit - 1;
  return (value & signBit) === signBit ? value | ~mask : value & mask;
}

// ---------------------------------------------------------------------------

export interface DecodeOptions {
  /** `deviceTypeNumber` di LogTRAK, o il modello libdivecomputer. */
  model?: number;
  /** Forza la dimensione dell'intestazione, per i casi ambigui. */
  headerSize?: number;
}

export function decodeUwatecSmart(bytes: Uint8Array, opts: DecodeOptions = {}): UwatecDive {
  const warnings: string[] = [];
  if (!hasUwatecMagic(bytes)) {
    throw new Error('Firma Uwatec (A5 A5 5A 5A) non trovata.');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const declared = view.getUint32(4, true);

  let layout = opts.model !== undefined ? UWATEC_MODELS[opts.model] : undefined;
  if (!layout) {
    // Discriminante empirico: sul layout da 84 byte la parola di configurazione
    // sta a 68 e il bit di salinità è quasi sempre attivo (acqua di mare); sul
    // layout da 152 sta a 92. Provare a leggere i campioni dall'offset sbagliato
    // dà un record id fuori tabella, quindi verifichiamo anche quello.
    const candidates = [TRIMIX_HEADER, GALILEO_HEADER];
    layout =
      candidates.find((c) => {
        if (bytes.length <= c.size) return false;
        const id = identifyGalileo(bytes[c.size]);
        return id < c.samples.length;
      }) ?? TRIMIX_HEADER;
    warnings.push(
      `Modello del computer non indicato: intestazione da ${layout.size} byte dedotta dal contenuto.`,
    );
  }
  const headerSize = opts.headerSize ?? layout.size;

  const settings =
    layout.settings !== undefined && layout.settings + 4 <= bytes.length
      ? view.getUint32(layout.settings, true)
      : 0;
  const salinity = (settings & SETTING.salinity) !== 0 ? 'salt' : 'fresh';
  const density = salinity === 'salt' ? DENSITY_SALT : DENSITY_FRESH;
  const freedive = (settings & SETTING.freedive) !== 0;
  const gauge = (settings & SETTING.gauge) !== 0;
  const mode = freedive ? 'freedive' : gauge ? 'gauge' : 'oc';
  const intervalS = freedive ? 1 : 4;

  // Il tempo del dispositivo è in MEZZI secondi dal 2000-01-01.
  const devTime = view.getUint32(8, true);
  const startMs = UWATEC_EPOCH_MS + (devTime / 2) * 1000;
  const utcOffsetMinutes = layout.timezone !== undefined ? view.getInt8(layout.timezone) * 15 : undefined;

  const readTemp = (off: number | undefined) =>
    off !== undefined && off >= 0 && off + 2 <= bytes.length ? view.getInt16(off, true) / 10 : undefined;

  const dive: UwatecDive = {
    startMs,
    utcOffsetMinutes,
    // L'intestazione usa 1 mbar per unità, i campioni 2 mbar: risoluzione doppia.
    maxDepth: round2((view.getUint16(layout.maxDepth, true) * (BAR_PA / 1000)) / (density * 10)),
    durationS: view.getUint16(layout.diveTime, true) * 60,
    tempMinC: readTemp(layout.tempMin),
    tempMaxC: readTemp(layout.tempMax),
    tempSurfaceC: readTemp(layout.tempSurface),
    avgDepth:
      layout.size === 84 || layout.size === 152
        ? round2((view.getUint16(24, true) * (BAR_PA / 1000)) / (density * 10))
        : undefined,
    salinity,
    mode,
    intervalS,
    samples: [],
    gasMixes: [],
    events: [],
    bytesConsumed: 0,
    bytesDeclared: declared,
    warnings,
  };

  // --- stato del bitstream -------------------------------------------------
  let offset = headerSize;
  let time = 0;
  let depth = 0;
  let depthCalibration = 0;
  let calibrated = false;
  let temperature = 0;
  let pressure = 0;
  let rbt = 99;
  let heartRate = 0;
  let bearing: number | undefined;
  let tank = 0;
  let complete = 0;
  let haveDepth = false;
  let haveTemp = false;
  let havePressure = false;
  let haveHeartRate = false;

  const limit = Math.min(declared, bytes.length);
  const table = layout.samples;

  while (offset < limit) {
    const first = bytes[offset];
    const id = layout.identify === 'galileo' ? identifyGalileo(first) : identifyLeadingOnes(bytes, offset);
    if (id < 0 || id >= table.length) {
      throw new Error(
        `Record sconosciuto (byte 0x${first.toString(16)}, indice ${id}) a offset ${offset}: intestazione da ${headerSize} byte probabilmente sbagliata.`,
      );
    }
    const info = table[id];

    // Salta i byte interamente occupati dal tipo.
    offset += Math.floor(info.ntypebits / 8);

    // Bit di dato che restano nell'ultimo byte del tipo.
    let nbits = 0;
    let value = 0;
    const n = info.ntypebits % 8;
    if (n > 0) {
      nbits = 8 - n;
      value = bytes[offset] & (0xff >> n);
      if (info.ignoretype) {
        nbits = 0;
        value = 0;
      }
      offset++;
    }

    // Byte aggiuntivi: BIG endian dentro il record, al contrario dell'intestazione.
    for (let i = 0; i < info.extrabytes; i++) {
      nbits += 8;
      value = value * 256 + bytes[offset];
      offset++;
    }

    const signed = signExtend(value, nbits);

    switch (info.kind) {
      case 'depth':
        if (info.absolute) {
          depth = value;
          if (!calibrated) {
            calibrated = true;
            depthCalibration = depth;
          }
          haveDepth = true;
        } else {
          depth += signed;
        }
        complete = 1;
        break;

      case 'pressureDepth':
        // Un solo record porta entrambi: byte alto pressione, byte basso profondità.
        pressure += ((signed >> 8) << 24) >> 24;
        depth += ((signed & 0xff) << 24) >> 24;
        havePressure = true;
        complete = 1;
        break;

      case 'temperature':
        if (info.absolute) {
          temperature = signed;
          haveTemp = true;
        } else {
          temperature += signed;
        }
        break;

      case 'pressure':
        if (info.absolute) {
          if (layout.trimix) {
            // Sui modelli trimix l'indice del serbatoio sta nel nibble alto.
            tank = (value & 0xf000) >> 12;
            pressure = value & 0x0fff;
          } else {
            tank = info.index;
            pressure = value;
          }
          havePressure = true;
        } else {
          pressure += signed;
        }
        break;

      case 'rbt':
        if (info.absolute) rbt = value;
        else rbt += signed;
        break;

      case 'heartrate':
        if (info.absolute) {
          heartRate = value;
          haveHeartRate = true;
        } else {
          heartRate += signed;
        }
        break;

      case 'bearing':
        // Il rilevamento vale per i campioni successivi finché non cambia: è un
        // record che il computer emette solo quando la bussola viene usata.
        bearing = value;
        break;

      case 'time':
        // Ripeti l'ultimo campione `value` volte. Con 0 non emette nulla.
        complete = value;
        break;

      case 'alarms':
        dive.events.push({ t: time, group: info.index, value });
        break;

      case 'apnea':
        offset += 8;
        break;

      case 'misc': {
        const subtype = bytes[offset];
        if (subtype >= 32 && subtype <= 41) {
          // Descrittore di miscela. Dentro il payload i campi tornano little endian.
          const base = offset + 1;
          const o2 = view.getUint16(base, true);
          const he = view.getUint16(base + 2, true);
          const beginBar = view.getUint16(base + 4, true);
          const endBar = view.getUint16(base + 6, true);
          dive.gasMixes.push({
            index: subtype - 32,
            o2: o2 / 100,
            he: he / 100,
            startBar: beginBar > 0 ? round2(beginBar / 128) : undefined,
            endBar: endBar > 0 ? round2(endBar / 128) : undefined,
          });
        }
        offset += value - 1;
        break;
      }
    }

    while (complete > 0) {
      const s: UwatecSample = { t: time };
      if (haveDepth) {
        // I campioni usano 2 mbar per unità: il fattore 2 è nella formula.
        s.depth = round2(((depth - depthCalibration) * (2 * BAR_PA)) / 1000 / (density * 10));
      }
      if (haveTemp) s.tempC = round1(temperature / 2.5);
      if (havePressure && pressure > 0) {
        s.pressureBar = round2(pressure / 4);
        s.tank = tank;
      }
      if (havePressure) s.rbtMin = rbt;
      if (haveHeartRate) s.heartRate = heartRate;
      if (bearing !== undefined) s.bearing = bearing;
      dive.samples.push(s);
      time += intervalS;
      complete--;
    }
  }

  dive.bytesConsumed = offset;
  if (offset !== declared) {
    warnings.push(
      `Decodifica disallineata: consumati ${offset} byte su ${declared} dichiarati. Il profilo potrebbe essere incompleto.`,
    );
  }
  return dive;
}

/**
 * Estrae tutti i record Uwatec da un buffer che ne contiene una sequenza.
 * LogTRAK ne mette uno per immersione, ma il download diretto dal computer
 * restituisce un flusso concatenato.
 */
export function splitUwatecRecords(bytes: Uint8Array): Uint8Array[] {
  const out: Uint8Array[] = [];
  let at = 0;
  while (at + 8 <= bytes.length) {
    if (!hasUwatecMagic(bytes, at)) {
      at++;
      continue;
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const len = view.getUint32(at + 4, true);
    if (len < 8 || at + len > bytes.length) break;
    out.push(bytes.subarray(at, at + len));
    at += len;
  }
  return out;
}

/**
 * Ritaglia il periodo in superficie prima e dopo l'immersione.
 *
 * Il computer registra anche i minuti passati a galla dopo essere risaliti: su
 * un'immersione da 35 minuti ho trovato 5 minuti di zeri in coda. Lasciarli
 * dentro abbassa la profondità media e falsa il consumo calcolato, quindi vanno
 * tolti — ma ne teniamo un campione per lato, perché la risalita finale finisce
 * in superficie e serve al calcolo della velocità.
 */
export function trimSurface(samples: UwatecSample[], thresholdM = 0.8): UwatecSample[] {
  const deep = samples.map((s) => (s.depth ?? 0) >= thresholdM);
  const first = deep.indexOf(true);
  if (first < 0) return samples;
  let last = deep.length - 1;
  while (last > first && !deep[last]) last--;
  return samples.slice(Math.max(0, first - 1), Math.min(samples.length, last + 2));
}

const round1 = (v: number) => Math.round(v * 10) / 10;
const round2 = (v: number) => Math.round(v * 100) / 100;
