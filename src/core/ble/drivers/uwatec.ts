/**
 * Il protocollo Uwatec «Smart» via Bluetooth: Scubapro **Aladin Sport Matrix**,
 * Aladin H Matrix, Aladin A1 e A2, G2, G2 TEK, G2 HUD, G3, Luna 2.0.
 *
 * Riscritto da `libdivecomputer/src/uwatec_smart.c`, che è l'unica descrizione
 * pubblica: Scubapro non documenta niente. Ogni scelta qui sotto viene da lì.
 *
 * È UN PROTOCOLLO COMPLETAMENTE DIVERSO DA SHEARWATER, e vale la pena dire in
 * che senso, perché le due implementazioni si somigliano solo per il fatto di
 * stare accanto nella stessa cartella.
 *
 *  - **Non c'è nessun manifesto.** Shearwater dice «ho novantotto immersioni,
 *    ecco i loro indirizzi», e poi le si chiede una per una. Qui si chiede
 *    «quanti byte hai da darmi», arriva un numero, e poi arrivano quei byte:
 *    tutta la memoria in un blocco solo, senza confini. Le immersioni si
 *    scoprono DOPO, tagliando il blocco sui marcatori `A5 A5 5A 5A`. Fino a
 *    quel momento non si sa nemmeno quante siano.
 *
 *  - **Lo scarico incrementale lo fa il computer.** Si manda l'impronta
 *    dell'ultima immersione che si ha — che è il suo orario in mezzi secondi —
 *    dentro i parametri del comando, e il computer restituisce solo quello che
 *    è venuto dopo. Su Shearwater il filtro è nostro: si legge il manifesto e
 *    ci si ferma. Qui il trasferimento stesso è più corto, il che è molto
 *    meglio: su BLE i byte sono il costo.
 *
 *  - **Nessun handshake.** `uwatec_smart_handshake` esce subito quando il
 *    trasporto è BLE. Le due strette di mano `0x1B`/`0x1C` servono a IrDA e
 *    seriale; mandarle qui vorrebbe dire aspettare una risposta che non arriva.
 *
 * L'INCASTRO CHE ROMPE TUTTO SE SBAGLIATO: OGNI NOTIFICA HA UN BYTE DI TROPPO
 * IN TESTA. In uscita si scrive `[lunghezza+1, comando, ...parametri]`. In
 * entrata, invece, il PRIMO byte di ogni notifica non è dato: è una specie di
 * numero di sequenza — libdivecomputer lo documenta come una successione che
 * cresce di 19 a ogni pacchetto e poi ricomincia — e va buttato via prima di
 * concatenare. Diciannove è la parte utile di una notifica da venti byte.
 * Tenerlo dentro non dà un errore: dà un blocco di memoria disallineato di un
 * byte ogni diciannove, in cui i marcatori delle immersioni non si trovano
 * più e il risultato è «zero immersioni» con il trasferimento riuscito.
 *
 * COSA RESTA DA VERIFICARE COL COMPUTER IN MANO. Questo file non ha mai parlato
 * con un Aladin. Ha parlato con un finto Aladin che rispetta le stesse regole,
 * che è una cosa più debole. I punti su cui scommetto meno sono segnati «⚠️».
 * La decodifica, invece, non è un'incognita: `uwatecSmart.ts` è già stato
 * verificato su 85 immersioni reali di QUESTO computer, arrivate però da
 * LogTRAK. Quello che si sta aggiungendo è solo il modo di prendere gli stessi
 * byte senza passare dall'applicazione di Scubapro.
 */

import { computeMetrics } from '../../analysis/metrics';
import { diveIdFor } from '../../dedupe';
import type { Cylinder, Dive, DiveMode, Sample } from '../../model';
import {
  decodeUwatecSmart,
  splitUwatecRecords,
  trimSurface,
  uwatecModelName,
  uwatecSamplesToCanonical,
  type UwatecDive,
} from '../../parsers/uwatecSmart';
import { advertisesService, either, exactName, nameStartsWith } from '../match';
import type { BleLink, ComputerIdentity, DiveComputerDriver, DownloadedRecord } from '../types';

// --------------------------------------------------------------------- comandi

/** Un byte: il numero del modello, quello che sceglie il tracciato dell'intestazione. */
const CMD_MODEL = 0x10;
/** Un byte: versione dell'hardware. Non ci serve, si legge per il diario. */
const CMD_HARDWARE = 0x11;
/** Un byte: versione del firmware, in BCD. */
const CMD_SOFTWARE = 0x13;
/** Quattro byte little endian: il seriale. */
const CMD_SERIAL = 0x14;
/** Quattro byte little endian: l'orologio del computer, in mezzi secondi dal 2000. */
const CMD_DEVTIME = 0x1a;
/** Con i parametri: quanti byte ha da dare. */
const CMD_SIZE = 0xc6;
/** Con i parametri: comincia a darli. */
const CMD_DATA = 0xc4;

/** Il servizio «seriale su BLE» di Scubapro, dall'elenco di Subsurface. */
const SERVIZIO = 'fdcdeaaa-295d-470e-bf15-04217b7aa0a0';

/**
 * I nomi annunciati, e perché il confronto NON può essere tutto esatto.
 *
 * La lista viene dal filtro `dc_filter_uwatec` di libdivecomputer, che confronta
 * con `strcasecmp` — cioè per intero. Copiando quella regola tale e quale, il
 * riconoscimento ha fallito col computer vero in mano: **l'Aladin Sport Matrix
 * si annuncia «Aladin Sport», non «Aladin»**, e la schermata diceva «non
 * riconosciuto come computer subacqueo» davanti a un computer subacqueo.
 *
 * La lista di libdivecomputer non è sbagliata: serve al suo elenco di modelli,
 * dove l'utente sceglie a mano. Qui serve a riconoscere quello che il
 * dispositivo GRIDA, e quello che grida dipende dal firmware, dalla versione e
 * da quale dei due nomi BLE il sistema operativo ha messo in cache.
 *
 * Quindi due regole, divise secondo il rischio del nome:
 *
 *  - **Per prefisso** i nomi lunghi e specifici. «Aladin» non è l'inizio di
 *    nient'altro che si porti in barca, quindi «Aladin Sport», «Aladin Matrix»
 *    e «Aladin H» entrano tutti.
 *  - **Per intero** quelli di due o tre caratteri. «A1», «A2», «G2», «HUD» come
 *    prefissi riconoscerebbero un paio di auricolari e mezza cambusa — e un
 *    falso riconoscimento non è cosmetico: significa connettersi al dispositivo
 *    di qualcun altro e mandargli i byte di un comando Uwatec.
 *
 * Chi non rientra in nessuna delle due resta nell'elenco senza etichetta, e da
 * lì lo si può forzare a mano: vedi il pulsante «provalo come…» nella schermata
 * dello scarico. È la rete di sicurezza per il prossimo nome che non avevamo
 * previsto — perché ce ne sarà un altro.
 */
