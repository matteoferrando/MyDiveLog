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

export function recognise(
  devices: BleFoundDevice[],
  drivers: DiveComputerDriver[] = DRIVERS,
): RecognisedDevice[] {
  return devices
    .map((device) => ({ device, driver: driverFor(device, drivers) }))
    .sort((a, b) => {
      // Prima quelli che sappiamo leggere, poi per segnale, poi per nome: chi
      // apre l'elenco deve trovare in cima la cosa che può fare.
      if (!!a.driver !== !!b.driver) return a.driver ? -1 : 1;
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
