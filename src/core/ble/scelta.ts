/**
 * Che cosa succede DAVVERO quando uno sceglie il proprio computer nell'elenco.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * PERCHÉ QUESTO FILE ESISTE, E PERCHÉ È LA PARTE CHE CONTA.
 *
 * Il catalogo elenca 105 modelli. I driver scritti in casa ne leggono 22 —
 * Shearwater e Scubapro/Uwatec. Un selettore che mostra 105 voci e ne onora 22
 * è peggio di nessun selettore: chi ha un Mares Genius lo trova nell'elenco, lo
 * sceglie, e scopre che non succede niente. A quel punto ha imparato due cose
 * sbagliate — che l'app è rotta, e che segnalarlo non serve.
 *
 * Quindi la scelta non produce mai «niente». Produce sempre UNA delle tre
 * risposte qui sotto, e tutte e tre sono vere:
 *
 *   `si-scarica`      — c'è un driver, si può premere Scarica.
 *   `non-ancora`      — libdivecomputer lo sa leggere, noi non l'abbiamo
 *                       ancora acceso in produzione. Nel frattempo si importa
 *                       il file esportato dall'applicazione del costruttore.
 *   `mai-via-radio`   — quel computer i dati via BLE non li dà a nessuno.
 *                       È il caso Garmin, ed è l'unico in cui aspettare è
 *                       inutile: la strada è l'esportazione, per sempre.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * PERCHÉ LA MAPPA È DALLE FAMIGLIE E NON DAI MODELLI.
 *
 * Un driver non conosce «il Peregrine»: conosce il PROTOCOLLO della famiglia
 * `shearwater_petrel`, che è lo stesso per undici apparecchi. Mappare modello
 * per modello vorrebbe dire aggiungere una riga a ogni computer nuovo che esce
 * — e dimenticarsene, che è come nascono gli elenchi che invecchiano. Mappando
 * le famiglie, un Perdix 4 che uscisse domani entra nel catalogo alla prossima
 * rigenerazione e funziona senza toccare niente.
 *
 * IL ROVESCIO, dichiarato: una famiglia non è una garanzia. `uwatec_smart`
 * comprende apparecchi che l'Aladin Sport Matrix con cui il driver è stato
 * provato non somiglia più di tanto. Il driver ci proverà e potrebbe fermarsi;
 * si accetta perché il fallimento è leggibile e non scrive niente in archivio,
 * mentre nascondere dieci modelli per prudenza li rende invisibili a chi li ha.
 */

import { MODELLI_BLE, SENZA_SCARICO_DIRETTO, type ModelloComputer } from './catalogo';

/**
 * Le famiglie di libdivecomputer che i driver scritti in casa sanno leggere.
 *
 * La chiave è il nome della famiglia come lo scrive `descriptor.c` (in
 * minuscolo), il valore è l'`id` del nostro driver. Aggiungendo un driver si
 * aggiunge una riga QUI: è l'unico posto, e un driver che c'è nel registro ma
 * non qui semplicemente non viene mai proposto da una scelta manuale.
 */
export const FAMIGLIE_CON_DRIVER: Record<string, string> = {
  shearwater_petrel: 'shearwater',
  uwatec_smart: 'uwatec',
};

export type Esito =
  | { tipo: 'si-scarica'; driverId: string }
  | { tipo: 'non-ancora' }
  | { tipo: 'mai-via-radio' };

/** Che cosa possiamo fare con questo modello, adesso. */
export function esitoPer(modello: ModelloComputer): Esito {
  if ((SENZA_SCARICO_DIRETTO as readonly string[]).includes(modello.marca)) {
    return { tipo: 'mai-via-radio' };
  }
  const driverId = FAMIGLIE_CON_DRIVER[modello.famiglia];
  return driverId ? { tipo: 'si-scarica', driverId } : { tipo: 'non-ancora' };
}

/**
 * Quanti modelli del catalogo si scaricano davvero, oggi.
 *
 * Serve ai controlli automatici: è il numero che deve crescere quando si
 * accende libdivecomputer, ed è il numero che qualcuno deve guardare prima di
 * dire «il selettore supporta 105 computer».
 */
export function modelliScaricabili(): ModelloComputer[] {
  return MODELLI_BLE.filter((m) => esitoPer(m).tipo === 'si-scarica');
}