const NOMI_INTERI = ['G2', 'G3', 'A1', 'A2', 'HUD', 'G2 Console'];
const NOMI_INIZIALI = ['Aladin', 'Galileo', 'Luna 2.0', 'G2 TEK', 'G2 HUD'];

/** Millisecondi fra l'epoca Uwatec (2000-01-01 UTC) e quella Unix. */
const UWATEC_EPOCH_MS = 946_684_800_000;

/** Attesa per un pezzo di risposta. libdivecomputer usa 5 s su tutto. */
const TIMEOUT_MS = 5000;
/**
 * Attesa per i due comandi che fanno lavorare il computer.
 *
 * ⚠️ `CMD_SIZE` e `CMD_DATA` obbligano il firmware a scorrere tutta la memoria
 * per contare cosa è più recente dell'impronta che gli abbiamo dato. Su un
 * archivio pieno può prendersi qualche secondo prima di rispondere il primo
 * byte, ed è un'attesa che assomiglia in tutto a una disconnessione.
 */
const TIMEOUT_LUNGO_MS = 20_000;

/** Ogni quanti byte si aggiorna la barra. Più fitto sarebbe solo lavoro per React. */
const PASSO_AVANZAMENTO = 4096;

/** Quante notifiche senza dati di fila si sopportano prima di dire che è rotto. */
const NOTIFICHE_A_VUOTO = 64;

/**
 * Quante volte si riprende un trasferimento che si è fermato a metà.
 *
 * Col computer vero ogni giro ha portato circa un terzo della memoria, quindi
 * tre o quattro basterebbero. Dodici è il margine per una memoria piena e un
 * firmware più capriccioso — ed è comunque un numero, perché un ciclo senza
 * limite superiore in un protocollo ricostruito è un modo di scrivere
 * «l'applicazione si è piantata».
 */
const MAX_RIPRESE = 12;

/**
 * Quante volte si riapre il collegamento durante uno stesso scarico.
 *
 * Riaprire costa qualche secondo e, su alcuni stack, una richiesta di permesso:
 * è un rimedio, non una strategia. Se dopo sei sessioni nuove il computer
 * continua a impiantarsi, il problema non è la sessione.
 */
const MAX_RIAPERTURE = 6;

/**
 * Quanto può durare in tutto uno scarico, prima che ci si arrenda.
 *
 * SERVE PERCHÉ LE SCADENZE SONO PER NOTIFICA. `TIMEOUT_DATI_MS` scatta solo
 * quando non arriva niente per dodici secondi: un firmware che consegna un byte
 * ogni undici non lo fa scattare mai. In prova, 6 080 byte in altrettante
 * notifiche a quel ritmo passano senza un errore — e alla stessa cadenza il
 * blocco vero da 129 kB durerebbe **venti ore**, con la barra che avanza e
 * nessun modo di fermarsi da sé.
 *
 * Mezz'ora è molto più di quanto serva: lo scarico di una memoria piena,
 * riaperture comprese, sta in pochi minuti. È un limite contro l'assurdo, non un
 * budget da rispettare.
 */
const TEMPO_MASSIMO_MS = 30 * 60_000;

/**
 * Di quanti byte i conti della ripresa possono non tornare senza allarmare.
 *
 * Fra un record e l'altro la memoria può contenere byte che non sono record —
 * riempimenti, resti di scritture precedenti — e il conto «quello che restava
 * meno quello che ho preso» non torna al byte. Un record intero però non ci sta
 * in questo margine, ed è quello che questa guardia deve prendere.
 */
const TOLLERANZA_BYTE = 256;

/**
 * L'attesa fra due notifiche DURANTE il trasferimento del blocco.
 *
 * Più lunga dei cinque secondi che usa libdivecomputer, e non per prudenza
 * generica: il computer vero, a metà di un blocco da 129 kB, ha smesso di
 * mandare per più di cinque secondi. Con la scadenza corta ogni pausa del
 * firmware diventa una ripresa, e ogni ripresa costa un giro di comandi.
 */
const TIMEOUT_DATI_MS = 12_000;

export class UwatecProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UwatecProtocolError';
  }
}

// ------------------------------------------------------------------ il framing

/**
 * Il pacchetto da mandare: `[lunghezza+1, comando, ...dati]`.
 *
 * La lunghezza conta il comando, non se stessa. Viene da `uwatec_smart_usbhid_send`,
 * che costruisce `buf[0]=0; buf[1]=size+1; buf[2]=cmd` e poi su BLE scrive da
 * `buf+1` — cioè salta lo zero iniziale, che serve solo all'USB HID.
 */
export function pacchettoUwatec(cmd: number, dati: Uint8Array = new Uint8Array(0)): Uint8Array {
  const out = new Uint8Array(dati.length + 2);
  out[0] = dati.length + 1;
  out[1] = cmd;
  out.set(dati, 2);
  return out;
}

/**
 * Il riassemblatore: notifiche in entrata → byte, buttando il primo di ognuna.
 *
 * PERCHÉ TIENE UN AVANZO. libdivecomputer non lo fa: legge una notifica per
 * volta e copia tutto quello che c'è dentro nel buffer del chiamante, dando per
 * scontato che il computer non mandi mai in una notifica la fine di una
 * risposta e l'inizio della successiva. Sul suo codice, se succedesse, sarebbe
 * uno sconfinamento di memoria.
 *
 * Qui non si può dare per scontato, e c'è un motivo preciso per dubitarne: la
 * risposta a `CMD_DATA` dichiara `lunghezza + 4`, dove il 4 sono i byte della
 * dichiarazione stessa. Il firmware conta cioè l'intestazione come parte del
 * blocco — e un firmware che la conta insieme potrebbe benissimo mandarla
 * insieme, nella stessa notifica dei primi quindici byte di dati. Tenendo
 * l'avanzo il caso funziona; buttandolo si perderebbero quei quindici byte e
 * tutto il resto sarebbe disallineato.
 *
 * Costa tre righe e copre tutti e due i modi in cui il firmware può comportarsi,
 * quindi non c'è niente da decidere e niente da provare col computer in mano.
 */
class Riassemblatore {
  private avanzo = new Uint8Array(0);

  constructor(private link: BleLink) {}

  /**
   * Butta via tutto quello che è rimasto in coda. Da fare prima di ogni comando.
   *
   * Quello che si butta si SCRIVE nel diario. Al primo tentativo con un
   * computer vero, «prima del comando c'erano quattro byte residui» è
   * l'informazione che distingue un dispositivo ancora impegnato in una
   * sessione precedente da un protocollo capito male — e senza quella riga la
   * differenza costa un altro giro di prove col computer in mano.
   */
  azzera(trace?: (line: string) => void): void {
    const residuo = this.link.drain();
    if ((residuo.length || this.avanzo.length) && trace) {
      trace(
        `in coda prima del comando: ${residuo.length + this.avanzo.length} byte buttati` +
          (residuo.length
            ? ` (${esadecimale(residuo.subarray(0, 16))}${residuo.length > 16 ? '…' : ''})`
            : ''),
      );
    }
    this.avanzo = new Uint8Array(0);
  }

