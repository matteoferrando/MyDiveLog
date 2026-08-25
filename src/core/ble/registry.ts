/**
 * Chi sa parlare con che cosa.
 *
 * L'elenco è vuoto di proposito: i driver veri arrivano uno per volta, col
 * computer in mano. Quello che c'è qui è il modo in cui si aggiungono e la
 * regola di riconoscimento — che è la parte in cui si sbaglia.
 *
 * PERCHÉ NON SI DEDUCE IL MODELLO CONNETTENDOSI. Sarebbe più preciso: si apre,
 * si chiede chi sei, si risponde. Ma connettersi a un dispositivo BLE
 * sconosciuto non è un'operazione neutra — su alcuni firmware avvia una
 * sessione che va chiusa dal computer, su altri interrompe la registrazione in
 * corso, e in ogni caso significa parlare con un oggetto che potrebbe essere le
 * cuffie di qualcun altro nella stessa barca. Il riconoscimento si fa sul nome
 * annunciato e sui servizi, che sono informazioni che il dispositivo grida da
 * solo a chiunque passi.
 */

import { shearwaterDriver } from './drivers/shearwater';
import { uwatecDriver } from './drivers/uwatec';
import type { BleFoundDevice, DiveComputerDriver } from './types';

/**
 * I driver disponibili.
 *
 * Un driver scritto leggendo `libdivecomputer` e mai eseguito su un dispositivo
 * vero non andrebbe messo qui: comparirebbe nell'elenco, la gente ci
 * proverebbe, e fallirebbe in un modo che sembra un guasto dell'app.
 *
 * Shearwater c'è perché è stato provato col Peregrine in mano e funziona.
 * Uwatec c'è perché lo si sta provando ADESSO, con l'Aladin Sport Matrix in
 * mano. Se l'ultimo miglio non funzionasse, la cosa giusta è toglierlo da qui —
 * non lasciarlo con una nota che spiega perché non va.
 */
export const DRIVERS: DiveComputerDriver[] = [shearwaterDriver, uwatecDriver];

/** Il driver che riconosce questo dispositivo, se ce n'è uno. */
export function driverFor(device: BleFoundDevice, drivers: DiveComputerDriver[] = DRIVERS) {
  return drivers.find((d) => {
    try {
      return d.matches(device);
    } catch {
      // Un driver che esplode nel riconoscimento non deve far sparire gli altri
      // dall'elenco: si comporta come se non riconoscesse niente.
      return false;
    }
  });
}

/**
 * Un dispositivo con l'etichetta di chi lo sa leggere.
 *
 * I dispositivi non riconosciuti restano nell'elenco, con `driver` indefinito.
 * Nasconderli sarebbe peggio: chi ha un computer che non supportiamo deve poter
 * vedere che l'app lo TROVA e non lo sa leggere — è un'informazione diversa da
 * «non lo trova», e porta a una segnalazione utile invece che a un'ora persa
 * dietro al Bluetooth.
 */
export interface RecognisedDevice {
  device: BleFoundDevice;
  driver?: DiveComputerDriver;
}

/**
 * Mette in ordine i dispositivi trovati — e poi LI LASCIA STARE.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ► L'ORDINE PER SEGNALE, RICALCOLATO A OGNI ANNUNCIO, RENDE L'ELENCO
 *   INTOCCABILE. ◄
 *
 * Un dispositivo BLE si annuncia più volte al secondo e l'RSSI cambia a ogni
 * annuncio: basta muovere la mano. Ordinando per segnale a ogni aggiornamento,
 * due dispositivi vicini di qualche dB si scambiano di posto in continuazione —
 * e siccome la chiave React è l'identificativo, il browser SPOSTA DAVVERO le
 * righe. Chi guarda vede un elenco che sfarfalla; chi prova a toccare una riga
 * ne colpisce un'altra, perché nel frattempo si sono scambiate.
 *
 * Su iPhone è peggio che altrove: la scheda del catalogo si apre DENTRO la riga
 * del dispositivo, quindi ogni riordino la fa saltare su e giù mentre si sta
 * scegliendo un modello. È il difetto segnalato con un video il 25 agosto 2026,
 * ed era invisibile a tutte le prove perché il Bluetooth finto emetteva i
 * dispositivi una volta sola, con il segnale fermo.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * LA REGOLA: L'ORDINE SI DECIDE QUANDO UN DISPOSITIVO COMPARE, E POI NON SI
 * TOCCA PIÙ.
 *
 * `ordinePrecedente` sono gli identificativi nell'ordine in cui erano l'ultima
 * volta. Chi c'era già tiene il suo posto; chi è nuovo entra in fondo al proprio
 * gruppo. Il segnale continua a decidere dove entra un dispositivo NUOVO — che
 * è l'unico momento in cui quell'informazione serve — e a mostrarsi accanto al
 * nome, perché avvicinarsi al computer e veder salire il numero è il modo in cui
 * si capisce quale dei quattro è il proprio.
 *
 * L'UNICA COSA CHE PUÒ ANCORA SPOSTARE UNA RIGA è passare da «non riconosciuto»
 * a «riconosciuto», e deve poterlo fare: succede quando il dispositivo annuncia
 * prima un nome corto e poi quello completo. Non è tremolio, è una notizia — e
 * portarla in cima è esattamente quello che serve.
 *
 * Chiamandola senza `ordinePrecedente` si comporta come prima: è il primo giro,
 * dove un ordine precedente non esiste.
 */
export function recognise(
  devices: BleFoundDevice[],
  drivers: DiveComputerDriver[] = DRIVERS,
  ordinePrecedente: readonly string[] = [],
): RecognisedDevice[] {
  const posto = new Map(ordinePrecedente.map((id, i) => [id, i]));
  return devices
    .map((device) => ({ device, driver: driverFor(device, drivers) }))
    .sort((a, b) => {
      // Prima quelli che sappiamo leggere: chi apre l'elenco deve trovare in
      // cima la cosa che può fare.
      if (!!a.driver !== !!b.driver) return a.driver ? -1 : 1;

      const pa = posto.get(a.device.id);
      const pb = posto.get(b.device.id);
      // Due dispositivi già visti: l'ordine è quello di prima, punto.
      if (pa !== undefined && pb !== undefined) return pa - pb;
      // Uno solo già visto: sta davanti al nuovo arrivato. Un dispositivo che
      // compare adesso non scavalca chi era lì da prima, nemmeno se ha il
      // segnale più forte — quello che l'utente stava per toccare non si muove.
      if (pa !== undefined) return -1;
      if (pb !== undefined) return 1;

      // Due nuovi nello stesso giro: qui il segnale serve davvero, ed è l'unico
      // posto in cui viene usato per ordinare.
      const ra = a.device.rssi ?? -999;
      const rb = b.device.rssi ?? -999;
      if (ra !== rb) return rb - ra;
      return (a.device.name || '￿').localeCompare(b.device.name || '￿', 'it');
    });
}

/*
 * I riconoscitori si riesportano da qui.
 *
 * Vivono in `match.ts` perché i driver li usano e non possono importare il
 * registro senza creare un anello — vedi il commento in cima a quel file. Chi
 * legge però se li aspetta qui, insieme all'elenco dei driver, ed è giusto che
 * li trovi.
 */
export { advertisesService, either, exactName, nameStartsWith } from './match';
