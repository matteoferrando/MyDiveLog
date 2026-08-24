/**
 * DUE COMPUTER AL POLSO, DUE ORE DIVERSE.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUESTO FILE NON È UNO SCENARIO INVENTATO. I numeri sono quelli veri di due
 * immersioni fatte il 24 agosto 2026 e scaricate lo stesso giorno via
 * Bluetooth dai due computer del proprietario. Sono entrate in archivio
 * QUATTRO volte.
 *
 * Quello che l'archivio conteneva, letteralmente:
 *
 *   Aladin    06:46:00Z  max 11.43 m  dur 3360 s   (utcOffsetMinutes: 60)
 *   Peregrine 07:45:25Z  max 11.60 m  dur 3460 s   (nessun fuso)
 *   Aladin    08:24:35Z  max 12.27 m  dur 3180 s   (utcOffsetMinutes: 60)
 *   Peregrine 09:24:02Z  max 12.30 m  dur 3300 s   (nessun fuso)
 *
 * Il proprietario è entrato in acqua alle **07:46 e alle 09:24 locali**, cioè
 * alle 05:46 e alle 07:24 UTC — Italia, ora legale, +120. Lo scarico è
 * avvenuto alle **09:05:36Z**.
 *
 * Da lì si legge tutto:
 *
 *  - Il Peregrine dichiara un inizio alle 09:24:02Z **diciotto minuti dopo**
 *    l'istante in cui era già stato scaricato. Un'immersione nel futuro non è
 *    un indizio, è una dimostrazione: quel numero non è UTC, è l'ora a parete.
 *    Due ore di errore.
 *  - L'Aladin dichiara il fuso +60 il 24 agosto, cioè è fermo sull'ora solare:
 *    l'UTC che ne discende è avanti di un'ora.
 *  - Fra i due restano i 59 minuti che hanno impedito l'unione — 3565 s sulla
 *    prima coppia, 3567 s sulla seconda, DUE SECONDI di differenza fra loro.
 *
 * E niente di tutto questo si vedeva: senza fuso l'applicazione mostra l'UTC
 * (09:24, giusto), e con fuso +60 mostra 08:24+60 (09:24, di nuovo giusto).
 * Sullo schermo comparivano le ore giuste in tutti e due i casi. Sbagliato era
 * solo l'istante assoluto — e quello lo guarda una cosa sola, la deduplica.
 * ────────────────────────────────────────────────────────────────────────────
 */

import { describe, expect, it } from 'vitest';
import { inferClockOffsets, likelySame, mergeDive, mergeImports } from '../src/core/dedupe';
import { istanteDaOraAParete } from '../src/core/oraAParete';
import type { Dive } from '../src/core/model';

/** Il fuso italiano il 24 agosto 2026: ora legale, due ore. */
const FUSO_ITALIA_AGOSTO = 120;

/** Un'immersione come l'ha scritta il computer, con i numeri veri. */
function immersione(p: {
  id: string;
  startTime: string;
  utcOffsetMinutes?: number;
  maxDepth: number;
  durationS: number;
  modello: string;
  seriale: string;
  formato: string;
}): Dive {
  return {
    id: p.id,
    startTime: p.startTime,
    utcOffsetMinutes: p.utcOffsetMinutes,
    durationS: p.durationS,
    maxDepth: p.maxDepth,
    mode: 'oc',
    cylinders: [{ mix: { o2: 0.21, he: 0 } }],
    computer: { model: p.modello, serial: p.seriale, deviceId: p.seriale },
    source: { kind: 'ble', format: p.formato, importedAt: '2026-08-24T09:05:36.188Z' },
    tags: [],
  } as unknown as Dive;
}

const ALADIN_1 = immersione({
  id: 'a1',
  startTime: '2026-08-24T06:46:00.000Z',
  utcOffsetMinutes: 60,
  maxDepth: 11.43,
  durationS: 3360,
  modello: 'Scubapro Aladin Sport Matrix',
  seriale: '63034502',
  formato: 'uwatec-ble',
});
const PEREGRINE_1 = immersione({
  id: 'p1',
  startTime: '2026-08-24T07:45:25.000Z',
  maxDepth: 11.6,
  durationS: 3460,
  modello: 'Shearwater Peregrine',
  seriale: '988B023F',
  formato: 'shearwater-ble',
});
const ALADIN_2 = immersione({
  id: 'a2',
  startTime: '2026-08-24T08:24:35.000Z',
  utcOffsetMinutes: 60,
  maxDepth: 12.27,
  durationS: 3180,
  modello: 'Scubapro Aladin Sport Matrix',
  seriale: '63034502',
  formato: 'uwatec-ble',
});
const PEREGRINE_2 = immersione({
  id: 'p2',
  startTime: '2026-08-24T09:24:02.000Z',
  maxDepth: 12.3,
  durationS: 3300,
  modello: 'Shearwater Peregrine',
  seriale: '988B023F',
  formato: 'shearwater-ble',
});