  async manda(cmd: number, dati?: Uint8Array): Promise<void> {
    const pacchetto = pacchettoUwatec(cmd, dati);
    if (pacchetto.length > this.link.mtu) {
      throw new UwatecProtocolError(
        `Comando 0x${cmd.toString(16)} da ${pacchetto.length} byte su un MTU di ${this.link.mtu}.`,
      );
    }
    await this.link.writeFrame(pacchetto);
  }

  /**
   * Riempie `out`, e dice fin dove è arrivato ANCHE se si interrompe.
   *
   * `stato.fatti` è mutato passo passo di proposito: quando il collegamento
   * cade a metà di un trasferimento da duecento kilobyte, quello che è arrivato
   * sono immersioni vere e vanno tenute. Un valore restituito si perderebbe
   * insieme all'eccezione.
   */
  async riempi(
    out: Uint8Array,
    stato: { fatti: number },
    timeoutMs: number,
    signal: AbortSignal,
    avanzamento?: (fatti: number) => void,
  ): Promise<void> {
    let aVuoto = 0;
    let giriDiLettura = 0;
    while (stato.fatti < out.length) {
      if (signal.aborted) throw new UwatecProtocolError('scarico annullato');
      let pezzo: Uint8Array;
      if (this.avanzo.length) {
        pezzo = this.avanzo;
        this.avanzo = new Uint8Array(0);
      } else {
        // Il segnale arriva fino allo stream: senza, «Annulla» non ha effetto
        // finché la scadenza non è passata — dodici secondi durante i dati,
        // venti sui comandi lunghi.
        const notifica = await this.link.readFrame(timeoutMs, signal);
        // Una notifica di un byte solo è il byte di sequenza e basta: non è un
        // errore, è un pacchetto vuoto, e insistere è la cosa giusta.
        pezzo = notifica.subarray(1);
      }
      /*
       * OGNI TANTO SI CEDE IL TURNO ANCHE QUANDO VA TUTTO BENE.
       *
       * `readFrame` su una notifica già in coda si risolve subito, senza toccare
       * la coda dei macrotask: se lo stack consegna più in fretta di quanto
       * questo ciclo consumi — cioè proprio quando la coda si allunga — migliaia
       * di giri filano via senza che nessun `setTimeout` riesca a scattare.
       * Misurato: 200 000 notifiche già in coda tengono il turno per quasi
       * diciassette secondi. Restituirlo ogni 256 giri costa niente e rimette in
       * moto scadenze, annullamento e disegno.
       */
      if (++giriDiLettura % 256 === 0) await new Promise((r) => setTimeout(r, 0));

      const quanti = Math.min(out.length - stato.fatti, pezzo.length);
      out.set(pezzo.subarray(0, quanti), stato.fatti);
      stato.fatti += quanti;
      if (quanti < pezzo.length) this.avanzo = pezzo.slice(quanti);
      avanzamento?.(stato.fatti);

      /*
       * UN GIRO CHE NON PORTA BYTE DEVE CEDERE IL CONTROLLO, e dopo un po' deve
       * arrendersi. Non è teoria: è il modo in cui questo ciclo pianta l'app.
       *
       * `readFrame` su una notifica già in coda si risolve SUBITO, senza
       * toccare la coda dei macrotask. Un dispositivo che consegna notifiche di
       * un byte solo — solo sequenza, niente dati — fa girare questo `while`
       * su microtask all'infinito: il `setTimeout` della scadenza dentro
       * `ByteStream` non scatta mai, e nemmeno l'evento di annullamento, che
       * pure viene controllato qui sopra a ogni giro. Dentro la webview di
       * Tauri quello è il thread dell'interfaccia: l'applicazione si inchioda,
       * senza scadenza, senza errore e senza il pulsante «Annulla».
       *
       * Il `setTimeout(0)` restituisce il turno — così scadenze e annullamento
       * possono scattare — e il contatore trasforma una sorgente impazzita in
       * un errore leggibile invece che in un blocco.
       */
      if (quanti === 0) {
        if (++aVuoto > NOTIFICHE_A_VUOTO) {
          throw new UwatecProtocolError(
            `Il computer manda notifiche senza dati: ${NOTIFICHE_A_VUOTO} di fila dopo ${stato.fatti} byte.`,
          );
        }
        await new Promise((r) => setTimeout(r, 0));
      } else {
        aVuoto = 0;
      }
    }
  }

  /** Manda un comando e aspetta esattamente `quanti` byte di risposta. */
  async chiedi(
    cmd: number,
    quanti: number,
    signal: AbortSignal,
    dati?: Uint8Array,
    timeoutMs = TIMEOUT_MS,
    trace?: (line: string) => void,
  ): Promise<Uint8Array> {
    this.azzera(trace);
    await this.manda(cmd, dati);
    const out = new Uint8Array(quanti);
    await this.riempi(out, { fatti: 0 }, timeoutMs, signal);
    return out;
  }

  /** Quello che è rimasto appiccicato all'ultima risposta. Serve solo al diario. */
  get avanzoInSospeso(): number {
    return this.avanzo.length;
  }
}

// ------------------------------------------------------------------- l'impronta

/**
 * La chiave di un'immersione: `<modello>:<orario>`, tutto in esadecimale.
 *
 * L'orario è i quattro byte a offset 8 del record — mezzi secondi dal
 * 2000-01-01 — ed è esattamente quello che libdivecomputer usa come impronta e
 * che il computer si aspetta indietro nei parametri per lo scarico
 * incrementale. Non è una nostra invenzione: è il numero che il firmware
 * confronta.
 *
 * IL MODELLO STA NELLA CHIAVE, ed è una scelta che va spiegata perché sembra
 * sporcarla. `decode()` riceve i record e basta — non sa con quale computer si
 * è parlato — ma senza il numero del modello non sa nemmeno quanto è lunga
 * l'intestazione: 84 byte sull'Aladin Sport Matrix, 152 sul Galileo. Leggere
 * dall'offset sbagliato non dà un errore, dà una immersione plausibile e falsa.
 * Il tracciato si può indovinare — `decodeUwatecSmart` ha un ripiego empirico —
 * ma indovinare quando si SA è la cosa che poi non si riesce più a spiegare.
 *
 * Insieme al modello viaggia il SERIALE, per lo stesso motivo: senza,
 * l'immersione scaricata via Bluetooth entrerebbe in archivio senza sapere da
 * quale computer viene, e `mergeDive` tratta il blocco `computer` come un tutto
 * unico — chi scarica via Bluetooth e poi importa lo stesso periodo da LogTRAK
 * si ritroverebbe le immersioni fuse ma prive di seriale per sempre.
 *
 * La chiave viaggia dentro il segnalibro e torna indietro da `since`: chi la
 * scrive e chi la legge sono lo stesso driver, quindi il formato è affar suo.
 * `orarioDaChiave` legge l'ultimo campo, quindi le chiavi vecchie a due campi
 * continuano a funzionare come segnalibro.
 */
