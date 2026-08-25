/**
 * Le immersioni di libdivecomputer, tradotte nel modello di casa.
 *
 * PERCHÉ QUESTI CONTROLLI ESISTONO PRIMA DELL'HARDWARE. Il guscio Rust si può
 * provare solo con un computer subacqueo in mano; questa metà no, ed è la metà
 * in cui stanno le convenzioni che si sbagliano — l'ora a parete, la profondità
 * che manca perché «non è cambiata», la bombola senza trasmettitore, il
 * profondimetro che non dichiara nessuna miscela. Ognuno di questi quattro casi
 * ha già prodotto un difetto vero in qualche altro punto del progetto.
 */

import { describe, expect, it } from 'vitest';
import { immersioneDaLdc, immersioniDaLdc, type ImmersioneLdc } from '../src/core/ble/esterni';

const IMPORTATA = '2026-08-25T09:00:00.000Z';

/**
 * Un'immersione come la manda `serde` dal guscio Rust.
 *
 * I nomi dei campi sono copiati da `#[serde(rename)]` in
 * `src-tauri/src/trasporto_ldc.rs`: se qualcuno li cambia di là senza cambiare
 * `esterni.ts`, l'oggetto qui smette di combaciare col tipo e il compilatore lo
 * dice. È l'unico legame automatico possibile fra due linguaggi diversi.
 */
function unaImmersione(sovrascrivi: Partial<ImmersioneLdc> = {}): ImmersioneLdc {
  return {
    // 24 agosto 2026, 07:46 sul quadrante — l'ora dichiarata dal proprietario
    // per la prima delle due immersioni di quel giorno.
    startMs: Date.parse('2026-08-24T07:46:00.000Z'),
    durationS: 2400,
    maxDepth: 23.4,
    tempMinC: 18.1,
    gas: [{ o2: 0.32, he: 0 }],
    samples: [
      { t: 0, depth: 0, pressureBar: [200] },
      { t: 10, depth: 12.2, tempC: 19.5 },
      { t: 20, ndlS: 3600 },
      { t: 30, depth: 23.4, pressureBar: [180], cns: 2 },
      { t: 40, depth: 5 },
      { t: 50, depth: 0.2 },
    ],
    ...sovrascrivi,
  };
}

describe('l’ora di un computer letto da libdivecomputer', () => {
  it('è un’ora A PARETE, e col fuso diventa l’istante giusto', () => {
    /*
     * IL DIFETTO DELLE QUATTRO IMMERSIONI, in forma di controllo.
     *
     * `startMs` è l'ora che il computer segnava, letta come se fosse UTC.
     * Trattarla come un istante assoluto è esattamente ciò che il 24 agosto
     * 2026 ha fatto entrare due immersioni in archivio quattro volte. Col fuso
     * dell'Italia d'estate (+120), le 07:46 sul quadrante sono le 05:46Z.
     */
    const d = immersioneDaLdc(unaImmersione(), {
      marca: 'Heinrichs Weikamp',
      modello: 'OSTC 4',
      fuso: () => 120,
      importedAt: IMPORTATA,
    })!;
    expect(d.startTime).toBe('2026-08-24T05:46:00.000Z');
    expect(d.utcOffsetMinutes).toBe(120);
  });

  it('senza fuso NON dichiara un fuso, invece di inventarne uno', () => {
    // L'ambiguità detta vale più di un numero comodo: `utcOffsetMinutes`
    // assente è il modo in cui l'applicazione dice «questa è l'ora a parete».
    const d = immersioneDaLdc(unaImmersione(), {
      marca: 'Mares',
      modello: 'Genius',
      importedAt: IMPORTATA,
    })!;
    expect(d.startTime).toBe('2026-08-24T07:46:00.000Z');
    expect(d.utcOffsetMinutes).toBeUndefined();
  });
});

