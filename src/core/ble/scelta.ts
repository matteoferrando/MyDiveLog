/**
 * Che cosa succede DAVVERO quando uno sceglie il proprio computer nell'elenco.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * PERCHÉ QUESTO FILE ESISTE, E PERCHÉ È LA PARTE CHE CONTA.
 *
 * Il catalogo elenca 115 modelli. I driver scritti in casa ne leggono 22 —
 * Shearwater e Scubapro/Uwatec. Un selettore che mostra 115 voci e ne onora 22
 * è peggio di nessun selettore: chi ha un Mares Genius lo trova nell'elenco, lo
 * sceglie, e scopre che non succede niente. A quel punto ha imparato due cose
 * sbagliate — che l'app è rotta, e che segnalarlo non serve.
 *
 * Quindi la scelta non produce mai «niente». Produce sempre UNA delle tre
 * risposte qui sotto, e tutte e tre sono vere:
 *
 *   `si-scarica`      — c'è un driver scritto in casa, provato su un
 *                       apparecchio vero. Si preme Scarica.
 *   `si-scarica-ldc`  — non c'è un driver nostro, ma questa copia
 *                       dell'applicazione ha dentro libdivecomputer e quel
 *                       protocollo lo conosce. Si preme Scarica lo stesso, e
 *                       l'interfaccia dice da dove passa.
 *   `non-ancora`      — libdivecomputer lo saprebbe leggere, ma questa copia
 *                       è stata compilata senza. Nel frattempo si importa il
 *                       file esportato dall'applicazione del costruttore.
 *   `mai-via-radio`   — quel computer i dati via BLE non li dà a nessuno.
 *                       È il caso Garmin, ed è l'unico in cui aspettare è
 *                       inutile: la strada è l'esportazione, per sempre.
 *
 * ► LA DIFFERENZA FRA I PRIMI DUE VA DETTA, E NON PER PIGNOLERIA. ◄ I due
 * driver di casa sono stati provati con l'apparecchio in mano, cento e passa
 * immersioni a testa; libdivecomputer è una libreria che legge quel formato da
 * vent'anni ma che QUI, in questa applicazione, con QUEL modello, potrebbe non
 * essere mai stata eseguita. Presentare le due cose come la stessa cosa
 * significa promettere una certezza che non abbiamo — e in un logbook una
 * lettura sbagliata non dà errore, dà un profilo plausibile e falso.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * PERCHÉ LA MAPPA È DALLE FAMIGLIE E NON DAI MODELLI.
 *
 * Un driver non conosce «il Peregrine»: conosce il PROTOCOLLO della famiglia
 * `shearwater_petrel`, che è lo stesso per undici apparecchi. Mappare modello
 * per modello vorrebbe dire aggiungere una riga a ogni computer nuovo che esce
 * — e dimenticarsene, che è come nascono gli elenchi che invecchiano.
 *
 * ► MA LA FAMIGLIA DA SOLA HA GIÀ SBAGLIATO UNA VOLTA, E L'HA FATTO IN SILENZIO. ◄
 * Qui c'era scritto che *«un Perdix 4 che uscisse domani entra nel catalogo alla
 * prossima rigenerazione e funziona senza toccare niente»*. Il 22 settembre
 * 2026, aggiornando libdivecomputer, nel catalogo è entrato il **Perdix 3**:
 * stessa famiglia, `shearwater_petrel`, e un protocollo diverso — un altro
 * servizio GATT, niente intestazione di due byte sui pacchetti BLE, una
 * cornice di cinque byte invece di quattro (`shearwater_common.c`, «V2», che la
 * libreria sceglie dal numero di modello 14). Con la sola famiglia, questo file
 * lo avrebbe mandato al driver di casa, che parla V1 e cerca un servizio che
 * sul Perdix 3 non c'è. Nessuna prova sarebbe diventata rossa: la prova che
 * contava i modelli scaricabili sarebbe passata da 22 a 23 e basta.
 *
 * Quindi la regola adesso ha due metà: la famiglia dice QUALE driver, e i
 * **numeri di modello** dicono QUALI apparecchi quel driver conosce — quelli
 * che esistevano quando è stato scritto e provato. Un numero nuovo in una
 * famiglia di casa è un apparecchio che il driver non ha mai visto, e va alla
 * libreria che lo descrive: lei, a differenza nostra, è stata aggiornata
 * apposta per lui. *Un modello nuovo non è una promessa del driver vecchio.*
 *
 * IL ROVESCIO, dichiarato: una famiglia non è una garanzia. `uwatec_smart`
 * comprende apparecchi che l'Aladin Sport Matrix con cui il driver è stato
 * provato non somiglia più di tanto. Il driver ci proverà e potrebbe fermarsi;
 * si accetta perché il fallimento è leggibile e non scrive niente in archivio,
 * mentre nascondere dieci modelli per prudenza li rende invisibili a chi li ha.
 */

import { MODELLI_BLE, SENZA_SCARICO_DIRETTO, type ModelloComputer, type VoceCatalogo } from './catalogo';