export function chiaveUwatec(identita: { modello?: number; seriale?: number }, orario: number): string {
  const m = identita.modello === undefined ? '??' : identita.modello.toString(16).padStart(2, '0');
  const s = identita.seriale === undefined ? '' : String(identita.seriale);
  return `${m}:${s}:${(orario >>> 0).toString(16).padStart(8, '0')}`;
}

/** L'orario dentro una chiave, o `undefined` se non è una chiave nostra. */
export function orarioDaChiave(chiave: string | undefined): number | undefined {
  if (!chiave) return undefined;
  const coda = chiave.slice(chiave.lastIndexOf(':') + 1);
  if (!/^[0-9a-f]{1,8}$/i.test(coda)) return undefined;
  return parseInt(coda, 16) >>> 0;
}

/** Modello e seriale dentro una chiave, se ci sono. */
export function identitaDaChiave(chiave: string): { modello?: number; seriale?: string } {
  const pezzi = chiave.split(':');
  const testa = pezzi.length >= 2 ? pezzi[0] : '';
  const seriale = pezzi.length >= 3 ? pezzi[1] : '';
  return {
    modello: /^[0-9a-f]{1,2}$/i.test(testa) ? parseInt(testa, 16) : undefined,
    seriale: /^\d+$/.test(seriale) ? seriale : undefined,
  };
}

/**
 * I parametri di `CMD_SIZE` e `CMD_DATA`: l'impronta, più quattro byte fissi.
 *
 * `10 27 00 00` è 10000 little endian. libdivecomputer lo scrive senza
 * spiegarlo e lo manda identico da sempre; l'ipotesi ragionevole è un limite al
 * numero di immersioni da restituire. Lo si copia com'è: cambiarlo per vedere
 * che succede si fa con un computer di scorta, non con quello di qualcuno.
 */
export function parametriUwatec(orario: number): Uint8Array {
  const p = new Uint8Array(8);
  new DataView(p.buffer).setUint32(0, orario >>> 0, true);
  p[4] = 0x10;
  p[5] = 0x27;
  return p;
}

/** Il messaggio di un errore, qualunque cosa sia. */
const messaggio = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Byte in esadecimale, per il diario. */
const esadecimale = (b: Uint8Array) => [...b].map((v) => v.toString(16).padStart(2, '0')).join(' ');

const u32le = (b: Uint8Array, at = 0) =>
  new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(at, true);

/** Da BCD a decimale: `0x21` è la versione 21, non 33. */
const bcd2dec = (v: number) => ((v >> 4) & 0x0f) * 10 + (v & 0x0f);

// --------------------------------------------------------------------- il driver

