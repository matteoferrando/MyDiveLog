/**
 * IL CONSUMO DI SUPERFICIE SCRITTO A MANO.
 *
 * ► PERCHÉ ESISTE. ◄ *«Serve poter mettere un consumo di superficie a mano come
 * valore, se lo calcoli tu per ogni immersione.»* Chiesto il 12 settembre 2026,
 * e il motivo è che **quasi nessun computer subacqueo ha l'integrazione
 * d'aria**: senza le pressioni della bombola il conto non si può fare, e quella
 * casella dell'archivio resta vuota per sempre anche a chi il manometro l'ha
 * guardato a inizio e fine immersione.
 *
 * ► E PERCHÉ È UN CAMPO DELICATO. ◄ Il numero scritto a mano finisce nella
 * stessa casella di quello letto dalla bombola, e da lì in giù nessuno li
 * distingue più: entrano nella stessa media, nello stesso confronto, nello
 * stesso libretto. È comodo — tutto funziona senza che nessuno debba saperne
 * niente — ed è esattamente per questo che va tenuto separato **all'origine**.
 * Le prove qui sotto guardano tutte e due le metà: che il numero arrivi dove
 * serve, e che si porti dietro da dove viene.
 */

import { describe, expect, it } from 'vitest';
import { computeMetrics } from '../src/core/analysis/metrics';
import { AIR, type Dive, type Sample } from '../src/core/model';

const profilo = (): Sample[] =>
  Array.from({ length: 60 }, (_, i) => ({
    t: i * 60,
    depth: i < 30 ? Math.min(20, i * 2) : Math.max(0, 20 - (i - 30) * 0.8),
    tempC: 18,
  }));

function immersione(sovrascrivi: Partial<Dive> = {}): Dive {
  return {
    id: 'x',
    startTime: '2026-06-14T10:38:00.000Z',
    durationS: 3600,
    maxDepth: 20,
    mode: 'oc',
    cylinders: [{ mix: AIR }],
    source: { format: 'uddf', file: 'sintetico', importedAt: '2026-06-14T12:00:00.000Z' },
    tags: [],
    samples: profilo(),
    ...sovrascrivi,
  };
}

describe('quando il consumo non è calcolabile', () => {
  it('il valore scritto a mano prende il suo posto, e si dichiara', () => {
    const m = computeMetrics(immersione({ rmvLpmManual: 13.4 }));
    expect(m.rmvLpm).toBe(13.4);
    expect(m.rmvLpmDichiarato).toBe(true);
    /*
     * ► E LO DICE ANCHE FRA LE AVVERTENZE. ◄ La casella a schermo ha una nota,
     * ma le avvertenze sono quello che finisce nei contesti per l'analisi e nei
     * posti dove il numero viene riletto senza la sua casella accanto.
     */
    expect(m.quality.caveats.join(' ')).toContain('l’hai scritto tu');
  });

  it('senza niente scritto a mano resta vuoto, e non diventa zero', () => {
    const m = computeMetrics(immersione());
    expect(m.rmvLpm).toBeUndefined();
    expect(m.rmvLpmDichiarato).toBeUndefined();
  });

  it('uno zero non è un consumo, ed è trattato come niente', () => {
    /*
     * Un subacqueo che consuma zero litri al minuto non esiste. Uno zero qui
     * arriva da un campo svuotato male o da un'importazione storta, e accettarlo
     * significherebbe infilare uno zero dentro le medie — dove non fa rumore e
     * tira giù il risultato di tutti.
     */
    const m = computeMetrics(immersione({ rmvLpmManual: 0 }));
    expect(m.rmvLpm).toBeUndefined();
    expect(m.rmvLpmDichiarato).toBeUndefined();
  });
});

describe('quando il consumo è calcolabile', () => {
  const conBombola = (extra: Partial<Dive> = {}) =>
    immersione({
      cylinders: [{ mix: AIR, sizeL: 12, startBar: 200, endBar: 70 }],
      ...extra,
    });

  it('vince la misura, e il valore scritto a mano non la sostituisce', () => {
    /*
     * ════════════════════════════════════════════════════════════════════════
     * ► È LA RIGA CHE DECIDE DI CHE TIPO DI APPLICAZIONE SI TRATTA. ◄
     *
     * È la stessa regola della miscela analizzata: il valore dichiarato
     * sull'etichetta non sovrascrive mai quello letto dall'analizzatore.
     * Un'applicazione che preferisse il numero scritto a mano a quello misurato
     * insegnerebbe, una scheda alla volta, a non fidarsi del misurato.
     */
    const calcolato = computeMetrics(conBombola()).rmvLpm;
    expect(calcolato).toBeDefined();

    const m = computeMetrics(conBombola({ rmvLpmManual: 99 }));
    expect(m.rmvLpm).toBe(calcolato);
    expect(m.rmvLpmDichiarato).toBeUndefined();
    expect(m.quality.caveats.join(' ')).not.toContain('l’hai scritto tu');
  });

  it('ma il valore scritto a mano NON viene cancellato dall’immersione', () => {
    /*
     * Le metriche si ricalcolano da capo a ogni modifica; il dato scritto a
     * mano sta sull'immersione e sopravvive. Se un domani le pressioni venissero
     * tolte — una bombola corretta, un'unione di schede — il numero di chi l'ha
     * calcolato è ancora lì e torna a valere.
     */
    const dive = conBombola({ rmvLpmManual: 13.4 });
    dive.metrics = computeMetrics(dive);
    expect(dive.rmvLpmManual).toBe(13.4);

    const senzaPressioni: Dive = { ...dive, cylinders: [{ mix: AIR }] };
    expect(computeMetrics(senzaPressioni).rmvLpm).toBe(13.4);
  });
});
