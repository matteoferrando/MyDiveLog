/**
 * Quanti modelli si scaricano via Bluetooth, per chi non può importare il
 * catalogo TypeScript: gli script `.mjs` che girano con `node` nudo, come
 * quello del banner di Play.
 *
 * ► PERCHÉ ESISTE. ◄ Il banner di Play diceva «105 modelli via Bluetooth»,
 * scritto a mano in `grafica-play.mjs`. Era vero con libdivecomputer 0.9.0; il
 * 22 settembre 2026 la libreria nuova ha portato il catalogo a 115 voci, e il
 * banner avrebbe continuato a dire 105 a ogni rigenerazione senza che niente
 * lo facesse notare. Un numero scritto in un posto, e la verità in un altro.
 *
 * Il file PNG caricato su Play resta comunque quello che era finché qualcuno
 * non lo rigenera e lo ricarica: questo non lo può impedire nessuno script. Può
 * impedire che rigenerarlo dia il numero vecchio.
 *
 * ► IL CONTO È QUELLO DEL SITO. ◄ Le voci di `MODELLI_BLE`, che con la libreria
 * compilata dentro si scaricano tutte via Bluetooth. I Garmin no: stanno in
 * `MODELLI_SENZA_BLE`, e sommarli è l'errore che il sito ha fatto fino al 23
 * settembre 2026. `tests/sitoMarche.test.ts` confronta questo conto con quello
 * che fa `esitoPer` — la funzione che scrive la riga di ogni modello — e se un
 * giorno i due divergessero diventerebbe rossa.
 *
 * Il catalogo si legge come testo perché è un file GENERATO
 * (`scripts/catalogo-computer.mjs`) con una forma che non cambia da sola: una
 * voce per riga, `{ marca: '…', … }`. Se la forma cambiasse, il conto
 * scenderebbe a zero e la funzione si ferma invece di stampare «0 modelli».
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

/** Le voci di `MODELLI_BLE` in `src/core/ble/catalogoGenerato.ts`. */
export function modelliViaBluetooth(radice) {
  const sorgente = readFileSync(path.join(radice, 'src/core/ble/catalogoGenerato.ts'), 'utf8');
  const inizio = sorgente.indexOf('export const MODELLI_BLE');
  const fine = sorgente.indexOf('];', inizio);
  if (inizio < 0 || fine < 0) {
    throw new Error('MODELLI_BLE non si trova più in src/core/ble/catalogoGenerato.ts');
  }
  const quanti = (sorgente.slice(inizio, fine).match(/\{ marca: '/g) ?? []).length;
  if (quanti < 50) throw new Error(`MODELLI_BLE conta ${quanti} voci: il file generato ha cambiato forma?`);
  return quanti;
}
