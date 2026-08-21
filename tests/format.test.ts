/**
 * Formattazione dei testi dell'interfaccia.
 *
 * Piccolo, ma è la differenza fra un'applicazione e un prototipo: «1 immersioni»
 * compariva in una decina di punti, e ogni volta segnalava al lettore che il
 * testo non è stato riletto da nessuno.
 */

import { describe, expect, it } from 'vitest';
import { imm, plural, descriviFinestra } from '../src/ui/format';

describe('plurale', () => {
  it('usa il singolare solo per uno', () => {
    expect(imm(0)).toBe('0 immersioni');
    expect(imm(1)).toBe('1 immersione');
    expect(imm(2)).toBe('2 immersioni');
  });

  it('vale per qualunque coppia di forme', () => {
    expect(plural(1, 'bombola', 'bombole')).toBe('1 bombola');
    expect(plural(3, 'bombola', 'bombole')).toBe('3 bombole');
  });
});

describe('il piede dell’elenco a finestra', () => {
  /*
   * Il logbook disegna cinquanta righe alla volta. I due conti del piede si
   * sbagliano in silenzio: sbagliati non rompono niente, dicono solo una cosa
   * falsa a chi sta cercando un'immersione.
   */
  it('dichiara «tutte mostrate» solo quando non manca niente', () => {
    expect(descriviFinestra(50, 50).testo).toBe('50 immersioni, tutte mostrate');
    expect(descriviFinestra(50, 51).testo).toBe('50 di 51 immersioni');
    // Il caso limite dell'ultima schermata: mostrate === totali, non «quasi».
    expect(descriviFinestra(51, 51).altre).toBe(0);
  });

  it('il pulsante promette quante ne restano davvero, non il passo fisso', () => {
    // Ne mancano sette: «Mostra altre 50» sarebbe una promessa non mantenuta.
    expect(descriviFinestra(50, 57).altre).toBe(7);
    // Ne mancano cento: si va a passi di cinquanta.
    expect(descriviFinestra(50, 150).altre).toBe(50);
    // E il passo si può cambiare senza toccare il testo.
    expect(descriviFinestra(25, 100, 25).altre).toBe(25);
  });

  it('non produce numeri negativi se la finestra supera il totale', () => {
    // Succede per un istante quando un filtro restringe i risultati mentre la
    // finestra è ancora quella allargata di prima.
    expect(descriviFinestra(80, 3).altre).toBe(0);
    expect(descriviFinestra(80, 3).testo).toBe('3 immersioni, tutte mostrate');
  });

  it('una sola immersione si dice al singolare', () => {
    expect(descriviFinestra(1, 1).testo).toBe('1 immersione, tutte mostrate');
  });
});
