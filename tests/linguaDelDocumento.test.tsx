// @vitest-environment jsdom
/**
 * LA LINGUA CHE IL DOCUMENTO DICHIARA, non quella che si vede.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ► IL DIFETTO. ◄ `index.html` nasce con `lang="it"`, perché l'applicazione è
 * scritta in italiano. La lingua però la sceglie il sistema: chi apre l'app con
 * il telefono in inglese legge «Dives logged», dentro un documento che continua
 * a dichiarare italiano.
 *
 * Non è una sfumatura da specifica. **Uno screen reader sceglie la voce e la
 * fonetica dal `lang` del documento**, quindi legge l'inglese con la pronuncia
 * italiana: non «meno elegante», proprio incomprensibile. E il pulsante EN era
 * già `aria-pressed="true"` — chi avrebbe potuto rimediare premendolo non aveva
 * nessuna ragione di farlo, perché l'app dichiarava di essere già in inglese.
 *
 * ► PERCHÉ SUCCEDEVA. ◄ Delle tre conseguenze di «che lingua parliamo» — il
 * dizionario, il locale ICU delle date, e il `lang` del documento — le prime due
 * partivano da `adotta()`, che vale anche per la lingua INIZIALE; la terza stava
 * solo dentro `cambia()`, che gira soltanto se qualcuno preme il pulsante.
 *
 * ► COSA CONTROLLA QUESTO FILE. ◄ Che le tre cose non possano più separarsi: il
 * documento dichiara la lingua di partenza, qualunque sia, e continua a seguirla
 * quando si cambia.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

import { ProvvedituraLingua, RigaLingua, useLingua } from '../src/ui/lingua';
import { LOCALE_DELLA_LINGUA, localeCorrente, registraLocale } from '../src/core/locale';

/** Finge un sistema che parla `tag`: è l'unica cosa che decide la lingua iniziale. */
function sistemaIn(tag: string) {
  Object.defineProperty(window.navigator, 'language', { value: tag, configurable: true });
}

function monta(node: React.ReactNode) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(node));
  return { host, smonta: () => act(() => root.unmount()) };
}

/** Scrive la lingua vista dal contesto, per legare il `lang` a ciò che si legge. */
function Spia() {
  const { lingua } = useLingua();
  return <p data-lingua={lingua}>{lingua === 'it' ? 'Immersioni' : 'Dives'}</p>;
}

beforeEach(() => {
  localStorage.clear();
  // Il punto di partenza è quello vero: il documento nasce italiano.
  document.documentElement.lang = 'it';
});

afterEach(() => {
  localStorage.clear();
  document.documentElement.lang = 'it';
  // Il registro del locale è stato di modulo: chi lo sposta se lo rimette.
  registraLocale(LOCALE_DELLA_LINGUA.it);
});

describe('la lingua di partenza', () => {
  it('il documento nasce dichiarando italiano, o questa prova non prova niente', () => {
    /*
     * ► LA GUARDIA DELLA GUARDIA. ◄ Tutto il file poggia su un presupposto: che
     * `index.html` dichiari `it`, e che quindi qualcuno DEBBA correggerlo per
     * chi non legge italiano. Il giorno in cui quella riga diventasse `lang=""`
     * o sparisse, le prove qui sotto continuerebbero a passare senza più
     * controllare niente.
     */
    expect(readFileSync('index.html', 'utf8')).toMatch(/<html lang="it">/);
  });

  it('con il sistema in inglese, il documento dichiara inglese', () => {
    sistemaIn('en-US');
    const { host, smonta } = monta(
      <ProvvedituraLingua>
        <Spia />
      </ProvvedituraLingua>,
    );
    // Quello che si legge e quello che il documento dichiara devono coincidere:
    // è esattamente la coppia che uno screen reader mette insieme.
    expect(host.querySelector('p')?.dataset.lingua).toBe('en');
    expect(document.documentElement.lang).toBe('en');
    smonta();
  });

  it('con il sistema in italiano resta italiano', () => {
    sistemaIn('it-IT');
    const { smonta } = monta(
      <ProvvedituraLingua>
        <Spia />
      </ProvvedituraLingua>,
    );
    expect(document.documentElement.lang).toBe('it');
    smonta();
  });

  it('e la scelta già salvata vince sul sistema, come per il dizionario', () => {
    sistemaIn('it-IT');
    localStorage.setItem('mydivelog.lingua', 'en');
    const { smonta } = monta(
      <ProvvedituraLingua>
        <Spia />
      </ProvvedituraLingua>,
    );
    expect(document.documentElement.lang).toBe('en');
    smonta();
  });

  it('dichiara la lingua insieme al locale delle date, che è l’altra metà della stessa scelta', () => {
    // Le due cose partono dallo stesso punto apposta: separate, si era già visto
    // che una delle due resta indietro. Questa riga è ciò che le tiene insieme.
    sistemaIn('en-GB');
    const { smonta } = monta(
      <ProvvedituraLingua>
        <Spia />
      </ProvvedituraLingua>,
    );
    expect(document.documentElement.lang).toBe('en');
    expect(localeCorrente()).toBe(LOCALE_DELLA_LINGUA.en);
    smonta();
  });
});

describe('il comando che cambia lingua', () => {
  /*
   * ► ERA LA COPPIA IT/EN DELLA BARRA, ED È LA RIGA DI IMPOSTAZIONI. ◄
   *
   * Il 16 settembre 2026 la coppia in alto è stata tolta: era il secondo
   * comando per la stessa cosa, e sul desktop i due si vedevano insieme. Questa
   * prova è rimasta dov'era e ha cambiato soggetto, perché la proprietà da
   * difendere non era del pulsante — è che il comando, QUALUNQUE sia, sposti
   * anche `<html lang>` e resti d'accordo con quello che mostra.
   *
   * Il difetto originale era proprio una coppia che si contraddiceva: EN
   * premuto e documento dichiarato in italiano, cioè uno screen reader che
   * legge l'inglese con la fonetica italiana e nessun modo di accorgersene
   * guardando lo schermo.
   */
  it('sposta anche la lingua del documento, e resta d’accordo con quello che mostra', () => {
    sistemaIn('it-IT');
    const { host, smonta } = monta(
      <ProvvedituraLingua>
        <RigaLingua />
        <Spia />
      </ProvvedituraLingua>,
    );
    const tendina = host.querySelector('select')!;
    expect(document.documentElement.lang).toBe('it');
    expect(tendina.value).toBe('it');

    act(() => {
      tendina.value = 'en';
      tendina.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(document.documentElement.lang).toBe('en');
    expect(tendina.value).toBe('en');
    expect(host.querySelector('p')?.dataset.lingua).toBe('en');
    smonta();
  });

  it('e nella barra non ne è rimasta una seconda copia', async () => {
    /*
     * Una guardia contro il ritorno del doppione: se qualcuno rimettesse in
     * `App.tsx` un secondo comando per la lingua, questa riga se ne accorge.
     * Si legge il sorgente e non il DOM montato, perché montare tutta
     * l'applicazione qui vorrebbe dire portarsi dietro archivio, rotte e
     * dizionario per rispondere a una domanda che sta in una riga di testo.
     */
    const { readFileSync } = await import('node:fs');
    const app = readFileSync('src/ui/App.tsx', 'utf8');
    expect(app, 'la coppia IT/EN nella barra era il doppione della riga in Impostazioni').not.toMatch(
      /<CambiaLingua\s*\/>/,
    );
  });
});
