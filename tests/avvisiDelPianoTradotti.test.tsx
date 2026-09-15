// @vitest-environment jsdom
/**
 * I TRENTATRÉ AVVISI DEI PIANIFICATORI, NELLA LINGUA DI CHI PIANIFICA.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ► IL DIFETTO. ◄ Gli avvisi nascono in `core/analysis/gasPlan.ts` (diciotto) e
 * `core/analysis/deco.ts` (quindici), dove la lingua non si sa, e venivano
 * disegnati **così com'erano** in cinque punti fra `Planner.tsx` e
 * `DecoPlan.tsx`. Con l'applicazione in inglese il riquadro diceva «Worth
 * knowing:» e poi una frase italiana intera.
 *
 * Non è una schermata qualunque: **qui il testo è una regola di sicurezza** —
 * PPO2 oltre il limite, END oltre i quaranta metri, controdiffusione isobarica,
 * GF99 all'uscita, orologio CNS, obbligo decompressivo probabile. Chi legge
 * l'app in inglese stava pianificando un'immersione con avvisi che non poteva
 * leggere.
 *
 * ► PERCHÉ NON BASTAVA `t()`. ◄ Sono quasi tutti template literal con dei numeri
 * dentro. La chiave cambierebbe a ogni piano — «A 33.3 m…», «A 41 m…» — e nel
 * dizionario non ci sarebbe mai. È lo stesso difetto che tenne fuori novantuno
 * frasi del piano di miglioramento per mesi; la cura è la stessa, ed è
 * `core/frase.ts`: si traduce prima e si riempie dopo.
 *
 * ► COSA CONTROLLA QUESTO FILE. ◄ Tre cose che insieme chiudono il canale:
 * che ogni modello abbia la sua voce inglese coi segnaposti giusti; che nessuno
 * possa più scrivere una frase **sul posto** dentro i due motori; e che a
 * schermo, con l'applicazione in inglese, esca davvero l'inglese.
 */

import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';

import * as A from '../src/core/analysis/avvisiDelPiano';
import { TESTI_DEGLI_AVVISI_DEL_PIANO } from '../src/core/analysis/avvisiDelPiano';
import { testoAvvertenza } from '../src/core/analysis/avvertenze';
import { comeSta } from '../src/core/traduci';
import { DEFAULT_PLAN, planGas } from '../src/core/analysis/gasPlan';
import { planDeco } from '../src/core/analysis/deco';
import { INGLESE as EN } from '../src/ui/traduzioni';
import { periodOf } from '../src/core/analysis/window';
import type { Dive } from '../src/core/model';

const inglese = (s: string) => EN[s] ?? s;
const segnaposti = (s: string) => (s.match(/\{(\d+)\}/g) ?? []).sort();

// ---------------------------------------------------------------------------
// 1. Il canale che nessuna guardia sul sorgente può vedere
// ---------------------------------------------------------------------------

describe('ogni avviso del piano', () => {
  it('sono trentasette modelli, o questa prova sta guardando un elenco che si è svuotato', () => {
    /*
     * ► LA GUARDIA DELLA GUARDIA. ◄ `it.each` su un elenco vuoto non esegue
     * niente e chiude verde: è il modo più silenzioso di perdere un controllo.
     * Trentatré punti di `warnings.push` diventano trentasette modelli perché
     * sei frasi hanno due forme — singolare e plurale, con e senza la coda.
     */
    expect(TESTI_DEGLI_AVVISI_DEL_PIANO.length).toBeGreaterThanOrEqual(37);
  });

  it.each(TESTI_DEGLI_AVVISI_DEL_PIANO)('«%s» ha la sua voce in inglese', (modello) => {
    expect(EN[modello], `manca la traduzione di «${modello}»`).toBeDefined();
  });

  it.each(TESTI_DEGLI_AVVISI_DEL_PIANO)('«%s» tiene gli stessi segnaposti', (modello) => {
    /*
     * Una traduzione che perde un `{0}` non sembra rotta: la frase resta
     * grammaticale e sparisce soltanto il numero — «PPO2 up to bar». Su una
     * pagina di regole di sicurezza il numero È l'avviso.
     */
    const en = EN[modello];
    if (!en) return; // lo dice già la prova sopra
    expect(segnaposti(en), `segnaposti diversi in «${en}»`).toEqual(segnaposti(modello));
  });

  it('e ogni costante del modulo è nell’elenco che la prova scorre', () => {
    /*
     * La metà che tiene chiuso il buco: una costante nuova che nessuno aggiunge
     * a `TESTI_DEGLI_AVVISI_DEL_PIANO` sfuggirebbe alla guardia restando
     * perfettamente ordinata a vedersi.
     */
    const testi = Object.entries(A)
      .filter(([, v]) => typeof v === 'string')
      .map(([, v]) => v as string);
    expect(
      testi.length,
      'nessuna costante trovata: la ricerca non aggancia più niente',
    ).toBeGreaterThanOrEqual(37);
    const fuori = testi.filter((s) => !(TESTI_DEGLI_AVVISI_DEL_PIANO as readonly string[]).includes(s));
    expect(fuori, `modelli che nessuna prova scorre: ${fuori.join(' | ')}`).toEqual([]);
  });
});

