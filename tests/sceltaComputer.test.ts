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
    // modello per cui abbiamo qualcosa da dire, sempre.
    for (const m of MODELLI_BLE) {
      expect(['si-scarica', 'non-ancora', 'mai-via-radio']).toContain(esitoPer(m).tipo);
    }
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
