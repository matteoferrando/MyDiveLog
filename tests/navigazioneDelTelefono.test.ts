/**
 * LA NAVIGAZIONE DEL TELEFONO: che ci si arrivi, e una volta sola.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ► PERCHÉ QUESTA PROVA NASCE OGGI, 15 SETTEMBRE 2026. ◄
 *
 * Fino a stamattina la navigazione del telefono era un elenco che ripeteva
 * `TABS` per intero: ogni scheda c'era per costruzione, e non c'era niente da
 * verificare. Da oggi non è più così — quattro voci stanno nella barra in
 * basso, le altre cinque in tre gruppi dentro il foglio «Altro» — e *una
 * divisione scritta a mano è una divisione che si può sbagliare*.
 *
 * Il modo di sbagliarla è preciso e silenzioso: si aggiunge una pagina, la si
 * mette in `TABS` perché altrimenti non compare sul desktop, e ci si dimentica
 * del foglio. Sul Mac funziona tutto. Sull'iPhone quella pagina **non esiste**:
 * nessun errore, nessuna schermata rotta, nessuno screenshot diverso: una voce
 * che manca da un menu non la vede nessuno finché qualcuno non la cerca. È
 * esattamente il tipo di difetto che questo progetto ha già pagato tre volte
 * altrove — la regola che non fa niente, la guardia che non guarda — e che solo
 * una prova sul CONTENUTO delle tabelle può fermare.
 *
 * Costa d'esistere: `navigazione.tsx` tiene le tabelle e non importa niente, in
 * modo che si possano leggere senza montare il guscio.
 */

import { describe, expect, it } from 'vitest';
import { BARRA, GRUPPI_ALTRO, TABS, type Vista } from '../src/ui/navigazione';
import { INGLESE as EN } from '../src/ui/traduzioni';

/** Tutto quello che il telefono mostra, nell'ordine in cui lo mostra. */
const SUL_TELEFONO: Vista[] = [
  ...BARRA.map((b) => b.id),
  ...GRUPPI_ALTRO.flatMap((g) => g.voci.map((v) => v.id)),
];

describe('dal telefono si arriva a tutte le schede', () => {
  it.each(TABS.map((s) => s.id))('«%s» è raggiungibile', (id) => {
    expect(
      SUL_TELEFONO.filter((v) => v === id).length,
      `la scheda «${id}» non compare né nella barra in basso né nel foglio «Altro»: ` +
        'sul telefono non esiste',
    ).toBe(1);
  });

  it('e non ci si arriva due volte', () => {
    /*
     * L'altra metà, e non è simmetria per amore di simmetria: una voce
     * duplicata — nella barra E nel foglio — accende due bersagli insieme
     * quando la si apre, e chi guarda non capisce in quale dei due si trova.
     * La prova sopra lo direbbe già (`toBe(1)` e non `toBeGreaterThan(0)`), ma
     * solo per le schede che stanno in `TABS`: questa guarda il verso opposto,
     * cioè le voci che il telefono mostra e che scheda non sono.
     */
    const conosciute = new Set<string>(TABS.map((s) => s.id));
    for (const v of SUL_TELEFONO) {
      expect(conosciute.has(v), `«${v}» è nella navigazione del telefono ma non è una scheda`).toBe(true);
    }
    expect(new Set(SUL_TELEFONO).size).toBe(SUL_TELEFONO.length);
  });
});

