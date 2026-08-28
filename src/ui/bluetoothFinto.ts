/**
 * Il Bluetooth finto: quattro computer subacquei che non esistono.
 *
 * ESISTE SOLO NELLE BUILD FATTE CON `VITE_FINTO_BLUETOOTH=1`, e la bandiera è di
 * COMPILAZIONE, non un interruttore a runtime. La differenza non è di stile.
 * Un finto computer subacqueo raggiungibile in una build di produzione —
 * fosse anche dietro un parametro nell'indirizzo, una scorciatoia da tastiera o
 * una casella nelle impostazioni — IMMETTEREBBE IMMERSIONI INVENTATE
 * NELL'ARCHIVIO DI QUALCUNO. In un logbook subacqueo è il difetto peggiore che
 * ci sia: un'immersione falsa non si distingue da una vera guardandola, entra
 * nelle statistiche, nella saturazione residua, nei conteggi che servono per un
 * brevetto, e si porta dietro un'ora e una data che nessuno saprà più smentire.
 * Il rimedio non è nasconderlo bene: è che non ci sia. Vite sostituisce
 * `import.meta.env.VITE_FINTO_BLUETOOTH` con una costante alla compilazione,
 * quindi nella build normale il ramo che importa questo modulo è codice morto e
 * Rollup lo elimina insieme al suo `import()`: nessun pezzo, nessuna stringa,
 * niente da raggiungere. Il controllo sta in fondo a `scripts/schermate-bluetooth.mjs`
 * ed è una riga di `grep` sul `dist/`.
 *
 * A COSA SERVE. Alle schermate dello scarico, che sono le uniche mai
 * fotografate: esistono soltanto quando una ricerca Bluetooth trova qualcosa, e
 * nel browser il Bluetooth non c'è. L'elenco dei dispositivi, l'avanzamento, il
 * computer che si scollega a metà, l'esito. Il difetto che è arrivato fino
 * all'utente — l'elenco che si trascinava di lato su iPhone — viveva esattamente
 * lì, dove nessun controllo automatico poteva vederlo.
 *
 * I QUATTRO DISPOSITIVI SONO SCELTI PER I CASI CHE ROMPONO L'INTERFACCIA, non
 * per fare numero. Uno riconosciuto che arriva in fondo, uno riconosciuto che
 * tace, uno che non annuncia nessun nome e si presenta col suo identificativo
 * di trentasei caratteri — è il caso che sfondava la tabella, e la fotografia
 * serve a vedere che adesso ci sta — e uno che è un televisore.
 */

import { FakeTransport, fintoPeregrine, logPnfSintetico } from '../core/ble/fake';
import type { BleFoundDevice, BleTransport, BleUnavailable } from '../core/ble/types';

/**
 * Tre memorie diverse, così lo scarico completo produce tre immersioni distinte
 * e non tre copie della stessa: la deduplica dell'import le fonderebbe e
 * l'esito direbbe «1 nuova, 2 già in archivio», che è vero ma non è la
 * schermata che si vuole guardare.
 */
const MEMORIA_PEREGRINE = [
  logPnfSintetico(1_750_000_000, 284),
  logPnfSintetico(1_750_100_000, 176),
  logPnfSintetico(1_750_200_000, 412),
];

/**
 * E una memoria DIVERSA per il dispositivo senza nome.
 *
 * Le immersioni si deduplicano sull'ora di inizio: con la stessa memoria del
 * Peregrine, lo scarico interrotto avrebbe risposto «2 già in archivio» — vero,
 * ma non è la schermata da guardare. Con date sue dice «2 nuove» e poi la riga
 * rossa dell'interruzione, che è quello che si vuole vedere in fotografia.
 */
const MEMORIA_SENZA_NOME = [
  logPnfSintetico(1_742_300_000, 331),
  logPnfSintetico(1_742_400_000, 158),
  logPnfSintetico(1_742_500_000, 225),
];

/**
 * Quarantacinque millisecondi di ritardo per ogni risposta.
 *
 * Non è realismo per il realismo: uno scarico che finisce in duecento
 * millisecondi NON SI PUÒ FOTOGRAFARE — la schermata dell’avanzamento, con la
 * barra e il «3 di 3», esiste per un battito di ciglia e lo script la manca
 * ogni volta. Su BLE vero un trasferimento dura minuti; qui bastano due
 * secondi per vederlo passare. È anche il solo modo di provare il pulsante
 * «Interrompi», che su uno scarico istantaneo non fa in tempo a esistere.
 */
const RITARDO_MS = 45;

const dispositivo = (over: Partial<BleFoundDevice> & { id: string }): BleFoundDevice => ({
  name: '',
  serviceUuids: [],
  ...over,
});

/**
 * Come si comporta la ricerca in questo giro.
 *
 * Sono modi diversi di FALLIRE, e ognuno produce una schermata che altrimenti
 * non si vedrebbe mai. Si scelgono con `?finto=…` nell'indirizzo — che qui è
 * lecito proprio perché tutto questo file non esiste nella build normale.
 */
export type ModoFinto = 'normale' | 'vuoto' | 'spento' | 'negato';

export function modoDaIndirizzo(ricerca: string): ModoFinto {
  const v = new URLSearchParams(ricerca).get('finto');
  return v === 'vuoto' || v === 'spento' || v === 'negato' ? v : 'normale';
}

/**
 * Il messaggio ESATTO che il plugin lancia quando il permesso è negato.
 *
 * Trascritto dalla schermata di chi l'ha trovato, non ricostruito a memoria: se
 * un giorno la libreria cambierà quelle parole, la classificazione in
 * `core/ble/causaGuasto.ts` smetterà di riconoscerlo — e allora è QUESTA riga
 * che deve cambiare per prima, perché è quella che tiene onesta la prova.
 */