describe('i campioni', () => {
  it('riportano avanti la profondità quando il computer dice «non è cambiata»', () => {
    /*
     * libdivecomputer manda l'istante e poi i soli valori cambiati: il campione
     * a t=20 qui ha solo l'NDL. Uno zero al suo posto disegnerebbe
     * un'immersione che risale in superficie e ridiscende ogni volta che il
     * subacqueo sta fermo — cioè il grafico peggiore possibile per un logbook.
     */
    const d = immersioneDaLdc(unaImmersione(), {
      marca: 'Suunto',
      modello: 'EON Steel',
      importedAt: IMPORTATA,
    })!;
    const a20 = d.samples!.find((s) => s.t === 20)!;
    expect(a20.depth).toBe(12.2);
    expect(a20.ndlS).toBe(3600);
  });

  it('buttano i campioni PRIMA della prima profondità nota', () => {
    // Non c'è niente da riportare avanti, e uno zero inventato sarebbe una
    // discesa dalla superficie che il computer non ha registrato.
    const d = immersioneDaLdc(
      unaImmersione({
        samples: [
          { t: 0, tempC: 21 },
          { t: 10, tempC: 20 },
          { t: 20, depth: 8 },
          { t: 30, depth: 9 },
        ],
      }),
      { marca: 'Cressi', modello: 'Goa', importedAt: IMPORTATA },
    )!;
    expect(d.samples!.map((s) => s.t)).toEqual([20, 30]);
  });

  it('una bombola senza lettura resta senza lettura, non a zero bar', () => {
    /*
     * Il lato Rust manda `Vec<Option<f64>>`, cioè `[203, null]` in JSON: la
     * seconda bombola non ha il trasmettitore. Uno zero lì significa «bombola
     * vuota» — il messaggio opposto — e finisce dritto nel calcolo del consumo.
     */
    const d = immersioneDaLdc(
      unaImmersione({
        gas: [
          { o2: 0.32, he: 0 },
          { o2: 0.5, he: 0 },
        ],
        samples: [
          { t: 0, depth: 1, pressureBar: [203, null] },
          { t: 10, depth: 12, pressureBar: [198, null] },
        ],
      }),
      { marca: 'Shearwater', modello: 'Perdix 2', importedAt: IMPORTATA },
    )!;
    expect(d.samples![0].pressureBar).toEqual([203, undefined]);
  });
});

describe('quello che non arriva e quello che si assume', () => {
  it('un profondimetro senza miscele dichiarate respira aria, non niente', () => {
    const d = immersioneDaLdc(unaImmersione({ gas: [] }), {
      marca: 'Ratio',
      modello: 'iX3M 2 Tech+',
      importedAt: IMPORTATA,
    })!;
    expect(d.cylinders).toEqual([{ mix: { o2: 0.21, he: 0 } }]);
  });

  it('«ossigeno zero» di alcuni firmware vuol dire aria, non ipossia', () => {
    /*
     * È una convenzione del firmware, non un errore della libreria: alcune
     * famiglie dichiarano 0 per «aria». Passato così com'è produrrebbe una
     * PPO2 di zero e un'immersione che risulta respirata in ipossia grave.
     */
    const d = immersioneDaLdc(unaImmersione({ gas: [{ o2: 0, he: 0 }] }), {
      marca: 'Oceanic',
      modello: 'Geo 4.0',
      importedAt: IMPORTATA,
    })!;
    expect(d.cylinders[0].mix).toEqual({ o2: 0.21, he: 0 });
  });

  it('la provenienza è dichiarata, perché spiega i campi vuoti', () => {
    const d = immersioneDaLdc(unaImmersione(), {
      marca: 'Divesoft',
      modello: 'Freedom',
      dispositivo: 'ABC-123',
      importedAt: IMPORTATA,
    })!;
    expect(d.source?.format).toBe('libdivecomputer');
    expect(d.computer?.model).toBe('Divesoft Freedom');
    // I gradient factor NON si inventano: libdivecomputer non li espone in modo
    // uniforme fra le famiglie, e la «conservatism» di un Suunto non è un GF.
    expect(d.computer?.gfLow).toBeUndefined();
    expect(d.computer?.gfHigh).toBeUndefined();
  });

  it('la profondità massima è il massimo fra il dichiarato e i campioni', () => {
    /*
     * Il difetto già visto col Peregrine: su un record troncato l'intestazione
     * dichiara zero, `??` non intercetta lo zero, e l'immersione entra in
     * archivio a ZERO METRI con un profilo che arriva a ventitré — senza un
     * solo errore a schermo, e con ogni statistica sbagliata da lì in poi.
     */
    const d = immersioneDaLdc(unaImmersione({ maxDepth: 0 }), {
      marca: 'Apeks',
      modello: 'DSX',
      importedAt: IMPORTATA,
    })!;
    expect(d.maxDepth).toBe(23.4);
  });

  it('un record vuoto non è un’immersione e non entra in archivio', () => {
    // La memoria di alcuni computer contiene record vuoti o troncati. Farli
    // entrare vuol dire immersioni di zero minuti da cancellare a mano.
    const vuota = immersioneDaLdc(unaImmersione({ durationS: 0, maxDepth: 0, samples: [] }), {
      marca: 'Mares',
      modello: 'Quad Ci',
      importedAt: IMPORTATA,
    });
    expect(vuota).toBeUndefined();
  });
});

