/**
 * La frase in cima alla schermata di esito racconta la sessione, non l'ultimo
 * tentativo. Il perché sta in `src/core/ble/immersioniGiaSalvate.ts`: un
 * Aqualung i330R, settantuno immersioni in archivio, e sopra la scritta «non è
 * stata salvata nessuna immersione».
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { immersioniGiaSalvate } from '../src/core/ble/immersioniGiaSalvate';

const leggi = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');

describe('le immersioni già salvate nella sessione', () => {
  it('il caso del 23 settembre: niente in questo tentativo, settantuno prima', () => {
    expect(immersioniGiaSalvate({ arrivate: 0, salvatePrima: 71 })).toBe(71);
  });

  it('se questo tentativo ne ha portate, la frase parla di quelle', () => {
    expect(immersioniGiaSalvate({ arrivate: 5, salvatePrima: 71 })).toBeUndefined();
  });

  it('se nessun tentativo ha salvato, «nessuna» è vero e resta', () => {
    expect(immersioniGiaSalvate({ arrivate: 0 })).toBeUndefined();
    expect(immersioniGiaSalvate({ arrivate: 0, salvatePrima: 0 })).toBeUndefined();
  });
});

describe('e la schermata la usa davvero', () => {
  const sorgente = leggi('../src/ui/components/BleDownload.tsx');

  it('la frase in cima passa dalla regola, con le salvate dei tentativi di prima', () => {
    expect(sorgente).toContain('immersioniGiaSalvate({');
    expect(sorgente).toMatch(/salvatePrima:\s*insiste\?\.raccolto\?\.salvateQuante/);
    expect(sorgente).toContain(
      'Il logbook ha ricevuto e salvato {0} prima che il collegamento si interrompesse.',
    );
    // E la frase nuova prende davvero il posto di quella del tentativo: una
    // regola calcolata e poi non usata sarebbe verde qui sopra e falsa a schermo.
    expect(sorgente).toMatch(
      /if \(giaSalvate !== undefined\) \{[\s\S]{0,600}?testo = guasto === undefined \? detta : conDettaglio\(detta, guasto\);/,
    );
  });

  it('e il conto delle salvate si porta avanti fra i tentativi, senza le sole arrivate', () => {
    expect(sorgente).toMatch(
      /salvateQuante:\s*Math\.max\(\s*salvateInArchivio \? dives\.length : 0,\s*insiste\?\.raccolto\?\.salvateQuante \?\? 0,?\s*\)/,
    );
  });
});
