// @vitest-environment jsdom
/**
 * Il confine fra l'applicazione e il guscio Rust, guardato dal lato di qua.
 *
 * ► PERCHÉ SERVE UNA PROVA SU UN FILE CHE «NON HA NIENTE DA SBAGLIARE». ◄
 * In cima a `storage/computerEsterni.ts` c'è scritto che lì non c'è niente da
 * provare perché è solo traduzione. È vero per la forma degli eventi — quelli
 * passano senza essere toccati — e **falso per i nomi degli argomenti**: un
 * argomento che il comando Rust non riconosce non dà nessun errore, arriva
 * come `None`, e il difetto è invisibile da tutte e due le parti. Qui il
 * codice di accoppiamento sparirebbe, il PIN verrebbe richiesto a ogni
 * scarico, e non ci sarebbe nessun messaggio da nessuna parte.
 *
 * I nomi si scrivono in `camelCase` da questa parte e Tauri li converte in
 * `snake_case` per il Rust: `codiceAccesso` qui è `codice_accesso` di là. È
 * una convenzione, cioè la specie di cosa che si dimentica.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

const finto = vi.hoisted(() => ({
  chiamate: [] as { comando: string; argomenti: Record<string, unknown> }[],
  risposta: (): Promise<unknown> => Promise.resolve([]),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (comando: string, argomenti: Record<string, unknown>) => {
    finto.chiamate.push({ comando, argomenti });
    return finto.risposta();
  },
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: () => Promise.resolve(() => {}),
}));

vi.mock('../src/storage/index', () => ({ isTauri: () => true }));

const { rispondiCodicePin, scaricaDaComputerEsterno } = await import('../src/storage/computerEsterni');

beforeEach(() => {
  finto.chiamate = [];
  finto.risposta = () => Promise.resolve([]);
});

describe('gli argomenti che attraversano il confine', () => {
  it('il codice di accoppiamento arriva al comando, con il nome che il Rust si aspetta', async () => {
    await scaricaDaComputerEsterno({
      dispositivo: 'dev-1',
      nome: 'i330R',
      marca: 'Aqualung',
      modello: 'i330R',
      codiceAccesso: '0a1b2c3d',
      emit: () => {},
    });
    const chiamata = finto.chiamate.find((c) => c.comando === 'scarica_da_computer_esterno');
    expect(chiamata, 'il comando deve essere stato chiamato').toBeDefined();
    expect(chiamata!.argomenti.codiceAccesso).toBe('0a1b2c3d');
    expect(chiamata!.argomenti.prodotto).toBe('i330R');
    expect(chiamata!.argomenti.dispositivo).toBe('dev-1');
  });

  it('senza codice si manda `null`, non una stringa vuota', async () => {
    // `undefined` in un argomento di Tauri sparisce dalla serializzazione, e
    // una stringa vuota sarebbe un codice di zero byte: nessuna delle due è
    // «non ce l'ho». `null` sì.
    await scaricaDaComputerEsterno({
      dispositivo: 'dev-1',
      marca: 'Aqualung',
      modello: 'i330R',
      emit: () => {},
    });
    const chiamata = finto.chiamate.find((c) => c.comando === 'scarica_da_computer_esterno');
    expect(chiamata!.argomenti.codiceAccesso).toBeNull();

    finto.chiamate = [];
    await scaricaDaComputerEsterno({
      dispositivo: 'dev-1',
      marca: 'Aqualung',
      modello: 'i330R',
      codiceAccesso: '   ',
      emit: () => {},
    });
    expect(
      finto.chiamate.find((c) => c.comando === 'scarica_da_computer_esterno')!.argomenti.codiceAccesso,
    ).toBeNull();
  });

  it('la risposta al PIN passa dal comando giusto, cifre o rinuncia che sia', async () => {
    await rispondiCodicePin('482915');
    await rispondiCodicePin(null);
    expect(finto.chiamate.map((c) => [c.comando, c.argomenti.pin])).toEqual([
      ['rispondi_codice_pin', '482915'],
      ['rispondi_codice_pin', null],
    ]);
  });

  it('un guasto della risposta al PIN non si propaga', async () => {
    /*
     * A quel punto lo scarico è già finito male per conto suo, e un errore
     * lanciato da qui coprirebbe quello vero con uno che non spiega niente.
     */
    finto.risposta = () => Promise.reject(new Error('il guscio non c’è più'));
    await expect(rispondiCodicePin('482915')).resolves.toBeUndefined();
  });
});
