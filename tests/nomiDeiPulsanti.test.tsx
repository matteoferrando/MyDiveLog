// @vitest-environment jsdom
/**
 * DODICI PULSANTI CHE SI CHIAMANO TUTTI «APRI».
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ► IL DIFETTO, misurato il 16 settembre 2026 sull'inventario dei comandi. ◄
 *
 * Nelle tabelle dei brevetti e dell'attrezzatura ogni riga finisce con un
 * pulsantino «Apri». A vederlo è chiarissimo: sta in fondo alla sua riga, e la
 * riga dice di che cosa si parla. Ma il nome accessibile di quel pulsante era
 * la sola parola «Apri» — cioè chi attraversa la pagina col tabulatore, o la
 * ascolta da un lettore di schermo, riceve dodici pulsanti identici e nessun
 * modo di sapere quale sta per premere senza tornare indietro a leggere la
 * riga. *Quello che l'occhio prende dal contesto, la tastiera non lo ha.*
 *
 * ► PERCHÉ NON SI CAMBIA IL TESTO VISIBILE. ◄ Scrivere «Apri Advanced Open
 * Water Diver» dentro ogni riga allunga la colonna e ripete un'informazione che
 * sta già due celle più a sinistra. Il testo resta «Apri»; il nome accessibile
 * porta anche il soggetto. È esattamente ciò per cui esiste `aria-label`.
 *
 * ► E LA PROVA GUARDA I NOMI, NON L'ATTRIBUTO. ◄ Controlla che due pulsanti
 * della stessa tabella non si chiamino allo stesso modo: è la proprietà che
 * conta, e resta vera comunque la si ottenga.
 */

import { describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

import type { Certification } from '../src/core/analysis/gear';

const finto = vi.hoisted(() => ({ valore: {} as Record<string, unknown> }));
vi.mock('../src/ui/state', () => ({ useDiveLog: () => finto.valore }));

import { Brevetti } from '../src/ui/components/Brevetti';

const BREVETTI: Certification[] = [
  { id: 'a', agency: 'PADI', name: 'Advanced Open Water Diver', level: 'advanced' },
  { id: 'b', agency: 'SSI', name: 'Nitrox', level: 'base' },
];

/** Il nome con cui un comando si presenta a chi non lo guarda. */
function nomeAccessibile(el: Element): string {
  return (el.getAttribute('aria-label') || el.textContent || '').trim();
}

function monta(nodo: React.ReactNode) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const radice = createRoot(host);
  act(() => radice.render(nodo));
  return { host, smonta: () => act(() => radice.unmount()) };
}

describe('i pulsanti di riga si chiamano col nome della riga', () => {
  it('due brevetti danno due pulsanti «Apri» con due nomi diversi', () => {
    finto.valore = {
      gear: { certifications: BREVETTI, items: [], weights: [] },
      saveGear: () => Promise.resolve(),
    };
    const { host, smonta } = monta(<Brevetti />);

    const apri = [...host.querySelectorAll('tbody button')];
    expect(apri.length, 'un pulsante per riga').toBe(2);
    expect(
      apri.every((b) => b.textContent?.trim() === 'Apri'),
      'il testo visibile resta «Apri»',
    ).toBe(true);

    const nomi = apri.map(nomeAccessibile);
    expect(new Set(nomi).size, `due pulsanti con lo stesso nome: ${nomi.join(' / ')}`).toBe(2);
    expect(nomi.join(' ')).toContain('Advanced Open Water Diver');
    expect(nomi.join(' ')).toContain('Nitrox');
    smonta();
  });

  it('e un brevetto senza nome non lascia il pulsante muto', () => {
    /*
     * Il nome è facoltativo: chi aggiunge una riga e non la compila subito ha un
     * brevetto senza nome, e il pulsante non deve tornare a chiamarsi «Apri» e
     * basta — deve dire che quella riga è senza nome, che è un'informazione
     * vera e utile quanto il nome.
     */
    finto.valore = {
      gear: { certifications: [{ id: 'c', agency: '', name: '', level: 'base' }], items: [], weights: [] },
      saveGear: () => Promise.resolve(),
    };
    const { host, smonta } = monta(<Brevetti />);
    const bottone = host.querySelector('tbody button')!;
    expect(nomeAccessibile(bottone)).toBe('Apri senza nome');
    smonta();
  });
});
