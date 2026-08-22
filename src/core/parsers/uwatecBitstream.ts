/**
 * Il flusso dei campioni dei computer Uwatec/Scubapro, letto come un codice a
 * prefissi.
 *
 * DA DOVE VIENE QUESTO FILE, e perché è scritto così.
 *
 * Il formato è descritto pubblicamente dal progetto Diversity
 * (`diversity.sourceforge.net/uwatec_smart_format.html`), che lo presenta per
 * quello che è: **un codice a prefissi**. Ogni record comincia con un disegno di
 * bit — `0ddddddd`, `110ddddd`, `1111110x` — dove le cifre fisse identificano il
 * tipo e le `d` sono il dato. Nessun disegno è prefisso di un altro, quindi si
 * legge un bit alla volta finché non se ne riconosce uno, e non serve sapere in
 * anticipo quanto è lungo.
 *
 * Questa è la descrizione che si è scelto di seguire, e le tabelle qui sotto
 * sono scritte in quella forma. È una scelta consapevole: il formato ha anche
 * altre descrizioni in giro, che lo rappresentano come una tabella di numeri —
 * quanti bit di tipo, quale indice, quanti byte in coda — e da quella forma si
 * arriva allo stesso risultato per una strada diversa. I FATTI di un formato
 * (quale bit sta dove, per cosa si divide una temperatura) non appartengono a
 * nessuno; il modo di organizzarli sì, e questo è il nostro.
 *
 * COSA LA SPECIFICA NON COPRE. È del 2007 e si ferma alle famiglie di allora —
 * Smart PRO, Aladin TEC, Smart COM, Smart TEC/Z. La famiglia **Galileo**, che è
 * quella dei computer moderni (Aladin Sport Matrix, Square, A1/A2, G2, G3,
 * Luna 2), è arrivata dopo: i suoi disegni sono stati ricavati dai dati, e
 * verificati su 85 immersioni reali di un Aladin Sport Matrix.
 *
 * PERCHÉ QUESTO FILE È DELICATO. I valori sono **delta con segno accumulati su
 * uno stato**: un errore in un punto qualunque non produce un errore, produce un
 * profilo plausibile e falso che scorre a caso da lì in poi. Non c'è nessun
 * controllo interno che lo prenda. Per questo `decodificaFlusso` restituisce
 * quanti byte ha consumato, e chi lo chiama verifica che coincidano con la
 * lunghezza dichiarata: è il controllo che prende un disallineamento di un byte.
 */

/** Cosa misura un record. */
export type Grandezza =
  | 'profondita'
  | 'temperatura'
  | 'pressione'
  | 'rbt'
  | 'battito'
  | 'rilevamento'
  | 'tempo'
  | 'allarmi'
  | 'apnea'
  | 'accessorio'
  /** Un record solo che porta pressione e profondità insieme, un byte ciascuna. */
  | 'pressioneEProfondita';

/**
 * Un tipo di record, scritto come lo scrive la specifica.
 *
 * `disegno` usa quattro simboli: `1` e `0` sono i bit fissi che identificano il
 * tipo, `d` è un bit di dato, `x` è un bit che c'è ma non si guarda — capita
 * sulle famiglie vecchie, dove qualche record ha un bit di riempimento fra il
 * tipo e i byte che seguono.
 */
export interface Voce {
  disegno: string;
  grandezza: Grandezza;
  /** Il valore sostituisce lo stato invece di sommarcisi. */
  assoluto: boolean;
  /** Serbatoio, per le pressioni; gruppo, per gli allarmi. */
  indice: number;
  /** Byte interi che seguono il disegno, letti big endian. */
  byteExtra: number;
}

function v(
  disegno: string,
  grandezza: Grandezza,
  extra: Partial<Pick<Voce, 'assoluto' | 'indice' | 'byteExtra'>> = {},
): Voce {
  return { disegno, grandezza, assoluto: false, indice: 0, byteExtra: 0, ...extra };
}