export const uwatecDriver: DiveComputerDriver = {
  id: 'uwatec',
  label: 'Scubapro / Uwatec (Aladin Matrix, A1, A2, G2, G3, Luna 2)',
  profile: {
    service: SERVIZIO,
    /*
     * ⚠️ La modalità di scrittura si decide guardando il dispositivo.
     *
     * Non l'ho mai vista, questa caratteristica, e le due modalità non sono
     * intercambiabili: scrivere «senza risposta» dove il GATT dichiara solo
     * «write» fallisce alla PRIMA scrittura, cioè nel punto in cui il sintomo è
     * identico a «il computer non risponde». `auto` sceglie quella che il
     * dispositivo dichiara di sapere fare, come fa Subsurface.
     */
    writeType: 'auto',
  },
  /*
   * Il servizio annunciato vale quanto il nome, e non è ridondante: alcuni
   * firmware annunciano l'UUID e un nome che non abbiamo previsto, e in quel
   * caso il servizio è la prova più forte delle due — è il suo, e non ce
   * l'ha nessun altro.
   */
  matches: either(exactName(...NOMI_INTERI), nameStartsWith(...NOMI_INIZIALI), advertisesService(SERVIZIO)),

  async download(link, { emit, signal, since, trace, riapri }) {
    let bus = new Riassemblatore(link);

    /*
     * Nessuna stretta di mano: su BLE `uwatec_smart_handshake` esce subito.
     * Il primo byte che il computer riceve è già il comando «chi sei».
     */
    const modello = (await bus.chiedi(CMD_MODEL, 1, signal))[0];
    trace(`modello: 0x${modello.toString(16)} (${uwatecModelName(modello)})`);

    const hardware = (await bus.chiedi(CMD_HARDWARE, 1, signal))[0];
    const software = (await bus.chiedi(CMD_SOFTWARE, 1, signal))[0];
    const seriale = u32le(await bus.chiedi(CMD_SERIAL, 4, signal));
    const orologio = u32le(await bus.chiedi(CMD_DEVTIME, 4, signal));

    /*
     * IL SERIALE È UN NUMERO, e si scrive in decimale.
     *
     * È il contrario di Shearwater, dove è testo esadecimale. Qui
     * `array_uint32_le` di libdivecomputer e la schermata del computer dicono
     * lo stesso numero decimale, ed è anche quello che LogTRAK mette nei suoi
     * export: usare un'altra base darebbe due identità diverse allo stesso
     * computer a seconda di come sono arrivate le immersioni.
     */
    const identita: ComputerIdentity = {
      model: uwatecModelName(modello),
      serial: String(seriale),
    };
    emit({
      kind: 'identified',
      model: identita.model ?? 'Scubapro',
      serial: identita.serial,
      firmware: `${bcd2dec(software)} (hw ${hardware})`,
    });

    /*
     * LA DERIVA DELL'OROLOGIO SI DICE, NON SI CORREGGE.
     *
     * Ogni immersione porta il proprio orario assoluto, e il decodificatore lo
     * usa così com'è — è quello che fa anche `uwatec_smart_parser_get_datetime`,
     * che non applica nessuna correzione. Quindi se l'orologio del computer va
     * indietro di un'ora, TUTTE le immersioni scaricate saranno un'ora indietro,
     * comprese quelle già fatte.
     *
     * Correggerle qui sarebbe sbagliato due volte: la deriva di oggi non è
     * quella di tre anni fa, e un'immersione il cui orario è stato aggiustato
     * da noi non combacia più con la stessa immersione arrivata da LogTRAK.
     * Si dice e basta, così chi legge sa che l'ora sul computer va rimessa.
     */
    const orologioMs = UWATEC_EPOCH_MS + (orologio / 2) * 1000;
    const derivaS = Math.round((orologioMs - Date.now()) / 1000);
    trace(
      `seriale ${seriale}, firmware ${bcd2dec(software)}, hardware ${hardware}, ` +
        `orologio ${new Date(orologioMs).toISOString()} (${derivaS >= 0 ? '+' : ''}${derivaS} s rispetto a qui)`,
    );

    const segnalibro = since(identita);
    const daOrario = orarioDaChiave(segnalibro);
    if (segnalibro && daOrario === undefined) {
      trace(`segnalibro «${segnalibro}» non riconosciuto: rileggo tutta la memoria`);
    }
    /*
     * IL FILTRO LO FA IL COMPUTER, e cambia l'ordine di grandezza dell'attesa.
     *
     * Su Shearwater si scarica tutto e ci si ferma leggendo il manifesto: il
     * risparmio c'è ma il manifesto va comunque letto. Qui l'impronta entra nei
     * parametri di `CMD_SIZE`, e il numero che torna è già la dimensione del
     * SOLO nuovo. Con niente di nuovo torna zero, e il collegamento si chiude
     * dopo sei comandi.
     */
    /*
     * IL TRASFERIMENTO SI RIPRENDE DA SOLO, E QUESTO È IL CUORE DEL DRIVER.
     *
     * Col computer vero in mano è successo questo: il computer ha annunciato
     * 129 037 byte, ne ha mandati 39 634 — il trenta per cento — e poi ha
     * smesso, senza disconnettersi. La lettura è scaduta dopo cinque secondi di
     * silenzio, e delle centotrenta immersioni in memoria ne sono arrivate
     * trentanove: le più VECCHIE, perché il blocco comincia da quelle. Cioè
     * proprio quelle che nell'archivio non servivano, mentre le recenti — le
     * uniche che avrebbero potuto fondersi con quelle già importate da file —
     * non sono mai partite.
     *
     * Perché smetta non lo so, e non serve saperlo: potrebbe essere una pausa
     * del firmware più lunga della nostra scadenza, un limite di buffer, una
     * finestra di risparmio energetico. Quello che conta è che il protocollo
     * offre già il modo di ripartire, e non l'avevamo usato.
     *
     * `CMD_SIZE` e `CMD_DATA` prendono un'IMPRONTA e il computer restituisce
     * solo quello che è venuto dopo. È il meccanismo dello scarico incrementale
     * fra una sessione e l'altra — ma niente vieta di usarlo DENTRO la stessa
     * sessione: si prende l'immersione più recente arrivata, la si dà come
     * impronta, e si richiede il resto. Ogni giro riparte esattamente da dove
     * si era rotto, senza rileggere niente e senza chiedere niente all'utente.
     *
     * Il ciclo si ferma da sé in tre modi, e tutti e tre servono: quando il
     * computer dice che non c'è più niente (`lunghezza === 0`), quando un giro
     * finisce per intero, e quando un giro non porta NESSUNA immersione nuova —
     * che è la condizione senza la quale un computer bloccato sul primo byte
     * farebbe girare questo ciclo per sempre.
     */
    const perChiave = new Map<string, DownloadedRecord>();
    let impronta = daOrario ?? 0;
    let bytiTotali = 0;
    let ultimoErrore: unknown;
    let completo = false;

    let riaperto = false;
    let riaperture = 0;
    let fuoriOrdine = false;
    let doppioni = 0;
    const scadenzaTotale = Date.now() + TEMPO_MASSIMO_MS;
    /** Quanto il computer aveva dichiarato al PRIMO giro, e quanto ne abbiamo consumato. */
    let lunghezzaIniziale = 0;
    let byteDeiRecord = 0;
    for (let giro = 1; giro <= MAX_RIPRESE && !completo; giro++) {
      if (signal.aborted) break;
      if (Date.now() > scadenzaTotale) {
        ultimoErrore =
          ultimoErrore ??
          new UwatecProtocolError(
            `Lo scarico dura da più di ${Math.round(TEMPO_MASSIMO_MS / 60_000)} minuti e non è finito: mi fermo. Quello che è arrivato è salvato.`,
          );
        trace('superato il tempo massimo per uno scarico: mi fermo');
        break;
      }
      const parametri = parametriUwatec(impronta);
      let nuovi = 0;

      /*
       * TUTTO IL GIRO STA DENTRO UN `try`, comandi compresi.
       *
       * Non è prudenza generica. Quando l'Aladin si impianta non lo fa a metà
       * dei dati: smette di rispondere, e il primo a cadere è il comando
       * SUCCESSIVO — `CMD_SIZE` del giro dopo, che va in scadenza. Se solo la
       * lettura del blocco fosse protetta, quell'errore uscirebbe dal ciclo e
       * la riapertura non verrebbe mai tentata: era esattamente il difetto, e
       * il test con il finto che ammutolisce lo ha preso al primo colpo.
       */
      try {
        const lunghezza = u32le(await bus.chiedi(CMD_SIZE, 4, signal, parametri, TIMEOUT_LUNGO_MS, trace));
        trace(
          giro === 1
            ? impronta
              ? `da scaricare dopo l'impronta 0x${impronta.toString(16)}: ${lunghezza} byte`
              : `da scaricare (tutta la memoria): ${lunghezza} byte`
            : `ripresa ${giro - 1}: dall'impronta 0x${impronta.toString(16)} restano ${lunghezza} byte`,
        );

        if (lunghezza === 0) {
          completo = true;
          break;
        }

        /*
         * CONTROLLO CHE LA RIPRESA NON ABBIA SALTATO NIENTE.
         *
         * La guardia sull'ordine cronologico vede solo il disordine DENTRO il
         * pezzo arrivato: se il pezzo è ordinato ma quello che resta in memoria
         * è più vecchio, l'impronta lo scavalca e non ce ne accorgiamo. Qui il
         * conto lo fa il computer: al primo giro ha dichiarato quanti byte
         * aveva in tutto, e a ogni ripresa dichiara quanti ne restano. Se i
         * record che abbiamo in mano non spiegano la differenza, in mezzo è
         * sparito qualcosa.
         *
         * Non si prova a indovinare quanto: ci si ferma, si tiene quello che è
         * arrivato e si dice che il resto va riletto da capo. Costa minuti, non
         * immersioni.
         */
        if (giro > 1 && lunghezzaIniziale > 0) {
          const attesi = lunghezzaIniziale - byteDeiRecord;
          if (lunghezza < attesi - TOLLERANZA_BYTE) {
            trace(
              `la ripresa salterebbe ${attesi - lunghezza} byte: restano ${lunghezza} dove ne aspettavo ${attesi}`,
            );
            fuoriOrdine = true;
            break;
          }
        }
        if (giro === 1) lunghezzaIniziale = lunghezza;

        /*
         * `CMD_DATA` risponde PRIMA con quanto sta per mandare, e quel numero è
         * `lunghezza + 4`: conta cioè anche i quattro byte con cui lo sta
         * dicendo. Se non torna così, il computer ha capito una domanda diversa
         * dalla nostra — e continuare vorrebbe dire tagliare il blocco nel
         * punto sbagliato.
         */
        bus.azzera(giro === 1 ? trace : undefined);
        await bus.manda(CMD_DATA, parametri);
        const dichiarato = new Uint8Array(4);
        await bus.riempi(dichiarato, { fatti: 0 }, TIMEOUT_LUNGO_MS, signal);
        const totale = u32le(dichiarato);
        if (totale !== lunghezza + 4) {
          throw new UwatecProtocolError(
            `Il computer dice che manderà ${totale} byte, ma ne aveva annunciati ${lunghezza + 4}.`,
          );
        }
        if (bus.avanzoInSospeso) {
          trace(`la dichiarazione arriva incollata ai dati: ${bus.avanzoInSospeso} byte già in mano`);
        }

        const blocco = new Uint8Array(lunghezza);
        const stato = { fatti: 0 };
        let ultimoAnnuncio = 0;
        try {
          await bus.riempi(blocco, stato, TIMEOUT_DATI_MS, signal, (fatti) => {
            if (fatti - ultimoAnnuncio < PASSO_AVANZAMENTO && fatti < lunghezza) return;
            ultimoAnnuncio = fatti;
            // Il tetto vale anche DENTRO un trasferimento lentissimo, non solo
            // fra un giro e l'altro: è lì che le venti ore si accumulerebbero.
            if (Date.now() > scadenzaTotale) throw new UwatecProtocolError('tempo massimo superato');
            const kb = (v: number) => Math.round(v / 1024);
            emit({
              kind: 'progress',
              done: bytiTotali + fatti,
              total: bytiTotali + lunghezza,
              label:
                `Ricevo la memoria del computer: ${kb(bytiTotali + fatti)} di ${kb(bytiTotali + lunghezza)} kB` +
                (giro > 1 ? ` (ripresa ${giro - 1})` : ''),
            });
          });
          completo = true;
        } catch (err) {
          ultimoErrore = err;
          trace(`giro ${giro}: interrotto a ${stato.fatti} di ${lunghezza} byte — ${messaggio(err)}`);
        }
        bytiTotali += stato.fatti;

        const tagliato = tagliaRecord(blocco.subarray(0, stato.fatti), { modello, seriale, orologio }, trace);
        if (!tagliato.cronologico) fuoriOrdine = true;
        for (const r of tagliato.record) {
          const gia = perChiave.get(r.key);
          if (gia) {
            /*
             * Due record con lo STESSO orario. Non può succedere — due immersioni
             * non cominciano nello stesso mezzo secondo — ma se succede la chiave
             * è la stessa e uno dei due sparirebbe in silenzio, portandosi dietro
             * anche il conteggio mostrato a schermo. Si tiene il primo e si dice.
             */
            if (gia.bytes.length !== r.bytes.length) doppioni++;
            continue;
          }
          perChiave.set(r.key, r);
          byteDeiRecord += r.bytes.length;
          nuovi++;
          emit({ kind: 'record', done: perChiave.size, record: r });
        }
      } catch (err) {
        ultimoErrore = err;
        trace(`giro ${giro}: ${messaggio(err)}`);
        // Un protocollo che non torna — un totale annunciato che non combacia —
        // non si cura riaprendo: vuol dire che ci siamo capiti male, e insistere
        // taglierebbe il blocco nel punto sbagliato.
        if (err instanceof UwatecProtocolError && !/non ha risposto|annullato/.test(messaggio(err))) break;
      }

      if (completo) break;

      /*
       * SE IL BLOCCO NON ERA IN ORDINE DI DATA, NON SI RIPRENDE.
       *
       * La ripresa dà al computer l'impronta dell'immersione più recente
       * ricevuta e gli chiede il resto: funziona solo se quello che è arrivato
       * erano le più vecchie. Con un blocco fuori ordine — memoria circolare che
       * ha girato, orologio rimesso indietro — quell'impronta scavalca immersioni
       * che non sono ancora arrivate, e il computer non le offrirà più: sparite,
       * con lo scarico dichiarato completo e nessun avviso.
       *
       * Meglio fermarsi e dirlo. Quello che è arrivato entra in archivio, il
       * segnalibro non si sposta, e il prossimo tentativo ricomincia da capo —
       * che costa minuti, non immersioni.
       */
      if (fuoriOrdine) {
        trace('il blocco non è in ordine di data: non riprendo, il resto si rilegge da capo');
        break;
      }

      if (nuovi > 0) {
        /*
         * Il computer parla ancora: si riparte sulla STESSA sessione,
         * dall'impronta dell'immersione più recente arrivata. È il caso normale
         * — una pausa del firmware più lunga della nostra scadenza — e riaprire
         * qui costerebbe secondi senza servire a niente.
         */
        riaperto = false;
        impronta = Math.max(...[...perChiave.keys()].map((k) => orarioDaChiave(k) ?? 0));
        trace(`riprendo da 0x${impronta.toString(16)} — ${perChiave.size} immersioni finora`);
        if (giro === MAX_RIPRESE) trace(`raggiunto il limite di ${MAX_RIPRESE} riprese: mi fermo`);
        continue;
      }

      /*
       * NIENTE DI NUOVO: il computer si è impiantato, e si riapre la sessione.
       *
       * Un giro che non porta nessuna immersione — perché il comando è andato
       * in scadenza, o perché i dati si sono fermati prima di un record intero
       * — significa che il firmware non risponde più, pur senza essersi
       * disconnesso. Il collegamento sembra vivo e non lo è: rimandare lo
       * stesso comando rifà esattamente la stessa cosa, e l'unica cosa che lo
       * rimette in moto è una sessione GATT nuova.
       *
       * Una volta sola per punto di stallo. Se anche dopo la riapertura non
       * arriva niente, il computer è spento, lontano o scarico, e insistere
       * allunga soltanto l'attesa. La bandiera si azzera appena un giro torna a
       * portare qualcosa, così un trasferimento lungo può riaprire più volte,
       * ma mai due volte di fila a vuoto.
       */
      if (riaperto || riaperture >= MAX_RIAPERTURE) {
        trace(`giro ${giro}: niente di nuovo nemmeno dopo aver riaperto, mi fermo`);
        break;
      }
      try {
        // Si dice a schermo, altrimenti la barra resta ferma per qualche secondo
        // e chi guarda non ha modo di sapere se è ancora viva.
        emit({
          kind: 'progress',
          done: bytiTotali,
          total: bytiTotali,
          label: 'Il computer non risponde più: riapro il collegamento…',
        });
        bus = new Riassemblatore(await riapri());

        /*
         * Dopo la riapertura ci si ripresenta, e si CONTROLLA il seriale.
         *
         * I due comandi costano niente e servono a due cose. La prima è mettere
         * il firmware nello stesso stato in cui lo trova l'applicazione del
         * costruttore, che dopo ogni apertura chiede sempre chi sei: un
         * dispositivo che si aspetta quella sequenza e riceve subito una
         * richiesta di dati potrebbe tacere di nuovo, e avremmo dato la colpa
         * alla riapertura.
         *
         * La seconda conta di più: la riapertura passa dall'identificativo che
         * dà il sistema operativo, e in mezzo c'è stata una disconnessione.
         * Ritrovarsi collegati a un ALTRO computer subacqueo — un secondo
         * Aladin nella stessa barca — non è impossibile, e proseguire
         * mescolerebbe due archivi in uno senza che nessuno se ne accorga. Il
         * seriale è l'unica cosa che lo esclude.
         */
        const modelloDiNuovo = (await bus.chiedi(CMD_MODEL, 1, signal))[0];
        const serialeDiNuovo = u32le(await bus.chiedi(CMD_SERIAL, 4, signal));
        if (serialeDiNuovo !== seriale || modelloDiNuovo !== modello) {
          throw new UwatecProtocolError(
            `Dopo la riapertura risponde un computer diverso: seriale ${serialeDiNuovo} invece di ${seriale}.`,
          );
        }
        trace(`ripresentato: seriale ${serialeDiNuovo}, è sempre lui`);

        riaperto = true;
        riaperture++;
        // La riapertura non consuma un giro: non ha letto niente.
        giro--;
      } catch (err) {
        ultimoErrore = ultimoErrore ?? err;
        trace(`riapertura non riuscita: ${messaggio(err)}`);
        break;
      }
    }

    /*
     * Il motivo VERO viene prima di quello apparente.
     *
     * Un trasferimento che si interrompe lascia sempre dietro di sé una
     * scadenza, e quella scadenza è l'ultimo errore visto — ma non è la ragione
     * per cui ci si è fermati. Dire «il computer non ha risposto» dove il
     * problema è che riprendere salterebbe delle immersioni manda a cercare il
     * guasto dalla parte sbagliata: la prima frase invita a riprovare
     * avvicinandosi, la seconda dice che riprovare è proprio la cosa giusta ma
     * per un altro motivo.
     */
    if (fuoriOrdine) {
      ultimoErrore = new UwatecProtocolError(
        'Le immersioni non arrivano in ordine di data, quindi riprendere il trasferimento da dove si era interrotto ne salterebbe qualcuna. Quelle arrivate sono salvate; riprova a scaricare per avere le altre.',
      );
    }

    if (doppioni) {
      trace(`${doppioni} record con lo stesso orario di uno già arrivato: tenuto il primo`);
    }

    const record = [...perChiave.values()].sort(
      (a, b) => (orarioDaChiave(b.key) ?? 0) - (orarioDaChiave(a.key) ?? 0),
    );
    emit({ kind: 'counted', total: record.length });

    /*
     * L'errore si rilancia solo se lo scarico NON è completo, e dopo aver
     * consegnato tutto quello che è arrivato. Così `downloadFromComputer` ha in
     * mano le immersioni intere: lo scarico risulterà `partial`, il segnalibro
     * non si sposterà, e quello che c'è entrerà comunque in archivio.
     */
    if (!completo && ultimoErrore) throw ultimoErrore;
    return record;
  },

  decode(records) {
    const dives: Dive[] = [];
    const warnings: string[] = [];
    const ripetuti = new Map<string, number>();
    const nota = (testo: string) => ripetuti.set(testo, (ripetuti.get(testo) ?? 0) + 1);
    const importedAt = new Date().toISOString();

    for (const r of records) {
      try {
        const identita = identitaDaChiave(r.key);
        const decodificata = decodeUwatecSmart(r.bytes, { model: identita.modello });
        for (const w of decodificata.warnings) nota(w);
        dives.push(costruisci(decodificata, r.key, identita, importedAt));
      } catch (err) {
        warnings.push(
          `Immersione ${r.key} scaricata ma non decodificabile: ${err instanceof Error ? err.message : String(err)}.`,
        );
      }
    }

    /*
     * Gli avvisi che si ripetono si contano, non si elencano.
     *
     * Gli avvisi del decodificatore sono per costruzione gli stessi su tutte le
     * immersioni dello stesso computer: elencandoli uno per uno, su ottantacinque
     * immersioni escono ottantacinque righe identiche che seppelliscono le due
     * che contano. È la stessa regola già applicata al driver Shearwater, dopo
     * averla vista fallire con ottanta righe uguali a schermo.
     */
    for (const [testo, quante] of ripetuti) {
      warnings.push(quante > 1 ? `${testo} (su ${quante} immersioni)` : testo);
    }
    return { dives, warnings };
  },
};