describe('il difetto, com’era', () => {
  it('due letture dello stesso tuffo non si riconoscevano', () => {
    // Profondità e durata combaciano; è solo l'orario a non tornare.
    expect(likelySame(ALADIN_2, PEREGRINE_2, 0)).toBe(false);
  });

  it('con due sole immersioni lo sfasamento non veniva nemmeno cercato', () => {
    // La soglia di allora: tre coppie. Uno scarico incrementale ne porta due,
    // quindi l'unica difesa contro un orologio sbagliato era spenta proprio nel
    // caso in cui serviva.
    const stretto = inferClockOffsets([ALADIN_1, ALADIN_2], [PEREGRINE_1, PEREGRINE_2], {
      minPairsStrette: 3,
    });
    expect(stretto).toEqual([]);
  });
});

describe('la lettura dell’ora, corretta', () => {
  it('il Peregrine: l’ora a parete diventa l’istante vero', () => {
    // 09:24 a Camogli, ora legale: le 07:24 UTC.
    const oraAParete = Date.parse('2026-08-24T09:24:02.000Z');
    const vero = istanteDaOraAParete(oraAParete, FUSO_ITALIA_AGOSTO);
    expect(new Date(vero).toISOString()).toBe('2026-08-24T07:24:02.000Z');
  });

  it('l’Aladin: si riparte dall’ora a parete, non dall’UTC che dichiara', () => {
    /*
     * Il byte del fuso dice +60 mentre il 24 agosto in Italia sono +120: l'UTC
     * che il computer crede di avere è avanti di un'ora. L'unica cosa che sa
     * per certo è che ti ha mostrato le 09:24.
     */
    const oraAParete = Date.parse('2026-08-24T08:24:35.000Z') + 60 * 60_000;
    expect(new Date(oraAParete).toISOString()).toBe('2026-08-24T09:24:35.000Z');
    const vero = istanteDaOraAParete(oraAParete, FUSO_ITALIA_AGOSTO);
    expect(new Date(vero).toISOString()).toBe('2026-08-24T07:24:35.000Z');
  });

  it('corretti tutti e due, i due computer cadono a trentacinque secondi l’uno dall’altro', () => {
    /*
     * I trentacinque secondi non sono un errore residuo: sono i due computer
     * che si accorgono dell'ingresso in acqua a mezzo minuto di distanza. È il
     * segno che la correzione è giusta — se lo fosse solo per metà resterebbe
     * un'ora tonda.
     */
    const per = istanteDaOraAParete(Date.parse('2026-08-24T09:24:02.000Z'), FUSO_ITALIA_AGOSTO);
    const ala = istanteDaOraAParete(Date.parse('2026-08-24T08:24:35.000Z') + 60 * 60_000, FUSO_ITALIA_AGOSTO);
    expect(Math.abs(per - ala) / 1000).toBeLessThan(60);

    // E così si uniscono senza bisogno di nessuno sfasamento.
    const a = { ...ALADIN_2, startTime: new Date(ala).toISOString(), utcOffsetMinutes: 120 };
    const p = { ...PEREGRINE_2, startTime: new Date(per).toISOString(), utcOffsetMinutes: 120 };
    expect(likelySame(a, p, 0)).toBe(true);
  });

  it('l’ora mostrata non cambia: è sempre quella che segnava il computer', () => {
    // La correzione sposta l'istante, non il quadrante. Chi guarda il logbook
    // deve vedere le stesse 09:24 di prima, altrimenti la correzione sembra un
    // guasto.
    const vero = istanteDaOraAParete(Date.parse('2026-08-24T09:24:02.000Z'), FUSO_ITALIA_AGOSTO);
    const mostrata = new Date(vero + FUSO_ITALIA_AGOSTO * 60_000).toISOString().slice(11, 16);
    expect(mostrata).toBe('09:24');
  });
});

