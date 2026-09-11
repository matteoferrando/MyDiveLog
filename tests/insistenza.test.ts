import { describe, expect, it } from 'vitest';

import {
  decidiComeInsistere,
  RIPROVE_STESSO_METODO,
  TENTATIVI_AUTOMATICI,
  type EsitoTentativo,
} from '../src/core/insistenza';

/**
 * Un esito «normale»: fallito, con un metodo aperto che NON ha risposto, al
 * primo giro. Ogni prova cambia solo quello che sta esaminando, così la riga
 * che conta si legge senza dover ricostruire il resto.
 */
function esito(cambia: Partial<EsitoTentativo> = {}): EsitoTentativo {
  return {
    nienteAltroDaFare: false,
    haRisposto: false,
    metodo: { indice: 0, totale: 3 },
    fatti: 0,
    stesso: 0,
    fermato: false,
    ...cambia,
  };
}

describe('► come si insiste quando uno scarico non riesce ◄', () => {
  it('se il computer HA RISPOSTO si riprova con lo stesso metodo, non con un altro', () => {
    /*
     * ════════════════════════════════════════════════════════════════════════
     * LA PROVA CHE VALE PIÙ DI TUTTE LE ALTRE DI QUESTO FILE.
     *
     * È il caso dei due diari veri del 9 settembre: un Mares che manda 276 KB
     * e poi si ferma. Il metodo ha appena dimostrato di funzionare — le
     * notifiche sono arrivate — e cambiarlo vorrebbe dire buttare via l'unica
     * combinazione che si sa buona per provarne una mai vista.
     */
    const scelta = decidiComeInsistere(esito({ haRisposto: true, metodo: { indice: 0, totale: 3 } }));
    expect(scelta.cosa).toBe('stesso-metodo');
    if (scelta.cosa === 'smetti') throw new Error('non deve smettere');
    expect(scelta.tentativo).toBe(0);
  });

  it('se non è arrivato NIENTE si passa al metodo dopo', () => {
    // Qui il metodo non ha dimostrato niente: ripeterlo uguale sarebbe
    // ripetere all'infinito la stessa domanda a chi non risponde.
    const scelta = decidiComeInsistere(esito({ haRisposto: false, metodo: { indice: 0, totale: 3 } }));
    expect(scelta.cosa).toBe('altro-metodo');
    if (scelta.cosa === 'smetti') throw new Error('non deve smettere');
    expect(scelta.tentativo).toBe(1);
  });

  it('lo stesso metodo si ripete un numero finito di volte, poi si cambia', () => {
    // Dopo le riprove concesse, un metodo che risponde ma non porta a casa
    // niente ha avuto le sue occasioni: si prova l'altro.
    const scelta = decidiComeInsistere(
      esito({ haRisposto: true, stesso: RIPROVE_STESSO_METODO, metodo: { indice: 0, totale: 3 } }),
    );
    expect(scelta.cosa).toBe('altro-metodo');
  });

  it('esauriti i metodi si smette, invece di girare in tondo', () => {
    const scelta = decidiComeInsistere(
      esito({ haRisposto: true, stesso: RIPROVE_STESSO_METODO, metodo: { indice: 2, totale: 3 } }),
    );
    expect(scelta.cosa).toBe('smetti');
  });

  it('un tetto ai tentativi automatici c’è, e vale anche quando il metodo risponde', () => {
    /*
     * Senza questo, un computer che risponde e non finisce mai terrebbe il
     * telefono a scaricare finché non si spegne — e la persona davanti non
     * saprebbe nemmeno quante volte ci ha provato.
     */
    const scelta = decidiComeInsistere(esito({ haRisposto: true, fatti: TENTATIVI_AUTOMATICI }));
    expect(scelta.cosa).toBe('smetti');
    if (scelta.cosa !== 'smetti') throw new Error('impossibile');
    expect(scelta.perche).toContain('troppi');
  });

  it('«Interrompi» batte qualunque regola', () => {
    // Anche nel caso più invitante — il metodo funziona, i tentativi ci sono
    // ancora — se la persona ha detto basta, si smette.
    const scelta = decidiComeInsistere(esito({ haRisposto: true, fermato: true }));
    expect(scelta.cosa).toBe('smetti');
    if (scelta.cosa !== 'smetti') throw new Error('impossibile');
    expect(scelta.perche).toContain('fermato');
  });

  it('quando non è rimasto niente da chiedere non si ripete', () => {
    const scelta = decidiComeInsistere(esito({ nienteAltroDaFare: true, haRisposto: true }));
    expect(scelta.cosa).toBe('smetti');
    if (scelta.cosa !== 'smetti') throw new Error('impossibile');
    expect(scelta.perche).toContain('niente da fare');
  });

  it('► delle immersioni in mano NON bastano a fermare il giro ◄', () => {
    /*
     * ════════════════════════════════════════════════════════════════════════
     * LA PROVA NATA DAL DIARIO DEL 10 SETTEMBRE 2026.
     *
     * Fin qui questo campo si chiamava `riuscito` e chi chiamava ci metteva
     * dentro `dives.length > 0`. Poi il recupero parziale ha cominciato a
     * funzionare davvero: un Puck 4 che si rompe dopo due immersioni su
     * quarantacinque **ne consegna due**, «almeno una» diventa vero, e il giro
     * dei tentativi si spegne sul nascere.
     *
     * Qui dentro la regola non può accorgersene: questa funzione non sa cosa
     * sia un'immersione. Quello che può fare — e che questa prova inchioda — è
     * non avere nessuna scorciatoia che confonda le due cose: se chi chiama
     * dice «c'è ancora da fare», si riprova, e basta. Il resto è in
     * `metodoDiCollegamento.test.tsx`, dove la domanda viene formulata.
     */
    const scelta = decidiComeInsistere(esito({ nienteAltroDaFare: false, haRisposto: true }));
    expect(scelta.cosa).toBe('stesso-metodo');
  });

  it('se il ponte non si è nemmeno aperto si riprova UNA volta da dove si era partiti', () => {
    /*
     * È la prima riga del diario del 9 settembre: «collegamento non riuscito:
     * Timeout during execution of Connect», zero immersioni — e il tentativo
     * dopo, stessa persona stesso apparecchio, si è collegato in 60 ms.
     *
     * Il metodo qui non c'è: non si è arrivati a sceglierlo. Si riparte da
     * dove si era partiti, e si riparte **una volta sola**, perché il guscio
     * Rust ha già insistito tre volte sul solo `connect`.
     */
    const primo = decidiComeInsistere(esito({ metodo: undefined, partitoDa: 2 }));
    expect(primo.cosa).toBe('stesso-metodo');
    if (primo.cosa === 'smetti') throw new Error('non deve smettere');
    expect(primo.tentativo).toBe(2);

    const secondo = decidiComeInsistere(esito({ metodo: undefined, partitoDa: 2, stesso: 1 }));
    expect(secondo.cosa).toBe('smetti');
  });

  it('il conto dei tentativi cresce, e quello dello stesso metodo si azzera cambiando', () => {
    // Senza questo, il tetto non arriverebbe mai e le riprove sullo stesso
    // metodo si porterebbero dietro il conto del metodo precedente.
    const uguale = decidiComeInsistere(esito({ haRisposto: true, fatti: 1, stesso: 1 }));
    if (uguale.cosa === 'smetti') throw new Error('non deve smettere');
    expect(uguale.fatti).toBe(2);
    expect(uguale.stesso).toBe(2);

    const cambio = decidiComeInsistere(esito({ haRisposto: false, fatti: 1, stesso: 1 }));
    if (cambio.cosa === 'smetti') throw new Error('non deve smettere');
    expect(cambio.fatti).toBe(2);
    expect(cambio.stesso).toBe(0);
  });
});