/**
 * Taglia il blocco in immersioni, dalla più recente alla più vecchia.
 *
 * L'ORDINE SI OTTIENE GUARDANDO GLI ORARI, non la posizione in memoria.
 * libdivecomputer scandisce il blocco all'indietro e si fida che l'ordine degli
 * indirizzi sia quello cronologico. È quasi sempre vero e non è garantito: la
 * memoria di questi computer è circolare, e un archivio che ha girato ha la
 * cesura in mezzo. Ordinare per l'orario che ogni record porta con sé costa una
 * riga e non dipende da nessuna assunzione — e conta, perché il primo record
 * dell'elenco diventa il segnalibro: sbagliarlo significa non riscaricare mai
 * più tutto quello che sta dopo di lui.
 */
export interface BloccoTagliato {
  record: DownloadedRecord[];
  /**
   * Vero se nel blocco i record erano in ordine di data crescente.
   *
   * NON È UN DETTAGLIO: la ripresa di un trasferimento interrotto funziona solo
   * se lo è. Si riparte dando al computer l'impronta dell'immersione più recente
   * ricevuta, e lui risponde «tutto quello che è venuto DOPO» — che è il resto
   * solo se quello che è arrivato erano le più vecchie. Su una memoria circolare
   * che ha girato, o dopo un orologio rimesso indietro, l'ordine degli indirizzi
   * non è quello del tempo, e riprendere così SALTEREBBE le immersioni non
   * ancora arrivate, per sempre e senza un avviso.
   */
  cronologico: boolean;
  /** Quanti pezzi sono stati scartati perché troppo corti o con un orario assurdo. */
  scartati: number;
}

