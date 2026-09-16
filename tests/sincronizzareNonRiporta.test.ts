/**
 * TRE COSE CHE TORNAVANO INDIETRO DA SOLE, E UNA CHE SI SDOPPIAVA.
 *
 * ► LA FORMA È SEMPRE LA STESSA, ed è già stata chiusa due volte in
 * `dedupe.ts`: fra due dispositivi la stessa scheda è la stessa scheda, e un
 * campo vuoto da una parte non è un buco — **è una cancellazione**. Le note
 * svuotate e le etichette tolte avevano già la loro regola. Il 16 settembre
 * 2026 si è visto che tre pezzi erano rimasti fuori.
 *
 *  1. La **lapide** (`svuotatiIl`) si toglieva da sé guardando la scheda DOPO
 *     la fusione: se la fusione aveva appena riportato il campo dall'altro
 *     lato, «adesso ha un valore» era vero e la lapide veniva cancellata. Il
 *     dato non tornava una volta — **non si poteva più togliere**.
 *  2. La stessa lapide valeva solo in sincronizzazione. Fra due FONTI il campo
 *     tornava comunque: chi cancella il nome di un compagno e poi reimporta
 *     l'UDDF se lo ritrovava scritto.
 *  3. Le **bombole** non ricevevano nemmeno il parametro. Una stage tolta a
 *     mano tornava dall'altro dispositivo, senza pressioni: volume totale
 *     raddoppiato, e il consumo da **2.2 a 4.5 L/min** — un numero che entra
 *     nel pianificatore.
 *  4. E l'**identificativo** dipendeva dal fuso del dispositivo che scaricava:
 *     lo stesso tuffo preso col telefono in Egitto e col Mac in Italia
 *     diventava due immersioni, su tutti e due i dispositivi, senza un avviso.
 */

import { describe, expect, it } from 'vitest';
import { mergeDive, diveIdFor } from '../src/core/dedupe';
import { AIR, type Dive } from '../src/core/model';

const immersione = (extra: Partial<Dive> = {}): Dive =>
  ({
    id: 'x',
    startTime: '2026-06-14T10:38:00.000Z',
    durationS: 2400,
    maxDepth: 20,
    mode: 'oc',
    salinity: 'salt',
    cylinders: [{ mix: AIR, sizeL: 12, startBar: 200, endBar: 80 }],
    source: { format: 'uddf', file: 'a.uddf', importedAt: '2026-05-01T20:00:00Z' },
    tags: [],
    ...extra,
  }) as Dive;

/** Il lato che ha scritto per ultimo è sempre `base`. */
const sincronizza = (vincitore: Dive, perdente: Dive) =>
  mergeDive(vincitore, perdente, undefined, true);
const importa = (base: Dive, altro: Dive) => mergeDive(base, altro, undefined, false);

describe('la lapide di un campo svuotato sopravvive alla fusione', () => {
  const svuotata = immersione({
    buddy: undefined,
    svuotatiIl: { buddy: '2026-06-01T12:00:00Z' },
  });
  const conBuddy = immersione({ buddy: 'Marta' });

  it('fra due dispositivi il campo resta vuoto E la lapide resta scritta', () => {
    const fusa = sincronizza(svuotata, conBuddy);
    expect(fusa.buddy).toBeUndefined();
    // ► IL PEZZO CHE MANCAVA. ◄ Senza la lapide, al giro dopo il campo si
    // riempie e non c'è più niente che dica che qualcuno l'aveva tolto.
    expect(fusa.svuotatiIl?.buddy).toBe('2026-06-01T12:00:00Z');
  });

  it('e fra due FONTI diverse vale lo stesso: la lapide parla della scheda', () => {
    // Prima: il campo tornava, e la lapide veniva distrutta dallo stesso giro.
    const fusa = importa(svuotata, conBuddy);
    expect(fusa.buddy).toBeUndefined();
    expect(fusa.svuotatiIl?.buddy).toBe('2026-06-01T12:00:00Z');
  });

  it('ma un buco SENZA lapide si riempie ancora, che è tutto il punto', () => {
    const senzaNiente = immersione({ buddy: undefined });
    expect(importa(senzaNiente, conBuddy).buddy).toBe('Marta');
  });

  it('e riscrivendo il campo la lapide cade, altrimenti non si potrebbe più scrivere', () => {
    const riscritta = immersione({ buddy: 'Luca', svuotatiIl: { buddy: '2026-06-01T12:00:00Z' } });
    const fusa = sincronizza(riscritta, conBuddy);
    expect(fusa.buddy).toBe('Luca');
    expect(fusa.svuotatiIl?.buddy).toBeUndefined();
  });

  it('e la lapide dell’altro lato cade se il vincitore il campo ce l’ha scritto', () => {
    // Il vincitore ha scritto per ultimo: il suo valore è più recente del gesto
    // dell'altro. Senza questa regola resterebbe un valore a schermo con
    // accanto una lapide che dice «tolto», e ogni completamento futuro
    // rifiutato per sempre.
    const fusa = sincronizza(immersione({ buddy: 'Luca' }), svuotata);
    expect(fusa.buddy).toBe('Luca');
    expect(fusa.svuotatiIl?.buddy).toBeUndefined();
  });

  it('e non torna nemmeno dopo tre giri, che era il difetto vero', () => {
    let fusa = importa(svuotata, conBuddy);
    for (let giro = 0; giro < 3; giro++) fusa = importa(fusa, conBuddy);
    expect(fusa.buddy).toBeUndefined();
  });
});

