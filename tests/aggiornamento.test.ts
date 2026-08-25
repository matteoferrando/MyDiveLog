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
import { descriviScaricamento, percentualeScaricata } from '../src/aggiornamento/aggiornamento';
import { suComputer } from '../src/piattaforma';

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
    expect(suComputer()).toBe(false);
  });

  it('su iPhone, no — e non è una dimenticanza', () => {
    /*
     * Là gli aggiornamenti li distribuisce l'App Store. Un'applicazione che se
     * li scarica per conto suo viene rifiutata alla revisione, quindi questa
     * riga non è prudenza: è una regola del negozio.
     */
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
    vi.stubGlobal('navigator', { platform: 'iPhone', maxTouchPoints: 5 });
    expect(suComputer()).toBe(false);
  });

  /*
   * ► QUESTO È IL CASO CHE MANCAVA, ED È IL MOTIVO PER CUI LA FUNZIONE HA
   * CAMBIATO NOME. ◄
   *
   * Si chiamava `suMac` e diceva «nell'app e non su iPhone»: giusta finché il
   * Mac era l'unico computer su cui girassimo. Con Android è diventata vera
   * anche là, dove il plugin dell'aggiornamento NON è compilato — quindi la
   * scheda sarebbe comparsa e il pulsante avrebbe risposto «comando
   * sconosciuto», che non spiega niente a nessuno.
   *
   * Android si riconosce dall'agente e non da `navigator.platform`, che là dice
   * «Linux armv8l»: vero, inutile, e indistinguibile da un computer Linux.
   */
  it('su Android, no — là l’APK si riscarica dal sito', () => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
    vi.stubGlobal('navigator', {
      platform: 'Linux armv8l',
      maxTouchPoints: 5,
      userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36',
    });
    expect(suComputer()).toBe(false);
  });

  it('nell’applicazione del Mac, sì', () => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
    vi.stubGlobal('navigator', { platform: 'MacIntel', maxTouchPoints: 0 });
    expect(suComputer()).toBe(true);
  });

  it('nell’applicazione di Windows, sì — e prima era no', () => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
    vi.stubGlobal('navigator', {
      platform: 'Win32',
      maxTouchPoints: 0,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    });
    expect(suComputer()).toBe(true);
  });
});