describe('i due motori non scrivono più frasi sul posto', () => {
  it.each(['src/core/analysis/gasPlan.ts', 'src/core/analysis/deco.ts'])(
    '%s manda solo modelli, mai testo già composto',
    (percorso) => {
      /*
       * ► IL DIFETTO, SCRITTO COM'ERA. ◄ `text: \`A ${depthM} m questa miscela…\``:
       * una frase composta sul posto, coi numeri dentro, impossibile da tradurre
       * perché la chiave cambia a ogni piano. Qui si cerca proprio quella forma,
       * in tutte le sue varianti: un campo di testo il cui valore è una stringa
       * invece di una costante.
       */
      const sorgente = readFileSync(percorso, 'utf8');
      const composte = [...sorgente.matchAll(/\b(?:text|testo):\s*(['"`])/g)].map((m) => m[0]);
      expect(composte, 'avvisi scritti sul posto invece che come modello esportato').toEqual([]);
      // E il campo vecchio non deve tornare con un altro valore.
      expect(sorgente).not.toMatch(/\btext:\s/);
      // La guardia della guardia: se `warnings.push` sparisse o cambiasse forma,
      // il controllo qui sopra passerebbe su un file che non ne ha più.
      expect(
        [...sorgente.matchAll(/warnings\.push\(/g)].length,
        'nessun avviso in questo file: la prova sta guardando il posto sbagliato',
      ).toBeGreaterThanOrEqual(12);
    },
  );
});

// ---------------------------------------------------------------------------
// 2. Composti, arrivano in inglese coi numeri dentro
// ---------------------------------------------------------------------------

describe('un piano che non regge, letto in inglese', () => {
  /**
   * 40 m per 40 minuti con EAN36 su una 10 L: fuori da ogni limite.
   *
   * La miscela ricca serve a far scattare anche l'avviso della MOD — in aria la
   * MOD a 1.4 bar è a 56 m e a quaranta metri non succede niente — così la
   * prova guarda più di una famiglia di avvisi.
   */
  const piano = planGas({
    ...DEFAULT_PLAN,
    depthM: 40,
    avgDepthM: 32,
    bottomMin: 40,
    totalMin: 50,
    tankL: 10,
    startBar: 200,
    rmvLpm: 20,
    mix: { o2: 0.36, he: 0 },
  });

  it('produce avvisi, o questa prova non prova niente', () => {
    expect(piano.warnings.length).toBeGreaterThan(0);
  });

  it('nessuno resta in italiano, e nessun segnaposto resta vuoto', () => {
    for (const w of piano.warnings) {
      const en = testoAvvertenza(w, inglese);
      const it = testoAvvertenza(w, comeSta);
      expect(en, `«${it}» non ha una forma inglese`).not.toBe(it);
      expect(en, `segnaposto non riempito in «${en}»`).not.toMatch(/\{\d+\}/);
    }
  });

  it('e i numeri arrivano fino alla frase inglese', () => {
    const testi = piano.warnings.map((w) => testoAvvertenza(w, inglese)).join(' ');
    // La quota pianificata compare nell'avviso della MOD, in inglese.
    expect(testi).toMatch(/At 40 m this mix goes past the PPO2 limit/);
  });
});

describe('un piano di decompressione fuori limite, letto in inglese', () => {
  /*
   * Aria a 60 metri per 25 minuti: PPO2 di lavoro oltre il limite, END oltre i
   * quaranta, e soste obbligate. È il caso in cui gli avvisi SONO la ragione per
   * cui la pagina esiste.
   */
  const soste = planDeco([{ depthM: 60, minutes: 25 }], [{ mix: { o2: 0.21, he: 0 }, role: 'bottom' }]);

  it('produce avvisi, o questa prova non prova niente', () => {
    expect(soste.warnings.length).toBeGreaterThan(0);
  });

  it('PPO2 ed END escono in inglese, col loro numero', () => {
    const testi = soste.warnings.map((w) => testoAvvertenza(w, inglese)).join(' | ');
    expect(testi).toMatch(/PPO2 up to [\d.]+ bar during the working phase/);
    expect(testi).toMatch(/Equivalent narcotic depth up to \d+ m/);
    expect(testi).not.toMatch(/fase di lavoro|narcotica equivalente/);
    expect(testi).not.toMatch(/\{\d+\}/);
  });

  it('e in italiano restano esattamente le frasi di prima, numeri compresi', () => {
    // Il ripiego del dizionario: senza traduzione esce la chiave, cioè
    // l'italiano. Nessuna frase si è persa passando ai modelli.
    const testi = soste.warnings.map((w) => testoAvvertenza(w, comeSta)).join(' | ');
    expect(testi).toMatch(/PPO2 fino a [\d.]+ bar in fase di lavoro/);
    expect(testi).not.toMatch(/\{\d+\}/);
  });
});

// ---------------------------------------------------------------------------
// 3. E a schermo, dove il difetto si vedeva
// ---------------------------------------------------------------------------

const finto = vi.hoisted(() => ({ valore: {} as Record<string, unknown> }));
vi.mock('../src/ui/state', () => ({ useDiveLog: () => finto.valore }));

const { Planner } = await import('../src/ui/pages/Planner');
const { ProvvedituraLingua } = await import('../src/ui/lingua');
/*
 * ► IL DIZIONARIO SI PRECARICA. ◄ `ProvvedituraLingua` lo chiede con un
 * `import()` dinamico, e la prima volta Vitest deve anche trasformare il modulo:
 * sotto carico sono centinaia di millisecondi, durante i quali `t()` restituisce
 * la chiave — cioè l'italiano. Caricandolo qui, prima di montare, il modulo è
 * già in cache e la provveditura lo riceve in un giro di eventi.
 */
await import('../src/ui/traduzioni');

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

describe('il riquadro degli avvisi del pianificatore', () => {
  it('con l’applicazione in inglese non mostra più frasi italiane', async () => {
    Object.defineProperty(window.navigator, 'language', { value: 'en-US', configurable: true });
    const dives: Dive[] = [];
    finto.valore = {
      dives,
      scope: { dives, period: periodOf('12m'), all: dives },
      period: '12m',
      setPeriod: () => undefined,
      // Lo stesso piano impossibile di sopra: serve che gli avvisi ci siano.
      gasInput: {
        depthM: 40,
        avgDepthM: 32,
        bottomMin: 40,
        totalMin: 50,
        tankL: 10,
        startBar: 200,
        rmvLpm: 20,
        mix: { o2: 0.36, he: 0 },
      },
      saveGasInput: () => undefined,
      decoInput: null,
      saveDecoInput: () => undefined,
      decoPlans: [],
      saveNamedDecoPlan: async () => undefined,
      deleteNamedDecoPlan: async () => undefined,
    };

    const { host, smonta } = monta(
      <ProvvedituraLingua>
        <Planner />
      </ProvvedituraLingua>,
    );
    try {
      /*
       * Il dizionario arriva con un `import()` dinamico: finché non è arrivato
       * `t()` restituisce la chiave, cioè l'italiano — ed è proprio il ripiego
       * che ha reso questo difetto invisibile tanto a lungo. Si aspetta che sia
       * arrivato davvero, guardando lo schermo.
       */
      for (let giro = 0; giro < 200 && !(host.textContent ?? '').includes('Worth knowing'); giro++) {
        await act(async () => {
          await new Promise((risolvi) => setTimeout(risolvi, 5));
        });
      }
      const riquadri = [...host.querySelectorAll('.notice')].map((n) => n.textContent ?? '');
      const conAvviso = riquadri.filter((r) => /Worth knowing|This plan does not hold/.test(r));
      expect(
        conAvviso.length,
        'nessun riquadro di avviso: la prova guarda il posto sbagliato',
      ).toBeGreaterThan(0);

      const testo = conAvviso.join(' | ');
      // ► IL DIFETTO. ◄ «Worth knowing:» seguito da una frase italiana intera.
      expect(testo).not.toMatch(/questa miscela supera il limite/);
      expect(testo).not.toMatch(/Il gas basta per|Uscita prevista a/);
      expect(testo).not.toMatch(/\{\d+\}/);
      // E almeno uno degli avvisi si legge davvero in inglese.
      expect(testo).toMatch(/this mix goes past the PPO2 limit|The gas is enough for|Expected exit at/);
    } finally {
      smonta();
    }
  });
});
