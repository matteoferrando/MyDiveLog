// @vitest-environment jsdom
/**
 * NESSUN NUMERO A SCHERMO PORTA LA CODA DELLA VIRGOLA MOBILE.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * ► IL DIFETTO, visto il 17 settembre 2026 in una schermata del pianificatore. ◄
 *
 * Sotto il campo della bombola c’era scritto:
 *
 *     3982.0000000000005 L di gas
 *
 * Non è un errore di calcolo: `18.1 * 220` in JavaScript fa esattamente quello,
 * perché 18,1 non esiste in binario. Ma chi legge non vede i binari: vede
 * un’applicazione che sbaglia a contare il gas che si porta sott’acqua, e su un
 * numero come quello la fiducia non si recupera spiegando lo standard IEEE 754.
 *
 * ► PERCHÉ NON L’AVEVA PRESO NESSUNA PROVA. ◄ Perché il valore era GIUSTO. Le
 * prove del piano controllano i litri, le pressioni, i minuti — e 3982,0000…
 * supera qualunque confronto numerico con la tolleranza. Il difetto stava solo
 * nella FORMA del numero disegnato, e la forma non la guarda nessun `expect`
 * sui dati: si vede aprendo la pagina.
 *
 * ► E NON ERA UN POSTO SOLO. ◄ Scrivendo questa prova è venuto fuori il gemello:
 * la riga «200 bar × 18,1 L = 3982,0000000000005 L a bordo», nella spiegazione
 * del consumo. Stessa moltiplicazione, stessa coda, altra pagina — ed è il
 * motivo per cui qui sotto non si controlla un campo ma TUTTO il testo della
 * pagina: il prossimo prodotto con la coda sarà da un’altra parte ancora.
 *
 * ► COSA CONTROLLA QUESTA PROVA. ◄ Monta il pianificatore con una bombola da
 * 18,1 L — il caso che ha prodotto il difetto — e rilegge tutto il testo
 * cercando numeri con la coda.
 *
 * ► PERCHÉ QUATTRO CIFRE E NON TRE. ◄ Non per prudenza: per non litigare con le
 * migliaia. In italiano 3982 si scrive «3.982», e un separatore seguito da tre
 * cifre è esattamente la forma di un gruppo di migliaia — cercando da tre in su
 * questa prova accuserebbe ogni numero sopra il migliaio. Da quattro in su
 * l’ambiguità sparisce: un gruppo di migliaia ha sempre tre cifre esatte,
 * l’applicazione non mostra mai più di due decimali veri (26.4 m, 17.2 L/min,
 * 1.4 bar), e una coda binaria non è mai corta — `200 * 18.1` ne produce
 * tredici, perché JavaScript stampa la forma più breve che rilegge lo stesso
 * numero, e quella forma o è pulita o è lunga.
 */

import { describe, expect, it, vi } from 'vitest';
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';

import { computeMetrics } from '../src/core/analysis/metrics';
import { periodOf } from '../src/core/analysis/window';
import { AIR, type Dive, type Sample } from '../src/core/model';

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
 * Un archivio con profilo e pressioni: serve perché il pianificatore misuri un
 * consumo vero e scriva le righe che spiegano da dove viene — è in una di quelle
 * righe che si nascondeva il secondo numero con la coda.
 */
function archivio(n: number): Dive[] {
  const GIORNO = 86_400_000;
  const ora = Date.now();
  return Array.from({ length: n }, (_, i) => {
    const inizio = new Date(ora - (5 + (n - 1 - i) * 10) * GIORNO);
    const samples: Sample[] = Array.from({ length: 240 }, (_, k) => ({
      t: k * 10,
      depth: Math.max(0, 28 - Math.abs(120 - k) * 0.22),
      tempC: 17,
      pressureBar: [200 - k * 0.5],
    }));
    const dive: Dive = {
      id: `v${i}`,
      number: i + 1,
      startTime: inizio.toISOString(),
      durationS: 2400,
      maxDepth: 28,
      minTempC: 17,
      site: { name: 'Punta Chiappa' },
      mode: 'oc',
      cylinders: [{ mix: AIR, sizeL: 12, startBar: 200, endBar: 80 }],
      salinity: 'salt',
      source: { format: 'uddf', file: 'sintetico', importedAt: inizio.toISOString() },
      tags: [],
      samples,
    };
    dive.metrics = computeMetrics(dive);
    return dive;
  });
}

/** La finestra che le pagine leggono, costruita sulle immersioni che le si danno. */
function finestra(dives: Dive[]) {
  return {
    period: periodOf('12m'),
    dives,
    excluded: 0,
    from: dives[0]?.startTime,
    to: dives[dives.length - 1]?.startTime,
  };
}

/**
 * I numeri con quattro o più cifre dopo il separatore, come compaiono a schermo.
 *
 * ► PERCHÉ NON `textContent`. ◄ Perché `textContent` incolla i pezzi vicini senza
 * lo spazio che li separa a schermo: «3.99» accanto a «14» diventa «3.9914», che
 * ha tre decimali e non è mai esistito. Si guardano i nodi di testo uno per uno
 * — ognuno è un pezzo solo — e le finte code spariscono senza dover scrivere
 * eccezioni.
 */
function codeDellaVirgola(radice: HTMLElement): string[] {
  const fuori: string[] = [];
  const cammino = document.createTreeWalker(radice, NodeFilter.SHOW_TEXT);
  for (let n = cammino.nextNode(); n; n = cammino.nextNode()) {
    for (const m of (n.textContent ?? '').matchAll(/\d+[.,]\d{4,}/g)) fuori.push(m[0]);
  }
  return fuori;
}

/** Scrive in un campo come fa una persona, passando dal setter nativo di React. */
function scrivi(campo: HTMLInputElement, valore: string) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
    setter.call(campo, valore);
    campo.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('i numeri disegnati', () => {
  it('non mostrano la coda della virgola mobile, nemmeno con una bombola da 18,1 L', () => {
    const dives = archivio(8);
    finto.valore = {
      dives,
      scope: finestra(dives),
      period: '12m',
      setPeriod: () => undefined,
      gasInput: null,
      saveGasInput: () => undefined,
      decoInput: null,
      saveDecoInput: () => undefined,
      decoPlans: [],
      saveNamedDecoPlan: async () => undefined,
      deleteNamedDecoPlan: async () => undefined,
    };
    const vista = monta(<Planner />);

    const campo = [...vista.host.querySelectorAll('input')].find(
      (i) => i.getAttribute('aria-label') === 'Volume in litri',
    );
    expect(campo, 'il campo del volume non c’è più: il selettore va aggiornato').toBeTruthy();

    scrivi(campo!, '18.1');

    const code = codeDellaVirgola(vista.host);
    expect(code, `numeri con la coda: ${code.join(', ')}`).toEqual([]);
    vista.smonta();
  });
});
