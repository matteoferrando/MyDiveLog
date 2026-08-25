/**
 * Il gas analizzato di persona, e quando l'etichetta mente.
 *
 * PERCHÉ QUESTO FILE ESISTE. Fra tutte le procedure dei manuali didattici una
 * sola è imposta senza sfumature: «No diver should breathe any mixture they
 * have not personally confirmed prior to the dive» (TDI *Advanced Nitrox*
 * 2013, p. 73). L'applicazione non aveva un posto dove registrarla.
 *
 * Ma archiviare il numero non serve quasi a niente. Serve il CONFRONTO: se
 * l'adesivo dice 32% e la cella ne legge 30, la MOD che l'applicazione ha
 * mostrato è più profonda di quella vera, e con lei PPO2, CNS e OTU. È quel
 * caso che questi test inchiodano.
 */

import { describe, expect, it } from 'vitest';
import { descriviScarto, discorda, scartiDiAnalisi, TOLLERANZA_ANALISI } from '../src/core/analisiGas';
import type { Cylinder } from '../src/core/model';

const bombola = (o2: number, analisi?: { o2: number; he?: number }): Cylinder =>
  ({ mix: { o2, he: 0 }, sizeL: 12, analisi }) as unknown as Cylinder;

describe('l’analisi contro l’etichetta', () => {
  it('quando coincidono non dice niente', () => {
    expect(scartiDiAnalisi([bombola(0.32, { o2: 0.32 })])).toEqual([]);
  });

  it('mezzo punto percentuale è lo strumento, non il gas', () => {
    /*
     * Una cella all'ossigeno tarata in aria ha una precisione attorno all'1%
     * assoluto. Segnalare sotto quella soglia produrrebbe un avviso a ogni
     * immersione, e un avviso che compare sempre non lo legge più nessuno.
     */
    expect(discorda({ o2: 0.32, he: 0 }, { o2: 0.325 })).toBe(false);
    expect(discorda({ o2: 0.32, he: 0 }, { o2: 0.315 })).toBe(false);
  });

  it('due punti percentuali sono il gas, e vanno detti', () => {
    const scarti = scartiDiAnalisi([bombola(0.32, { o2: 0.3 })]);
    expect(scarti).toHaveLength(1);
    expect(scarti[0].o2Dichiarato).toBeCloseTo(0.32, 3);
    expect(scarti[0].o2Analizzato).toBeCloseTo(0.3, 3);
  });

  it('PIÙ ossigeno del dichiarato è il caso pericoloso, e sembra il contrario', () => {
    /*
     * ► IL TEST CHE HA PRESO UN ERRORE MIO. ◄ Scrivendo il messaggio la prima
     * volta avevo invertito i due casi, perché «più ossigeno» suona come «più
     * sicuro». È il contrario: più ossigeno c'è, più la MOD è BASSA.
     *
     * Dichiarato 28%, analizzato 32%: la MOD vera è 33.3 m mentre
     * l'applicazione ne mostrava 39.5. Il subacqueo poteva scendere sei metri
     * più giù del limite reale credendo di essere dentro.
     */
    const [s] = scartiDiAnalisi([bombola(0.28, { o2: 0.32 })]);
    expect(s.modAnalizzata).toBeLessThan(s.modDichiarata);
    expect(s.modAnalizzata).toBeCloseTo(33.3, 0);
    expect(s.modDichiarata).toBeCloseTo(39.5, 0);
    expect(descriviScarto(s)).toContain('più profondo di quello vero');
  });

  it('MENO ossigeno del dichiarato lascia i conti dal lato prudente', () => {
    // Dichiarato 32%, analizzato 30%: la MOD vera è più profonda di quella
    // mostrata. Va detto lo stesso — cambia l'esposizione all'ossigeno — ma non
    // è un limite superato.
    const [s] = scartiDiAnalisi([bombola(0.32, { o2: 0.3 })]);
    expect(s.modAnalizzata).toBeGreaterThan(s.modDichiarata);
    expect(descriviScarto(s)).toContain('prudenti');
  });

  it('la frase nomina la MOD, non solo la percentuale', () => {
    const [s] = scartiDiAnalisi([bombola(0.32, { o2: 0.3 })]);
    const frase = descriviScarto(s);
    expect(frase).toContain('30%');
    expect(frase).toContain('32%');
    expect(frase).toContain('MOD');
    expect(frase).toMatch(/\d+\.\d m/);
  });

  it('l’elio discorda solo se l’analizzatore lo ha letto', () => {
    // Le celle all'ossigeno non leggono l'elio: assente non vuol dire zero, e
    // trattarlo come zero farebbe scattare un avviso su ogni trimix.
    const trimix = { mix: { o2: 0.21, he: 0.35 }, analisi: { o2: 0.21 } } as unknown as Cylinder;
    expect(scartiDiAnalisi([trimix])).toEqual([]);
    const conElio = { mix: { o2: 0.21, he: 0.35 }, analisi: { o2: 0.21, he: 0.3 } } as unknown as Cylinder;
    expect(scartiDiAnalisi([conElio])).toHaveLength(1);
  });

  it('una bombola non analizzata non è una bombola discordante', () => {
    expect(scartiDiAnalisi([bombola(0.32)])).toEqual([]);
    expect(scartiDiAnalisi(undefined)).toEqual([]);
  });

  it('nomina la bombola giusta quando ce ne sono più di una', () => {
    const scarti = scartiDiAnalisi([bombola(0.32, { o2: 0.32 }), bombola(0.5, { o2: 0.32 })]);
    expect(scarti).toHaveLength(1);
    expect(scarti[0].bombola).toBe(1);
  });

  it('la tolleranza è dichiarata e non sepolta in un confronto', () => {
    expect(TOLLERANZA_ANALISI).toBe(0.01);
  });
});
