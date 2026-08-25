// @vitest-environment jsdom
/**
 * Il confine d'errore mantiene quello che promette: «Le altre schede funzionano».
 *
 * ► PERCHÉ ESISTE QUESTO FILE. ◄ `ErrorBoundary` è un componente a classe che
 * tiene l'errore nel proprio stato, e uno stato non si azzera da solo: una
 * volta scattato, quel componente mostra la schermata rotta finché qualcuno non
 * lo SMONTA. Nell'albero dell'applicazione il confine è lo stesso elemento per
 * tutte le schede, quindi cambiando scheda React lo conservava — e il messaggio
 * che invita ad andare altrove restava a schermo mentre andare altrove non
 * serviva a niente.
 *
 * È il difetto che costa più di quello che sembra: non rompe una funzione, rompe
 * la fiducia. Chi legge «le altre schede funzionano», prova, e trova la stessa
 * pagina rotta, non crede più nemmeno al messaggio successivo.
 *
 * Il rimedio è una `key` legata alla scheda corrente. La prova quindi non
 * guarda il codice: naviga davvero: fa esplodere una pagina, preme un'altra
 * scheda, e controlla che la pagina nuova ci sia. Una prova sulla presenza
 * della `key` passerebbe anche con la chiave sbagliata.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

/*
 * Le pagine vere non servono e costerebbero l'archivio intero. Ne bastano due:
 * una che esplode — è l'unico modo di far scattare un confine d'errore, che per
 * definizione reagisce a un'eccezione durante il disegno — e una sana su cui
 * atterrare.
 */
vi.mock('../src/ui/pages/Stats', () => ({
  Stats: () => {
    throw new Error('un dato d’archivio rovinato');
  },
}));
vi.mock('../src/ui/pages/Logbook', () => ({
  Logbook: () => <div>il logbook, sano come prima</div>,
}));
vi.mock('../src/ui/state', () => ({
  useDiveLog: () => ({ ready: true, dives: [{ id: 'imm-1' }], initError: undefined }),
}));

const { App } = await import('../src/ui/App');

/**
 * jsdom non implementa `scrollIntoView`, e la barra in alto lo chiama sulla
 * scheda corrente a ogni disegno: senza questa riga il primo render esplode per
 * un motivo che non c'entra niente con quello che si sta provando.
 */
beforeEach(() => {
  Element.prototype.scrollIntoView = () => {};
  // React scrive sulla console ogni errore catturato da un confine: qui gli
  // errori sono il soggetto della prova, e il rumore nasconderebbe i guasti veri.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

async function apri() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<App />);
  });
  return { host, smonta: () => act(() => root.unmount()) };
}

/** Preme una voce della navigazione e aspetta che la pagina pigra arrivi. */
async function vaiA(host: HTMLElement, etichetta: string) {
  const voce = [...host.querySelectorAll('nav.nav button')].find(
    (b) => (b.textContent ?? '').trim() === etichetta,
  );
  if (!voce) throw new Error(`nella navigazione non c'è «${etichetta}»`);
  await act(async () => {
    voce.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  // Il secondo giro serve al `lazy`: il primo `act` risolve l'import, il
  // contenuto compare al disegno successivo.
  await act(async () => {});
}

describe('il confine d’errore si azzera cambiando scheda', () => {
  it('una scheda che esplode non porta con sé le altre', async () => {
    const { host, smonta } = await apri();
    try {
      expect(host.textContent).toContain('il logbook, sano come prima');

      await vaiA(host, 'Statistiche');
      expect(host.textContent).toContain('Qualcosa si è rotto in questa pagina');

      // La promessa scritta nel riquadro. Se cambia, deve cambiare anche qui:
      // è il testo di cui questa prova verifica la veridicità.
      expect(host.textContent).toContain('Le altre schede funzionano');

      await vaiA(host, 'Logbook');
      expect(host.textContent).toContain('il logbook, sano come prima');
      expect(host.textContent).not.toContain('Qualcosa si è rotto in questa pagina');
    } finally {
      smonta();
    }
  });
});