/** Un driver scritto in casa, e gli apparecchi che conosce. */
export interface DriverDiCasa {
  /** L'`id` del driver nel registro (`registry.ts`). */
  driverId: string;
  /**
   * I numeri di modello di libdivecomputer (`descriptor.c`) che questo driver
   * conosce: quelli che esistevano quando è stato scritto e provato. Una voce
   * della famiglia con un numero che qui non c'è va a libdivecomputer — vedi
   * il Perdix 3 in testa al file.
   */
  numeri: readonly number[];
}

/**
 * Le famiglie di libdivecomputer che i driver scritti in casa sanno leggere.
 *
 * La chiave è il nome della famiglia come lo scrive `descriptor.c` (in
 * minuscolo). Aggiungendo un driver si aggiunge una riga QUI: è l'unico posto,
 * e un driver che c'è nel registro ma non qui semplicemente non viene mai
 * proposto da una scelta manuale.
 *
 * ► I NUMERI SI AGGIUNGONO A MANO, E DI PROPOSITO. ◄ Quando la libreria porta
 * un modello nuovo in una di queste famiglie, la voce va a libdivecomputer
 * finché qualcuno non ha verificato che il driver di casa parla anche con lui
 * — e `tests/sceltaComputer.test.ts` lo fa notare, perché elenca le voci del
 * catalogo che per questo motivo restano fuori.
 */
export const FAMIGLIE_CON_DRIVER: Record<string, DriverDiCasa> = {
  /*
   * Petrel 2 (3), Perdix (5), Perdix AI (6), NERD 2 (7), Teric (8),
   * Peregrine (9), Petrel 3 (10), Perdix 2 (11), Tern e Tern TX (12),
   * Peregrine TX (13). Il 14 è il Perdix 3, e NON c'è: vedi sopra.
   */
  shearwater_petrel: { driverId: 'shearwater', numeri: [3, 5, 6, 7, 8, 9, 10, 11, 12, 13] },
  /*
   * Aladin Sport/H Matrix (23), A1 (37), A2 (40), G2 TEK (49), G2 e G2
   * Console (50), G3 (52), G2 HUD (66), Luna 2.0 AI (80), Luna 2.0 (81).
   */
  uwatec_smart: { driverId: 'uwatec', numeri: [23, 37, 40, 49, 50, 52, 66, 80, 81] },
};

/**
 * Se il driver di casa conosce TUTTI i numeri di questa voce.
 *
 * Tutti e non «almeno uno»: una voce con più numeri è un nome commerciale
 * venduto in più revisioni, e quale revisione ha in mano la persona lo scopre
 * solo il driver collegandosi. Se una delle revisioni è sconosciuta, la
 * promessa «si scarica col driver di casa» non si può fare per il nome intero.
 * E una voce SENZA numeri non si promette a nessun driver di casa: non sapere
 * quale apparecchio è vuol dire non sapere se lo conosce.
 */
function conosciutoDa(casa: DriverDiCasa, modello: VoceCatalogo): boolean {
  const numeri = modello.numeri ?? [];
  return numeri.length > 0 && numeri.every((n) => casa.numeri.includes(n));
}

export type Esito =
  | { tipo: 'si-scarica'; driverId: string }
  | { tipo: 'si-scarica-ldc' }
  | { tipo: 'non-ancora' }
  | { tipo: 'mai-via-radio' };

/**
 * Che cosa possiamo fare con questo modello, adesso.
 *
 * `conLibdivecomputer` è **falso per difetto**, e la scelta è deliberata: una
 * funzione che presume la funzionalità accesa produrrebbe, in una copia
 * compilata senza, un pulsante «Scarica» che fallisce. Chi sa com'è compilata
 * questa copia è l'interfaccia, che lo chiede al guscio Rust
 * (`elenca_computer_supportati` risponde con un elenco vuoto quando la
 * funzionalità non c'è): il valore arriva da lì, non da un'ipotesi.
 */
export function esitoPer(modello: VoceCatalogo, conLibdivecomputer = false): Esito {
  if ((SENZA_SCARICO_DIRETTO as readonly string[]).includes(modello.marca)) {
    return { tipo: 'mai-via-radio' };
  }
  /*
   * NESSUNA FAMIGLIA = NESSUN DRIVER, e non è un dato mancante.
   *
   * Le voci di `MODELLI_SENZA_BLE` esistono per essere trovate dalla ricerca e
   * ricevere una risposta vera: libdivecomputer un driver per loro non ce l'ha,
   * quindi accenderla non cambierebbe niente e «non ancora» sarebbe una
   * promessa che nessuno può mantenere.
   */
  if (!modello.famiglia) return { tipo: 'mai-via-radio' };
  const casa = FAMIGLIE_CON_DRIVER[modello.famiglia];
  if (casa && conosciutoDa(casa, modello)) return { tipo: 'si-scarica', driverId: casa.driverId };
  return conLibdivecomputer ? { tipo: 'si-scarica-ldc' } : { tipo: 'non-ancora' };
}

/**
 * Quanti modelli del catalogo si scaricano davvero, oggi.
 *
 * Serve ai controlli automatici: è il numero che deve crescere quando si
 * accende libdivecomputer, ed è il numero che qualcuno deve guardare prima di
 * dire «il selettore supporta 115 computer».
 */
export function modelliScaricabili(conLibdivecomputer = false): ModelloComputer[] {
  return MODELLI_BLE.filter((m) => esitoPer(m, conLibdivecomputer).tipo.startsWith('si-scarica'));
}