const PERMESSO_NEGATO = 'Btleplug error: Permission denied';

const SPENTO: BleUnavailable = {
  reason: 'off',
  detail:
    'Il Bluetooth è spento. Accendilo dal centro di controllo o dalle Impostazioni di Sistema, poi riprova.',
};

/**
 * Il trasporto finto, pronto da dare a `BleDownload`.
 *
 * `vuoto` non è un errore: è la ricerca che gira e non trova niente, cioè il
 * caso in cui dopo dodici secondi compare il riquadro che elenca le tre cause
 * possibili.
 *
 * ► QUI C'ERA SCRITTO CHE ERA ANCHE LA SCHERMATA DI CHI HA NEGATO IL PERMESSO
 * SU iPHONE, «perché lì un permesso negato non produce nessun errore». NON È
 * VERO. ◄ Il 28 agosto 2026 il primo utente esterno dell'app ha negato il
 * permesso e ha letto `Btleplug error: Permission denied`: l'errore lo lancia
 * `scan()`, e adesso quel caso ha un messaggio suo (vedi
 * `core/ble/causaGuasto.ts`). `vuoto` resta quello che dice di essere — una
 * ricerca che non trova niente — e non imita più uno stato diverso.
 *
 * `negato` riproduce quella schermata: la scansione lancia il messaggio vero del
 * plugin, e l'interfaccia deve rispondere col percorso delle impostazioni. Prima
 * non c'era, e quel caso si poteva solo descrivere — che per un difetto trovato
 * da un estraneo è il modo di lasciarlo tornare.
 */
export function trasportoFinto(modo: ModoFinto = modoDaIndirizzo(location.search)): BleTransport {
  if (modo === 'spento') return new FakeTransport([], SPENTO);
  if (modo === 'negato') return new FakeTransport([], true, PERMESSO_NEGATO);
  if (modo === 'vuoto') return new FakeTransport([]);

  return new FakeTransport([
    {
      // Riconosciuto, e risponde davvero: è l'unico che porta lo scarico fino
      // in fondo — avanzamento, tre immersioni, esito, segnalibro salvato.
      device: dispositivo({ id: 'finto-peregrine', name: 'Peregrine', rssi: -47 }),
      responder: fintoPeregrine(MEMORIA_PEREGRINE),
      quirks: { mtu: 20, latencyMs: RITARDO_MS },
    },
    {
      /*
       * Riconosciuto e MUTO: si collega e non risponde a niente.
       *
       * È il guasto più comune e più difficile da leggere — il computer si è
       * riaddormentato, o è uscito dalla modalità trasferimento mentre lo si
       * cercava — e la schermata da guardare è quella che deve comparire dopo
       * la scadenza: un esito che dice cosa è successo, non una barra ferma.
       *
       * Non risponde come un Aladin vero perché non serve: qui la domanda è
       * cosa mostra l'interfaccia quando il protocollo scade, e a quella
       * risponde il silenzio. Il protocollo Uwatec ha già il suo finto
       * completo, in `tests/uwatecBle.test.ts`, dove viene esercitato per
       * quello che è.
       */
      device: dispositivo({ id: 'finto-aladin', name: 'Aladin Sport', rssi: -63 }),
      responder: () => undefined,
      quirks: { mtu: 20 },
    },
    {
      /*
       * SENZA NOME: annuncia solo il suo identificativo, trentasei caratteri
       * senza spazi che non si spezzano in nessun punto.
       *
       * È il dispositivo che ha fatto sfondare la tabella a 390 px — l'elenco
       * di allora scriveva l'identificativo, e quella riga non stava dentro
       * nessuna cella. Adesso l'elenco dice «senza nome» e la tabella non c'è
       * più: questo finto resta qui perché il caso resta, e la fotografia
       * serve a vedere che ci sta. Ed è anche
       * il caso in cui si usa la tendina «Che computer è?» — chi ha il computer
       * in mano sa cos'è, l'applicazione no. Risponde come un Peregrine e si
       * SCOLLEGA A METÀ: è l'altra schermata che serve, quella dello scarico
       * interrotto che tiene quello che è arrivato invece di buttarlo.
       */
      device: dispositivo({ id: '0f9d2c1e-7b44-4a83-9c15-2e6f8a0d3b71', rssi: -71 }),
      // Un SERIALE suo: il segnalibro si ricorda sotto quello, e col seriale
      // del Peregrine questo dispositivo sarebbe lo stesso computer — si
      // sentirebbe rispondere «niente di nuovo» e non scaricherebbe niente.
      responder: fintoPeregrine(MEMORIA_SENZA_NOME, '4C71A08D'),
      // Quaranta comandi: misurato, non scelto a occhio. Bastano a presentarsi,
      // leggere il manifesto e portare a casa due immersioni su tre — sotto i
      // trenta non ne arriva nessuna e l'esito diventa un errore secco, sopra i
      // quaranta lo scarico finisce e l'interruzione non si vede più.
      quirks: { mtu: 20, dropAfterCommands: 40, latencyMs: RITARDO_MS },
    },
    {
      // Un televisore. Non è uno scherzo: in casa e in barca l'elenco si
      // riempie di roba così, e deve restare visibile — «lo trovo e non lo so
      // leggere» è un'informazione diversa da «non lo trovo».
      device: dispositivo({ id: 'finto-tv', name: '[TV] Samsung 5 Series (40)', rssi: -86 }),
      responder: () => undefined,
      quirks: { mtu: 20 },
    },
  ]);
}
