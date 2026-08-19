/**
 * I campi della scheda immersione: condizioni, bombole, zavorra.
 *
 * Sono tre pezzi che sembrano banali e non lo sono, ciascuno per una ragione
 * diversa. Le condizioni devono continuare a leggersi anche dalle immersioni
 * salvate col formato vecchio, senza migrazioni. La sigla di una bombola è un
 * nome commerciale che MENTE sul volume, e sbagliare i litri sbaglia ogni
 * consumo calcolato della stessa percentuale, per sempre. La zavorra e la
 * piastra sono due campi che vanno sommati, e il difetto naturale di due campi
 * separati è dimenticarsi di sommarli.
 */

import { describe, expect, it } from 'vitest';
import { conditionsOf, condizioniTesto, tagsSenzaCondizioni, visibilitaTesto } from '../src/core/conditions';
import { parseCylinderSpec } from '../src/core/cylinders';
import { weightingBySuit, zavorraTotaleKg } from '../src/core/analysis/gear';
import type { Dive } from '../src/core/model';

describe('condizioni', () => {
  it('legge il campo nuovo quando c’è', () => {
    const d = { conditions: { weather: 'rainy' as const, waves: 'rough' as const }, tags: ['sole'] };
    expect(conditionsOf(d)).toEqual({ weather: 'rainy', waves: 'rough' });
    expect(condizioniTesto(d)).toBe('pioggia · mare agitato');
  });

  it('legge le etichette vecchie dai tag, senza bisogno di migrare l’archivio', () => {
    /*
     * È il punto di tutto il file `conditions.ts`. Un passaggio di migrazione
     * su tutto l'archivio gira una volta sola, non si riesce a provare due
     * volte, e se sbaglia sbaglia su tutto insieme. Leggere due forme costa
     * una funzione invece di un rischio.
     */
    expect(conditionsOf({ tags: ['sole', 'mare mosso', 'notturna'] })).toEqual({
      weather: 'sunny',
      waves: 'moderate',
    });
    // Anche i codici grezzi che LogTRAK produceva prima della traduzione.
    expect(conditionsOf({ tags: ['overcast', 'moderately'] })).toEqual({
      weather: 'overcast',
      waves: 'moderate',
    });
  });

  it('un campo nuovo VUOTO vince sui tag vecchi', () => {
    // Se qualcuno ha aperto la scheda e ha tolto il meteo, quel vuoto è una
    // scelta: riempirlo da un tag rimasto indietro sarebbe rimettere a mano
    // quello che è stato appena cancellato.
    expect(conditionsOf({ conditions: {}, tags: ['sole'] })).toEqual({});
  });

  it('i tag delle condizioni si tolgono quando si passa alla forma nuova', () => {
    expect(tagsSenzaCondizioni(['sole', 'notturna', 'mare calmo', 'relitto'])).toEqual([
      'notturna',
      'relitto',
    ]);
  });

  it('la visibilità si legge come fascia o come numero', () => {
    expect(visibilitaTesto({ visibilityM: 5, visibilityMaxM: 10 })).toBe('da 5 a 10 m');
    expect(visibilitaTesto({ visibilityM: 12 })).toBe('12 m');
    expect(visibilitaTesto({})).toBe('—');
    // Massimo uguale al minimo: è un numero, non una fascia da zero larghezza.
    expect(visibilitaTesto({ visibilityM: 8, visibilityMaxM: 8 })).toBe('8 m');
  });
});

describe('sigle delle bombole', () => {
  it('la S80 vale 11.1 L, non il numero che ha nel nome', () => {
    /*
     * «80» sono i piedi cubi di GAS erogati, non i litri d'acqua — e il nome
     * mente anche su quelli: la Luxfer chiamata 80 ne dà 77,4. Applicando la
     * formula al nome verrebbero 10,95 L: un errore dell'1,4% su ogni consumo
     * calcolato, sempre nella stessa direzione.
     */
    const s80 = parseCylinderSpec('S80');
    expect(s80?.sizeL).toBe(11.1);
    expect(s80?.material).toBe('alu');
    expect(s80?.workPressureBar).toBe(207);
    expect(s80?.from).toBe('tabella');

    expect(parseCylinderSpec('s40')?.sizeL).toBe(5.7);
    expect(parseCylinderSpec('AL 80')?.sizeL).toBe(11.1);
  });

  it('una sigla fuori tabella si stima e lo DICHIARA', () => {
    const s = parseCylinderSpec('S77');
    expect(s?.from).toBe('formula');
    expect(s?.note).toMatch(/stima/);
  });

  it('i litri scritti direttamente restano quelli', () => {
    expect(parseCylinderSpec('12')?.sizeL).toBe(12);
    expect(parseCylinderSpec('11,1 L')?.sizeL).toBe(11.1);
    expect(parseCylinderSpec('15 litri')?.sizeL).toBe(15);
  });

  it('un bibombola non si raddoppia né si dimezza in silenzio', () => {
    /*
     * `Cylinder.sizeL` è il volume di UNA bombola e il resto del programma
     * conta le bombole dall'elenco: indovinare qui significa raddoppiare due
     * volte o non raddoppiare affatto, e in tutti e due i casi senza che si
     * veda.
     */
    const d12 = parseCylinderSpec('D12');
    expect(d12?.sizeL).toBe(12);
    expect(d12?.note).toMatch(/24 L/);
    expect(parseCylinderSpec('2x12')?.sizeL).toBe(12);
  });

  it('quello che non si capisce resta vuoto, non diventa un numero inventato', () => {
    expect(parseCylinderSpec('')).toBeUndefined();
    expect(parseCylinderSpec('quella grigia')).toBeUndefined();
    expect(parseCylinderSpec('0')).toBeUndefined();
    expect(parseCylinderSpec('-5')).toBeUndefined();
    // Un numero assurdo è più probabilmente un errore di battitura che una
    // bombola: 200 litri non esistono, e accettarlo falserebbe tutto.
    expect(parseCylinderSpec('200')).toBeUndefined();
  });
});

describe('zavorra e piastra', () => {
  const base = (over: Partial<Dive>): Dive =>
    ({
      id: 'x',
      startTime: '2026-01-01T10:00:00Z',
      durationS: 2400,
      maxDepth: 20,
      mode: 'oc',
      cylinders: [],
      source: { format: 'manual', file: '', importedAt: '' },
      tags: [],
      ...over,
    }) as Dive;

  it('si sommano: è il peso che ti tira giù davvero', () => {
    expect(zavorraTotaleKg(base({ weightKg: 2, gear: { backplateKg: 3 } }))).toBe(5);
    expect(zavorraTotaleKg(base({ weightKg: 6 }))).toBe(6);
    expect(zavorraTotaleKg(base({}))).toBe(0);
  });

  it('la tabella per muta conta il totale, non la sola zavorra', () => {
    /*
     * Chi ha una piastra d'acciaio da 3 kg e scrive «2 kg di zavorra» ne porta
     * cinque: una statistica che legge solo `weightKg` racconta il contrario
     * di quello che succede in acqua.
     */
    const righe = weightingBySuit([
      base({ suit: 'stagna', weightKg: 2, gear: { backplateKg: 3 } }),
      base({ suit: 'stagna', weightKg: 2, gear: { backplateKg: 3 } }),
    ]);
    expect(righe[0].medianKg).toBe(5);
    expect(righe[0].withBackplate).toBe(2);
  });
});
