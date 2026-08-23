/**
 * L'aggiornamento automatico, per la parte che si può provare senza un Mac
 * acceso e una release pubblicata.
 *
 * Il giro vero — cerca, scarica, verifica la firma, riavvia — vive dentro il
 * plugin di Tauri e non si monta in Node. Quello che si può inchiodare qui è
 * il contorno, ed è dove stanno gli sbagli veri: la percentuale quando la
 * lunghezza non c'è, e il fatto che su iPhone e nel browser non si debba
 * nemmeno provare.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { descriviScaricamento, percentualeScaricata, suMac } from '../src/aggiornamento/aggiornamento';

describe('la percentuale scaricata', () => {
  it('è indefinita quando la lunghezza totale non si sa', () => {
    /*
     * GitHub non manda sempre `Content-Length`, e una barra ferma sullo zero
     * mentre il file arriva racconta una bugia: meglio nessun numero.
     */
    expect(percentualeScaricata(1024, undefined)).toBeUndefined();
    expect(percentualeScaricata(1024, 0)).toBeUndefined();
  });

  it('arrotonda e non supera cento', () => {
    expect(percentualeScaricata(0, 200)).toBe(0);
    expect(percentualeScaricata(51, 200)).toBe(26);
    expect(percentualeScaricata(200, 200)).toBe(100);
    // Può succedere: i pezzi si sommano e l'ultimo sfora la lunghezza annunciata.
    expect(percentualeScaricata(240, 200)).toBe(100);
  });
});

describe('la frase mentre scarica', () => {
  it('senza totale dice solo che sta scaricando', () => {
    expect(descriviScaricamento(10, undefined)).toBe('Scarico l’aggiornamento…');
  });

  it('col totale aggiunge la percentuale', () => {
    expect(descriviScaricamento(50, 200)).toBe('Scarico l’aggiornamento… 25%');
  });

  it('passa dal dizionario, come tutto il resto', () => {
    const t = (frase: string) => (frase === 'Scarico l’aggiornamento…' ? 'Downloading…' : frase);
    expect(descriviScaricamento(50, 200, t)).toBe('Downloading… 25%');
  });
});

describe('dove ha senso aggiornarsi', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('nel browser, no', () => {
    // Senza `__TAURI_INTERNALS__` non siamo nell'applicazione.
    expect(suMac()).toBe(false);
  });

  it('su iPhone, no — e non è una dimenticanza', () => {
    /*
     * Là gli aggiornamenti li distribuisce l'App Store. Un'applicazione che se
     * li scarica per conto suo viene rifiutata alla revisione, quindi questa
     * riga non è prudenza: è una regola del negozio.
     */
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
    vi.stubGlobal('navigator', { platform: 'iPhone', maxTouchPoints: 5 });
    expect(suMac()).toBe(false);
  });

  it('nell’applicazione del Mac, sì', () => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
    vi.stubGlobal('navigator', { platform: 'MacIntel', maxTouchPoints: 0 });
    expect(suMac()).toBe(true);
  });
});
