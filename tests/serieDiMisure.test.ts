// @vitest-environment jsdom
/**
 * Una serie di misure non è un istogramma di conteggi, e trattarla come tale
 * dice due bugie a chi guarda.
 *
 * La scheda «Temperatura per mese» passa da `ColumnChart`, che è nato per
 * contare immersioni. Su una serie di temperature quel componente faceva due
 * cose sbagliate, tutte e due invisibili a chi le ha scritte:
 *
 *  1. **la colonna a zero non veniva disegnata affatto** (`{d.value > 0 && …}`),
 *     quindi il mese in cui qualcuno si è immerso sotto il ghiaccio a zero gradi
 *     era indistinguibile da un mese senza immersioni — ed è esattamente la
 *     lettura che `tempByMonth` è stato riscritto per impedire;
 *  2. **il riassunto per chi non vede diceva «totale 77 °C»** — una somma di
 *     temperature, che non è una temperatura — **e «A zero: 1 su 6»**, cioè
 *     annunciava come un buco l'unico mese davvero freddo.
 *
 * *Zero è il valore più rassicurante che un numero possa avere, e l'ultimo che
 * dovrebbe comparire quando il dato manca.* Qui non mancava: era misurato.
 *
 * Le prove rendono davvero il componente e contano i nodi, invece di leggere il
 * sorgente: un `&&` in un JSX non si controlla con una ricerca di testo.
 */

import { describe, expect, it } from 'vitest';
import { createElement as e } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';

import { ColumnChart, riassuntoDistribuzione } from '../src/ui/components/Charts';

/** Un inverno di lago: gennaio a zero gradi, e la stagione che si scalda. */
const TEMPERATURE = [
  { key: '2026-01', label: 'gen', value: 0 },
  { key: '2026-02', label: 'feb', value: 1 },
  { key: '2026-05', label: 'mag', value: 14 },
  { key: '2026-06', label: 'giu', value: 18 },
  { key: '2026-07', label: 'lug', value: 21 },
  { key: '2026-08', label: 'ago', value: 23 },
];

/** Quante colonne sono davvero disegnate: le marche sono `<path>`. */
const colonneDisegnate = (markup: string) => (markup.match(/<path /g) ?? []).length;

describe('una serie di misure', () => {
  it('disegna anche la colonna a zero, che è una misura e non un buco', () => {
    const misure = renderToStaticMarkup(e(ColumnChart, { data: TEMPERATURE, unit: '°C', serie: 'misure' }));
    expect(colonneDisegnate(misure)).toBe(TEMPERATURE.length);
  });

  it('e su un istogramma di conteggi lo zero resta un buco, come deve', () => {
    const conteggi = renderToStaticMarkup(
      e(ColumnChart, { data: TEMPERATURE, unit: 'immersioni', serie: 'conteggi' }),
    );
    // Cinque su sei: il mese a zero non si disegna, perché lì zero vuol dire
    // «nessuna immersione» e una marca lo racconterebbe come una presenza.
    expect(colonneDisegnate(conteggi)).toBe(TEMPERATURE.length - 1);
  });

  it('non somma le temperature e non chiama «a zero» il mese più freddo', () => {
    const detto = riassuntoDistribuzione(TEMPERATURE, { unita: '°C', serie: 'misure' });
    expect(detto).not.toMatch(/totale/i);
    expect(detto).not.toMatch(/a zero/i);
    // Quello che invece deve dire: quante misure, la media, e i due estremi.
    expect(detto).toMatch(/6 colonne/);
    expect(detto).toMatch(/media 12/);
    expect(detto).toMatch(/Massimo ago/);
    expect(detto).toMatch(/minimo gen/);
  });

  it('su una serie di conteggi il totale e lo zero restano, che lì significano', () => {
    const detto = riassuntoDistribuzione(TEMPERATURE, { unita: 'immersioni' });
    expect(detto).toMatch(/totale 77/);
    expect(detto).toMatch(/A zero: 1 su 6/);
  });

  it('la scheda della temperatura chiede davvero la serie di misure', () => {
    // La correzione vive per metà in una proprietà passata da un'altra pagina:
    // senza questa riga il componente è a posto e la schermata no.
    const sorgente = readFileSync('src/ui/pages/Stats.tsx', 'utf8');
    const riga = sorgente.split('\n').find((l) => l.includes('<ColumnChart') && l.includes('°C'));
    expect(riga, 'la scheda «Temperatura per mese» non è più su una riga sola: guardare a mano').toBeTruthy();
    expect(riga).toMatch(/serie="misure"/);
  });
});

describe('la finestra scelta arriva ad aggregate', () => {
  /*
   * `aggregate` divide per i mesi guardati e sa distinguere «Ultimi 12 mesi» da
   * «tutto l'archivio» — ma solo se glielo si dice. La riga che glielo dice sta
   * in `state.tsx`, fuori dal modulo, ed è l'unica: se qualcuno la semplifica
   * togliendo il terzo argomento, il conto giusto resta dentro `aggregate` e
   * non arriva a nessuna schermata, senza che niente diventi rosso.
   */
  it('state.tsx passa l’ampiezza del periodo, non lascia dedurla dai dati', () => {
    const sorgente = readFileSync('src/ui/state.tsx', 'utf8');
    const chiamate = [...sorgente.matchAll(/aggregate\(([^)]*)\)/g)].map((m) => m[1]);
    expect(chiamate.length, 'nessuna chiamata ad aggregate in state.tsx').toBeGreaterThan(0);
    for (const argomenti of chiamate) {
      expect(argomenti, `aggregate(${argomenti}) non riceve l’ampiezza della finestra`).toMatch(
        /period\.months/,
      );
    }
  });
});
