// @vitest-environment jsdom
/**
 * L'INDICE LATERALE: che ci sia dove serve, che non ci sia dove no, e che apra.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ► LE TRE COSE CHE POSSONO ANDARE STORTE, e perché nessuna si vede leggendo. ◄
 *
 *  1. **L'indice resta vuoto.** I capitoli si registrano da soli: basta che il
 *     nodo arrivi in un `ref` invece che in uno stato e l'effetto gira una volta
 *     con `null` in mano. La pagina funziona, l'indice non c'è, e niente lo
 *     dice — è successo scrivendo questo componente, e si è visto solo perché
 *     un test lo ha contato.
 *
 *  2. **L'indice compare dove è arredamento.** Su una pagina da cinque capitoli
 *     l'indice è più lungo del contenuto che indicizza; sul computer, dove le
 *     carte sono già tutte aperte, non indicizza niente.
 *
 *  3. **Il tocco porta davanti a un riquadro chiuso.** È il difetto peggiore
 *     dei tre: *l'azione sembra fatta e non è successo niente.*
 *
 * `scrollIntoView` non esiste in jsdom e va finto, altrimenti il clic lancia e
 * la prova diventa rossa per il motivo sbagliato.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { CartaApribile } from '../src/ui/components/CartaApribile';
import { ProvvedituraCapitoli, dimenticaSezioniAperte, statoDiApertura } from '../src/ui/components/capitoli';
import { MINIMO_CAPITOLI, NavigatoreSezioni } from '../src/ui/components/NavigatoreSezioni';

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

/** Una pagina finta con `quanti` capitoli, dentro la sua provveditura. */
function pagina(quanti: number) {
  return (
    <ProvvedituraCapitoli>
      <div className="main">
        {Array.from({ length: quanti }, (_, i) => (
          <CartaApribile key={i} chiave={`c${i}`} titolo={`Capitolo ${i}`} sommario={`${i} cose`}>
            <p>corpo {i}</p>
          </CartaApribile>
        ))}
      </div>
      <NavigatoreSezioni />
    </ProvvedituraCapitoli>
  );
}

const punti = (host: HTMLElement) => [...host.querySelectorAll('.navigatore-sezioni .punto')];

beforeEach(() => {
  dimenticaSezioniAperte();
  // jsdom non ce l'ha, e senza il clic lancia invece di navigare.
  Element.prototype.scrollIntoView = () => {};
});
afterEach(() => {
  for (const smonta of montati.splice(0)) smonta();
  Object.defineProperty(window, 'matchMedia', { writable: true, configurable: true, value: undefined });
});

