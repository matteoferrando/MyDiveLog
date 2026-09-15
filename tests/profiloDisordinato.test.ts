/**
 * QUELLO CHE ARRIVA DALL'ARCHIVIO NON È QUELLO CHE CI SI ASPETTA.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Due difetti trovati il 15 settembre 2026, diversi in tutto tranne che nella
 * forma: un valore che nessuno aveva pensato di poter ricevere entrava nel
 * motore e ne usciva un numero **plausibile e falso**. Non un errore, non un
 * `NaN` che si vede a schermo: un numero che si legge e si crede.
 *
 *  1. **Campioni fuori ordine.** `computeMetrics` li ordina, `runProfile` no —
 *     e sono le due metà dell'analisi della stessa immersione. Un orologio che
 *     salta indietro a metà immersione, o un lettore che consegna i blocchi
 *     nell'ordine del documento, facevano uscire **60.7 minuti di obbligo
 *     decompressivo su un'immersione di 34.3 minuti**. Sulla stessa scheda, la
 *     profondità media era giusta.
 *
 *  2. **Pressione di superficie a zero.** Quattro lettori possono produrla da
 *     un campo azzerato del computer. Sulla singola immersione l'errore va
 *     verso l'alto ed è innocuo; sull'intervallo di superficie va verso il
 *     basso e vale tutto: i tessuti si lavavano **sotto il vuoto**, e la
 *     ripetitiva ripartiva da pulito quando non lo era.
 */

import { describe, expect, it } from 'vitest';
import { desaturate, gf99, runProfile, surfacedTissues } from '../src/core/analysis/buhlmann';
import { ATM_BAR, pressioneDiSuperficie } from '../src/core/units';
import type { Sample } from '../src/core/model';

/** Un'immersione quadra a 42 m: discesa, fondo, risalita. In ordine. */
const PROFILO: Sample[] = (() => {
  const out: Sample[] = [];
  for (let t = 0; t <= 2060; t += 20) {
    out.push({
      t,
      depth: t < 180 ? (t / 180) * 42 : t < 1800 ? 42 : Math.max(0, 42 - ((t - 1800) / 260) * 42),
    });
  }
  return out;
})();

const analizza = (sm: Sample[]) => {
  const r = runProfile(sm, {});
  return {
    gf99: Math.round(r.gf99Max * 10) / 10,
    tetto: Math.round(r.maxCeilingM * 10) / 10,
    obbligo: Math.round(r.decoMinutes * 10) / 10,
  };
};

describe('l’ordine dei campioni non cambia il risultato', () => {
  const atteso = analizza(PROFILO);

  it('il profilo in ordine è la verità di riferimento, e ha senso', () => {
    // Se questa riga cade, tutte le altre confrontano con un riferimento rotto.
    expect(atteso.obbligo).toBeGreaterThan(0);
    // Un obbligo più lungo dell'immersione è impossibile: 2060 s sono 34.3 min.
    expect(atteso.obbligo).toBeLessThan(2060 / 60);
  });

  it('un campione di superficie scritto per primo non sposta niente', () => {
    expect(analizza([{ t: 2060, depth: 0 }, ...PROFILO])).toEqual(atteso);
  });

  it('un orologio che salta indietro di cinque minuti a metà non sposta niente', () => {
    /*
     * Non è un caso di scuola: è quello che fa un computer subacqueo quando la
     * batteria si scarica a metà immersione e l'orologio si riazzera, ed è il
     * motivo per cui esiste `inferClockOffsets` in `dedupe.ts`.
     */
    const storto = PROFILO.map((s, i) => (i > 50 && i < 60 ? { ...s, t: s.t - 300 } : s));
    expect(analizza(storto)).toEqual(atteso);
  });

  it('il blocco della risalita scritto prima di quello del fondo non sposta niente', () => {
    // È il caso che dava 60.7 minuti d'obbligo su 34.3 di immersione.
    const rovesciato = [...PROFILO.slice(90), ...PROFILO.slice(0, 90)];
    expect(analizza(rovesciato)).toEqual(atteso);
  });

  it('due campioni allo stesso istante danno lo stesso risultato in qualunque ordine', () => {
    // Capita nei file compilati a mano, dove l'ora si scrive al minuto. Senza un
    // criterio di spareggio il risultato dipenderebbe da come il lettore ha
    // letto il file, e cambierebbe da un avvio all'altro.
    const a: Sample[] = [...PROFILO, { t: 1000, depth: 30 }, { t: 1000, depth: 41 }];
    const b: Sample[] = [...PROFILO, { t: 1000, depth: 41 }, { t: 1000, depth: 30 }];
    expect(analizza(a)).toEqual(analizza(b));
  });
});

describe('una pressione di superficie impossibile non lava i tessuti', () => {
  it('lo zero, che è il valore che i lettori producono davvero, torna a quella standard', () => {
    // `??` non lo intercetta: è il motivo per cui questa funzione esiste.
    expect(pressioneDiSuperficie(0)).toBe(ATM_BAR);
    expect(pressioneDiSuperficie(undefined)).toBe(ATM_BAR);
    expect(pressioneDiSuperficie(NaN)).toBe(ATM_BAR);
    expect(pressioneDiSuperficie(-1)).toBe(ATM_BAR);
    expect(pressioneDiSuperficie(50)).toBe(ATM_BAR);
    // E una quota vera passa: 0.795 bar sono duemila metri, e chi si immerge in
    // un lago alpino ha ragione di aspettarsi che il numero venga usato.
    expect(pressioneDiSuperficie(0.795)).toBe(0.795);
    expect(pressioneDiSuperficie(1.013)).toBe(1.013);
  });

  it('l’intervallo di superficie non scarica più del dovuto', () => {
    /*
     * ► IL VERSO PERICOLOSO. ◄ Con zero, `desaturate` faceva scendere l'azoto
     * dei tessuti SOTTO l'equilibrio: un'ora di superficie li riportava a un
     * GF99 di zero dove il valore vero era 35.6, e la ripetitiva partiva da
     * pulito. È l'unico caso in cui l'errore di questo campo va nella direzione
     * che toglie margine invece di aggiungerlo.
     */
    const dopoImmersione = runProfile(PROFILO, {}).state;
    const vero = desaturate(dopoImmersione, 60, ATM_BAR);
    const conZero = desaturate(dopoImmersione, 60, 0);
    expect(gf99(conZero, ATM_BAR).percent).toBeCloseTo(gf99(vero, ATM_BAR).percent, 6);
    // E il numero non è zero: l'ora di superficie non ha lavato niente del tutto.
    expect(gf99(vero, ATM_BAR).percent).toBeGreaterThan(10);
  });

  it('i tessuti d’ingresso non partono più vuoti del vuoto', () => {
    const conZero = surfacedTissues(0);
    expect(Math.min(...conZero.n2)).toBeGreaterThan(0);
    expect(conZero.n2).toEqual(surfacedTissues(ATM_BAR).n2);
  });
});
