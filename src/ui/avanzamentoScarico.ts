/**
 * Come un evento di scarico cambia la riga che si vede a schermo.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ► PERCHÉ STA IN UN FILE SUO, E NON È ORDINE FINE A SE STESSO. ◄
 *
 * Questa stessa catena di ternari esisteva **due volte** dentro
 * `BleDownload.tsx`, una per la strada di libdivecomputer e una per i driver di
 * casa, identiche riga per riga. Il 12 settembre 2026, aggiungendo il conto
 * delle immersioni all'avanzamento, la modifica è andata fatta in tutte e due —
 * e la seconda l'ha salvata soltanto una ricerca fatta apposta.
 *
 * *Due copie della stessa regola non sono ridondanza: sono una regola e la sua
 * versione vecchia, e quale delle due sia quella vecchia lo si scopre da una
 * segnalazione.* È la stessa lezione che questo progetto ha già imparato sul
 * registratore del banco di prova, che mancava su una delle due strade.
 *
 * E in più: qui la regola si può provare. Dentro il componente era raggiungibile
 * solo montando duemila righe di interfaccia con Tauri sotto.
 */

import type { DownloadEvent } from '../core/ble/types';

/** La parte di stato che l'avanzamento tocca. Il resto non lo riguarda. */
export interface StatoAvanzamento {
  /** Quante immersioni sono già arrivate. */
  fatte: number;
  /** Quante ce ne sono in tutto, per i protocolli che lo sanno prima. */
  totale?: number;
  /** La riga che si legge a schermo. */
  passo: string;
  /** L'avanzamento a byte, per chi non sa quante immersioni ci sono. */
  byte?: { fatti: number; totali: number };
}

/**
 * Applica un evento allo stato mostrato. Gli eventi che non lo riguardano
 * lasciano lo stato **identico**, e identico vuol dire lo stesso oggetto: React
 * salta il disegno, e su uno scarico da settemila eventi la differenza si vede.
 *
 * `traduci` arriva da fuori perché la lingua la sa l'interfaccia. *Le frasi con
 * dentro un numero non si compongono qui e non arrivano dal Rust:* la chiave del
 * dizionario è la frase intera, e con il numero dentro cambierebbe a ogni
 * scarico. Il numero viaggia come numero e la frase la costruisce chi disegna.
 */
export function applicaAvanzamento<S extends StatoAvanzamento>(
  p: S,
  e: DownloadEvent,
  traduci: (s: string) => string,
): S {
  switch (e.kind) {
    case 'counted':
      return { ...p, totale: e.total, passo: traduci('Lettura in corso…') };
    case 'record':
      /*
       * ► QUI I BYTE SI BUTTANO, ED È VOLUTO. ◄ Chi consegna le immersioni una
       * per una sa dire «43 di 98», che è una risposta migliore di una barra a
       * byte. Tenere tutte e due vorrebbe dire due barre che raccontano la
       * stessa attesa con due velocità diverse.
       */
      return {
        ...p,
        fatte: e.done,
        totale: e.total ?? p.totale,
        passo: traduci('Lettura in corso…'),
        byte: undefined,
      };
    case 'progress':
      return {
        ...p,
        passo: e.label,
        /*
         * ► IL CONTO DELLE IMMERSIONI DI CHI NON SA IL TOTALE. ◄ Dalla 1.8.18
         * libdivecomputer lo manda mentre legge, contando le immersioni che la
         * sua callback consegna. Va nello STESSO campo dei driver di casa, così
         * la riga a schermo resta una sola.
         *
         * **Assente vuol dire «non lo so», non «zero».** Senza il `??`, ogni
         * battito della barra dei driver che non contano — Uwatec manda la
         * memoria in blocco — azzererebbe un numero che qualcun altro aveva
         * appena scritto.
         */
        fatte: e.dives ?? p.fatte,
        /*
         * E il totale dei byte si tiene quando l'evento non lo porta: il ripiego
         * che dice solo «byte ricevuti» non conosce la fine, e sovrascrivere
         * con niente farebbe sparire una barra che c'era.
         */
        byte: e.total ? { fatti: e.done, totali: e.total } : p.byte,
      };
    default:
      return p;
  }
}