/** Il primo orario possibile: 1° gennaio 2001, cioè un anno dopo l'epoca Uwatec. */
const ORARIO_MINIMO = 2 * 365 * 24 * 3600 * 2;

export function tagliaRecord(
  blocco: Uint8Array,
  identita: { modello?: number; seriale?: number; orologio?: number } = {},
  trace?: (line: string) => void,
): BloccoTagliato {
  const pezzi = splitUwatecRecords(blocco);
  const consumati = pezzi.reduce((n, p) => n + p.length, 0);

  /*
   * UN RECORD TROPPO CORTO NON DEVE POTER FAR SALTARE LO SCARICO INTERO.
   *
   * `splitUwatecRecords` accetta qualunque cosa dichiari almeno otto byte,
   * perché è scritto per leggere file. Qui i byte arrivano da una memoria
   * circolare che può contenere un record troncato o una firma `A5 A5 5A 5A`
   * capitata per caso dentro dei campioni: leggere l'orario a offset 8 su un
   * pezzo da nove byte solleva un `RangeError`, e siccome questo taglio avviene
   * PRIMA di consegnare qualunque immersione, quell'eccezione butterebbe via
   * ottantacinque immersioni appena scaricate — dopo minuti di trasferimento
   * riuscito, e con a schermo un messaggio incomprensibile sui limiti di una
   * DataView. Si scarta il pezzo e si va avanti: è la stessa regola per cui
   * un'immersione illeggibile non ne ferma novantanove.
   */
  /*
   * Si scarta anche chi porta un ORARIO IMPOSSIBILE, non solo chi è corto.
   *
   * Una firma `A5 A5 5A 5A` capitata per caso dentro dei campioni produce un
   * pezzo con quattro byte qualunque a offset 8, e quel numero letto come data
   * può cadere nel 2098. Non è un problema di visualizzazione: quell'orario
   * finisce nell'impronta con cui si chiede il resto della memoria, e il
   * computer risponde «dopo il 2098 non c'è niente» — scarico dichiarato
   * completo, con dentro una immersione su centotrenta. È successo in prova.
   *
   * Il limite alto è l'orologio del computer, che abbiamo appena letto: nessuna
   * immersione può essere più recente di adesso. Un giorno di margine copre un
   * orologio impostato male senza aprire la porta a un anno di errore.
   */
  const massimo = identita.orologio ? identita.orologio + 2 * 86_400 : Infinity;
  const buoni: { bytes: Uint8Array; orario: number }[] = [];
  for (const p of pezzi) {
    if (p.length < 12) continue;
    const orario = u32le(p, 8);
    if (orario < ORARIO_MINIMO || orario > massimo) continue;
    buoni.push({ bytes: p, orario });
  }
  const scartati = pezzi.length - buoni.length;

  // L'ordine in cui erano scritti in memoria, PRIMA di riordinarli per data.
  let cronologico = true;
  for (let i = 1; i < buoni.length; i++) {
    if (buoni[i].orario < buoni[i - 1].orario) cronologico = false;
  }

  trace?.(
    `${buoni.length} immersioni nel blocco, ${consumati} byte su ${blocco.length}` +
      (consumati === blocco.length ? '' : ' — il resto non è un record e viene ignorato') +
      (scartati ? ` — ${scartati} pezzi scartati (troppo corti o con una data impossibile)` : '') +
      (cronologico ? '' : ' — ATTENZIONE: non sono in ordine di data'),
  );

  return {
    record: [...buoni]
      .sort((a, b) => b.orario - a.orario)
      .map(({ bytes, orario }) => ({ key: chiaveUwatec(identita, orario), bytes })),
    cronologico,
    scartati,
  };
}

