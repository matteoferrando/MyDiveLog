// @vitest-environment jsdom
/**
 * L'ora che scorre in cima al logbook.
 *
 * ► IL DIFETTO. ◄ `nextDiveBriefing` prende `now` come parametro proprio per non
 * leggere l'orologio da sé: sta scritto in testa a quella funzione, ed è ciò che
 * la rende provabile. Poi l'interfaccia lo leggeva **durante il render**, dentro
 * una `useMemo` che dipende solo dalle immersioni — e il tempo si congelava al
 * primo disegno.
 *
 * Cosa faceva davvero: chi apre l'applicazione mezz'ora dopo essere risalito
 * legge «30 minuti dall'ultima immersione», e sei ore più tardi, con la finestra
 * ancora aperta, continua a leggere trenta minuti. Da `now` dipendono le ore
 * dall'ultima immersione, **la CNS residua dopo l'intervallo di superficie** e
 * l'immersione ripetitiva ipotetica.
 *
 * *Non era una data in un angolo: era un conto che parla del presente e che del
 * presente non sapeva niente.* Nessuna prova poteva prenderlo, perché il difetto
 * non stava nel calcolo — il calcolo era giusto, sul numero sbagliato.
 *
 * L'aveva segnalato il lint, come «funzione impura durante il render», in mezzo
 * ad altri tredici avvisi che nessuno leggeva più.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { useOraCorrente } from '../src/ui/pages/Logbook';

/** Monta l'hook e restituisce cosa ha risposto, giro per giro. */
function monta(passoMs?: number) {
  const letture: number[] = [];
  function Sonda() {
    letture.push(useOraCorrente(passoMs));
    return null;
  }
  const nodo = document.createElement('div');
  document.body.appendChild(nodo);
  const radice = createRoot(nodo);
  act(() => radice.render(<Sonda />));
  return {
    letture,
    smonta: () => {
      act(() => radice.unmount());
      nodo.remove();
    },
  };
}

describe('l’ora in cima al logbook', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-01T09:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('parte dall’ora vera', () => {
    const { letture, smonta } = monta();
    expect(letture[0]).toBe(Date.parse('2026-09-01T09:00:00Z'));
    smonta();
  });

  it('dopo sei ore non dice più che è passata mezz’ora', () => {
    // È il caso del difetto, raccontato in numeri: la finestra resta aperta e
    // l'ora deve muoversi con l'orologio, non con i render.
    const { letture, smonta } = monta();
    const inizio = letture[0];

    act(() => {
      vi.advanceTimersByTime(6 * 3600_000);
    });

    const adesso = letture[letture.length - 1];
    expect(Math.round((adesso - inizio) / 3600_000)).toBe(6);
    smonta();
  });

  it('si aggiorna quando la finestra torna in primo piano', () => {
    // Il momento vero in cui qualcuno riguarda. Senza, dopo un pomeriggio in
    // secondo piano si aspetterebbe fino a un minuto per vedere un numero
    // giusto — e il minuto lo si passa a guardare un numero falso.
    const { letture, smonta } = monta(60_000);
    const inizio = letture[0];

    // Si sposta l'orologio SENZA far scattare il battito: sotto il passo.
    act(() => {
      vi.setSystemTime(new Date('2026-09-01T09:00:30Z'));
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(letture[letture.length - 1] - inizio).toBe(30_000);
    smonta();
  });

  it('il logbook la usa davvero, e non rilegge l’orologio durante il render', () => {
    // ► LE PROVE QUI SOPRA REGGONO ANCHE SE NESSUNO USA L'HOOK. ◄ Difendono
    // che funzioni, non che sia collegato: si può lasciarlo lì, rimettere
    // `Date.now()` dentro la `useMemo`, e restare tutti verdi. Questa riga
    // guarda il punto d'innesto, che è dove il difetto stava.
    // `process.cwd()` e non `import.meta.url`: sotto jsdom quell'URL non è un
    // percorso di file — è `http://localhost/` — e `readFileSync` si rifiuta.
    // La riga dopo pretende di aver letto qualcosa: un percorso sbagliato che
    // restituisse una stringa vuota farebbe passare tutte e due le condizioni.
    const sorgente = readFileSync(join(process.cwd(), 'src/ui/pages/Logbook.tsx'), 'utf8');
    expect(sorgente.length, 'il sorgente del logbook non è stato letto').toBeGreaterThan(1000);
    expect(sorgente).toMatch(/nextDiveBriefing\(dives, undefined, ora, t\)/);
    expect(
      /nextDiveBriefing\([^)]*Date\.now\(\)/.test(sorgente),
      'l’orologio è tornato dentro la chiamata: il tempo si congela al primo render',
    ).toBe(false);
  });

  it('smontata, smette di battere e si toglie l’orecchio', () => {
    // ► LE LETTURE NON BASTANO A VEDERE QUESTA PERDITA. ◄ Il primo tentativo
    // smontava, faceva passare un minuto e pretendeva che non arrivassero altre
    // letture — e restava verde anche togliendo `clearInterval`, perché React
    // dopo lo smontaggio ignora `setState` in silenzio. Il battito continuava
    // davvero, e la prova non lo vedeva: guardava l'effetto, che è soppresso,
    // invece della causa, che è il timer.
    //
    // Un intervallo che sopravvive al componente non dà errore e non si vede
    // subito: si vede dopo ore, come lentezza, ed è precisamente il genere di
    // difetto che nessuno collega a niente.
    const primaDelMontaggio = vi.getTimerCount();
    const spia = vi.spyOn(document, 'removeEventListener');
    const { smonta } = monta(1000);
    expect(vi.getTimerCount(), 'il battito non è mai partito').toBeGreaterThan(primaDelMontaggio);

    smonta();

    expect(vi.getTimerCount(), 'il battito continua dopo lo smontaggio').toBe(primaDelMontaggio);
    expect(
      spia.mock.calls.some(([evento]) => evento === 'visibilitychange'),
      'l’orecchio sul ritorno in primo piano non viene tolto',
    ).toBe(true);
    spia.mockRestore();
  });
});
