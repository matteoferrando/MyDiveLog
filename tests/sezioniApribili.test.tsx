// @vitest-environment jsdom
/**
 * LE SEZIONI CHE SI APRONO: SUL TELEFONO SÌ, SUL COMPUTER NO.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ► PERCHÉ QUESTE PROVE ESISTONO. ◄
 *
 * Il 15 settembre 2026, misurando l'applicazione a 402 px — la larghezza vera
 * dell'iPhone 16 Pro — è venuto fuori quanto si scorre: Gas 14.2 schermate,
 * Logbook 13.0, Statistiche 9.0. La risposta scelta è stata «niente sparisce,
 * ma non tutto è aperto insieme».
 *
 * Una risposta così ha due modi di andare storta, e sono opposti:
 *
 *  1. **Chiudere anche sul computer**, dove il problema non c'è: là i riquadri
 *     stanno affiancati e si vedono insieme, e un pulsante da premere sarebbe
 *     un peggioramento gratuito. Peggio: un lettore di schermo annuncerebbe
 *     quattordici sezioni richiudibili che nessuno ha chiesto.
 *
 *  2. **Nascondere davvero qualcosa.** Un riquadro chiuso che non dice il suo
 *     numero è contenuto sparito con l'aria di essere lì. Il `sommario` è il
 *     numero che si legge senza aprire, ed è la riga che rende questa scelta
 *     un risparmio invece di un tocco in più.
 *
 * Il terzo modo, quello che è successo davvero: `window.matchMedia` in jsdom
 * NON esiste, e la prima versione lanciava — ventinove prove rosse in quattro
 * file, con «matchMedia is not a function». Il ripiego è «schermo largo», cioè
 * tutto aperto: *una misura che manca non autorizza a togliere.*
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { CartaApribile, dimenticaSezioniAperte } from '../src/ui/components/CartaApribile';

/** Lo stesso `monta` degli altri file di prova: React vero, DOM vero. */
const montati: (() => void)[] = [];
function monta(nodo: ReactNode) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(nodo));
  montati.push(() => {
    act(() => root.unmount());
    host.remove();
  });
  return host;
}

const bottone = (host: HTMLElement) => host.querySelector('button');
const testo = (host: HTMLElement, parola: string) => (host.textContent ?? '').includes(parola);

/** Finge `matchMedia`, che in jsdom non c'è. `largo` decide cosa risponde. */
function fingiLarghezza(largo: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: query.includes('min-width: 701px') ? largo : !largo,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
}

function togliMatchMedia() {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: undefined,
  });
}

beforeEach(() => dimenticaSezioniAperte());
afterEach(() => {
  for (const smonta of montati.splice(0)) smonta();
  togliMatchMedia();
});

const carta = (props: Partial<Parameters<typeof CartaApribile>[0]> = {}) => (
  <CartaApribile chiave="prova" titolo="Quanti bar devi avere" sommario="rientro a 163 bar" {...props}>
    <p>la tabella intera</p>
  </CartaApribile>
);

describe('sul computer il riquadro è quello di sempre', () => {
  it('nessun pulsante, e il contenuto è lì', () => {
    fingiLarghezza(true);
    const host = monta(carta());
    expect(bottone(host)).toBeNull();
    expect(host.querySelector('h2')?.textContent).toBe('Quanti bar devi avere');
    expect(testo(host, 'la tabella intera')).toBe(true);
  });

  it('e nemmeno il sommario, che sul computer sarebbe la ripetizione di un numero già a schermo', () => {
    fingiLarghezza(true);
    expect(testo(monta(carta()), 'rientro a 163 bar')).toBe(false);
  });
});

describe('sul telefono parte chiuso, e dice cosa c’è dentro', () => {
  it('il titolo è il pulsante, e il sommario si legge senza aprire', () => {
    fingiLarghezza(false);
    const host = monta(carta());
    expect(bottone(host)?.getAttribute('aria-expanded')).toBe('false');
    expect(testo(host, 'Quanti bar devi avere')).toBe(true);
    // ► LA RIGA CHE RENDE UTILE TUTTO IL RESTO. ◄ Senza, chi legge apre per
    // forza e il risparmio diventa un tocco in più.
    expect(testo(host, 'rientro a 163 bar')).toBe(true);
  });

  it('il contenuto c’è nel documento ma è nascosto, non smontato', () => {
    /*
     * `hidden` e non smontato: un grafico rimontato a ogni apertura ricalcola e
     * rianima, e chi apre e chiude due volte lo vede lampeggiare. Costa memoria
     * e non tempo, che su queste pagine è il verso giusto.
     */
    fingiLarghezza(false);
    const host = monta(carta());
    const corpo = host.querySelector('[id][hidden]');
    expect(corpo, 'il corpo deve esistere, marcato hidden').toBeTruthy();
    expect(corpo!.textContent).toContain('la tabella intera');
  });

  it('un tocco lo apre, un altro lo richiude', () => {
    fingiLarghezza(false);
    const host = monta(carta());
    const b = bottone(host)!;
    act(() => b.click());
    expect(b.getAttribute('aria-expanded')).toBe('true');
    expect(host.querySelector('[id][hidden]')).toBeNull();
    // Aperto, il sommario sparisce: sarebbe la ripetizione di un numero che sta
    // due centimetri più sotto.
    expect(testo(host, 'rientro a 163 bar')).toBe(false);
    act(() => b.click());
    expect(b.getAttribute('aria-expanded')).toBe('false');
  });

  it('`apertoDiDefault` tiene aperto il riquadro principale della pagina', () => {
    // Il modulo dei dati del pianificatore: è quello per cui si apre la pagina,
    // e chiederne l'apertura sarebbe un tocco prima di poter fare qualunque cosa.
    fingiLarghezza(false);
    const host = monta(carta({ apertoDiDefault: true }));
    expect(bottone(host)?.getAttribute('aria-expanded')).toBe('true');
    expect(host.querySelector('[id][hidden]')).toBeNull();
  });

  it('due riquadri con chiavi diverse si aprono uno per volta', () => {
    fingiLarghezza(false);
    const host = monta(
      <>
        <CartaApribile chiave="uno" titolo="Primo" sommario="1">
          <p>corpo uno</p>
        </CartaApribile>
        <CartaApribile chiave="due" titolo="Secondo" sommario="2">
          <p>corpo due</p>
        </CartaApribile>
      </>,
    );
    const bottoni = [...host.querySelectorAll('button')];
    act(() => bottoni[0].click());
    expect(bottoni[0].getAttribute('aria-expanded')).toBe('true');
    expect(bottoni[1].getAttribute('aria-expanded')).toBe('false');
  });
});

describe('quando la larghezza non si può misurare, non si nasconde niente', () => {
  it('senza `matchMedia` il riquadro è aperto e senza pulsante', () => {
    /*
     * È il caso delle prove, ed è successo davvero: la prima versione chiamava
     * `window.matchMedia(...)` senza il punto interrogativo e faceva esplodere
     * ventinove prove in quattro file. Ma la lezione vera non è «metti il punto
     * interrogativo»: è **cosa fare quando non si sa**. Tenere chiuso
     * nasconderebbe contenuto a chi non ha modo di sapere che c'è; tenere
     * aperto costa solo una pagina più lunga.
     */
    togliMatchMedia();
    const host = monta(carta());
    expect(bottone(host)).toBeNull();
    expect(testo(host, 'la tabella intera')).toBe(true);
  });
});