/**
 * Da record nativo a immersione.
 *
 * Povera di proposito: sito, compagno, note, zavorra non sono nel computer, sono
 * nell'applicazione. Qui c'è quello che il computer ha misurato, che è la parte
 * che nessun altro può dare.
 *
 * `diveIdFor` è lo stesso identificativo che usano gli import da file: la stessa
 * immersione già arrivata da LogTRAK viene FUSA e non duplicata, e le note
 * scritte a mano restano dov'erano.
 */
function costruisci(
  d: UwatecDive,
  key: string,
  identita: { modello?: number; seriale?: string },
  importedAt: string,
): Dive {
  const samples: Sample[] = uwatecSamplesToCanonical(trimSurface(d.samples));

  /*
   * Il massimo fra intestazione e campioni, non l'uno o l'altro.
   *
   * L'intestazione ha risoluzione doppia rispetto ai campioni, quindi quando c'è
   * vince lei. Ma `??` non intercetta lo zero: su un record troncato
   * l'immersione entrerebbe in archivio a ZERO METRI con un profilo che arriva a
   * ventitré, e da lì ogni statistica sarebbe sbagliata senza un errore a
   * schermo. È lo stesso difetto trovato sul driver Shearwater.
   */
  const daiCampioni = samples.length ? Math.max(...samples.map((s) => s.depth)) : 0;
  const maxDepth = Math.max(d.maxDepth || 0, daiCampioni);
  const durationS = Math.max(d.durationS || 0, samples.length ? samples[samples.length - 1].t : 0);

  /*
   * Senza profondità E senza durata non è un'immersione: è un record vuoto.
   *
   * Il lettore di LogTRAK scarta lo stesso record (`if (!maxDepth || !durationS)
   * return null`), e devono concordare: una riga a zero metri e zero secondi in
   * archivio non si fonde con niente — `likelySame` rifiuta per costruzione
   * qualunque immersione di durata nulla — quindi resterebbe lì per sempre a
   * sporcare le statistiche, e comparirebbe solo scaricando via Bluetooth.
   * Sollevare qui la trasforma in un avviso leggibile.
   */
  if (!maxDepth || !durationS) {
    throw new Error('il record non porta né profondità né durata: non è un’immersione');
  }

  /*
   * Le bombole vanno all'INDICE che il computer dà loro, non in fila.
   *
   * `pressureBar` dei campioni è un array indicizzato per serbatoio, e gli
   * indici li sceglie il computer: un'immersione registrata sul solo gas 2
   * darebbe un unico record di miscela con indice 1. Impilando le miscele in
   * ordine di arrivo, quella finirebbe in posizione 0 e le pressioni del
   * profilo punterebbero a una bombola che non esiste — cioè un grafico del
   * consumo vuoto su una immersione che i dati ce li ha.
   */
  const cylinders: Cylinder[] = [];
  for (const g of d.gasMixes) {
    cylinders[Math.max(0, g.index)] = { mix: { o2: g.o2, he: g.he }, startBar: g.startBar, endBar: g.endBar };
  }
  for (let i = 0; i < cylinders.length; i++) {
    if (!cylinders[i]) cylinders[i] = { mix: { o2: 0.21, he: 0 } };
  }
  if (cylinders.length === 0) cylinders.push({ mix: { o2: 0.21, he: 0 } });

  const mode: DiveMode = d.mode === 'freedive' ? 'freedive' : d.mode === 'gauge' ? 'gauge' : 'oc';

  const base: Omit<Dive, 'id'> = {
    startTime: new Date(d.startMs).toISOString(),
    utcOffsetMinutes: d.utcOffsetMinutes,
    durationS,
    maxDepth,
    avgDepth: d.avgDepth,
    minTempC: d.tempMinC,
    airTempC: d.tempSurfaceC,
    mode,
    cylinders,
    salinity: d.salinity,
    computer: {
      model: uwatecModelName(identita.modello),
      serial: identita.seriale,
      // `deviceId` è la stessa cosa del seriale anche nell'import da LogTRAK:
      // è quello il campo su cui `matchComputer` fa il confronto forte.
      deviceId: identita.seriale,
      // Vedi `profiloImpronta`: la stessa immersione arrivata dal file di
      // LogTRAK porta questa identica stringa, e si riconoscono anche se le due
      // date sono lontane mesi.
      profileFingerprint: d.profileFingerprint,
      sampleIntervalS: d.intervalS,
    },
    source: { format: 'uwatec-ble', file: `bluetooth:${key}`, importedAt },
    tags: [],
    samples,
  };

  const dive: Dive = { ...base, id: diveIdFor(base) };
  dive.metrics = computeMetrics(dive);
  // La media dell'intestazione è più precisa di quella ricalcolata sul profilo
  // ritagliato; quando manca vale quella calcolata.
  if (dive.avgDepth === undefined) dive.avgDepth = dive.metrics.avgDepth;
  return dive;
}
