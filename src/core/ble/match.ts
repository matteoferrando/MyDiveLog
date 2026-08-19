/**
 * Come si riconosce un computer dal suo annuncio.
 *
 * STA IN UN FILE SUO, e non nel registro, per una ragione che si è vista
 * fallire: i driver hanno bisogno di questi riconoscitori, e il registro ha
 * bisogno dei driver. Tenendoli insieme si crea un anello — `registry` importa
 * `uwatec`, `uwatec` importa `registry` — che il bundler risolve per fortuna e
 * Node no: eseguendo uno script con `tsx`, l'elenco dei driver si valuta prima
 * che il driver esista e il programma muore con «Cannot access 'uwatecDriver'
 * before initialization». Lo script di confronto è morto esattamente così, al
 * primo tentativo, e in produzione l'anello sarebbe rimasto lì ad aspettare un
 * cambio di ordine dei moduli.
 *
 * Qui dentro non si importa niente che non sia un tipo, quindi l'anello non si
 * può riformare.
 */

import type { BleFoundDevice } from './types';

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

/**
 * Riconoscimento per nome ESATTO, che è come li elenca libdivecomputer.
 *
 * Sembra la stessa cosa di `nameStartsWith` con un solo nome, e non lo è.
 * `dc_match_name` di libdivecomputer è `strcasecmp(...) == 0`: un confronto
 * intero, non un prefisso. E per Uwatec conta, perché i nomi annunciati sono
 * roba come «A1», «A2», «HUD», «G2» — due caratteri. Come prefissi
 * riconoscerebbero «A1 Pro», «G2 Buds», «HUD Display» e qualunque altra cosa
 * cominci per quelle lettere: mezzo Bluetooth di una barca affollata.
 *
 * Il rischio non è cosmetico. Un falso riconoscimento porta a connettersi a un
 * dispositivo di qualcun altro e a mandargli i byte di un comando Uwatec.
 */
export function exactName(...names: string[]) {
  const lower = names.map((n) => n.trim().toLowerCase()).filter((n) => n.length > 0);
  return (device: BleFoundDevice) => {
    const name = (device.name ?? '').trim().toLowerCase();
    return name.length > 0 && lower.includes(name);
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