/**
 * La famiglia **Galileo**: Aladin Sport Matrix e H Matrix, Square, A1, A2,
 * Chromis, Mantis, Meridian, G2, G3, Luna 2, Galileo. È quella di qualunque
 * export recente.
 *
 * I disegni fino a `1110dddd` sono corti e portano il dato con sé; da `1111`
 * in poi il primo byte è tutto tipo e il dato sta nei byte che seguono.
 */
export const GALILEO: Voce[] = [
  v('0ddddddd', 'profondita'),
  v('100ddddd', 'rbt'),
  v('1010dddd', 'pressione'),
  v('1011dddd', 'temperatura'),
  v('1100dddd', 'tempo', { assoluto: true }),
  v('1101dddd', 'battito'),
  v('1110dddd', 'allarmi', { assoluto: true, indice: 0 }),
  v('11110000', 'allarmi', { assoluto: true, indice: 1, byteExtra: 1 }),
  v('11110001', 'profondita', { assoluto: true, byteExtra: 2 }),
  v('11110010', 'rbt', { assoluto: true, byteExtra: 1 }),
  v('11110011', 'temperatura', { assoluto: true, byteExtra: 2 }),
  v('11110100', 'pressione', { assoluto: true, indice: 0, byteExtra: 2 }),
  v('11110101', 'pressione', { assoluto: true, indice: 1, byteExtra: 2 }),
  v('11110110', 'pressione', { assoluto: true, indice: 2, byteExtra: 2 }),
  v('11110111', 'battito', { assoluto: true, byteExtra: 1 }),
  v('11111000', 'rilevamento', { assoluto: true, byteExtra: 2 }),
  v('11111001', 'allarmi', { assoluto: true, indice: 2, byteExtra: 1 }),
  v('11111010', 'apnea', { assoluto: true }),
  v('11111011', 'accessorio', { assoluto: true, byteExtra: 1 }),
];

/**
 * **Smart PRO**, la famiglia più vecchia, e quella che la specifica del 2007
 * descrive per prima. Qui il disegno è regolare: tanti `1` quanti sono i passi
 * di indice, poi uno `0`, poi il dato.
 */
export const SMART_PRO: Voce[] = [
  v('0ddddddd', 'profondita'),
  v('10dddddd', 'temperatura'),
  v('110ddddd', 'tempo', { assoluto: true }),
  v('1110dddd', 'allarmi', { assoluto: true }),
  v('11110ddd', 'profondita', { byteExtra: 1 }),
  v('111110dd', 'temperatura', { byteExtra: 1 }),
  v('1111110x', 'profondita', { assoluto: true, byteExtra: 2 }),
  v('11111110', 'temperatura', { assoluto: true, byteExtra: 2 }),
];

/** **Aladin TEC / PRIME / 2G**: come Smart PRO, più un secondo gruppo di allarmi. */
export const ALADIN: Voce[] = [...SMART_PRO, v('111111110ddddddd', 'allarmi', { assoluto: true, indice: 1 })];

/**
 * **Smart COM**: il primo computer con il trasmettitore di pressione, e si vede
 * dal disegno più corto — `0ddddddd` più un byte porta pressione e profondità
 * insieme, perché sono i due valori che cambiano a ogni campione.
 */
export const SMART_COM: Voce[] = [
  v('0ddddddd', 'pressioneEProfondita', { byteExtra: 1 }),
  v('10dddddd', 'rbt'),
  v('110ddddd', 'temperatura'),
  v('1110dddd', 'pressione', { byteExtra: 1 }),
  v('11110ddd', 'profondita', { byteExtra: 1 }),
  v('111110dd', 'temperatura', { byteExtra: 1 }),
  v('1111110x', 'allarmi', { assoluto: true, byteExtra: 1 }),
  v('11111110', 'tempo', { assoluto: true, byteExtra: 1 }),
  v('111111110xxxxxxx', 'profondita', { assoluto: true, byteExtra: 2 }),
  v('1111111110xxxxxx', 'pressione', { assoluto: true, byteExtra: 2 }),
  v('11111111110xxxxx', 'temperatura', { assoluto: true, byteExtra: 2 }),
  v('111111111110xxxx', 'rbt', { assoluto: true, byteExtra: 1 }),
];

