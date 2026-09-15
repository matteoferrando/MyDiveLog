// @vitest-environment jsdom
/**
 * IL VERDETTO NON PASSA MAI DAL SOLO COLORE.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ► LA REGOLA, E DOVE È SCRITTA. ◄ Sopra `SEVERITY_TEXT`, in `ui/format.ts`:
 * *«un colore di stato non porta mai il significato da solo: accanto al pallino
 * c'è sempre questa etichetta testuale»*. Statistiche e Debrief la seguono.
 *
 * ► DOVE NON ERA SEGUITA. ◄ Nella tabella «E se…» del pianificatore. Ogni
 * scenario di contingenza aveva un pallino da otto pixel — verde o rosso — e
 * l'uscita prevista scritta in rosso quando il piano non regge: **due
 * indicazioni, tutte e due col solo colore**. Chi non distingue il rosso dal
 * verde, chi legge con uno screen reader e chi stampa in bianco e nero aveva
 * davanti una tabella di scenari senza sapere quali reggono — e sono gli
 * scenari che la didattica chiede di avere in tasca *prima* di entrare in
 * acqua.
 *
 * Lo stesso piano, stampato, lo scriveva a parole da sempre: «— non ci sta»
 * (`core/export/planSheet.ts`). Era la schermata a essere l'eccezione.
 *
 * ► PERCHÉ SI MONTA LA PAGINA. ◄ Perché la domanda è *cosa c'è a schermo*, e la
 * risposta non si legge nel sorgente: un'etichetta può esserci ed essere
 * nascosta, o esserci per una riga e non per l'altra. Qui si guardano tutte le
 * righe, quelle che reggono e quelle che no.
 */

import { describe, expect, it, vi } from 'vitest';
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';

import { periodOf } from '../src/core/analysis/window';
import type { Dive } from '../src/core/model';

const finto = vi.hoisted(() => ({ valore: {} as Record<string, unknown> }));
vi.mock('../src/ui/state', () => ({ useDiveLog: () => finto.valore }));

import { Planner } from '../src/ui/pages/Planner';

function monta(nodo: ReactNode) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(nodo));
  return {
    host,
    smonta: () => {
      act(() => root.unmount());
      host.remove();
    },
  };
}

/**
 * Un piano sul filo: 32 metri per 22 minuti su una quindici litri, respirando 18
 * litri al minuto.
 *
 * Scelto perché gli scenari si dividono — due reggono e due no. Coi valori
 * predefiniti reggerebbero tutti, e una tabella di soli pallini verdi non
 * direbbe se il verdetto negativo sia scritto da qualche parte o no; con un
 * piano troppo stretto succede l'opposto. Servono tutti e due i casi nella
 * stessa tabella.
 */
const PIANO_SUL_FILO = {
  depthM: 32,
  avgDepthM: 24,
  bottomMin: 22,
  totalMin: 29,
  tankL: 15,
  startBar: 200,
  rmvLpm: 18,
};

function archivioFinto(dives: Dive[]) {
  finto.valore = {
    dives,
    scope: { dives, period: periodOf('12m'), all: dives },
    period: '12m',
    setPeriod: () => undefined,
    gasInput: PIANO_SUL_FILO,
    saveGasInput: () => undefined,
    decoInput: null,
    saveDecoInput: () => undefined,
    decoPlans: [],
    saveNamedDecoPlan: async () => undefined,
    deleteNamedDecoPlan: async () => undefined,
  };
}

/** La tabella della scheda «E se…», cercata dal suo titolo e non dalla posizione. */
function tabellaDegliScenari(host: HTMLElement): HTMLTableElement {
  const scheda = [...host.querySelectorAll('div.card')].find((c) =>
    (c.querySelector('h2')?.textContent ?? '').includes('E se'),
  );
  const tabella = scheda?.querySelector('table');
  if (!tabella) {
    const titoli = [...host.querySelectorAll('h2')].map((h) => h.textContent).join(' | ');
    throw new Error(`nessuna tabella «E se…». Le schede sono: ${titoli}`);
  }
  return tabella as HTMLTableElement;
}

describe('la tabella «E se…» del pianificatore', () => {
  it('scrive a parole se lo scenario regge, riga per riga', () => {
    archivioFinto([]);
    const vista = monta(<Planner />);
    const righe = [...tabellaDegliScenari(vista.host).querySelectorAll('tbody tr')];

    expect(righe.length, 'nessuno scenario: la prova sta guardando una tabella vuota').toBeGreaterThanOrEqual(
      4,
    );

    const verdetti = righe.map((r) => {
      const pallino = r.querySelector('span.dot');
      const testo = r.textContent ?? '';
      return {
        // Il pallino è l'indicazione che c'era PRIMA: qui serve solo a sapere
        // quale verdetto la riga dovrebbe dire a parole.
        regge: pallino?.classList.contains('dot-good') ?? false,
        testo,
      };
    });

    /*
     * ► IL CUORE. ◄ Tolto il colore, la riga deve continuare a dire come va a
     * finire. Si guarda il testo e basta: è tutto quello che arriva a chi legge
     * con uno screen reader, e tutto quello che resta su un foglio in bianco e
     * nero.
     */
    // Niente confini di parola: `textContent` incolla le celle fra loro e
    // «Fondo più lungo» + «non ci sta» diventa «lungonon ci sta». Un confine
    // qui renderebbe la prova verde per un motivo che non c'entra col difetto.
    const mute = verdetti.filter((v) => !/ci sta/.test(v.testo));
    expect(
      mute.map((v) => v.testo),
      'righe in cui il verdetto passa solo dal colore',
    ).toEqual([]);

    // E il verdetto scritto deve essere QUELLO GIUSTO, non una parola messa lì
    // per far tacere una prova.
    for (const v of verdetti) {
      if (v.regge) expect(v.testo, `«${v.testo}» dice il contrario del pallino`).not.toMatch(/non ci sta/);
      else expect(v.testo, `«${v.testo}» dice il contrario del pallino`).toMatch(/non ci sta/);
    }

    /*
     * ► LA GUARDIA DELLA GUARDIA. ◄ Se tutti gli scenari reggessero — o nessuno —
     * il controllo qui sopra proverebbe solo metà della regola, e passerebbe
     * anche con un'etichetta costante. Il piano stretto esiste per avere tutti e
     * due i casi nella stessa tabella.
     */
    expect(
      verdetti.some((v) => v.regge),
      'nessuno scenario che regge',
    ).toBe(true);
    expect(
      verdetti.some((v) => !v.regge),
      'nessuno scenario che non regge',
    ).toBe(true);

    vista.smonta();
  });

  it('e il pallino resta decorativo: non porta testo né etichetta accessibile', () => {
    /*
     * Un pallino con dentro un `aria-label` sarebbe l'altra via d'uscita, ed è
     * peggiore: l'etichetta la sentirebbe chi usa uno screen reader e non la
     * vedrebbe chi guarda lo schermo in bianco e nero o non distingue i colori.
     * Il testo visibile serve a tutti e due.
     */
    archivioFinto([]);
    const vista = monta(<Planner />);
    for (const pallino of tabellaDegliScenari(vista.host).querySelectorAll('span.dot')) {
      expect(pallino.textContent).toBe('');
      expect(pallino.getAttribute('aria-label')).toBeNull();
    }
    vista.smonta();
  });
});
