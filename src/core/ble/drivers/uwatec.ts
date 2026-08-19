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
import { exactName } from '../registry';
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
 * I nomi annunciati, dal filtro `dc_filter_uwatec` di libdivecomputer.
 *
 * Il confronto è ESATTO — vedi `exactName`. «A1» e «A2» come prefissi
 * riconoscerebbero qualunque cosa cominci per quelle due lettere.
 *
 * L'Aladin Sport Matrix si annuncia «Aladin», non col suo nome commerciale: è
 * un nome di famiglia condiviso con l'H Matrix. Il modello vero si sa solo dopo
 * essersi connessi, con `CMD_MODEL`, ed è per questo che l'etichetta
 * nell'elenco dei dispositivi resta generica.
 */
const NOMI = ['G2', 'Aladin', 'HUD', 'A1', 'A2', 'G2 TEK', 'Galileo 3', 'Luna 2.0 AI', 'Luna 2.0'];

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
    while (stato.fatti < out.length) {
      if (signal.aborted) throw new UwatecProtocolError('scarico annullato');
      let pezzo: Uint8Array;
      if (this.avanzo.length) {
        pezzo = this.avanzo;
        this.avanzo = new Uint8Array(0);
      } else {
        const notifica = await this.link.readFrame(timeoutMs);
        // Una notifica di un byte solo è il byte di sequenza e basta: non è un
        // errore, è un pacchetto vuoto, e insistere è la cosa giusta.
        pezzo = notifica.subarray(1);
      }
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
  matches: exactName(...NOMI),

  async download(link, { emit, signal, since, trace }) {
    const bus = new Riassemblatore(link);

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
    const impronta = daOrario ?? 0;
    const parametri = parametriUwatec(impronta);

    /*
     * IL FILTRO LO FA IL COMPUTER, e cambia l'ordine di grandezza dell'attesa.
     *
     * Su Shearwater si scarica tutto e ci si ferma leggendo il manifesto: il
     * risparmio c'è ma il manifesto va comunque letto. Qui l'impronta entra nei
     * parametri di `CMD_SIZE`, e il numero che torna è già la dimensione del
     * SOLO nuovo. Con niente di nuovo torna zero, e il collegamento si chiude
     * dopo sei comandi.
     */
    const lunghezza = u32le(await bus.chiedi(CMD_SIZE, 4, signal, parametri, TIMEOUT_LUNGO_MS));
    trace(
      impronta
        ? `da scaricare dopo l'impronta 0x${impronta.toString(16)}: ${lunghezza} byte`
        : `da scaricare (tutta la memoria): ${lunghezza} byte`,
    );

    if (lunghezza === 0) {
      emit({ kind: 'counted', total: 0 });
      return [];
    }

    /*
     * `CMD_DATA` risponde PRIMA con quanto sta per mandare, e quel numero è
     * `lunghezza + 4`: conta cioè anche i quattro byte con cui lo sta dicendo.
     * Se non torna così, il computer ha capito una domanda diversa dalla nostra
     * — e continuare vorrebbe dire tagliare il blocco nel punto sbagliato.
     */
    bus.azzera();
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

    /*
     * Il blocco si legge in un colpo solo, e quello che arriva si tiene.
     *
     * Duecento kilobyte a diciannove byte per notifica sono più di diecimila
     * notifiche: qualche minuto, durante il quale il collegamento può cadere.
     * `stato.fatti` sopravvive all'eccezione apposta — un blocco troncato
     * contiene comunque le immersioni intere che stanno prima del taglio, e
     * buttarle costringerebbe a rifare tutto il trasferimento da capo.
     */
    const blocco = new Uint8Array(lunghezza);
    const stato = { fatti: 0 };
    let ultimoAnnuncio = 0;
    let rotto: unknown;
    try {
      await bus.riempi(blocco, stato, TIMEOUT_MS, signal, (fatti) => {
        if (fatti - ultimoAnnuncio < PASSO_AVANZAMENTO && fatti < lunghezza) return;
        ultimoAnnuncio = fatti;
        emit({
          kind: 'progress',
          done: fatti,
          total: lunghezza,
          label: `Ricevo la memoria del computer: ${Math.round(fatti / 1024)} di ${Math.round(lunghezza / 1024)} kB`,
        });
      });
    } catch (err) {
      rotto = err;
      trace(`trasferimento interrotto a ${stato.fatti} di ${lunghezza} byte`);
    }

    const arrivato = blocco.subarray(0, stato.fatti);
    const record = tagliaRecord(arrivato, { modello, seriale }, trace);
    /*
     * Il conteggio si dichiara solo a trasferimento finito.
     *
     * Su uno scarico interrotto `record.length` sono le immersioni ARRIVATE,
     * non quelle attese — e darlo come totale farebbe scrivere all'interfaccia
     * «si è interrotto (2 su 2)», che è una frase che si contraddice da sola.
     * Quante fossero in tutto, qui, non si sa: il computer manda byte, non
     * immersioni.
     */
    if (!rotto) emit({ kind: 'counted', total: record.length });
    record.forEach((r, i) =>
      emit({ kind: 'record', done: i + 1, total: rotto ? undefined : record.length, record: r }),
    );

    /*
     * Si consegna PRIMA di rilanciare l'errore.
     *
     * Gli eventi sono già usciti, quindi `downloadFromComputer` ha in mano le
     * immersioni intere anche se qui sotto si solleva un'eccezione: lo scarico
     * risulterà `partial`, il segnalibro non si sposterà, e quello che è
     * arrivato entrerà in archivio.
     */
    if (rotto) throw rotto;
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
export function tagliaRecord(
  blocco: Uint8Array,
  identita: { modello?: number; seriale?: number } = {},
  trace?: (line: string) => void,
): DownloadedRecord[] {
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
  const buoni = pezzi.filter((p) => p.length >= 12);
  const corti = pezzi.length - buoni.length;
  trace?.(
    `${buoni.length} immersioni nel blocco, ${consumati} byte su ${blocco.length}` +
      (consumati === blocco.length ? '' : ' — il resto non è un record e viene ignorato') +
      (corti ? ` — ${corti} pezzi troppo corti per essere immersioni, scartati` : ''),
  );

  return buoni
    .map((bytes) => ({ bytes, orario: u32le(bytes, 8) }))
    .sort((a, b) => b.orario - a.orario)
    .map(({ bytes, orario }) => ({ key: chiaveUwatec(identita, orario), bytes }));
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