describe('una bombola tolta a mano', () => {
  const dueBombole = immersione({
    cylinders: [
      { mix: AIR, sizeL: 12, startBar: 200, endBar: 80 },
      { mix: { o2: 0.5, he: 0 }, sizeL: 7, startBar: 200, endBar: 190 },
    ],
  });
  const unaSola = immersione({ cylinders: [{ mix: AIR, sizeL: 12, startBar: 200, endBar: 80 }] });

  it('non torna sincronizzando, e non torna nemmeno dopo tre giri', () => {
    let fusa = sincronizza(unaSola, dueBombole);
    expect(fusa.cylinders).toHaveLength(1);
    for (let giro = 0; giro < 3; giro++) fusa = sincronizza(fusa, dueBombole);
    expect(fusa.cylinders).toHaveLength(1);
  });

  it('ma fra due FONTI la stage si aggiunge ancora: là è una lettura più ricca', () => {
    expect(importa(unaSola, dueBombole).cylinders).toHaveLength(2);
  });

  it('e i campi delle bombole che restano si completano anche fra dispositivi', () => {
    // Una macchina non cancella: un volume che arriva dall'altro lato riempie
    // un buco senza togliere niente a nessuno.
    const senzaVolume = immersione({
      cylinders: [{ mix: AIR, startBar: 200, endBar: 80 } as never],
    });
    expect(sincronizza(senzaVolume, unaSola).cylinders[0].sizeL).toBe(12);
  });

  it('togliere TUTTE le bombole è una frase, e va rispettata fra dispositivi', () => {
    const nessuna = immersione({ cylinders: [] });
    expect(sincronizza(nessuna, unaSola).cylinders).toHaveLength(0);
    // Fra due fonti resta un buco da riempire.
    expect(importa(nessuna, unaSola).cylinders).toHaveLength(1);
  });
});

describe('l’identificativo non dipende da dove sei quando scarichi', () => {
  /*
   * Lo stesso tuffo: il computer non dichiara il fuso, quindi chi scarica
   * applica il proprio. In Egitto (UTC+3) l'ora a parete delle 13:38 diventa
   * l'istante 10:38Z; in Italia (UTC+2) la stessa ora a parete diventa 11:38Z.
   * Due istanti diversi per lo stesso tuffo, ed è per costruzione.
   */
  const dalTelefonoInEgitto = {
    startTime: '2026-06-14T10:38:00.000Z',
    utcOffsetMinutes: 180,
    maxDepth: 28.4,
    durationS: 2760,
  };
  const dalMacInItalia = {
    startTime: '2026-06-14T11:38:00.000Z',
    utcOffsetMinutes: 120,
    maxDepth: 28.4,
    durationS: 2760,
  };

  it('i due scarichi dello stesso tuffo hanno lo stesso identificativo', () => {
    // Prima: due identificativi diversi, quindi due immersioni in archivio su
    // tutti e due i dispositivi, per sempre, senza un avviso.
    expect(diveIdFor(dalTelefonoInEgitto)).toBe(diveIdFor(dalMacInItalia));
  });

  it('e due tuffi diversi restano diversi, altrimenti avrei solo fuso tutto', () => {
    const unAltro = { ...dalMacInItalia, startTime: '2026-06-14T13:38:00.000Z' };
    expect(diveIdFor(unAltro)).not.toBe(diveIdFor(dalMacInItalia));
    expect(diveIdFor({ ...dalMacInItalia, maxDepth: 31.2 })).not.toBe(diveIdFor(dalMacInItalia));
  });

  it('e l’indice interno del computer, quando c’è col seriale, comanda ancora', () => {
    const conIndice = {
      ...dalMacInItalia,
      computer: { model: 'Perdix', deviceId: 'ABC123', diveId: '7' },
    };
    expect(diveIdFor(conIndice)).toBe(
      diveIdFor({ ...conIndice, startTime: '2026-01-01T00:00:00.000Z' }),
    );
  });
});