describe('la barra in basso', () => {
  /*
   * ► LA VOCE CHE SPORGE DEVE STARE IN MEZZO. ◄
   *
   * Il cerchio d'accento alzato di sei pixel funziona come segno solo se è
   * simmetrico: spostato di una casella diventa una macchia storta, e nessuno
   * lo nota leggendo un diff — si nota guardando il telefono, cioè dopo. La
   * barra disegna le voci di `BARRA` e poi «Altro»: le caselle sono quindi una
   * più di quante ne conta la tabella, e il centro esiste solo se sono dispari.
   */
  it('ha «Importa» esattamente al centro delle cinque caselle', () => {
    const caselle = BARRA.length + 1; // + «Altro»
    expect(caselle % 2, 'le caselle sono pari: un centro non c’è').toBe(1);
    expect(BARRA[(caselle - 1) / 2]?.id).toBe('import');
  });

  it('non è più larga di quanto un pollice possa dividere', () => {
    // Cinque caselle su 320 px fanno 62 px l'una: è il minimo sotto cui una
    // parola come «Statistiche» non si legge più nemmeno con i puntini. Sei
    // sarebbero 52, e a quel punto tanto vale togliere le parole.
    expect(BARRA.length + 1).toBeLessThanOrEqual(5);
  });
});

describe('le parole della navigazione passano dal dizionario', () => {
  /*
   * `t(scheda.label)` e `t(gruppo.titolo)` ricevono una VARIABILE, e la guardia
   * del dizionario — che scorre il sorgente cercando un apice subito dopo la
   * parentesi — non le vede. È lo stesso buco già costato cinque volte (vedi
   * `testiTradotti.test.ts`), e la cura è sempre quella: una costante esportata
   * che una prova possa scorrere tutta.
   */
  it.each(TABS.map((s) => s.label))('l’etichetta «%s» ha la sua voce in inglese', (label) => {
    expect(EN[label], `manca la traduzione dell’etichetta «${label}»`).toBeDefined();
  });

  it.each(GRUPPI_ALTRO.map((g) => g.titolo))('il gruppo «%s» ha la sua voce in inglese', (titolo) => {
    expect(EN[titolo], `manca la traduzione del gruppo «${titolo}»`).toBeDefined();
  });

  it.each(GRUPPI_ALTRO.flatMap((g) => g.voci).map((v) => v.sotto))(
    'la riga «%s» ha la sua voce in inglese',
    (sotto) => {
      expect(EN[sotto], `manca la traduzione della riga «${sotto}»`).toBeDefined();
    },
  );
});

describe('ogni voce del foglio dice anche cosa c’è dentro', () => {
  /*
   * ► LA RIGA SOTTO NON È UN ABBELLIMENTO. ◄
   *
   * La prima versione del foglio era un elenco di sostantivi nudi, e un menu di
   * sostantivi si può usare soltanto se si sa già cosa vuol dire ognuno:
   * «Suggerimenti» non dice che è il piano di miglioramento, «Il tuo profilo»
   * non dice che lì dentro ci sono i brevetti. Chi arriva la prima volta deve
   * entrare in tutte e cinque per scoprirlo.
   *
   * Quindi la riga è obbligatoria, e la prova la pretende: una voce nuova
   * aggiunta senza spiegazione non passa. Non giudica le parole — quelle sono
   * scelte — ma verifica che ci siano, che siano corte abbastanza per stare su
   * una riga di telefono, e che non ripetano l'etichetta che hanno sopra.
   */
  const voci = GRUPPI_ALTRO.flatMap((g) => g.voci);

  it.each(voci)('«$id» ha una riga di spiegazione', (voce) => {
    expect(voce.sotto.trim().length, `«${voce.id}» non ha spiegazione`).toBeGreaterThan(0);
    // 40 caratteri a 12 px stanno in 402 px meno il segno e il gallone; oltre,
    // va a capo e la riga diventa alta il doppio solo per quella voce.
    expect(voce.sotto.length, `la riga di «${voce.id}» è troppo lunga: «${voce.sotto}»`).toBeLessThanOrEqual(
      40,
    );
    const etichetta = TABS.find((s) => s.id === voce.id)?.label ?? '';
    expect(
      voce.sotto.toLowerCase(),
      `la riga di «${voce.id}» ripete l’etichetta invece di aggiungere qualcosa`,
    ).not.toBe(etichetta.toLowerCase());
  });
});
