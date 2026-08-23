/**
 * Il libretto delle immersioni dell'art. 12, comma 8 della legge 70/2026.
 *
 * Perché questo file esiste: quelle tredici lettere sono uno schema dati
 * imposto per legge, e un libretto a cui ne manca una in silenzio non è un
 * libretto — è un quaderno. Qui si inchioda l'ordine, si inchioda il fatto che
 * un dato assente resti assente, e si inchioda che la firma non venga MAI
 * riempita da noi.
 */

import { describe, expect, it } from 'vitest';
import { libretto, mancanti, type Subacqueo } from '../src/core/libretto';
import type { Dive } from '../src/core/model';

const IMMERSIONE: Dive = {
  id: 'x',
  startTime: '2026-07-11T09:24:00Z',
  utcOffsetMinutes: 120,
  durationS: 55 * 60,
  maxDepth: 31.2,
  mode: 'oc',
  cylinders: [{ mix: { o2: 0.32, he: 0 } }],
  site: { name: 'Camogli Gonzatti', region: 'Liguria', country: 'Italia' },
  source: { kind: 'manual' },
} as unknown as Dive;

const CHI: Subacqueo = { nome: 'Mario Rossi', brevetto: 'Advanced Open Water' };

describe('le tredici lettere', () => {
  it('ci sono tutte, nell’ordine della legge, e senza j né k', () => {
    /*
     * L'italiano giuridico salta la j e la k: chi controlla un libretto scorre
     * le lettere, e una sequenza diversa da quella del testo costringe a
     * cercare. L'ordine è parte del requisito, non impaginazione.
     */
    const voci = libretto(IMMERSIONE, CHI);
    expect(voci.map((v) => v.lettera)).toEqual([
      'a',
      'b',
      'c',
      'd',
      'e',
      'f',
      'g',
      'h',
      'i',
      'l',
      'm',
      'n',
      'o',
    ]);
  });

  it('gli orari sono quelli del LUOGO, non quelli di casa', () => {
    // 09:24 UTC con due ore di fuso: sul libretto vanno le 11:24, che è l'ora
    // che segnava il computer al polso.
    const voci = libretto(IMMERSIONE, CHI);
    expect(voci.find((v) => v.lettera === 'c')?.valore).toBe('11/07/2026');
    expect(voci.find((v) => v.lettera === 'e')?.valore).toBe('11:24');
    expect(voci.find((v) => v.lettera === 'f')?.valore).toBe('12:19');
  });

  it('la profondità programmata NON diventa quella raggiunta', () => {
    /*
     * ► La riga che protegge un documento firmato. ◄ Nessun computer registra le
     * intenzioni: la programmata o la scrive una persona o non c'è. Riempirla
     * con la raggiunta sarebbe inventare un dato — e su un foglio che un
     * istruttore controfirma, un dato inventato è peggio di uno mancante.
     */
    const voci = libretto(IMMERSIONE, CHI);
    expect(voci.find((v) => v.lettera === 'i')?.valore).toBeNull();
    expect(voci.find((v) => v.lettera === 'l')?.valore).toBe('31.2 m');

    const conPiano = libretto({ ...IMMERSIONE, plannedMaxDepth: 30 }, CHI);
    expect(conPiano.find((v) => v.lettera === 'i')?.valore).toBe('30.0 m');
  });

  it('la firma resta vuota anche quando tutto il resto è pieno', () => {
    // Una casella «firmato: sì» compilata da chi tiene il libretto non è la
    // firma di nessuno.
    const piena = libretto(
      { ...IMMERSIONE, plannedMaxDepth: 30, center: 'Diving X', guide: 'Anna Bianchi' },
      CHI,
    );
    expect(piena.find((v) => v.lettera === 'o')?.valore).toBeNull();
    expect(mancanti(piena)).toEqual(['o']);
  });

  it('quello che manca resta nullo, e non diventa stringa vuota', () => {
    const voci = libretto(IMMERSIONE, {});
    expect(voci.find((v) => v.lettera === 'a')?.valore).toBeNull();
    expect(voci.find((v) => v.lettera === 'b')?.valore).toBeNull();
    expect(voci.find((v) => v.lettera === 'm')?.valore).toBeNull();
    // Uno spazio non è un nome.
    expect(libretto(IMMERSIONE, { nome: '   ' })[0].valore).toBeNull();
  });

  it('il tipo di autorespiratore è il TIPO, e l’apnea non ne ha uno', () => {
    const t = (d: Partial<Dive>) =>
      libretto({ ...IMMERSIONE, ...d } as Dive, CHI).find((v) => v.lettera === 'g')?.valore;
    expect(t({ mode: 'oc' })).toContain('circuito aperto');
    expect(t({ mode: 'ccr' })).toContain('circuito chiuso');
    expect(t({ mode: 'scr' })).toContain('semichiuso');
    // «gauge» dice come registrava lo strumento, non cosa respirava la persona.
    expect(t({ mode: 'gauge' })).toBeNull();
    expect(t({ mode: 'freedive' })).toBeNull();
  });

  it('le miscele si elencano tutte, senza doppioni', () => {
    const due = libretto(
      {
        ...IMMERSIONE,
        cylinders: [{ mix: { o2: 0.32, he: 0 } }, { mix: { o2: 0.5, he: 0 } }, { mix: { o2: 0.32, he: 0 } }],
      } as unknown as Dive,
      CHI,
    );
    const h = due.find((v) => v.lettera === 'h')?.valore ?? '';
    expect(h.split(' · ')).toHaveLength(2);
  });

  it('passa dal dizionario: le etichette non sono scritte a mano nella stampa', () => {
    const voci = libretto(IMMERSIONE, CHI, (frase) => frase.toUpperCase());
    expect(voci[0].etichetta).toBe('GENERALITÀ DEL SUBACQUEO');
  });
});
