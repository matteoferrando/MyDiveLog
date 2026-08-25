// @vitest-environment jsdom
/**
 * La nota della sigla resta sulla SUA bombola, anche togliendone una in mezzo.
 *
 * ► IL DIFETTO CHE QUESTO FILE ESISTE PER NON FAR TORNARE. ◄ L'elenco delle
 * bombole nella scheda di modifica usava la posizione come chiave React. Ogni
 * riga però ha uno stato che vive solo dentro di lei — `notaSigla`, la frase
 * che dice se i litri d'acqua vengono dal dato di targa o da una formula —
 * e la posizione, quando si toglie una bombola in mezzo, cambia significato:
 * React tiene i componenti dove sono e ci fa scorrere sotto i dati. Il
 * risultato è che la nota di una bombola compare accanto a un'altra, cioè
 * accanto a un gas che non è quello di cui parla.
 *
 * Non è un difetto d'aspetto. La nota è l'unica conferma che l'applicazione
 * abbia capito «S80» come 11,1 L e non come qualcos'altro, e quel numero si
 * porta dietro ogni consumo calcolato su quell'immersione.
 *
 * Il controllo si fa MONTANDO davvero il componente e togliendo davvero una
 * riga: la memoria di un componente fra un render e l'altro non esiste finché
 * non c'è React che la tiene, e nessun controllo sui tipi o sulla forma
 * dell'albero può vederla.
 */

import { describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Dive } from '../src/core/model';
import type { GearArchive } from '../src/core/analysis/gear';

// La scheda legge l'archivio solo per proporre i diving già usati: qui non
// serve niente di vero, e montarlo per davvero tirerebbe dentro lo storage.
vi.mock('../src/ui/state', () => ({ useDiveLog: () => ({ dives: [] }) }));

const { ModificaImmersione } = await import('../src/ui/components/ModificaImmersione');

const immersione = (): Dive => ({
  id: 'imm-bombole',
  startTime: '2026-06-14T10:38:00+02:00',
  durationS: 2400,
  maxDepth: 25,
  mode: 'oc',
  cylinders: [
    { description: 'prima', mix: { o2: 0.21, he: 0 } },
    { description: 'seconda', mix: { o2: 0.21, he: 0 } },
    { description: 'terza', mix: { o2: 0.21, he: 0 } },
  ],
  source: { format: 'manual', file: '—', importedAt: '2026-06-14T20:00:00Z' },
  tags: [],
});

const attrezzatura: GearArchive = { equipment: [], certifications: [] };

function monta() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() =>
    root.render(
      <ModificaImmersione
        dive={immersione()}
        gear={attrezzatura}
        onSalvaAttrezzatura={() => Promise.resolve()}
        onSave={() => Promise.resolve()}
        onDelete={() => {}}
      />,
    ),
  );
  return { host, smonta: () => act(() => root.unmount()) };
}

/** I campi «Sigla o descrizione», uno per bombola, nell'ordine dell'elenco. */
function sigle(host: HTMLElement): HTMLInputElement[] {
  return [...host.querySelectorAll<HTMLInputElement>('input[placeholder="S80, D12, 15 L…"]')];
}

/** La riga di bombola a cui appartiene un campo. */
function riga(campo: HTMLElement): HTMLElement {
  const card = campo.closest<HTMLElement>('.card');
  if (!card) throw new Error('il campo non sta dentro una riga di bombola');
  return card;
}

/**
 * Scrive in un campo come farebbe una tastiera, e poi esce.
 *
 * Il valore passa dal setter nativo perché React tiene la propria copia del
 * valore sul nodo e ignorerebbe un `input.value = …` diretto. L'uscita dal
 * campo è `focusout` e non `blur`: `blur` non risale, e i gestori di React
 * stanno sulla radice.
 */
function scriviEdEsci(campo: HTMLInputElement, testo: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(campo, testo);
    campo.dispatchEvent(new Event('input', { bubbles: true }));
  });
  act(() => {
    campo.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  });
}

function togli(riga: HTMLElement) {
  const bottone = [...riga.querySelectorAll('button')].find((b) =>
    (b.textContent ?? '').includes('Togli questa bombola'),
  );
  if (!bottone) throw new Error('la riga non ha il pulsante per togliere la bombola');
  act(() => {
    bottone.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

describe('la sigla della bombola resta sulla bombola giusta', () => {
  it('la nota segue la sua bombola quando se ne toglie una prima di lei', () => {
    const { host, smonta } = monta();
    try {
      const campi = sigle(host);
      expect(campi).toHaveLength(3);

      // La seconda bombola diventa una S80: la nota dice da dove escono i litri.
      scriviEdEsci(campi[1], 'S80');
      const nota = riga(campi[1]).textContent ?? '';
      expect(nota).toContain('alluminio 80 cuft');

      // Via la prima. Le altre due scalano di un posto.
      togli(riga(sigle(host)[0]));

      const rimaste = sigle(host);
      expect(rimaste.map((c) => c.value)).toEqual(['S80', 'terza']);
      // La nota sta con la S80, che è l'unica bombola di cui parla…
      expect(riga(rimaste[0]).textContent ?? '').toContain('alluminio 80 cuft');
      // …e NON è passata alla bombola che le è scivolata sotto. Si cerca
      // «cuft», che compare solo nella nota: «alluminio» da solo è anche una
      // voce della tendina del materiale, presente in ogni riga.
      expect(riga(rimaste[1]).textContent ?? '').not.toContain('cuft');
    } finally {
      smonta();
    }
  });

  it('ogni bombola porta una chiave sua, diversa dalle altre e stabile', () => {
    /*
     * La prova sopra fallisce anche per altri motivi (un `notaSigla` spostato
     * altrove, un `onRimuovi` che toglie la riga sbagliata). Questa dice che il
     * rimedio è quello giusto: la chiave esiste, è unica, ed è sul dato — cioè
     * viaggia col salvataggio e si ritrova alla riapertura, che è la sola forma
     * che impedisce al difetto di rientrare dalla porta di servizio.
     */
    let salvata: Dive | undefined;
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() =>
      root.render(
        <ModificaImmersione
          dive={immersione()}
          gear={attrezzatura}
          onSalvaAttrezzatura={() => Promise.resolve()}
          onSave={(d) => {
            salvata = d;
            return Promise.resolve();
          }}
          onDelete={() => {}}
        />,
      ),
    );
    const bottone = [...host.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('Salva'));
    if (!bottone) throw new Error('la scheda non ha il pulsante che salva');
    act(() => {
      bottone.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const chiavi = (salvata?.cylinders ?? []).map((c) => c.id);
    expect(chiavi.filter(Boolean)).toHaveLength(3);
    expect(new Set(chiavi).size).toBe(3);

    act(() => root.unmount());
  });
});