/** **Smart TEC / Z**: come Smart COM, ma con tre serbatoi invece di uno. */
export const SMART_TEC: Voce[] = [
  ...SMART_COM.slice(0, 8),
  v('111111110xxxxxxx', 'profondita', { assoluto: true, byteExtra: 2 }),
  v('1111111110xxxxxx', 'temperatura', { assoluto: true, byteExtra: 2 }),
  v('11111111110xxxxx', 'pressione', { assoluto: true, indice: 0, byteExtra: 2 }),
  v('111111111110xxxx', 'pressione', { assoluto: true, indice: 1, byteExtra: 2 }),
  v('1111111111110xxx', 'pressione', { assoluto: true, indice: 2, byteExtra: 2 }),
  v('11111111111110xx', 'rbt', { assoluto: true, byteExtra: 1 }),
];

// --------------------------------------------------------------- lettura bit

/**
 * Legge un flusso bit per bit, dal più significativo.
 *
 * Serve perché i disegni non sono allineati ai byte: `100ddddd` finisce dopo tre
 * bit di tipo, e il dato che segue sta nello stesso byte. Fare la stessa cosa
 * con l'aritmetica sugli offset si può, e vuol dire portarsi dietro «quanti bit
 * ho consumato dell'ultimo byte» in ogni ramo del codice. Con un lettore, quel
 * conto sta in un posto solo.
 */
export class LettoreDiBit {
  private bit = 0;

  constructor(
    private readonly byte: Uint8Array,
    daByte = 0,
  ) {
    this.bit = daByte * 8;
  }

  /** Quanti byte sono stati consumati finora. Vale solo a bit allineati. */
  get posizioneByte(): number {
    return this.bit >> 3;
  }

  get finito(): boolean {
    return this.bit >= this.byte.length * 8;
  }

  /** Il prossimo bit, come 0 o 1. */
  leggiBit(): number {
    const indice = this.bit >> 3;
    if (indice >= this.byte.length) throw new Error('flusso finito a metà di un record');
    const dentro = 7 - (this.bit & 7);
    this.bit++;
    return (this.byte[indice] >> dentro) & 1;
  }

  /** `quanti` bit come un numero, il primo letto è il più significativo. */
  leggiBits(quanti: number): number {
    let valore = 0;
    for (let i = 0; i < quanti; i++) valore = valore * 2 + this.leggiBit();
    return valore;
  }

  /** Un byte intero. Presuppone di essere a un confine di byte. */
  leggiByte(): number {
    return this.leggiBits(8);
  }

  /** Guarda un byte più avanti senza consumarlo. */
  sbircia(avanti = 0): number | undefined {
    return this.byte[this.posizioneByte + avanti];
  }

  /** Salta `quanti` byte interi. */
  salta(quanti: number): void {
    this.bit += quanti * 8;
  }
}

/**
 * Il valore di un delta, interpretato in complemento a due su `bit` bit.
 *
 * Scritto come sottrazione e non con le maschere perché è la definizione: un
 * numero oltre la metà dell'intervallo rappresenta sé stesso meno l'intervallo
 * intero. Con zero bit non c'è nessun segno da estendere, e il valore è zero —
 * non un bit di segno letto a caso.
 */
export function conSegno(valore: number, bit: number): number {
  if (bit <= 0) return 0;
  const intervallo = 2 ** bit;
  return valore >= intervallo / 2 ? valore - intervallo : valore;
}

/** Il disegno, scomposto una volta sola invece che a ogni record. */
interface Scomposto {
  voce: Voce;
  /** I bit fissi, come stringa: è la chiave del riconoscimento. */
  fissi: string;
  /** Quanti bit di dato ci sono dentro il disegno. */
  bitDato: number;
  /** Quanti bit ci sono ma non si guardano. */
  bitIgnorati: number;
}

