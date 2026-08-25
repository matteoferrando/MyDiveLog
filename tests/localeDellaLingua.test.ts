/**
 * Le date e i numeri seguono la lingua scelta — tranne dove non devono.
 *
 * ► IL DIFETTO. ◄ Il dizionario traduce le frasi, ma «domenica 12 luglio 2026»
 * non passa dal dizionario: la scrive ICU, e ICU obbedisce al locale che gli si
 * dà. Sparse per l'interfaccia c'era una dozzina di `'it-IT'` scritti a mano, e
 * il risultato per chi sceglieva EN era una schermata mezza tradotta: le frasi
 * in inglese, le date e le migliaia in italiano. Nessun test poteva prenderlo
 * perché nessun test guardava il locale — girando tutti su una macchina
 * italiana, «giusto» e «italiano» sembravano la stessa cosa.
 *
 * ► LA PARTE PIÙ IMPORTANTE DI QUESTO FILE È L'ULTIMA. ◄ La stampa del libretto
 * resta in italiano QUALUNQUE lingua parli l'interfaccia, perché è il documento
 * previsto dall'art. 12, comma 8 della legge 70/2026 e si mostra a un istruttore
 * o a un centro italiano. È l'eccezione, ed è il genere di eccezione che
 * qualcuno un giorno «sistema» in buona fede scambiandola per una dimenticanza.
 * Da qui in poi, sistemarla fa fallire un test che spiega perché non si tocca.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { LOCALE_DELLA_LINGUA, localeCorrente, registraLocale } from '../src/core/locale';
import { dateLong, dateShort, int, timeShort } from '../src/ui/format';
import { dataLunga as dataLungaGrafico } from '../src/ui/components/Charts';
import { dataLunga as dataLungaLibretto, logbookHtml } from '../src/core/export/logbookPrint';
import type { Dive } from '../src/core/model';

/** Domenica 12 luglio 2026, mezzogiorno UTC. */
const ISO = '2026-07-12T12:00:00Z';

/*
 * Il registro è uno stato di modulo: chi lo sposta se lo rimette com'era, o i
 * test che girano dopo nello stesso processo si trovano una lingua che non hanno
 * chiesto. `it-IT` è il ripiego dichiarato in `core/locale.ts`.
 */
afterEach(() => registraLocale(LOCALE_DELLA_LINGUA.it));

describe('il registro del locale', () => {
  it('parte in italiano, che è il ripiego di tutto il progetto', () => {
    expect(localeCorrente()).toBe(LOCALE_DELLA_LINGUA.it);
  });
});

describe('date e ore dell’interfaccia', () => {
  it('scrivono il mese nella lingua scelta', () => {
    registraLocale(LOCALE_DELLA_LINGUA.it);
    expect(dateLong(ISO)).toContain('luglio');
    registraLocale(LOCALE_DELLA_LINGUA.en);
    expect(dateLong(ISO)).toContain('July');
    expect(dateLong(ISO)).not.toContain('luglio');
  });

  it('restano nel fuso del sito comunque, che è una regola a parte', () => {
    // Il locale decide COME si scrive la data, non QUALE istante si legge: senza
    // fuso dichiarato si legge in UTC in tutte e due le lingue, altrimenti
    // cambiare lingua sposterebbe l'ora di un'immersione.
    registraLocale(LOCALE_DELLA_LINGUA.it);
    const oraIt = timeShort(ISO);
    registraLocale(LOCALE_DELLA_LINGUA.en);
    expect(timeShort(ISO)).toBe(oraIt);
    expect(oraIt).toBe('12:00');
    // Il giorno è lo stesso: 12/07 in tutte e due (giorno prima del mese anche
    // in `en-GB`, che è il motivo per cui non si è scelto `en-US`).
    expect(dateShort(ISO)).toBe('12/07/26');
  });
});

describe('i numeri', () => {
  it('cambiano separatore delle migliaia con la lingua', () => {
    // Punto e virgola si scambiano di ruolo fra le due lingue: il locale
    // sbagliato non fa un numero brutto, ne fa uno che si legge come un altro.
    registraLocale(LOCALE_DELLA_LINGUA.it);
    expect(int(12_900)).toBe('12.900');
    registraLocale(LOCALE_DELLA_LINGUA.en);
    expect(int(12_900)).toBe('12,900');
  });
});

describe('le date dei grafici', () => {
  it('seguono la lingua come tutto il resto', () => {
    registraLocale(LOCALE_DELLA_LINGUA.it);
    expect(dataLungaGrafico(Date.parse(ISO))).toContain('luglio');
    registraLocale(LOCALE_DELLA_LINGUA.en);
    expect(dataLungaGrafico(Date.parse(ISO))).toContain('July');
  });
});

/**
 * L'immersione più scarna che `logbookHtml` accetta: qui non si prova il
 * contenuto del foglio, si prova in che lingua è scritto.
 */
const IMMERSIONE: Dive = {
  id: 'libretto-1',
  number: 1,
  startTime: ISO,
  durationS: 2400,
  maxDepth: 25,
  mode: 'oc',
  cylinders: [],
  tags: [],
  source: { format: 'uddf', file: 'prova', importedAt: ISO },
};

describe('l’eccezione: la stampa del libretto resta italiana', () => {
  it('scrive il mese in italiano anche con l’interfaccia in inglese', () => {
    registraLocale(LOCALE_DELLA_LINGUA.en);
    // Non è una svista: è il libretto dell'art. 12, comma 8 della legge 70/2026,
    // un documento italiano che si mostra in Italia a chi lo controfirma. Le
    // tredici voci hanno i nomi che gli dà quel testo; una data inglese in cima
    // a voci italiane non renderebbe il documento più internazionale, solo
    // incoerente. Il perché per esteso in `core/export/logbookPrint.ts`.
    expect(dataLungaLibretto(ISO)).toBe('domenica 12 luglio 2026');
  });

  it('e lo dichiara anche nel documento', () => {
    registraLocale(LOCALE_DELLA_LINGUA.en);
    const html = logbookHtml([IMMERSIONE], new Map(), { now: ISO });
    expect(html).toContain('<html lang="it">');
    expect(html).toContain('luglio');
    expect(html).not.toContain('July');
  });
});
