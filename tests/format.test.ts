/**
 * Formattazione dei testi dell'interfaccia.
 *
 * Piccolo, ma è la differenza fra un'applicazione e un prototipo: «1 immersioni»
 * compariva in una decina di punti, e ogni volta segnalava al lettore che il
 * testo non è stato riletto da nessuno.
 */

import { describe, expect, it } from 'vitest';
import { imm, plural } from '../src/ui/format';

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
