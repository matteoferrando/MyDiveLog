/**
 * Che cosa promette il selettore, e che cosa mantiene.
 *
 * Il difetto che questi controlli difendono non è tecnico: è una promessa. Un
 * elenco di 105 modelli in cui 83 non fanno niente è un'app che sembra rotta a
 * quattro persone su cinque, e il modo in cui si arriva lì è aggiungere modelli
 * al catalogo senza toccare i driver — cioè con una rigenerazione automatica,
 * senza che nessuno se ne accorga.
 */

import { describe, expect, it } from 'vitest';
import { MODELLI_BLE } from '../src/core/ble/catalogo';
import { DRIVERS } from '../src/core/ble/registry';
import { esitoPer, FAMIGLIE_CON_DRIVER, modelliScaricabili } from '../src/core/ble/scelta';

describe('la scelta di un modello', () => {
  it('non lascia mai l’utente senza risposta', () => {
    // La regola che tiene in piedi tutto il resto: un modello nell'elenco è un
    // modello per cui abbiamo qualcosa da dire, sempre. E vale in tutte e due
    // le compilazioni, perché l'utente non sa come è stata compilata la sua.
    for (const m of MODELLI_BLE) {
      for (const conLdc of [false, true]) {
        expect(['si-scarica', 'si-scarica-ldc', 'non-ancora', 'mai-via-radio']).toContain(
          esitoPer(m, conLdc).tipo,
        );
      }
    }
  });

  it('senza libdivecomputer non promette niente in più: è il difetto per difetto', () => {
    /*
     * IL VALORE PREDEFINITO CONTA. Se `esitoPer` presumesse la funzionalità
     * accesa, una copia compilata senza mostrerebbe «Scarica» su ottantatré
     * modelli e fallirebbe su tutti. Chi sa com'è compilata questa copia è
     * l'interfaccia, che lo chiede al guscio Rust.
     */
    const mares = MODELLI_BLE.find((m) => m.marca === 'Mares')!;
    expect(esitoPer(mares).tipo).toBe('non-ancora');
    expect(esitoPer(mares, true).tipo).toBe('si-scarica-ldc');
  });

  it('con libdivecomputer i driver di casa restano distinti, e non è pignoleria', () => {
    /*
     * I due driver di casa sono stati provati con l'apparecchio in mano, cento
     * e passa immersioni a testa. libdivecomputer quel formato lo legge da
     * vent'anni, ma con QUEL modello dentro QUESTA applicazione potrebbe non
     * essere mai stata eseguita. Un solo esito per i due casi cancellerebbe la
     * differenza — e in un logbook una lettura sbagliata non dà errore, dà un
     * profilo plausibile e falso.
     */
    const peregrine = MODELLI_BLE.find((m) => m.modello === 'Peregrine')!;
    expect(esitoPer(peregrine, true)).toEqual({ tipo: 'si-scarica', driverId: 'shearwater' });
  });

  it('Garmin resta «mai», anche con libdivecomputer acceso', () => {
    // Non è una questione di driver: i Descent i dati via BLE non li danno a
    // nessuna applicazione. Accendere la libreria non cambia il fatto.
    const garmin = MODELLI_BLE.filter((m) => m.marca === 'Garmin');
    for (const g of garmin) expect(esitoPer(g, true).tipo).toBe('mai-via-radio');
  });

  it('promette uno scarico solo dove c’è un driver che esiste davvero', () => {
    /*
     * IL CONTROLLO CHE VALE PIÙ DI TUTTI. `FAMIGLIE_CON_DRIVER` è una mappa
     * scritta a mano verso identificativi scritti altrove: basta rinominare un
     * driver e la mappa punta a un `id` che non esiste più. L'effetto non è un
     * errore — è un pulsante «Scarica» che non fa niente.
     */
    const id = new Set(DRIVERS.map((d) => d.id));
    for (const famiglia of Object.values(FAMIGLIE_CON_DRIVER)) {
      expect(id).toContain(famiglia);
    }
  });

  it('Shearwater e Scubapro si scaricano: sono i due driver provati con l’apparecchio in mano', () => {
    const scaricabili = modelliScaricabili();
    const marche = new Set(scaricabili.map((m) => m.marca));
    expect(marche).toEqual(new Set(['Shearwater', 'Scubapro']));
    // 11 + 11. Se questo numero cambia senza che sia cambiato un driver, è
    // cambiato il catalogo e qualcuno deve guardare cosa è entrato.
    expect(scaricabili.length).toBe(22);
  });

  it('con libdivecomputer si scarica quasi tutto, ma non tutto', () => {
    /*
     * «Quasi» è la parola giusta e va tenuta: restano fuori i modelli che via
     * Bluetooth i dati non li danno. Un controllo che dicesse «tutti» sarebbe
     * verde oggi e falso il giorno in cui Garmin entra nel catalogo della
     * libreria senza cambiare politica.
     */
    const conLdc = modelliScaricabili(true);
    expect(conLdc.length).toBe(MODELLI_BLE.length);
    expect(conLdc.length).toBeGreaterThan(modelliScaricabili().length * 4);
  });

  it('la maggioranza dei modelli NON si scarica, e va detto ad alta voce', () => {
    /*
     * Questo controllo non difende il codice: difende la frase che l'app dice
     * all'utente. Finché è verde, «il selettore riconosce 105 computer» è una
     * bugia — quelli che scarica sono 22 — e nessuna schermata deve lasciarlo
     * intendere.
     */
    expect(modelliScaricabili().length).toBeLessThan(MODELLI_BLE.length / 2);
  });

  it('Garmin è un caso a parte: non «non ancora», ma mai', () => {
    /*
     * I Descent i dati via BLE non li danno a nessuno. Se un giorno Garmin
     * comparisse nel catalogo di libdivecomputer, questo controllo si accorge
     * che la risposta da dare è cambiata — e va cambiata, perché «esporta da
     * Garmin Connect» diventerebbe un consiglio inutilmente scomodo.
     */
    const garmin = MODELLI_BLE.filter((m) => m.marca === 'Garmin');
    expect(garmin).toEqual([]);
  });
});
