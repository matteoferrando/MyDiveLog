/**
 * I CANALI DI TESTO CHE LA GUARDIA DEL DIZIONARIO NON PUÒ VEDERE.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ► LA FORMA, PER LA QUINTA VOLTA IN UNA SETTIMANA. ◄
 *
 * `tests/dizionario.test.ts` scorre il sorgente e pretende una voce per ogni
 * frase passata a `t()` o a `frase()` — ma `chiaviDi` vuole un **apice subito
 * dopo la parentesi**, cioè una stringa letterale. Tutto ciò che arriva a `t()`
 * come variabile le è invisibile.
 *
 * Ci sono passati: le novantuno frasi del piano di miglioramento, le righe
 * dell'avanzamento dello scarico, le dieci avvertenze delle metriche, e adesso
 * questi tre — la destinazione di ogni esportazione, i nomi dei mesi sugli assi
 * dei grafici, e le sette istruzioni «da dove si esporta».
 *
 * *La cura è sempre la stessa, ed è l'unica che funziona: costanti esportate che
 * una prova possa scorrere tutte.*
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { DESTINAZIONI } from '../src/ui/esporta';
import { MESI_ABBREVIATI } from '../src/core/analysis/aggregate';
import { etichettaMese } from '../src/ui/format';
import { INGLESE as EN } from '../src/ui/traduzioni';

const segnaposti = (s: string) => (s.match(/\{(\d+)\}/g) ?? []).sort();
const inglese = (s: string) => EN[s] ?? s;

describe('le destinazioni di un’esportazione', () => {
  it.each(DESTINAZIONI)('«%s» ha la sua voce in inglese', (d) => {
    expect(EN[d], `manca la traduzione di «${d}»`).toBeDefined();
  });

  it('e i sei punti che la mostrano la traducono davvero', () => {
    /*
     * Interpolata dentro un'altra frase — «PDF salvato {dove}» — senza `t()`
     * attorno, con l'applicazione in inglese si leggeva *«PDF saved dove il
     * sistema mette i download»*. Si controlla sul sorgente perché sono sei
     * componenti diversi, e montarli tutti qui non proverebbe di più.
     */
    const punti = [
      'src/ui/pages/DiveDetail.tsx',
      'src/ui/pages/Planner.tsx',
      'src/ui/pages/SyncPage.tsx',
      'src/ui/components/BleDownload.tsx',
      'src/ui/components/DecoPlan.tsx',
    ];
    const nudi = punti.filter((p) => /\$\{(?:esito|dove|exported)\.dove\}/.test(readFileSync(p, 'utf8')));
    expect(nudi, `mostrano la destinazione senza tradurla: ${nudi.join(' | ')}`).toEqual([]);
  });
});

describe('i nomi dei mesi', () => {
  it('sono dodici, o questa prova sta guardando un elenco che si è svuotato', () => {
    expect(MESI_ABBREVIATI).toHaveLength(12);
  });

  it.each(MESI_ABBREVIATI)('«%s» ha la sua voce in inglese', (m) => {
    expect(EN[m], `manca la traduzione del mese «${m}»`).toBeDefined();
  });

  it('e l’etichetta composta traduce il mese lasciando stare l’anno', () => {
    /*
     * ► FINIVANO ANCHE NELLA DESCRIZIONE PER GLI SCREEN READER. ◄ Non solo
     * sull'asse X: con l'applicazione in inglese si leggeva *«Max ott 25 on 3
     * dives»*. L'anno è un numero e non si traduce; il mese è una parola.
     */
    expect(etichettaMese('ott 25', inglese)).toBe('Oct 25');
    expect(etichettaMese('gen 26', inglese)).toBe('Jan 26');
    // E un'etichetta che non è un mese non si rompe.
    expect(etichettaMese('0–12 m', inglese)).toBe('0–12 m');
  });
});

describe('le istruzioni «da dove si esporta»', () => {
  it('hanno tutte la loro voce in inglese', () => {
    /*
     * Sono sette righe lette dal sorgente, come `avanzamentoTradotto.test.ts`
     * fa con le etichette del ponte Rust: è l'unico modo di raggiungere un
     * oggetto costruito dentro un componente.
     */
    const sorgente = readFileSync('src/ui/pages/ImportPage.tsx', 'utf8');
    const blocco = /const HOWTO: Record<string, string> = \{([\s\S]*?)\n\};/.exec(sorgente);
    expect(
      blocco,
      'l’elenco HOWTO non si trova più: questa prova sta guardando il posto sbagliato',
    ).not.toBeNull();
    const voci = [...blocco![1].matchAll(/:\s*'([^']+)'/g)].map((m) => m[1]);
    expect(voci.length, 'nessuna voce trovata: la ricerca non aggancia più niente').toBeGreaterThanOrEqual(7);
    const senzaVoce = voci.filter((v) => EN[v] === undefined);
    expect(senzaVoce, `istruzioni senza traduzione: ${senzaVoce.join(' | ')}`).toEqual([]);
  });
});

describe('► e i segnaposti non si perdono per strada ◄', () => {
  it('ogni voce inglese porta gli stessi {0} dell’italiana', () => {
    /*
     * Una traduzione che perde un `{0}` non sembra rotta: la frase resta
     * grammaticale e sparisce soltanto il numero. Questa riga guarda il
     * dizionario **intero**, non solo i canali di questo file.
     */
    const rotte = Object.entries(EN).filter(([it, en]) => segnaposti(it).join() !== segnaposti(en).join());
    expect(
      rotte.map(([it]) => it),
      'voci in cui i segnaposti non combaciano',
    ).toEqual([]);
  });
});