describe('l’elenco', () => {
  it('esce dalla più recente alla più vecchia, che è l’ordine del segnalibro', () => {
    /*
     * NON È ESTETICA. Il primo elemento diventa il segnalibro da cui ripartirà
     * il prossimo scarico: un ordine diverso sposterebbe il segnalibro
     * sull'immersione sbagliata, e le successive non tornerebbero più.
     */
    const vecchia = unaImmersione({ startMs: Date.parse('2026-08-20T09:00:00Z') });
    const nuova = unaImmersione({ startMs: Date.parse('2026-08-24T07:46:00Z') });
    const out = immersioniDaLdc([vecchia, nuova], {
      marca: 'Scubapro',
      modello: 'G3',
      importedAt: IMPORTATA,
    });
    expect(out.map((d) => d.startTime.slice(0, 10))).toEqual(['2026-08-24', '2026-08-20']);
  });

  it('i record vuoti spariscono senza far cadere gli altri', () => {
    const out = immersioniDaLdc(
      [unaImmersione({ durationS: 0, maxDepth: 0, samples: [] }), unaImmersione()],
      { marca: 'Suunto', modello: 'D5', importedAt: IMPORTATA },
    );
    expect(out.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// I sei difetti del debug del 25 agosto 2026.
//
// Tutti trovati da una revisione avversariale con l'intera catena di controlli
// VERDE: tipi, 1382 test, lint, formato, build, cargo con e senza
// libdivecomputer, e la compilazione per iPhone. Nessuno di loro dava errore —
// è il motivo per cui esistono questi controlli e non un giro di prove a mano.
// ---------------------------------------------------------------------------

describe('i difetti del 25 agosto', () => {
  it('le pressioni sono indicizzate sulle BOMBOLE, non sulle miscele', () => {
    /*
     * Un computer integrato con UN gas dichiarato e il trasmettitore sulla
     * seconda bombola è la normalità, non un caso limite. Prima: `cylinders`
     * nasceva dalle miscele, quindi era lungo 1, e la pressione in posizione 1
     * veniva letta come se fosse della bombola 0 — o buttata. Il logbook
     * scriveva «nessuna pressione bombola: consumo gas non calcolabile» su
     * un'immersione in cui il computer aveva registrato 130 bar consumati.
     */
    const d = immersioneDaLdc(
      unaImmersione({
        gas: [{ o2: 0.21, he: 0 }],
        bombole: [{ gasIndex: 0 }, { gasIndex: 0, sizeL: 12, startBar: 220, endBar: 90 }],
        samples: [
          { t: 0, depth: 1, pressureBar: [null, 220] },
          { t: 900, depth: 20, pressureBar: [null, 150] },
          { t: 1800, depth: 0.5, pressureBar: [null, 90] },
        ],
      }),
      { marca: 'Aqualung', modello: 'i770R', importedAt: IMPORTATA },
    )!;
    expect(d.cylinders.length).toBe(2);
    expect(d.cylinders[1]).toMatchObject({ sizeL: 12, startBar: 220, endBar: 90 });
    expect(d.samples![0].pressureBar).toEqual([undefined, 220]);
    // E il consumo si calcola, che è il punto di tutto quanto sopra.
    expect(d.metrics?.quality.hasTankPressure).toBe(true);
    expect(d.metrics?.sacBarPerMin).toBeGreaterThan(0);
  });

  it('una pressione che punta a una bombola inesistente si butta', () => {
    // `Sample.pressureBar` è indicizzata come `Dive.cylinders`: una posizione in
    // più attribuirebbe una pressione a un contenitore che nell'immersione non
    // c'è, e tutto ciò che sta a valle si fida di quella corrispondenza.
    const d = immersioneDaLdc(
      unaImmersione({
        gas: [{ o2: 0.21, he: 0 }],
        bombole: [{ gasIndex: 0 }],
        samples: [{ t: 0, depth: 5, pressureBar: [200, 180, 160] }],
      }),
      { marca: 'Suunto', modello: 'D5', importedAt: IMPORTATA },
    )!;
    expect(d.samples![0].pressureBar).toEqual([200]);
  });

  it('la profondità media e la temperatura del computer non si buttano', () => {
    /*
     * Non è ridondanza col profilo: `computeMetrics` le usa come RIPIEGO quando
     * il profilo non c'è, e i record di sola sintesi esistono su parecchi
     * computer. Prima quelle immersioni entravano senza profondità media, senza
     * pressione ambiente media e senza temperatura.
     */
    const d = immersioneDaLdc(unaImmersione({ samples: [], avgDepth: 14.2, tempMinC: 12.5 }), {
      marca: 'Mares',
      modello: 'Genius',
      importedAt: IMPORTATA,
    })!;
    expect(d.avgDepth).toBe(14.2);
    expect(d.minTempC).toBe(12.5);
    expect(d.metrics?.avgAta).toBeGreaterThan(2);
  });

  it('un rebreather non entra in archivio a circuito aperto', () => {
    // Prima `mode` era `'oc'` fisso. Le CCR si contano a parte, l'apnea e il
    // profondimetro vengono esclusi dalle statistiche che falserebbero, e la
    // modalità finisce sul libretto a valore legale.
    const ccr = immersioneDaLdc(unaImmersione({ mode: 'ccr' }), {
      marca: 'Divesoft',
      modello: 'Liberty',
      importedAt: IMPORTATA,
    })!;
    expect(ccr.mode).toBe('ccr');
    // Senza dichiarazione resta 'oc', che è un ripiego dichiarato e non
    // un'invenzione.
    expect(immersioneDaLdc(unaImmersione(), { marca: 'x', modello: 'y', importedAt: IMPORTATA })!.mode).toBe(
      'oc',
    );
  });

  it('un record senza data non entra, e lo dice', () => {
    /*
     * Zero millisecondi è un istante legittimo — il 1° gennaio 1970 — quindi
     * senza bandiera non c'era modo di distinguerlo da «non lo so». Col fuso
     * applicato sopra, l'immersione entrava in archivio datata 31 dicembre 1969,
     * e da lì avvelenava la catena dei tessuti e il raggruppamento per giornata.
     */
    const motivi: string[] = [];
    const d = immersioneDaLdc(unaImmersione({ startMs: 0, senzaData: true }), {
      marca: 'Cressi',
      modello: 'Goa',
      fuso: () => 120,
      importedAt: IMPORTATA,
      onScarto: (m) => motivi.push(m),
    });
    expect(d).toBeUndefined();
    expect(motivi).toHaveLength(1);
    expect(motivi[0]).toContain('data');
  });

  it('la durata è il MASSIMO dei tempi, non l’ultimo campione', () => {
    // Con istanti non ordinati, l'ultimo campione dava 60 secondi su
    // un'immersione di cinquanta minuti: la deduplica non riconosceva più la
    // stessa immersione da un'altra fonte, e il consumo veniva diviso per un
    // minuto invece che per cinquanta.
    const d = immersioneDaLdc(
      unaImmersione({
        durationS: 0,
        samples: [
          { t: 0, depth: 5 },
          { t: 3000, depth: 30 },
          { t: 60, depth: 12 },
        ],
      }),
      { marca: 'Oceanic', modello: 'Geo 4.0', importedAt: IMPORTATA },
    )!;
    expect(d.durationS).toBe(3000);
    expect(d.maxDepth).toBe(30);
  });
});