function scomponi(voce: Voce): Scomposto {
  const fissi = voce.disegno.match(/^[01]+/)?.[0] ?? '';
  const coda = voce.disegno.slice(fissi.length);
  if (/[^dx]/.test(coda)) {
    throw new Error(`Disegno malformato: ${voce.disegno}`);
  }
  return {
    voce,
    fissi,
    bitDato: (coda.match(/d/g) ?? []).length,
    bitIgnorati: (coda.match(/x/g) ?? []).length,
  };
}

/**
 * Prepara una tabella per il riconoscimento, e controlla che sia un codice
 * valido.
 *
 * IL CONTROLLO NON È PEDANTERIA. Se due disegni fossero uno il prefisso
 * dell'altro, il riconoscimento sceglierebbe sempre il più corto e l'altro non
 * verrebbe mai riconosciuto — e il sintomo sarebbe un profilo sbagliato, non un
 * errore. Costa un giro all'avvio e toglie di mezzo un'intera categoria di
 * sbagli, compresi quelli di chi aggiungerà una famiglia in futuro.
 */
export function preparaTabella(voci: Voce[]): Map<string, Scomposto> {
  const perFissi = new Map<string, Scomposto>();
  for (const voce of voci) {
    const s = scomponi(voce);
    if (perFissi.has(s.fissi)) {
      throw new Error(`Due record con lo stesso disegno: ${s.fissi}`);
    }
    perFissi.set(s.fissi, s);
  }
  for (const a of perFissi.keys()) {
    for (const b of perFissi.keys()) {
      if (a !== b && b.startsWith(a)) {
        throw new Error(`Il disegno ${a} è prefisso di ${b}: il codice non è leggibile`);
      }
    }
  }
  return perFissi;
}

/** Un record letto: che cos'è, e il numero che porta. */
export interface RecordLetto {
  voce: Voce;
  /** Il valore così com'è, senza segno. Serve ai record assoluti. */
  grezzo: number;
  /** Lo stesso valore interpretato col segno. Serve ai delta. */
  segnato: number;
}

/**
 * Legge un record dal flusso: prima il disegno, poi il dato.
 *
 * Si legge un bit alla volta finché la sequenza raccolta non è il disegno di
 * qualcuno. Funziona perché nessun disegno è prefisso di un altro — e
 * `preparaTabella` lo verifica invece di darlo per buono.
 */
export function leggiRecord(lettore: LettoreDiBit, tabella: Map<string, Scomposto>): RecordLetto {
  let fissi = '';
  let trovato: Scomposto | undefined;
  // Nessun disegno conosciuto supera i sedici bit: oltre, il flusso è rotto e
  // continuare a leggere significherebbe solo sbagliare più in là.
  while (fissi.length < 16) {
    fissi += lettore.leggiBit();
    trovato = tabella.get(fissi);
    if (trovato) break;
  }
  if (!trovato) {
    throw new Error(`Record sconosciuto: nessun disegno comincia con ${fissi}`);
  }

  let bit = trovato.bitDato;
  let valore = lettore.leggiBits(trovato.bitDato);
  lettore.leggiBits(trovato.bitIgnorati);

  for (let i = 0; i < trovato.voce.byteExtra; i++) {
    valore = valore * 256 + lettore.leggiByte();
    bit += 8;
  }

  return { voce: trovato.voce, grezzo: valore, segnato: conSegno(valore, bit) };
}

// ------------------------------------------------------------- decodifica

/** Un campione come esce dal flusso, prima di diventare canonico. */
export interface CampioneGrezzo {
  /** Secondi dall'inizio della registrazione. */
  t: number;
  /** Unità di 2 mbar sopra la calibrazione, non metri. */
  profonditaUnita?: number;
  /** Decimi di grado per 2.5, non gradi. */
  temperaturaUnita?: number;
  /** Quarti di bar, non bar. */
  pressioneUnita?: number;
  serbatoio?: number;
  rbtMin?: number;
  battito?: number;
  rilevamento?: number;
}

export interface EventoGrezzo {
  t: number;
  gruppo: number;
  valore: number;
}

export interface MisceleGrezze {
  indice: number;
  /** Percentuale, come la scrive il computer. */
  o2: number;
  he: number;
  /** In unità di 1/128 di bar. */
  inizio128: number;
  fine128: number;
}