describe('l’unione manuale non deve inventare un orario', () => {
  it('il fuso non passa da una scheda con un altro orario', () => {
    /*
     * Il difetto sarebbe apparso al PRIMO uso dell'unione manuale, cioè
     * riparando a mano proprio queste quattro righe. La scheda che resta è
     * quella col profilo più ricco — il Peregrine, che porta tetto e TTS — e
     * `takeIfEmpty` le avrebbe attaccato il +60 dell'Aladin. Risultato:
     * 09:24 + 60 = 10:24, un'ora che nessuno dei due computer ha mai segnato.
     *
     * Il fuso è la seconda metà di `startTime`, non un campo per conto suo.
     */
    const fusa = mergeDive(PEREGRINE_2, ALADIN_2);
    expect(fusa.utcOffsetMinutes).toBeUndefined();
  });

  it('quando invece è lo stesso orario, il fuso si prende volentieri', () => {
    // Due letture a trentacinque secondi l'una dall'altra sono lo stesso
    // istante: lì il fuso dell'altra descrive anche questa.
    const vicina = { ...ALADIN_2, startTime: '2026-08-24T09:24:35.000Z' };
    const fusa = mergeDive({ ...PEREGRINE_2 }, vicina);
    expect(fusa.utcOffsetMinutes).toBe(60);
  });
});

describe('la rete di sicurezza: due coppie che concordano al secondo', () => {
  it('riconosce l’ora di scarto e unisce le quattro in due', () => {
    /*
     * Vale anche senza la correzione dell'ora — ed è il punto: un computer con
     * l'orologio impostato male è un fatto della vita, non un difetto nostro.
     * I due scarti misurati sono 3565 s e 3567 s.
     */
    const report = mergeImports([ALADIN_1, ALADIN_2], [PEREGRINE_1, PEREGRINE_2], '2026-08-24T09:06:24.668Z');
    expect(report.clockOffsets.length).toBe(1);
    expect(Math.round(report.clockOffsets[0].offsetMs / 1000)).toBe(-3566);
    expect(report.clockOffsets[0].pairs).toBe(2);
    expect(report.added).toBe(0);
    expect(report.merged).toBe(2);
    expect(report.dives).toHaveLength(2);
  });

  it('non accoppia la prima immersione di un computer con la seconda dell’altro', () => {
    /*
     * IL RISCHIO VERO di allargare la soglia. Fra la prima del Peregrine e la
     * seconda dell'Aladin ci sono 39 minuti e profondità e durate abbastanza
     * simili da passare i primi controlli: se lo sfasamento le mettesse in
     * corrispondenza, l'unione fonderebbe due immersioni DIVERSE — un danno
     * peggiore di quello che si sta riparando.
     */
    const report = mergeImports([ALADIN_1, ALADIN_2], [PEREGRINE_1, PEREGRINE_2], '2026-08-24T09:06:24.668Z');
    const per = report.dives.map((d) => d.startTime).sort();
    // Le due rimaste sono quelle dell'Aladin, ciascuna arricchita dalla sua.
    expect(per).toEqual(['2026-08-24T06:46:00.000Z', '2026-08-24T08:24:35.000Z']);
    /*
     * La prova che si sono accoppiate quelle GIUSTE: ciascuna delle due schede
     * rimaste porta dentro tutti e due gli apparecchi. Se lo sfasamento avesse
     * incrociato la prima con la seconda, una scheda avrebbe assorbito
     * un'immersione lunga cento secondi di più e profonda quasi un metro in
     * meno — e l'altra sarebbe rimasta sola.
     */
    for (const d of report.dives) {
      const modelli = [d.computer?.model, ...(d.otherComputers ?? []).map((c) => c.model)];
      expect(modelli).toContain('Scubapro Aladin Sport Matrix');
      expect(modelli).toContain('Shearwater Peregrine');
    }
  });

  it('due immersioni diverse con orario di bordo regolare NON diventano uno sfasamento', () => {
    /*
     * La ragione per cui la soglia era tre. Tre tuffi al giorno alle 09:00,
     * 11:30 e 14:30 per cinque giorni: le differenze fra tuffi diversi si
     * accumulano sugli stessi valori tondi. Concordano al minuto — non al
     * secondo, ed è lì che passa la distinzione.
     */
    const giorni = [12, 13, 14, 15, 16];
    const orari = [9, 11.5, 14.5];
    const archivio: Dive[] = [];
    giorni.forEach((g, gi) =>
      orari.forEach((o, oi) => {
        const h = Math.floor(o);
        const m = Math.round((o - h) * 60) + gi * 3 + oi; // nessuno entra allo stesso secondo
        archivio.push(
          immersione({
            id: `x${g}${oi}`,
            startTime: `2026-05-${g}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000Z`,
            maxDepth: 25,
            durationS: 2700,
            modello: 'Altro Computer',
            seriale: 'ZZZ',
            formato: 'uddf',
          }),
        );
      }),
    );
    // Un'immersione che l'archivio non ha, dello stesso stampo.
    const orfana = immersione({
      id: 'orfana',
      startTime: '2026-05-17T09:07:00.000Z',
      maxDepth: 25,
      durationS: 2700,
      modello: 'Ancora Un Altro',
      seriale: 'YYY',
      formato: 'uddf',
    });
    expect(inferClockOffsets(archivio, [orfana])).toEqual([]);
  });
});
