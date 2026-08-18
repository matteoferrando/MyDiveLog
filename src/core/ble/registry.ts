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

import type { BleFoundDevice, DiveComputerDriver } from './types';

/**
 * I driver disponibili.
 *
 * Vuoto finché non c'è un protocollo provato contro il suo computer. Un driver
 * scritto leggendo `libdivecomputer` e mai eseguito su un dispositivo vero non
 * va messo qui: comparirebbe nell'elenco, la gente ci proverebbe, e fallirebbe
 * in un modo che sembra un guasto dell'app.
 */
export const DRIVERS: DiveComputerDriver[] = [];

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

/**
 * Riconoscimento per prefisso del nome, che è come annunciano quasi tutti.
 *
 * Il confronto è senza maiuscole e ANCORATO ALL'INIZIO. Cercare la
 * sottostringa ovunque sembra più tollerante ed è la trappola: gli auricolari
 * «Perdix Pro Buds» non sono un Perdix, e un falso riconoscimento porta a
 * connettersi a un dispositivo di qualcun altro e a mandargli comandi.
 */
export function nameStartsWith(...prefixes: string[]) {
  /*
   * I prefissi vuoti si scartano QUI, non si spera che nessuno li passi.
   *
   * `''.startsWith` è vero per qualunque stringa: un prefisso vuoto — arrivato
   * da una costante non compilata, da un `.split()` su una stringa con una
   * virgola di troppo — trasformerebbe questo riconoscimento in «combacia con
   * tutto», e il primo dispositivo dell'elenco riceverebbe i comandi di un
   * computer subacqueo. Il test lo ha trovato al primo giro.
   */
  const lower = prefixes.map((p) => p.trim().toLowerCase()).filter((p) => p.length > 0);
  return (device: BleFoundDevice) => {
    const name = (device.name ?? '').trim().toLowerCase();
    return name.length > 0 && lower.some((p) => name.startsWith(p));
  };
}

/** Riconoscimento per servizio annunciato, quando il computer lo dichiara. */
export function advertisesService(...uuids: string[]) {
  const lower = uuids.map((u) => u.toLowerCase());
  return (device: BleFoundDevice) => device.serviceUuids.some((u) => lower.includes(u.trim().toLowerCase()));
}

/** Uno o l'altro: il nome basta, il servizio pure. */
export function either(...tests: ((d: BleFoundDevice) => boolean)[]) {
  return (device: BleFoundDevice) => tests.some((t) => t(device));
}