export interface EsitoFlusso {
  campioni: CampioneGrezzo[];
  eventi: EventoGrezzo[];
  miscele: MisceleGrezze[];
  /** Byte consumati in tutto, intestazione compresa. */
  byteConsumati: number;
}

export interface OpzioniFlusso {
  /** Dove finisce l'intestazione e comincia il flusso. */
  daByte: number;
  /** Dove smettere: la lunghezza dichiarata nel record. */
  finoA: number;
  tabella: Voce[];
  /** Sui modelli trimix l'indice del serbatoio sta nel nibble alto del valore. */
  trimix: boolean;
  /** Quanti secondi passano fra un campione e il successivo. */
  intervalloS: number;
}

/**
 * Percorre il flusso e restituisce i campioni, **senza convertirli in unità
 * fisiche**.
 *
 * La conversione sta fuori di proposito: dipende dalla densità dell'acqua e
 * dalla pressione di superficie, che sono dati dell'immersione e non del flusso.
 * Tenerle separate vuol dire che questa funzione si prova con numeri interi,
 * senza portarsi dietro un'ipotesi sull'acqua.
 *
 * LO STATO È IL PUNTO. Quasi tutti i record sono **variazioni** rispetto a
 * quello che c'era prima, e un campione viene emesso solo quando arriva un
 * record che «chiude» l'istante — una profondità, o un record di tempo che dice
 * «ripeti l'ultimo N volte». Fra i due, temperatura pressione e battito si
 * aggiornano in silenzio.
 */
