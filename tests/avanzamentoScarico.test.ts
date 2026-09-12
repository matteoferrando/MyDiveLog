/**
 * LA RIGA CHE SI VEDE MENTRE UN COMPUTER SI SCARICA.
 *
 * ► PERCHÉ ESISTE. ◄ *«Quando usi libdivecomputer serve un messaggio che dica
 * quante immersioni stai scaricando, che faccia il progress a video come nella
 * libreria nativa di Shearwater. Altrimenti dice solo sto scrivendo byte dal
 * computer.»* Chiesto il 12 settembre 2026, dopo uno scarico da **sette minuti
 * e quarantaquattro secondi** in cui a schermo non si è mosso niente di
 * significativo.
 *
 * ► E PERCHÉ QUESTE PROVE NON ESISTEVANO PRIMA. ◄ Questa regola stava dentro
 * `BleDownload.tsx`, in **due copie identiche** — una per la strada di
 * libdivecomputer e una per i driver di casa — raggiungibili solo montando
 * duemila righe di interfaccia con Tauri sotto. Aggiungendo il conto delle
 * immersioni la modifica è andata fatta in tutte e due, e la seconda l'ha
 * salvata una ricerca fatta apposta. *Due copie della stessa regola non sono
 * ridondanza: sono una regola e la sua versione vecchia.*
 */

import { describe, expect, it } from 'vitest';
import { applicaAvanzamento, type StatoAvanzamento } from '../src/ui/avanzamentoScarico';
import type { DownloadEvent } from '../src/core/ble/types';

/** La traduzione nelle prove è l'identità: qui si guardano i numeri. */
const t = (s: string) => s;

const partenza: StatoAvanzamento = { fatte: 0, passo: 'Collegamento in corso…' };

describe('l’avanzamento di libdivecomputer', () => {
  it('mostra quante immersioni sono già uscite, e quanta memoria manca', () => {
    /*
     * È la richiesta, tradotta in due numeri che non si fondono: le immersioni
     * dicono che sta succedendo qualcosa, i byte dicono quando finisce. Un «27
     * di 81» sarebbe inventato — con questi protocolli il totale si scopre
     * arrivando in fondo.
     */
    const e: DownloadEvent = {
      kind: 'progress',
      done: 580_000,
      total: 1_731_279,
      label: 'lettura della memoria del computer',
      dives: 27,
    };
    const dopo = applicaAvanzamento(partenza, e, t);
    expect(dopo.fatte).toBe(27);
    expect(dopo.byte).toEqual({ fatti: 580_000, totali: 1_731_279 });
    expect(dopo.totale).toBeUndefined();
  });

  it('senza il conto non azzera quello che c’era', () => {
    /*
     * ► È LA RIGA CHE RENDE VERO IL NUMERO A SCHERMO. ◄ Il ripiego che dice
     * soltanto «byte ricevuti dal computer» non conta immersioni, e i driver
     * Uwatec nemmeno: senza il `??`, ogni battito della barra farebbe sparire un
     * conto che qualcun altro aveva appena scritto, e il numero lampeggerebbe
     * fra «27 immersioni» e niente due volte al secondo.
     */
    const prima = applicaAvanzamento(
      partenza,
      {
        kind: 'progress',
        done: 1,
        total: 10,
        label: 'x',
        dives: 27,
      },
      t,
    );
    const dopo = applicaAvanzamento(
      prima,
      {
        kind: 'progress',
        done: 2,
        total: 10,
        label: 'byte ricevuti dal computer',
      },
      t,
    );
    expect(dopo.fatte).toBe(27);
  });

  it('senza totale tiene la barra che c’era invece di cancellarla', () => {
    const prima = applicaAvanzamento(
      partenza,
      {
        kind: 'progress',
        done: 500,
        total: 1000,
        label: 'x',
      },
      t,
    );
    const dopo = applicaAvanzamento(prima, { kind: 'progress', done: 600, label: 'x' }, t);
    expect(dopo.byte).toEqual({ fatti: 500, totali: 1000 });
  });
});

describe('l’avanzamento dei driver di casa', () => {
  it('quando si sa il totale, le immersioni vincono sui byte', () => {
    /*
     * Shearwater legge un manifesto e poi le immersioni una per una: «43 di 98»
     * è una risposta migliore di qualunque barra a byte. Tenere tutte e due
     * vorrebbe dire due barre che raccontano la stessa attesa a due velocità.
     */
    const conBarra = applicaAvanzamento(
      partenza,
      {
        kind: 'progress',
        done: 10,
        total: 100,
        label: 'x',
      },
      t,
    );
    expect(conBarra.byte).toBeDefined();

    const dopo = applicaAvanzamento(
      conBarra,
      {
        kind: 'record',
        done: 43,
        total: 98,
        record: { key: 'k', dive: {} } as never,
      },
      t,
    );
    expect(dopo.fatte).toBe(43);
    expect(dopo.totale).toBe(98);
    expect(dopo.byte).toBeUndefined();
  });

  it('il conteggio iniziale fissa il totale', () => {
    const dopo = applicaAvanzamento(partenza, { kind: 'counted', total: 98 }, t);
    expect(dopo.totale).toBe(98);
    expect(dopo.passo).toBe('Lettura in corso…');
  });
});

describe('gli eventi che non riguardano la riga', () => {
  it('lasciano lo stato IDENTICO, non soltanto uguale', () => {
    /*
     * ► NON È PIGNOLERIA, SONO SETTEMILA DISEGNI. ◄ Uno scarico del Puck 4
     * produce migliaia di eventi; restituire un oggetto nuovo a ognuno farebbe
     * ridisegnare React ogni volta, sullo stesso processo che deve stare dietro
     * al Bluetooth. *Un avanzamento che rallenta lo scarico che sta raccontando
     * è un peggioramento travestito da funzione.*
     */
    const e: DownloadEvent = { kind: 'trace', line: 'scrittura n. 1' };
    expect(applicaAvanzamento(partenza, e, t)).toBe(partenza);
  });
});
