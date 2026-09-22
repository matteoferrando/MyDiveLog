/**
 * Che cosa promette il selettore, e che cosa mantiene.
 *
 * Il difetto che questi controlli difendono non è tecnico: è una promessa. Un
 * elenco di 115 modelli in cui 93 non fanno niente è un'app che sembra rotta a
 * quattro persone su cinque, e il modo in cui si arriva lì è aggiungere modelli
 * al catalogo senza toccare i driver — cioè con una rigenerazione automatica,
 * senza che nessuno se ne accorga.
 */

import { describe, expect, it } from 'vitest';
import { cercaModelli, MODELLI_BLE } from '../src/core/ble/catalogo';
import { NOMI_DEL_PROTOCOLLO_V2, shearwaterDriver } from '../src/core/ble/drivers/shearwater';
import { fakeDevice } from '../src/core/ble/fake';
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
    for (const { driverId } of Object.values(FAMIGLIE_CON_DRIVER)) {
      expect(id).toContain(driverId);
    }
  });

  it('il Perdix 3 va a libdivecomputer: stessa famiglia del Peregrine, protocollo diverso', () => {
    /*
     * ► IL CASO VERO DEL 22 SETTEMBRE 2026. ◄ Aggiornando libdivecomputer è
     * entrato nel catalogo il Perdix 3, famiglia `shearwater_petrel` come il
     * Peregrine, ma con il protocollo «V2» — un altro servizio GATT e un'altra
     * cornice — che il driver di casa non parla. Con la mappa per sole famiglie
     * sarebbe finito al driver di casa, e l'unico segno sarebbe stato un 22
     * che diventava 23 nella prova qui sotto.
     */
    const perdix3 = MODELLI_BLE.find((m) => m.marca === 'Shearwater' && m.modello === 'Perdix 3')!;
    expect(perdix3, 'il Perdix 3 è sparito dal catalogo: questa prova va ripensata').toBeDefined();
    expect(esitoPer(perdix3, true)).toEqual({ tipo: 'si-scarica-ldc' });
    expect(esitoPer(perdix3, false)).toEqual({ tipo: 'non-ancora' });
    // E il riconoscimento per nome non se lo prende: «perdix» è l'inizio di
    // «Perdix 3», ed era esattamente il buco.
    expect(shearwaterDriver.matches(fakeDevice({ name: 'Perdix 3' }))).toBe(false);
    expect(shearwaterDriver.matches(fakeDevice({ name: 'Perdix3' }))).toBe(false);
    // Mentre i fratelli V1 restano suoi.
    for (const nome of [
      'Perdix',
      'Perdix 2',
      'Perdix AI',
      'Peregrine',
      'Peregrine TX',
      'Petrel 3',
      'Teric',
    ]) {
      expect(shearwaterDriver.matches(fakeDevice({ name: nome })), nome).toBe(true);
    }
  });

  it('un modello nuovo in una famiglia di casa non va al driver di casa finché nessuno lo decide', () => {
    /*
     * ► LA TRAPPOLA PER LA PROSSIMA RIGENERAZIONE. ◄ Quando libdivecomputer
     * porterà un Petrel 4 o un G4, questa prova diventa rossa: la voce nuova
     * compare qui sotto, fra quelle che la famiglia «conosce» ma il driver no.
     * La risposta giusta non è aggiornare l'elenco atteso e basta — è decidere,
     * con la documentazione del protocollo aperta, se il driver di casa parla
     * con lui. Fino ad allora va a libdivecomputer, che è quello che succede.
     */
    const fuori = MODELLI_BLE.filter((m) => {
      const casa = FAMIGLIE_CON_DRIVER[m.famiglia];
      return casa !== undefined && !m.numeri.every((n) => casa.numeri.includes(n));
    }).map((m) => `${m.marca} ${m.modello}`);
    expect(fuori).toEqual(['Shearwater Perdix 3']);
    for (const nome of fuori) {
      const voce = MODELLI_BLE.find((m) => `${m.marca} ${m.modello}` === nome)!;
      expect(esitoPer(voce, true).tipo, nome).toBe('si-scarica-ldc');
    }
    // I nomi esclusi dal driver sono proprio quelli delle voci rimaste fuori.
    expect(NOMI_DEL_PROTOCOLLO_V2.some((n) => n === 'perdix 3')).toBe(true);
  });

  it('una voce senza numeri non si promette al driver di casa', () => {
    // Non sapere quale apparecchio è vuol dire non sapere se il driver lo
    // conosce: meglio la libreria, che lo scopre collegandosi.
    const senzaNumeri = { marca: 'Shearwater', modello: 'Qualcosa', famiglia: 'shearwater_petrel' };
    expect(esitoPer(senzaNumeri, true).tipo).toBe('si-scarica-ldc');
    const numeroNuovo = { ...senzaNumeri, numeri: [99] };
    expect(esitoPer(numeroNuovo, true).tipo).toBe('si-scarica-ldc');
    const conosciuto = { ...senzaNumeri, numeri: [9] };
    expect(esitoPer(conosciuto, true)).toEqual({ tipo: 'si-scarica', driverId: 'shearwater' });
  });

  it('Shearwater e Scubapro si scaricano: sono i due driver provati con l’apparecchio in mano', () => {
    const scaricabili = modelliScaricabili();
    const marche = new Set(scaricabili.map((m) => m.marca));
    expect(marche).toEqual(new Set(['Shearwater', 'Scubapro']));
    // 11 + 11. Se questo numero cambia senza che sia cambiato un driver, è
    // cambiato il catalogo e qualcuno deve guardare cosa è entrato. Il 22
    // settembre 2026 è entrato il Perdix 3 e il numero è rimasto 22 — ma solo
    // perché la regola dei numeri di modello lo manda a libdivecomputer: vedi
    // la prova sul Perdix 3 qui sopra.
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
     * all'utente. Finché è verde, «il selettore riconosce 115 computer» è una
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

describe('Garmin, e la risposta che nessuno vedeva', () => {
  it('cercando «garmin» si trova qualcosa, e la risposta è quella vera', () => {
    /*
     * ► IL DIFETTO: il ramo «mai-via-radio» era irraggiungibile. ◄
     *
     * `SENZA_SCARICO_DIRETTO` conteneva Garmin ed `esitoPer` sapeva rispondere,
     * ma nel catalogo di libdivecomputer «Garmin» non compare nemmeno una volta
     * — quindi la ricerca dava zero risultati e l'utente riceveva «Nessun
     * modello con questo nome» su una delle marche più diffuse al mondo. La
     * frase preparata per quel caso non la leggeva nessuno.
     */
    const trovati = cercaModelli('garmin');
    expect(trovati.length).toBeGreaterThan(0);
    for (const g of trovati) {
      expect(g.marca).toBe('Garmin');
      expect(esitoPer(g).tipo).toBe('mai-via-radio');
      // E accendere libdivecomputer non cambia niente, perché non è questione
      // di driver: i Descent i dati via Bluetooth non li danno a nessuno.
      expect(esitoPer(g, true).tipo).toBe('mai-via-radio');
    }
  });

  it('anche cercando il nome del modello, che è come lo chiama chi ce l’ha', () => {
    // Nessuno cerca «garmin»: si cerca «descent» o «mk2i».
    expect(cercaModelli('descent').length).toBeGreaterThan(0);
    expect(cercaModelli('mk2i').map((m) => m.modello)).toContain('Descent Mk2i');
  });

  it('le voci senza driver vengono DOPO quelle che si scaricano', () => {
    /*
     * Metterle prima significherebbe mettere in cima all'elenco l'unica cosa
     * che non funziona. `g2` combacia con lo Scubapro G2 (che si scarica) e col
     * Garmin Descent G2 (che no): il primo risultato dev'essere lo Scubapro.
     */
    const trovati = cercaModelli('g2');
    expect(trovati.length).toBeGreaterThan(1);
    expect(esitoPer(trovati[0]!).tipo).toBe('si-scarica');
    expect(trovati.some((m) => m.marca === 'Garmin')).toBe(true);
    const primoGarmin = trovati.findIndex((m) => m.marca === 'Garmin');
    const ultimoScaricabile = trovati.map((m) => esitoPer(m).tipo).lastIndexOf('si-scarica');
    expect(primoGarmin).toBeGreaterThan(ultimoScaricabile);
  });
});