describe('l’indice laterale', () => {
  it('elenca tutti i capitoli della pagina, nell’ordine in cui stanno', () => {
    fingiLarghezza(false);
    const host = monta(pagina(8));
    expect(punti(host).length, 'l’indice è vuoto su una pagina con otto capitoli').toBe(8);
    expect(punti(host).map((b) => b.getAttribute('aria-label'))).toEqual([
      'Capitolo 0',
      'Capitolo 1',
      'Capitolo 2',
      'Capitolo 3',
      'Capitolo 4',
      'Capitolo 5',
      'Capitolo 6',
      'Capitolo 7',
    ]);
  });

  /*
   * ► I NUMERI SONO SCRITTI A MANO, e la prima stesura li leggeva dalla
   *   costante. ◄
   *
   * Diceva `pagina(MINIMO_CAPITOLI - 1)`, che sembra più pulito ed è una
   * guardia che non guarda: misurato portando la soglia da 6 a 1, **restava
   * verde** — perché il caso provato diventava «zero capitoli», dove l'indice
   * non c'è comunque. *Una prova che legge il valore che deve controllare non
   * può vederlo cambiare.*
   *
   * Cinque e sei sono i due lati della soglia, scritti qui. Cambiarla è
   * legittimo; cambiarla senza accorgersene no.
   */
  it('con cinque capitoli non c’è, con sei sì', () => {
    fingiLarghezza(false);
    expect(monta(pagina(5)).querySelector('.navigatore-sezioni')).toBeNull();
    expect(monta(pagina(6)).querySelector('.navigatore-sezioni')).not.toBeNull();
  });

  it('la soglia è sei, e spostarla è una scelta da fare apposta', () => {
    expect(MINIMO_CAPITOLI).toBe(6);
  });

  it('non compare sul computer, nemmeno con venti capitoli', () => {
    /*
     * Sopra i 700 px le carte non si registrano affatto — vedi `CartaApribile`,
     * che passa `null` al registro quando non siamo sul telefono. Non è una
     * scelta di CSS: l'indice non esiste proprio, e quindi non c'è niente che
     * un lettore di schermo debba attraversare.
     */
    fingiLarghezza(true);
    const host = monta(pagina(20));
    expect(host.querySelector('.navigatore-sezioni')).toBeNull();
    // E il riquadro sul computer non ha nemmeno il pulsante per aprirsi: è la
    // carta di sempre. Se un giorno qualcuno gli attaccasse il `ref` che serve
    // alla registrazione, l'indice comparirebbe sul Mac e questa riga sarebbe
    // l'unica ad accorgersene.
    expect(host.querySelectorAll('.carta-apribile').length).toBe(0);
    expect(host.querySelectorAll('.apri-sezione').length).toBe(0);
  });

  it('uno e uno solo è quello corrente', () => {
    /*
     * ► SI CONTA, NON SI NOMINA, e la prima stesura nominava. ◄
     *
     * Diceva «il primo è quello corrente», ed era rossa: in jsdom ogni
     * `getBoundingClientRect()` restituisce zeri, quindi tutti i capitoli
     * risultano sopra la soglia e il corrente diventa l'ultimo. Non è un
     * difetto del componente — è che jsdom non ha un layout — e una prova che
     * pretende una posizione da un ambiente senza posizioni misura jsdom, non
     * l'indice.
     *
     * Quello che invece è vero in qualunque ambiente, e che conta davvero: di
     * evidenziato ce n'è **esattamente uno**. Due sarebbero due «sei qui»
     * contemporanei; zero sarebbe un indice che non dice dove si è.
     */
    fingiLarghezza(false);
    const host = monta(pagina(7));
    expect(punti(host).filter((b) => b.getAttribute('aria-current') === 'true').length).toBe(1);
  });

  it('toccare un punto APRE il capitolo, non solo ci porta davanti', () => {
    fingiLarghezza(false);
    const host = monta(pagina(7));
    expect(statoDiApertura('c4'), 'il quinto capitolo parte aperto: la prova non misura niente').not.toBe(
      true,
    );
    act(() => (punti(host)[4] as HTMLButtonElement).click());
    expect(statoDiApertura('c4'), 'l’indice ha portato davanti a un riquadro chiuso').toBe(true);
    expect(punti(host)[4]!.getAttribute('aria-current')).toBe('true');
  });

  it('il capitolo aperto dall’indice si disegna davvero aperto', () => {
    /*
     * L'altra metà della prova sopra, e non è la stessa cosa: la mappa può dire
     * «aperto» mentre il riquadro resta disegnato chiuso, se nessuno avvisa il
     * componente. È esattamente il difetto che gli ascoltatori di `capitoli.tsx`
     * esistono per evitare, e senza questa riga nessuno lo verificherebbe.
     */
    fingiLarghezza(false);
    const host = monta(pagina(7));
    const corpi = () => [...host.querySelectorAll('.carta-apribile [id]')];
    expect(corpi()[3]!.hasAttribute('hidden')).toBe(true);
    act(() => (punti(host)[3] as HTMLButtonElement).click());
    expect(corpi()[3]!.hasAttribute('hidden'), 'la mappa dice aperto, il riquadro è chiuso').toBe(false);
  });

  it('premere un punto mostra il nome del capitolo e il suo numero', () => {
    fingiLarghezza(false);
    const host = monta(pagina(7));
    expect(host.querySelector('.navigatore-nome')).toBeNull();
    // React ascolta `focusin` alla radice, non `focus`: un `focus` che non
    // rimbalza non arriva a `onFocus` e la prova misurerebbe il nulla.
    act(() => {
      punti(host)[2]!.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    });
    const nome = host.querySelector('.navigatore-nome');
    expect(nome?.textContent).toContain('Capitolo 2');
    expect(nome?.textContent, 'il nome c’è ma il numero no: è un indice senza informazione').toContain(
      '2 cose',
    );
  });
});