export function decodificaFlusso(byte: Uint8Array, opzioni: OpzioniFlusso): EsitoFlusso {
  const tabella = preparaTabella(opzioni.tabella);
  const lettore = new LettoreDiBit(byte, opzioni.daByte);
  const esito: EsitoFlusso = { campioni: [], eventi: [], miscele: [], byteConsumati: 0 };

  let t = 0;
  let profondita = 0;
  let calibrazione = 0;
  let calibrato = false;
  let temperatura = 0;
  let pressione = 0;
  let rbt = 99;
  let battito = 0;
  let rilevamento: number | undefined;
  let serbatoio = 0;
  let vistaProfondita = false;
  let vistaTemperatura = false;
  let vistaPressione = false;
  let vistoBattito = false;

  const limite = Math.min(opzioni.finoA, byte.length);
  while (lettore.posizioneByte < limite) {
    const { voce, grezzo, segnato } = leggiRecord(lettore, tabella);
    /** Quanti campioni emettere dopo questo record. */
    let daEmettere = 0;

    switch (voce.grandezza) {
      case 'profondita':
        if (voce.assoluto) {
          profondita = grezzo;
          if (!calibrato) {
            // Il primo valore assoluto è lo zero: il computer misura la
            // pressione, e in superficie quella non è zero.
            calibrato = true;
            calibrazione = profondita;
          }
          vistaProfondita = true;
        } else {
          profondita += segnato;
        }
        daEmettere = 1;
        break;

      case 'pressioneEProfondita': {
        // Un record solo per i due valori che cambiano sempre: byte alto la
        // pressione, byte basso la profondità, **ciascuno col proprio segno**.
        pressione += conSegno((segnato >> 8) & 0xff, 8);
        profondita += conSegno(segnato & 0xff, 8);
        vistaPressione = true;
        daEmettere = 1;
        break;
      }

      case 'temperatura':
        temperatura = voce.assoluto ? segnato : temperatura + segnato;
        /*
         * IL CAMPIONE PORTA LA TEMPERATURA SOLO DOPO UN VALORE ASSOLUTO, e mai
         * dopo una variazione soltanto. Un delta dice «due decimi in meno di
         * prima», e se il «prima» non è mai arrivato, sommarlo a zero
         * inventerebbe una temperatura di 0 °C — plausibile, e falsa. Meglio un
         * campo vuoto.
         */
        if (voce.assoluto) vistaTemperatura = true;
        break;

      case 'pressione':
        if (voce.assoluto) {
          if (opzioni.trimix) {
            // Sui modelli trimix il serbatoio è scritto nel nibble alto del
            // valore, invece che nel tipo del record.
            serbatoio = (grezzo & 0xf000) >> 12;
            pressione = grezzo & 0x0fff;
          } else {
            serbatoio = voce.indice;
            pressione = grezzo;
          }
          vistaPressione = true;
        } else {
          pressione += segnato;
        }
        break;

      case 'rbt':
        rbt = voce.assoluto ? grezzo : rbt + segnato;
        break;

      case 'battito':
        battito = voce.assoluto ? grezzo : battito + segnato;
        // Come la temperatura: senza un valore assoluto di partenza il delta non
        // significa niente.
        if (voce.assoluto) vistoBattito = true;
        break;

      case 'rilevamento':
        // Vale per i campioni che seguono finché non cambia: il computer lo
        // emette solo quando la bussola viene usata.
        rilevamento = grezzo;
        break;

      case 'tempo':
        // «Ripeti l'ultimo campione N volte»: è così che si comprime la parte
        // di immersione in cui non cambia niente. Con zero non emette nulla.
        daEmettere = grezzo;
        break;

      case 'allarmi':
        esito.eventi.push({ t, gruppo: voce.indice, valore: grezzo });
        break;

      case 'apnea':
        // Otto byte di cui non si conosce il contenuto. Si saltano interi:
        // provare a interpretarli sarebbe inventare.
        lettore.salta(8);
        break;

      case 'accessorio': {
        /*
         * Un record a lunghezza variabile: `grezzo` è quanto è lungo, e il byte
         * subito dopo dice di cosa si tratta. I sottotipi da 32 a 41 sono le
         * dieci miscele, e **dentro il payload i numeri tornano little endian**,
         * al contrario del resto del flusso. Non è un errore di lettura: è
         * proprio così.
         */
        const sottotipo = lettore.sbircia();
        if (sottotipo !== undefined && sottotipo >= 32 && sottotipo <= 41) {
          const vista = new DataView(byte.buffer, byte.byteOffset, byte.byteLength);
          const base = lettore.posizioneByte + 1;
          if (base + 8 <= byte.length) {
            esito.miscele.push({
              indice: sottotipo - 32,
              o2: vista.getUint16(base, true),
              he: vista.getUint16(base + 2, true),
              inizio128: vista.getUint16(base + 4, true),
              fine128: vista.getUint16(base + 6, true),
            });
          }
        }
        lettore.salta(grezzo - 1);
        break;
      }
    }

    for (let i = 0; i < daEmettere; i++) {
      const campione: CampioneGrezzo = { t };
      if (vistaProfondita) campione.profonditaUnita = profondita - calibrazione;
      if (vistaTemperatura) campione.temperaturaUnita = temperatura;
      if (vistaPressione) {
        if (pressione > 0) {
          campione.pressioneUnita = pressione;
          campione.serbatoio = serbatoio;
        }
        campione.rbtMin = rbt;
      }
      if (vistoBattito) campione.battito = battito;
      if (rilevamento !== undefined) campione.rilevamento = rilevamento;
      esito.campioni.push(campione);
      t += opzioni.intervalloS;
    }
  }

  esito.byteConsumati = lettore.posizioneByte;
  return esito;
}

/**
 * Il flusso comincia con un record riconoscibile a partire da questo byte?
 *
 * Serve a indovinare la lunghezza dell'intestazione quando il modello non è
 * dichiarato: provando l'offset sbagliato si finisce in mezzo ai dati, e lì il
 * primo disegno quasi sempre non esiste. Non è una certezza — un byte a caso può
 * somigliare a un record — ma sbaglia molto meno che tirare a indovinare.
 */
export function iniziaConUnRecordValido(byte: Uint8Array, daByte: number, voci: Voce[]): boolean {
  if (daByte >= byte.length) return false;
  try {
    leggiRecord(new LettoreDiBit(byte, daByte), preparaTabella(voci));
    return true;
  } catch {
    return false;
  }
}
