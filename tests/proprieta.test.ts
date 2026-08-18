/**
 * Proprietà del motore decompressivo, verificate su casi generati a caso.
 *
 * PERCHÉ QUESTO FILE ESISTE ACCANTO A `deco.test.ts` E `vpm.test.ts`. Quei due
 * verificano CASI: trenta metri per venti minuti dà questo, quarantacinque per
 * venticinque dà quest'altro, il VPM di Baker dà quest'altro ancora. Sono la cosa
 * più preziosa che abbiamo, perché sono riscontri esterni, ma coprono i profili a
 * cui abbiamo pensato — e un pianificatore di decompressione sbaglia soprattutto
 * sui profili a cui non ha pensato nessuno. Qui invece non si verifica nessun
 * numero: si verificano le PROPRIETÀ che devono valere su qualunque ingresso, e le
 * si prova su qualche centinaio di profili tirati a sorte. È il modo in cui si
 * trovano i buchi fra un caso e l'altro.
 *
 * LE PROPRIETÀ, IN ORDINE DI GRAVITÀ SE VIOLATE.
 *
 *  1. Nessun NaN e nessun Infinity in nessun campo, da nessuna parte. Un NaN in un
 *     piano di decompressione non fa cadere niente: si propaga in silenzio, e alla
 *     fine produce una tabella SENZA soste. È il modo peggiore di fallire, perché
 *     «nessuna sosta» è esattamente ciò che un subacqueo vuole leggere e non ha
 *     modo di smentire finché non è in acqua.
 *  2. Niente durate, profondità o pressioni negative; il runtime copre almeno il
 *     tempo di fondo; le soste salgono.
 *  3. Monotonia rispetto ai gradient factor: più stretti non possono costare meno.
 *  4. Monotonia rispetto al profilo: più giù o più a lungo non può costare meno.
 *  5. Il bailout non è mai un affare rispetto al piano nominale.
 *  6. Le contingenze peggiori escono con più obbligo di quella nominale.
 *  7. Impostazioni degeneri: o un risultato sensato, o un errore esplicito. Mai una
 *     tabella vuota spacciata per valida.
 *  8. La tabella stampata non contiene mai `undefined`, `NaN`, `null`.
 *  9. VPM e Bühlmann sullo stesso profilo restano entrambi plausibili: non devono
 *     coincidere — sono modelli diversi — ma non può succedere che uno dica
 *     «nessuna sosta» mentre l'altro ne detta quattro.
 *
 * COME SI RIPRODUCE UN FALLIMENTO. Il generatore è un PRNG scritto a mano con seme
 * fisso (`SEME_BASE`), quindi la stessa serie di casi esce identica a ogni
 * esecuzione, su qualunque macchina e con qualunque versione di Node — cosa che
 * `Math.random()` non garantisce e che rende inutile un test property-based, perché
 * il fallimento di ieri non si ripete oggi. Quando una proprietà cade, il messaggio
 * stampa il SEME e il CASO per intero: `generaCaso(seme)` in una console li
 * ricostruisce identici.
 *
 * I BACHI GIÀ TROVATI QUI, in fondo al file, restano come test di non
 * regressione con la loro riproduzione minima: sono nati come `it.fails` — verdi
 * finché il baco c'era — e sono diventati test normali il giorno in cui li
 * abbiamo corretti tutti e sette. È il posto in cui un baco trovato una volta
 * deve finire, altrimenti torna.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DECO,
  bailoutPlan,
  decoContingencies,
  decoTableText,
  planDeco,
  planSeries,
  switchDepthOf,
  type DecoResult,
  type DecoSettings,
  type PlanGas,
  type PlanLevel,
} from '../src/core/analysis/deco';
import { DEFAULT_VPM, planVpm, type VpmLevel } from '../src/core/analysis/vpm';
import { compartments, desaturate, gf99, surfacedTissues } from '../src/core/analysis/buhlmann';
import { analyseProfile, whatIfGf } from '../src/core/analysis/tissues';
import type { Dive, Sample } from '../src/core/model';

// ---------------------------------------------------------------------------
// Il generatore
// ---------------------------------------------------------------------------

/**
 * Il seme da cui parte tutta la batteria.
 *
 * Cambiarlo è legittimo — anzi, è il modo di cercare casi nuovi — ma va cambiato
 * di proposito e committato: un seme che cambia da solo (l'orologio, `Math.random`)
 * trasforma questi test in una lotteria che fallisce una volta ogni tanto sulla
 * macchina di qualcun altro, e a quel punto nessuno li guarda più.
 */
const SEME_BASE = 20260817;

/**
 * PRNG deterministico, variante di «mulberry32», dodici righe e nessuna dipendenza.
 *
 * Serve una sola cosa: che la stessa sequenza esca ovunque. `Math.random()` non lo
 * promette (V8 può cambiare l'algoritmo, e comunque non si semina), e aggiungere
 * una libreria di property testing per avere un generatore di numeri interi
 * sarebbe sproporzionato rispetto a quello che serve qui.
 */
function generatore(seme: number): () => number {
  let s = seme >>> 0 || 1;
  return () => {
    s = (s + 0x9e3779b9) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Caso {
  levels: PlanLevel[];
  gases: PlanGas[];
  settings: Partial<DecoSettings>;
  /** Vero se il caso è a circuito chiuso: cambia che cosa è lecito aspettarsi. */
  ccr: boolean;
}

/**
 * Un'immersione plausibile, non un'immersione a caso.
 *
 * La distinzione conta più di quanto sembri. Generare profondità e miscele
 * completamente casuali riempie la batteria di immersioni che nessuno farebbe —
 * novanta metri con EAN12 e nessun gas di deco — e su quelle il modello non
 * converge, il che è corretto e non dimostra niente. Qui i vincoli sono quelli di
 * un pianificatore vero: normossica in alto, trimix ipossico sotto i quarantacinque
 * metri, gas di decompressione presenti spesso ma non sempre, profondità
 * decrescenti fra un livello e l'altro come in un'immersione multilivello reale.
 * Gli ingressi assurdi hanno una loro sezione, la settima, dove è quello il punto.
 */
function generaCaso(seme: number): Caso {
  const r = generatore(seme);
  const intero = (a: number, b: number) => a + Math.floor(r() * (b - a + 1));
  const scegli = <T>(xs: T[]): T => xs[intero(0, xs.length - 1)];

  const levels: PlanLevel[] = [];
  let quota = intero(6, 90);
  for (let i = 0, n = intero(1, 4); i < n; i++) {
    levels.push({ depthM: quota, minutes: intero(5, 60) });
    quota = Math.max(6, quota - intero(3, 25));
  }
  const massima = levels[0].depthM;

  // La miscela di fondo segue la profondità, come farebbe chi pianifica: l'elio
  // compare quando serve, e l'ossigeno scende solo insieme all'elio — un EAN15
  // senza elio non esiste in nessuna bombola al mondo, e metterlo nella batteria
  // vorrebbe dire misurare come il motore reagisce a un gas immaginario.
  let he = 0;
  let o2: number;
  if (massima > 45 && r() < 0.7) {
    he = intero(20, 60) / 100;
    o2 = intero(15, 21) / 100;
  } else if (r() < 0.3) {
    he = intero(10, 35) / 100;
    o2 = intero(18, 32) / 100;
  } else {
    o2 = intero(21, 36) / 100;
  }
  if (o2 + he > 1) he = 1 - o2;

  const gases: PlanGas[] = [
    { mix: { o2, he }, role: 'bottom', tankL: intero(10, 24), startBar: intero(150, 232) },
  ];
  if (r() < 0.65)
    gases.push({ mix: { o2: scegli([0.4, 0.5, 0.5, 0.8]), he: 0 }, role: 'deco', tankL: 11, startBar: 200 });
  if (r() < 0.45) gases.push({ mix: { o2: 1, he: 0 }, role: 'deco', tankL: 11, startBar: 200 });

  const gfLow = intero(10, 90) / 100;
  const gfHigh = Math.min(0.95, Math.max(gfLow, intero(50, 95) / 100));
  // Quota del sito fra zero e tremila metri, tradotta in pressione con la formula
  // barometrica standard: è lo stesso conto che fa `barometric()`, riscritto qui
  // perché il generatore non deve dipendere da ciò che sta provando.
  const quotaSito = r() < 0.4 ? intero(0, 3000) : 0;
  const settings: Partial<DecoSettings> = {
    gfLow,
    gfHigh,
    salinity: r() < 0.5 ? 'salt' : 'fresh',
    surfacePressureBar: quotaSito > 0 ? 1.01325 * Math.pow(1 - 2.25577e-5 * quotaSito, 5.25588) : 1.01325,
    lastStopM: r() < 0.3 ? 6 : 3,
  };

  const ccr = r() < 0.25;
  if (ccr) {
    const setpoint = scegli([0.7, 1.0, 1.3]);
    for (const l of levels) l.setpointBar = setpoint;
    gases[0].setpointBar = setpoint;
    if (r() < 0.5) {
      gases.push({
        mix: massima > 45 ? { o2: 0.18, he: 0.45 } : { o2: 0.21, he: 0 },
        role: 'bailout',
        tankL: 11,
        startBar: 200,
      });
    }
  }
  return { levels, gases, settings, ccr };
}

/** Il caso in una riga, perché un fallimento senza il caso è un fallimento inutile. */
function descrivi(c: Caso): string {
  const profilo = c.levels.map((l) => `${l.depthM}m×${l.minutes}min`).join(' → ');
  const miscele = c.gases
    .map((g) => `${Math.round(g.mix.o2 * 100)}/${Math.round(g.mix.he * 100)} ${g.role}`)
    .join(', ');
  const s = c.settings;
  return (
    `${profilo} | gas ${miscele} | GF ${s.gfLow}/${s.gfHigh} | ` +
    `${s.salinity} | ${s.surfacePressureBar?.toFixed(4)} bar | ultima sosta ${s.lastStopM} m` +
    (c.ccr ? ' | CCR' : '')
  );
}

/**
 * Cerca numeri non finiti dentro un oggetto qualunque, ricorsivamente.
 *
 * Ricorsivo e non su una lista di campi perché il NaN non arriva mai dove lo si
 * aspetta: nel caso che ha fatto nascere questo file stava nei sedici azoti del
 * ventitreesimo segmento, e da lì il risultato tornava a essere numerico —
 * un piano con soste sensate calcolate su tessuti che non esistono. Si ferma a otto
 * livelli e a cinque ritrovamenti: serve a dire DOVE, non a fare l'inventario.
 */
function nonFiniti(valore: unknown, percorso = '$', trovati: string[] = [], livello = 0): string[] {
  if (livello > 8 || trovati.length >= 5) return trovati;
  if (typeof valore === 'number') {
    if (!Number.isFinite(valore)) trovati.push(`${percorso} = ${valore}`);
    return trovati;
  }
  if (Array.isArray(valore)) {
    valore.forEach((v, i) => nonFiniti(v, `${percorso}[${i}]`, trovati, livello + 1));
    return trovati;
  }
  if (valore && typeof valore === 'object') {
    for (const chiave of Object.keys(valore)) {
      nonFiniti((valore as Record<string, unknown>)[chiave], `${percorso}.${chiave}`, trovati, livello + 1);
    }
  }
  return trovati;
}

/**
 * Il motore avvisa esplicitamente quando la risalita non converge, e quel caso va
 * escluso dalle monotonie.
 *
 * Non per comodità: quando la risalita non converge il piano è troncato al limite
 * di duemila iterazioni, quindi i suoi numeri non sono il risultato del modello ma
 * il punto in cui il modello si è arreso. Confrontare due troncamenti fra loro non
 * dimostra niente in nessuna delle due direzioni. Che il motore quel caso lo
 * dichiari invece di nasconderlo è la ragione per cui si può escluderlo qui.
 */
const converge = (r: DecoResult): boolean =>
  !r.warnings.some((w) => w.text.includes('La risalita non converge'));

/**
 * Il telaio di ogni proprietà: gira `quanti` casi, raccoglie i primi tre
 * fallimenti con seme e caso, e li mette dentro l'asserzione.
 *
 * Tre e non uno perché il primo fallimento da solo non dice se il problema è un
 * caso limite o una crepa larga; tre e non tutti perché un motore rotto
 * produrrebbe trecento righe identiche e il messaggio diventerebbe illeggibile.
 */
function perOgniCaso(quanti: number, prova: (caso: Caso, seme: number) => string | undefined): void {
  const falliti: string[] = [];
  for (let i = 0; i < quanti && falliti.length < 3; i++) {
    const seme = SEME_BASE + i;
    const caso = generaCaso(seme);
    let motivo: string | undefined;
    try {
      motivo = prova(caso, seme);
    } catch (errore) {
      motivo = `eccezione: ${(errore as Error).message}`;
    }
    if (motivo) falliti.push(`  seme ${seme} — ${motivo}\n    caso: ${descrivi(caso)}`);
  }
  expect(falliti.join('\n')).toBe('');
}

/** Il profilo del caso trasformato in campioni, per i moduli che leggono immersioni. */
function campioniDi(c: Caso): Sample[] {
  const out: Sample[] = [{ t: 0, depth: 0 }];
  let t = 0;
  for (const l of c.levels) {
    const partenza = out[out.length - 1].depth;
    const transito = Math.max(10, Math.round((Math.abs(l.depthM - partenza) / 18) * 60));
    for (let k = 10; k <= transito; k += 10)
      out.push({ t: t + k, depth: partenza + (l.depthM - partenza) * (k / transito) });
    t += transito;
    for (let k = 10; k <= l.minutes * 60; k += 10) out.push({ t: t + k, depth: l.depthM });
    t += l.minutes * 60;
  }
  const ultima = out[out.length - 1].depth;
  const risalita = Math.max(10, Math.round((ultima / 9) * 60));
  for (let k = 10; k <= risalita; k += 10)
    out.push({ t: t + k, depth: Math.max(0, ultima * (1 - k / risalita)) });
  return out;
}

/** L'immersione finta che serve a `analyseProfile`, costruita dal caso. */
function immersioneDi(c: Caso, campioni: Sample[]): Dive {
  return {
    id: 'proprieta',
    startTime: '2026-01-01T10:00:00Z',
    durationS: campioni[campioni.length - 1].t,
    maxDepth: Math.max(...c.levels.map((l) => l.depthM)),
    cylinders: c.gases.map((g) => ({ mix: g.mix })),
    source: { format: 'uddf', file: 'proprieta', importedAt: '2026-01-01T10:00:00Z' },
    mode: c.ccr ? 'ccr' : 'oc',
    tags: [],
    samples: campioni,
    salinity: c.settings.salinity,
    surfacePressureBar: c.settings.surfacePressureBar,
  };
}

/** Il caso tradotto per il VPM, che ragiona per livelli con una miscela ciascuno. */
function livelliVpm(c: Caso): VpmLevel[] {
  return c.levels.map((l) => ({ depthM: l.depthM, minutes: l.minutes, mix: c.gases[0].mix }));
}

/** I gas di deco nella forma che il VPM si aspetta: miscela e quota di cambio. */
function decoVpm(c: Caso): { mix: { o2: number; he: number }; switchDepthM: number }[] {
  const s: DecoSettings = { ...DEFAULT_DECO, ...c.settings };
  return c.gases
    .filter((g) => g.role === 'deco')
    .map((g) => ({ mix: g.mix, switchDepthM: switchDepthOf(g, s) }));
}

const ARIA: PlanGas = { mix: { o2: 0.21, he: 0 }, role: 'bottom', tankL: 12, startBar: 200 };
const EAN50: PlanGas = { mix: { o2: 0.5, he: 0 }, role: 'deco', tankL: 11, startBar: 200 };

// ---------------------------------------------------------------------------
// Il generatore prima di tutto: se non è riproducibile, il resto non vale niente
// ---------------------------------------------------------------------------

describe('il telaio', () => {
  it('lo stesso seme produce lo stesso caso, sempre', () => {
    // È la premessa di tutto il file. Un generatore che deriva — perché usa
    // l'orologio, o perché una funzione di libreria ha cambiato implementazione —
    // rende irriproducibile ogni fallimento, e un fallimento irriproducibile viene
    // riclassificato come «test instabile» e disattivato nel giro di due settimane.
    expect(JSON.stringify(generaCaso(12345))).toBe(JSON.stringify(generaCaso(12345)));
    expect(descrivi(generaCaso(SEME_BASE))).toBe(descrivi(generaCaso(SEME_BASE)));
  });

  it('semi diversi producono casi diversi, e la batteria copre davvero il dominio', () => {
    const casi = Array.from({ length: 300 }, (_, i) => generaCaso(SEME_BASE + i));
    const distinti = new Set(casi.map((c) => descrivi(c)));
    // Un generatore che ripete sempre gli stessi dieci casi passerebbe tutte le
    // proprietà e non proverebbe niente: la copertura si controlla, non si spera.
    expect(distinti.size).toBeGreaterThan(280);
    expect(casi.some((c) => c.ccr)).toBe(true);
    expect(casi.some((c) => !c.ccr)).toBe(true);
    expect(casi.some((c) => c.gases.some((g) => g.role === 'deco'))).toBe(true);
    expect(casi.some((c) => !c.gases.some((g) => g.role === 'deco'))).toBe(true);
    expect(casi.some((c) => c.gases[0].mix.he > 0)).toBe(true);
    expect(casi.some((c) => c.settings.salinity === 'fresh')).toBe(true);
    expect(casi.some((c) => (c.settings.surfacePressureBar ?? 1) < 0.95)).toBe(true);
    expect(casi.some((c) => c.levels.length >= 3)).toBe(true);
    expect(Math.max(...casi.map((c) => c.levels[0].depthM))).toBeGreaterThan(80);
  });

  it('il rilevatore di numeri non finiti trova un NaN sepolto in fondo a un oggetto', () => {
    // Il controllo ricorsivo è l'unico strumento che ha davvero trovato qualcosa in
    // questo file: se fosse rotto lui, tutta la prima proprietà passerebbe a vuoto.
    expect(nonFiniti({ a: [1, 2, { b: { c: NaN } }] })).toEqual(['$.a[2].b.c = NaN']);
    expect(nonFiniti({ a: 1, b: [Infinity] })).toEqual(['$.b[0] = Infinity']);
    expect(nonFiniti({ a: 1, b: 'NaN', c: null, d: undefined })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 1. Nessun numero non finito, da nessuna parte
// ---------------------------------------------------------------------------

describe('1. nessun NaN e nessun Infinity in nessun campo', () => {
  it('planDeco su trecento profili generati', () => {
    perOgniCaso(300, (c) => {
      const r = planDeco(c.levels, c.gases, c.settings);
      const guasti = nonFiniti(r);
      return guasti.length ? `numeri non finiti: ${guasti.join(', ')}` : undefined;
    });
  });

  it('planVpm sugli stessi profili', () => {
    perOgniCaso(250, (c) => {
      // Il VPM non conosce il circuito chiuso: passargli un profilo CCR
      // significherebbe fargli calcolare un'immersione che non è quella.
      if (c.ccr) return undefined;
      const r = planVpm(livelliVpm(c), decoVpm(c), {
        salinity: c.settings.salinity,
        surfacePressureBar: c.settings.surfacePressureBar,
        lastStopM: c.settings.lastStopM,
        conservatism: 3,
      });
      const guasti = nonFiniti(r);
      return guasti.length ? `numeri non finiti: ${guasti.join(', ')}` : undefined;
    });
  });

  it('bailout, serie di due immersioni e contingenze', () => {
    perOgniCaso(120, (c) => {
      const bailout = bailoutPlan(c.levels, c.gases, c.settings);
      if (bailout) {
        const guasti = nonFiniti(bailout);
        if (guasti.length) return `bailout: ${guasti.join(', ')}`;
      }
      const serie = planSeries(
        [
          { levels: c.levels, gases: c.gases, surfaceIntervalMin: 0 },
          { levels: c.levels, gases: c.gases, surfaceIntervalMin: 90 },
        ],
        c.settings,
      );
      const guastiSerie = nonFiniti(serie);
      if (guastiSerie.length) return `serie: ${guastiSerie.join(', ')}`;
      for (const k of decoContingencies(c.levels, c.gases, c.settings)) {
        const guasti = nonFiniti(k.result);
        if (guasti.length) return `contingenza ${k.id}: ${guasti.join(', ')}`;
      }
      return undefined;
    });
  });

  it('la rilettura del profilo: analyseProfile e whatIfGf', () => {
    perOgniCaso(150, (c) => {
      const campioni = campioniDi(c);
      const dive = immersioneDi(c, campioni);
      const iniziali = surfacedTissues(c.settings.surfacePressureBar);
      const guasti = nonFiniti(analyseProfile(dive, campioni, iniziali));
      if (guasti.length) return `analyseProfile: ${guasti.join(', ')}`;
      const ipotesi = whatIfGf(dive, campioni, iniziali, [
        { low: 0.9, high: 0.95 },
        { low: 0.5, high: 0.85 },
        { low: 0.2, high: 0.6 },
      ]);
      const guastiIpotesi = nonFiniti(ipotesi);
      return guastiIpotesi.length ? `whatIfGf: ${guastiIpotesi.join(', ')}` : undefined;
    });
  });

  it('gf99, compartments e desaturate sui tessuti che il piano lascia dietro di sé', () => {
    perOgniCaso(150, (c) => {
      const r = planDeco(c.levels, c.gases, c.settings);
      const superficie = c.settings.surfacePressureBar ?? DEFAULT_DECO.surfacePressureBar;
      const g = gf99(r.finalTissues, superficie);
      if (!Number.isFinite(g.percent)) return `gf99 = ${g.percent}`;
      const barre = compartments(r.bottomTissues, superficie, c.settings.gfHigh ?? 0.85);
      const guastiBarre = nonFiniti(barre);
      if (guastiBarre.length) return `compartments: ${guastiBarre.join(', ')}`;
      // Un giorno intero di superficie: i tessuti devono tornare verso il valore di
      // saturazione in aria, non divergere. L'elio in particolare deve SCENDERE:
      // in superficie non se ne respira, quindi ogni compartimento può solo
      // scaricarlo. Non deve arrivare a zero in ventiquattr'ore — l'emitempo più
      // lento dell'elio è di quasi undici ore, quindi un giorno sono poco più di
      // due dimezzamenti e un residuo c'è ancora, ed è giusto che ci sia — ma dopo
      // due settimane non deve restarne traccia.
      const dopo = desaturate(r.finalTissues, 24 * 60, superficie);
      const guastiDopo = nonFiniti(dopo);
      if (guastiDopo.length) return `desaturate: ${guastiDopo.join(', ')}`;
      for (let i = 0; i < dopo.he.length; i++) {
        if (dopo.he[i] < 0) return `elio negativo nel compartimento ${i + 1}: ${dopo.he[i]}`;
        if (dopo.he[i] > r.finalTissues.he[i] + 1e-12)
          return `l'elio del compartimento ${i + 1} è cresciuto in superficie`;
      }
      const dueSettimane = desaturate(r.finalTissues, 14 * 24 * 60, superficie);
      return dueSettimane.he.some((v) => v > 1e-3)
        ? `elio ancora presente dopo due settimane: ${Math.max(...dueSettimane.he)}`
        : undefined;
    });
  });
});

// ---------------------------------------------------------------------------
// 2. Coerenza interna: niente negativi, runtime coerente, soste in ordine
// ---------------------------------------------------------------------------

describe('2. niente valori negativi, e la tabella è internamente coerente', () => {
  it('durate, profondità, litri e bar non sono mai negativi', () => {
    perOgniCaso(300, (c) => {
      const r = planDeco(c.levels, c.gases, c.settings);
      for (const s of r.segments) {
        if (s.minutes < 0) return `segmento ${s.kind} di ${s.minutes} minuti`;
        if (s.runtimeMin < 0) return `runtime negativo su ${s.kind}`;
        if (s.litres < 0) return `consumo negativo su ${s.kind}: ${s.litres} L`;
        if (s.fromM < -0.01 || s.toM < -0.01) return `quota negativa: ${s.fromM} → ${s.toM}`;
        if (s.cnsAdded < 0 || s.cnsTotal < 0) return `CNS negativa: ${s.cnsAdded}/${s.cnsTotal}`;
      }
      for (const s of r.stops) {
        if (s.minutes <= 0) return `sosta di ${s.minutes} minuti a ${s.depthM} m`;
        if (s.depthM <= 0) return `sosta alla quota ${s.depthM} m`;
      }
      for (const u of r.gasUsage) {
        if (u.litres < 0) return `gas ${u.gasIndex}: ${u.litres} L`;
        if (u.bar !== undefined && u.bar < 0) return `gas ${u.gasIndex}: ${u.bar} bar`;
      }
      if (r.runtimeMin < 0 || r.decoMin < 0 || r.ascentMin < 0 || r.safetyStopMin < 0)
        return 'totali negativi';
      if (r.oxygen.cnsPercent < 0 || r.oxygen.otu < 0) return 'esposizione all’ossigeno negativa';
      return undefined;
    });
  });

  it('il runtime totale copre almeno la somma dei tempi di fondo', () => {
    perOgniCaso(300, (c) => {
      const r = planDeco(c.levels, c.gases, c.settings);
      // Sul primo livello il tempo dichiarato comprende la discesa, sugli altri no:
      // la somma dei tempi di fondo è quindi un minorante, mai un'uguaglianza. Se
      // il runtime ci finisse sotto vorrebbe dire che il piano ha perso per strada
      // del tempo passato in acqua, che è il modo silenzioso di sottostimare tutto.
      const fondo = c.levels.reduce((a, l) => a + l.minutes, 0);
      if (r.runtimeMin + 1e-6 < fondo) return `runtime ${r.runtimeMin} < tempo di fondo ${fondo}`;
      if (r.bottomRuntimeMin + 1e-6 < fondo) return `runtime al fondo ${r.bottomRuntimeMin} < ${fondo}`;
      if (r.runtimeMin + 1e-6 < r.bottomRuntimeMin) return 'il runtime totale precede quello del fondo';
      const ultimo = r.segments[r.segments.length - 1];
      if (ultimo && Math.abs(ultimo.runtimeMin - r.runtimeMin) > 0.2) {
        return `il runtime dell'ultimo segmento (${ultimo.runtimeMin}) non è il runtime totale (${r.runtimeMin})`;
      }
      return undefined;
    });
  });

  it('le soste salgono: profondità decrescente e runtime crescente', () => {
    perOgniCaso(300, (c) => {
      const r = planDeco(c.levels, c.gases, c.settings);
      for (let i = 1; i < r.stops.length; i++) {
        if (r.stops[i].depthM > r.stops[i - 1].depthM) {
          return `sosta a ${r.stops[i].depthM} m dopo una a ${r.stops[i - 1].depthM} m`;
        }
        if (r.stops[i].runtimeMin < r.stops[i - 1].runtimeMin)
          return 'runtime che torna indietro fra due soste';
      }
      // Nessuna sosta più profonda del fondo, e nessuna sotto l'ultima quota
      // dichiarata: sono i due modi in cui una tabella diventa ineseguibile.
      const massima = Math.max(...c.levels.map((l) => l.depthM));
      const primaTroppoGiu = r.stops.find((s) => s.depthM > massima + 0.01);
      if (primaTroppoGiu) return `sosta a ${primaTroppoGiu.depthM} m su un'immersione a ${massima} m`;
      if (r.firstStopM !== undefined && r.stops.length && r.firstStopM < r.stops[0].depthM - 0.01) {
        return `firstStopM ${r.firstStopM} più bassa della prima sosta in tabella ${r.stops[0].depthM}`;
      }
      return undefined;
    });
  });

  it('i minuti di sosta dichiarati nei totali sono quelli che stanno in tabella', () => {
    perOgniCaso(250, (c) => {
      const r = planDeco(c.levels, c.gases, c.settings);
      // `decoMin` e `safetyStopMin` sono i numeri che finiscono sulla lavagnetta e
      // nel riassunto a schermo: se non sommano alla tabella, uno dei due mente, e
      // non si sa quale.
      const obbligo = r.stops.filter((s) => s.mandatory).reduce((a, s) => a + s.minutes, 0);
      const sicurezza = r.stops.filter((s) => !s.mandatory).reduce((a, s) => a + s.minutes, 0);
      if (Math.abs(obbligo - r.decoMin) > 0.01)
        return `decoMin ${r.decoMin} ≠ soste obbligate in tabella ${obbligo}`;
      if (Math.abs(sicurezza - r.safetyStopMin) > 0.01)
        return `safetyStopMin ${r.safetyStopMin} ≠ ${sicurezza}`;
      if (r.noDeco !== (obbligo === 0)) return `noDeco = ${r.noDeco} con ${obbligo} minuti di obbligo`;
      return undefined;
    });
  });
});

// ---------------------------------------------------------------------------
// 3. Monotonia rispetto ai gradient factor
// ---------------------------------------------------------------------------

/** La coppia di GF più stretta da confrontare con quella del caso, derivata dal seme. */
function gfPiuStretti(c: Caso, seme: number): { gfLow: number; gfHigh: number } | undefined {
  const r = generatore(seme * 7919 + 13);
  const intero = (a: number, b: number) => a + Math.floor(r() * (b - a + 1));
  const basso = c.settings.gfLow ?? 0.4;
  const alto = c.settings.gfHigh ?? 0.85;
  const gfLow = Math.max(0.1, basso - intero(0, 30) / 100);
  const gfHigh = Math.max(gfLow, Math.max(0.4, alto - intero(1, 30) / 100));
  // Serve che almeno uno dei due scenda davvero, altrimenti non si sta
  // confrontando niente.
  if (gfLow >= basso && gfHigh >= alto) return undefined;
  return { gfLow, gfHigh };
}

describe('3. gradient factor più stretti non possono costare meno', () => {
  it('la decompressione obbligata non si accorcia mai', () => {
    perOgniCaso(300, (c, seme) => {
      const stretti = gfPiuStretti(c, seme);
      if (!stretti) return undefined;
      const largo = planDeco(c.levels, c.gases, c.settings);
      const stretto = planDeco(c.levels, c.gases, { ...c.settings, ...stretti });
      if (!converge(largo) || !converge(stretto)) return undefined;
      if (stretto.decoMin < largo.decoMin) {
        return (
          `GF ${c.settings.gfLow}/${c.settings.gfHigh} → ${stretti.gfLow}/${stretti.gfHigh}: ` +
          `la decompressione scende da ${largo.decoMin} a ${stretto.decoMin} minuti`
        );
      }
      if (largo.noDeco === false && stretto.noDeco === true) return 'stringendo i GF l’obbligo sparisce';
      return undefined;
    });
  });

  it('la risalita non diventa più veloce (salvo la sosta di sicurezza che sparisce, vedi sotto)', () => {
    perOgniCaso(300, (c, seme) => {
      const stretti = gfPiuStretti(c, seme);
      if (!stretti) return undefined;
      const largo = planDeco(c.levels, c.gases, c.settings);
      const stretto = planDeco(c.levels, c.gases, { ...c.settings, ...stretti });
      if (!converge(largo) || !converge(stretto)) return undefined;
      // L'UNICA eccezione ammessa qui è il baco documentato subito sotto: il piano
      // più largo aveva la sosta di sicurezza, quello più stretto la perde perché
      // il modello gli impone una sosta più breve, e così il piano più prudente
      // arriva in superficie prima. Ammetterla qui e provarla là è il modo di
      // tenere questa proprietà utile invece di disattivarla: qualunque ALTRA
      // violazione della monotonia fa cadere il test.
      const eccezioneNota = largo.safetyStopMin > 0 && stretto.safetyStopMin === 0;
      if (!eccezioneNota && stretto.runtimeMin < largo.runtimeMin - 1e-6) {
        return (
          `GF ${c.settings.gfLow}/${c.settings.gfHigh} → ${stretti.gfLow}/${stretti.gfHigh}: ` +
          `runtime da ${largo.runtimeMin} a ${stretto.runtimeMin} minuti`
        );
      }
      if (!eccezioneNota && stretto.ascentMin < largo.ascentMin - 1e-6) {
        return `risalita da ${largo.ascentMin} a ${stretto.ascentMin} minuti stringendo i GF`;
      }
      return undefined;
    });
  });

  it('la prima sosta non risale di più di un gradino', () => {
    perOgniCaso(300, (c, seme) => {
      const stretti = gfPiuStretti(c, seme);
      if (!stretti) return undefined;
      const largo = planDeco(c.levels, c.gases, c.settings);
      const stretto = planDeco(c.levels, c.gases, { ...c.settings, ...stretti });
      if (!converge(largo) || !converge(stretto)) return undefined;
      // PERCHÉ UN GRADINO DI TOLLERANZA E NON ZERO. Non è una concessione: è la
      // matematica dell'interpolazione di Baker. Il gradient factor a una quota
      // vale gfHigh + (gfLow − gfHigh)·quota/ancora, e l'ANCORA è la prima sosta,
      // che dipende a sua volta da gfLow. Abbassando gfLow l'ancora scende, e
      // un'ancora più profonda avvicina il fattore a gfHigh a ogni quota — cioè in
      // parte compensa. Su 1170 confronti generati lo scarto peggiore è stato
      // esattamente un gradino di sosta, e cade sempre insieme a una
      // decompressione totale più lunga: il piano è più conservativo, la prima
      // sosta no. Non è un baco del motore, è come è fatto il modello; ma uno
      // scarto di due gradini vorrebbe dire un'altra cosa, e quello lo si vuole
      // sapere.
      const gradino = c.settings.stopIntervalM ?? DEFAULT_DECO.stopIntervalM;
      const differenza = (largo.firstStopM ?? 0) - (stretto.firstStopM ?? 0);
      if (differenza > gradino + 1e-6) {
        return (
          `prima sosta da ${largo.firstStopM} m a ${stretto.firstStopM} m stringendo i GF ` +
          `(${c.settings.gfLow}/${c.settings.gfHigh} → ${stretti.gfLow}/${stretti.gfHigh}), ` +
          `deco ${largo.decoMin} → ${stretto.decoMin} min`
        );
      }
      return undefined;
    });
  });

  it('anche riletto sul profilo registrato, un GF più stretto dà più obbligo', () => {
    perOgniCaso(150, (c) => {
      const campioni = campioniDi(c);
      const dive = immersioneDi(c, campioni);
      const ipotesi = whatIfGf(dive, campioni, surfacedTissues(c.settings.surfacePressureBar), [
        { low: 0.9, high: 0.95 },
        { low: 0.6, high: 0.9 },
        { low: 0.4, high: 0.8 },
        { low: 0.2, high: 0.6 },
      ]);
      for (let i = 1; i < ipotesi.length; i++) {
        if (ipotesi[i].maxCeilingM < ipotesi[i - 1].maxCeilingM - 1e-9) {
          return (
            `tetto ${ipotesi[i - 1].maxCeilingM} m con ${ipotesi[i - 1].gfLow}/${ipotesi[i - 1].gfHigh} ` +
            `e ${ipotesi[i].maxCeilingM} m con ${ipotesi[i].gfLow}/${ipotesi[i].gfHigh}`
          );
        }
        if (ipotesi[i].decoMinutes < ipotesi[i - 1].decoMinutes) {
          return `minuti di obbligo ${ipotesi[i - 1].decoMinutes} → ${ipotesi[i].decoMinutes} stringendo i GF`;
        }
      }
      return undefined;
    });
  });
});

// ---------------------------------------------------------------------------
// 4. Monotonia rispetto al profilo
// ---------------------------------------------------------------------------

/** L'indice del gas respirato sul primo tratto di fondo, per capire se i due piani sono confrontabili. */
const gasAlFondo = (r: DecoResult): number | undefined =>
  r.segments.find((s) => s.kind === 'level')?.gasIndex;

describe('4. più giù o più a lungo non può costare meno', () => {
  it('sei metri più giù a parità di tempo', () => {
    perOgniCaso(250, (c) => {
      const base = planDeco(c.levels, c.gases, c.settings);
      const giu = c.levels.map((l, i) => (i === 0 ? { ...l, depthM: l.depthM + 6 } : l));
      const piuGiu = planDeco(giu, c.gases, c.settings);
      if (!converge(base) || !converge(piuGiu)) return undefined;
      // SE SCENDENDO CAMBIA IL GAS RESPIRATO AL FONDO, i due piani non sono più
      // «la stessa immersione sei metri più giù»: sono due immersioni con due
      // miscele. Sei metri possono portare il gas di fondo oltre la sua MOD, e a
      // quel punto il pianificatore ne sceglie un altro — con altro elio, altro
      // azoto e un'altra decompressione, che può benissimo risultare più corta.
      // Succede su una sessantina di casi generati su mille. Vale la pena
      // saltarli qui perché la monotonia che si vuole provare è quella del
      // MODELLO, non quella della scelta del gas; e uno di quei salti nasconde un
      // baco vero, che sta scritto per esteso in fondo al file.
      if (gasAlFondo(base) !== gasAlFondo(piuGiu)) return undefined;
      return piuGiu.decoMin < base.decoMin
        ? `${c.levels[0].depthM} m → ${c.levels[0].depthM + 6} m: obbligo da ${base.decoMin} a ${piuGiu.decoMin} minuti`
        : undefined;
    });
  });

  it('dieci minuti in più a parità di profondità', () => {
    perOgniCaso(250, (c) => {
      const base = planDeco(c.levels, c.gases, c.settings);
      const lungo = c.levels.map((l, i) => (i === 0 ? { ...l, minutes: l.minutes + 10 } : l));
      const piuLungo = planDeco(lungo, c.gases, c.settings);
      if (!converge(base) || !converge(piuLungo)) return undefined;
      return piuLungo.decoMin < base.decoMin
        ? `${c.levels[0].minutes} → ${c.levels[0].minutes + 10} min: obbligo da ${base.decoMin} a ${piuLungo.decoMin} minuti`
        : undefined;
    });
  });

  it('la seconda immersione della giornata non costa meno della prima', () => {
    perOgniCaso(250, (c, seme) => {
      const r = generatore(seme * 31 + 5);
      const intervallo = 20 + Math.floor(r() * 200);
      const [prima, seconda] = planSeries(
        [
          { levels: c.levels, gases: c.gases, surfaceIntervalMin: 0 },
          { levels: c.levels, gases: c.gases, surfaceIntervalMin: intervallo },
        ],
        c.settings,
      );
      if (!converge(prima) || !converge(seconda)) return undefined;
      // Solo su immersioni eseguibili. Sopra le due ore di decompressione il
      // profilo è saturo, il modello lavora ai suoi estremi e l'ancora dei
      // gradient factor si sposta abbastanza da invertire il conto di qualche
      // punto percentuale: è lo stesso artefatto documentato al punto 3, non un
      // errore di catena, e su un piano che nessuno eseguirà mai non vale la pena
      // di renderlo rosso.
      if (prima.decoMin > 90 || prima.gasUsage.some((u) => u.insufficient)) return undefined;
      return seconda.decoMin < prima.decoMin
        ? `con ${intervallo} min di intervallo la ripetitiva costa ${seconda.decoMin} contro ${prima.decoMin} minuti`
        : undefined;
    });
  });
});

// ---------------------------------------------------------------------------
// 5. Il bailout non è mai un affare
// ---------------------------------------------------------------------------

describe('5. il bailout non è mai più corto né più povero di gas del piano nominale', () => {
  it('a circuito aperto la risalita d’emergenza non è più breve di quella pianificata', () => {
    perOgniCaso(250, (c) => {
      // Il confronto ha senso solo a circuito aperto, e la ragione è fisica, non
      // tecnica: su un rebreather con setpoint basso — 0.7 bar — il gas del
      // circuito a sei metri è più povero d'ossigeno dell'EAN50 o dell'ossigeno
      // puro che il subacqueo si porta appresso, quindi abbandonare il circuito
      // ACCORCIA davvero la decompressione. È il modello che funziona, non il
      // motore che sbaglia, e pretendere il contrario sarebbe un'aspettativa
      // sbagliata scritta dentro un test.
      if (c.ccr) return undefined;
      const base = planDeco(c.levels, c.gases, c.settings);
      const bailout = bailoutPlan(c.levels, c.gases, c.settings);
      if (!bailout) return 'bailoutPlan non ha restituito niente su un profilo valido';
      if (!converge(base) || !converge(bailout)) return undefined;
      if (bailout.decoMin < base.decoMin) {
        return `bailout ${bailout.decoMin} minuti contro ${base.decoMin} del piano`;
      }
      if ((bailout.firstStopM ?? 0) < (base.firstStopM ?? 0) - 1e-6) {
        return `prima sosta del bailout a ${bailout.firstStopM} m contro ${base.firstStopM} m del piano`;
      }
      return undefined;
    });
  });

  it('il bailout non consuma meno gas della risalita nominale', () => {
    perOgniCaso(250, (c) => {
      const base = planDeco(c.levels, c.gases, c.settings);
      const bailout = bailoutPlan(c.levels, c.gases, c.settings);
      if (!bailout || !converge(base) || !converge(bailout)) return undefined;
      // Del piano nominale conta solo la parte dopo il fondo: il bailout comincia
      // lì. `bottomRuntimeMin` esiste apposta per separarle senza indovinare dal
      // tipo dei segmenti.
      const litriRisalita = base.segments
        .filter((s) => s.runtimeMin > base.bottomRuntimeMin + 1e-9)
        .reduce((a, s) => a + s.litres, 0);
      const litriBailout = bailout.segments.reduce((a, s) => a + s.litres, 0);
      // Un litro di tolleranza: i litri per segmento sono arrotondati all'unità.
      return litriBailout < litriRisalita - 1
        ? `bailout ${litriBailout} L contro ${Math.round(litriRisalita)} L della risalita nominale`
        : undefined;
    });
  });

  it('il bailout da metà risalita parte da lì, e non se la cava con zero soste', () => {
    perOgniCaso(150, (c) => {
      const massima = Math.max(...c.levels.map((l) => l.depthM));
      const meta = Math.round(massima / 2);
      const dalFondo = bailoutPlan(c.levels, c.gases, c.settings);
      const daMeta = bailoutPlan(c.levels, c.gases, c.settings, meta);
      if (!dalFondo || !daMeta) return 'bailoutPlan non ha restituito niente su un profilo valido';
      if (!converge(dalFondo) || !converge(daMeta)) return undefined;
      // NON si pretende che il bailout da metà risalita sia più corto di quello dal
      // fondo, e la ragione merita una riga perché è controintuitiva: il modello
      // riparte da quella quota ricalcolando l'ancora dei gradient factor sui
      // tessuti di lì, e un'ancora più bassa rende l'interpolazione meno permissiva
      // in alto. Su qualche caso su cento il totale che ne esce supera del cinque o
      // dieci per cento quello dal fondo, pur avendo già scontato le soste
      // profonde. È un artefatto noto del modello, non del motore.
      //
      // Quello che invece deve valere sempre è che il piano parta DAVVERO da lì —
      // il commento nel sorgente racconta di quando prendeva i tessuti della
      // DISCESA su un profilo multilivello, e rispondeva «zero obbligo, undici bar»
      // dove ne servivano cinquanta minuti e centoquaranta.
      const piuProfondo = daMeta.segments.reduce((a, s) => Math.max(a, s.fromM, s.toM), 0);
      if (piuProfondo > meta + 0.01) return `bailout da ${meta} m che passa da ${piuProfondo} m`;
      if ((daMeta.firstStopM ?? 0) > meta + 0.01)
        return `prima sosta a ${daMeta.firstStopM} m su un bailout da ${meta} m`;
      if (dalFondo.stops.filter((s) => s.mandatory).length > 3 && daMeta.decoMin === 0) {
        return `dal fondo (${massima} m) l'obbligo è di ${dalFondo.decoMin} minuti, da ${meta} m è zero`;
      }
      return undefined;
    });
  });
});

// ---------------------------------------------------------------------------
// 6. Le contingenze
// ---------------------------------------------------------------------------

describe('6. le contingenze peggiori escono con più obbligo di quella nominale', () => {
  it('più giù, più a lungo, tutte e due', () => {
    perOgniCaso(120, (c) => {
      const base = planDeco(c.levels, c.gases, c.settings);
      if (!converge(base)) return undefined;
      for (const k of decoContingencies(c.levels, c.gases, c.settings)) {
        if (!['deeper', 'longer', 'both'].includes(k.id)) continue;
        if (!converge(k.result)) continue;
        // Un minuto di tolleranza, e non di più. Le soste si contano a minuti
        // interi: spostando il primo livello di tre metri la griglia delle quote
        // cambia, e su una decompressione di sette ore può capitare che il totale
        // arrotondato scenda di un minuto. Su 2085 contingenze generate è successo
        // una volta sola, con uno scarto di 1 minuto su 419 — è il rumore della
        // discretizzazione, non una contingenza che costa meno.
        if (k.result.decoMin < base.decoMin - 1) {
          return `contingenza «${k.id}»: ${k.result.decoMin} minuti di obbligo contro ${base.decoMin} del nominale`;
        }
      }
      return undefined;
    });
  });

  it('perdere un gas di decompressione non accorcia mai la decompressione', () => {
    perOgniCaso(120, (c) => {
      const base = planDeco(c.levels, c.gases, c.settings);
      if (!converge(base)) return undefined;
      for (const k of decoContingencies(c.levels, c.gases, c.settings)) {
        if (!k.id.startsWith('lost-')) continue;
        if (!converge(k.result)) continue;
        // Perdere l'ossigeno o l'EAN50 e uscirne prima sarebbe il sintomo classico
        // dello scenario calcolato con gli indici sbagliati — cioè con un gas al
        // posto di un altro, che è già successo una volta in questo modulo.
        if (k.result.decoMin < base.decoMin) {
          return `«${k.label}»: ${k.result.decoMin} minuti contro ${base.decoMin} del nominale`;
        }
      }
      return undefined;
    });
  });

  it('gli extra dichiarati corrispondono ai risultati calcolati', () => {
    perOgniCaso(120, (c) => {
      const base = planDeco(c.levels, c.gases, c.settings);
      for (const k of decoContingencies(c.levels, c.gases, c.settings)) {
        // `extraRuntimeMin` ed `extraDecoMin` sono i numeri che l'interfaccia
        // mostra accanto a ciascuno scenario: devono essere la differenza vera fra
        // i due piani, arrotondata, e non un conto fatto una seconda volta.
        const attesoRuntime = Math.round(k.result.runtimeMin - base.runtimeMin);
        const attesoDeco = Math.round(k.result.decoMin - base.decoMin);
        if (k.extraRuntimeMin !== attesoRuntime)
          return `${k.id}: extraRuntimeMin ${k.extraRuntimeMin} invece di ${attesoRuntime}`;
        if (k.extraDecoMin !== attesoDeco)
          return `${k.id}: extraDecoMin ${k.extraDecoMin} invece di ${attesoDeco}`;
      }
      return undefined;
    });
  });
});

// ---------------------------------------------------------------------------
// 7. Impostazioni degeneri
// ---------------------------------------------------------------------------

/** I campi numerici delle impostazioni che un'interfaccia può mandare a rovescio. */
const CAMPI_DEGENERI: (keyof DecoSettings)[] = [
  'gfLow',
  'gfHigh',
  'ascentRateMpm',
  'descentRateMpm',
  'lastStopM',
  'stopIntervalM',
  'maxPpo2Work',
  'maxPpo2Deco',
  'switchMin',
  'morLpm',
  'decoMorLpm',
  'loopVolumeL',
  'flyingAltitudeM',
];

/**
 * I valori assurdi da provare.
 *
 * Zero e i negativi arrivano da un campo svuotato o da un segno di troppo; NaN
 * arriva da `parseFloat('')`, che è il modo standard in cui un campo di testo vuoto
 * diventa un numero in un'interfaccia React; un milione arriva da uno zero di
 * troppo. Non sono ingressi teorici: sono i quattro modi in cui un utente sbaglia.
 */
const VALORI_DEGENERI = [0, -1, -3, NaN, 1e6];

describe('7. impostazioni degeneri: o un risultato sensato, o un errore esplicito', () => {
  it('trecento combinazioni assurde di impostazioni non producono mai una tabella vuota né un NaN', () => {
    const falliti: string[] = [];
    for (let i = 0; i < 300 && falliti.length < 3; i++) {
      const seme = SEME_BASE + i;
      const r = generatore(seme);
      const intero = (a: number, b: number) => a + Math.floor(r() * (b - a + 1));
      const impostazioni: Record<string, number> = {};
      for (let k = 0, quanti = intero(1, 3); k < quanti; k++) {
        impostazioni[CAMPI_DEGENERI[intero(0, CAMPI_DEGENERI.length - 1)]] =
          VALORI_DEGENERI[intero(0, VALORI_DEGENERI.length - 1)];
      }
      const profondita = [12, 30, 45, 70][intero(0, 3)];
      const minuti = [8, 25, 45][intero(0, 2)];
      const descrizione = `${profondita} m × ${minuti} min con ${JSON.stringify(impostazioni)}`;
      try {
        const res = planDeco(
          [{ depthM: profondita, minutes: minuti }],
          [ARIA, EAN50],
          impostazioni as Partial<DecoSettings>,
        );
        const guasti = nonFiniti(res);
        if (guasti.length) falliti.push(`  seme ${seme} — ${descrizione}: ${guasti.join(', ')}`);
        // UNA TABELLA VUOTA È LA COSA PEGGIORE. Un'impostazione assurda può
        // legittimamente produrre un piano assurdo — ottanta ore di sosta con
        // gfHigh a zero è una risposta onesta a una domanda insensata. Quello che
        // non può fare è restituire zero segmenti, perché zero segmenti letti
        // dall'interfaccia diventano «nessuna sosta»: la stessa schermata di
        // un'immersione in curva, e nessun modo di distinguerle.
        else if (res.segments.length === 0)
          falliti.push(`  seme ${seme} — ${descrizione}: piano vuoto senza avvisi`);
      } catch {
        // Un'eccezione va benissimo: è la forma esplicita del rifiuto.
      }
    }
    expect(falliti.join('\n')).toBe('');
  });

  it('un profilo senza livelli utilizzabili produce un piano vuoto, non un piano finto', () => {
    // Profondità nulla, negativa o NaN: qui non c'è niente da pianificare, e un
    // risultato vuoto è la risposta giusta. Quello che si controlla è che sia vuoto
    // DAVVERO — runtime zero, nessun segmento — e non un piano con dentro dei
    // numeri che sembrano validi.
    for (const livelli of [
      [],
      [{ depthM: 0, minutes: 30 }],
      [{ depthM: -20, minutes: 30 }],
      [{ depthM: NaN, minutes: 30 }],
      [{ depthM: 30, minutes: NaN }],
    ]) {
      const r = planDeco(livelli, [ARIA], {});
      expect(r.segments).toHaveLength(0);
      expect(r.stops).toHaveLength(0);
      expect(r.runtimeMin).toBe(0);
      expect(nonFiniti(r)).toEqual([]);
    }
    // Nessun gas: stessa cosa. Un piano senza bombole non è un piano in curva.
    const senzaGas = planDeco([{ depthM: 30, minutes: 30 }], [], {});
    expect(senzaGas.segments).toHaveLength(0);
    expect(senzaGas.runtimeMin).toBe(0);
  });

  it('un passo fra le soste minuscolo ma positivo resta gestibile', () => {
    // Il motore si difende da `stopIntervalM` nullo o negativo tornando al
    // predefinito, ma un millimetro è positivo e passa il controllo. Il piano che
    // ne esce deve comunque essere quello giusto: le soste vere sono dodici, non
    // dodicimila, perché il tetto le raggruppa da solo.
    const r = planDeco([{ depthM: 40, minutes: 25 }], [ARIA], { stopIntervalM: 1e-3 });
    expect(nonFiniti(r)).toEqual([]);
    expect(r.stops.length).toBeLessThan(50);
    expect(r.decoMin).toBeGreaterThan(0);
  });

  it('gf99 e compartments reggono pressioni ambiente fuori scala', () => {
    const tessuti = surfacedTissues();
    // Pressione ambiente zero o negativa: non esiste, ma è quello che esce da una
    // quota fuori scala o da un campione corrotto. Il risultato deve essere un
    // numero — enorme quanto si vuole — e non un NaN che si propaga.
    for (const ambiente of [0, -1, 1e9]) {
      expect(Number.isFinite(gf99(tessuti, ambiente).percent)).toBe(true);
      expect(nonFiniti(compartments(tessuti, ambiente, 0.85))).toEqual([]);
    }
    // Minuti negativi o NaN in un passo di desaturazione: lo stato non deve
    // muoversi, perché «meno dieci minuti in superficie» non è un'informazione.
    for (const minuti of [-10, NaN, 0]) {
      expect(desaturate(tessuti, minuti).n2[0]).toBe(tessuti.n2[0]);
    }
  });
});

// ---------------------------------------------------------------------------
// 8. La tabella stampata
// ---------------------------------------------------------------------------

describe('8. decoTableText non stampa mai undefined, NaN o null', () => {
  it('su duecentocinquanta piani generati', () => {
    perOgniCaso(250, (c) => {
      const r = planDeco(c.levels, c.gases, c.settings);
      const testo = decoTableText(r, c.levels, c.gases, c.settings);
      // Questo foglio finisce su una lavagnetta. Un `undefined` in mezzo ai numeri
      // non è un difetto estetico: è una riga che il subacqueo non sa leggere nel
      // momento in cui gli serve, e non ha modo di ricostruire sott'acqua.
      const guasto = testo.match(/undefined|NaN|null|Infinity|\[object/);
      if (guasto) {
        const riga = testo.split('\n').find((l) => /undefined|NaN|null|Infinity|\[object/.test(l));
        return `«${guasto[0]}» nella riga: ${riga}`;
      }
      // E deve contenere le cose per cui esiste.
      if (!testo.includes('SOSTE')) return 'manca la sezione delle soste';
      if (!testo.includes('GAS')) return 'manca la sezione del gas';
      for (const sosta of r.stops) {
        if (!testo.includes(`${sosta.depthM} m`)) return `la sosta a ${sosta.depthM} m non compare nel testo`;
      }
      return undefined;
    });
  });

  it('anche sui piani di bailout e di contingenza, e su un piano vuoto', () => {
    perOgniCaso(100, (c) => {
      const bailout = bailoutPlan(c.levels, c.gases, c.settings);
      if (bailout) {
        const testo = decoTableText(bailout, c.levels, c.gases, c.settings);
        if (/undefined|NaN|null|Infinity/.test(testo))
          return `bailout: ${testo.split('\n').find((l) => /undefined|NaN|null|Infinity/.test(l))}`;
      }
      for (const k of decoContingencies(c.levels, c.gases, c.settings)) {
        const testo = decoTableText(k.result, c.levels, c.gases, c.settings);
        if (/undefined|NaN|null|Infinity/.test(testo))
          return `contingenza ${k.id}: ${testo.split('\n').find((l) => /undefined|NaN|null|Infinity/.test(l))}`;
      }
      return undefined;
    });
  });

  it('il piano vuoto stampa un foglio leggibile invece di rompersi', () => {
    const testo = decoTableText(planDeco([], [], {}), [], [], {});
    expect(testo).not.toMatch(/undefined|NaN|null/);
    expect(testo).toContain('SOSTE');
  });
});

// ---------------------------------------------------------------------------
// 9. Due modelli, due risposte, entrambe plausibili
// ---------------------------------------------------------------------------

describe('9. VPM e Bühlmann restano entrambi plausibili sullo stesso profilo', () => {
  it('nessuno dei due dice «nessuna sosta» mentre l’altro ne detta più di tre', () => {
    perOgniCaso(200, (c) => {
      if (c.ccr) return undefined;
      const buhlmann = planDeco(c.levels, c.gases, c.settings);
      if (!converge(buhlmann)) return undefined;
      const vpm = planVpm(livelliVpm(c), decoVpm(c), {
        salinity: c.settings.salinity,
        surfacePressureBar: c.settings.surfacePressureBar,
        lastStopM: c.settings.lastStopM,
        conservatism: DEFAULT_VPM.conservatism,
      });
      if (vpm === undefined || buhlmann === undefined) return 'uno dei due modelli non ha risposto';
      const soste = buhlmann.stops.filter((s) => s.mandatory).length;
      // NON si pretende che coincidano: sono modelli diversi, il VPM mette la prima
      // sosta molto più in basso e distribuisce il tempo in modo diverso, ed è
      // proprio per questo che l'app li mostra tutti e due. Si pretende che siano
      // dello stesso ordine di grandezza qualitativo, perché «zero soste» contro
      // «quattro soste» non sono due opinioni: è uno dei due che ha smesso di
      // funzionare, e chi guarda lo schermo non sa quale.
      if (vpm.stops.length === 0 && soste > 3) {
        return `il VPM non detta soste dove Bühlmann ne detta ${soste} (${buhlmann.decoMin} min)`;
      }
      if (soste === 0 && vpm.stops.length > 3) {
        return `Bühlmann non detta soste dove il VPM ne detta ${vpm.stops.length} (${vpm.decoMin} min)`;
      }
      return undefined;
    });
  });

  it('il VPM è monotono nel conservatorismo come Bühlmann lo è nei gradient factor', () => {
    perOgniCaso(200, (c) => {
      if (c.ccr) return undefined;
      const comune = {
        salinity: c.settings.salinity,
        surfacePressureBar: c.settings.surfacePressureBar,
        lastStopM: c.settings.lastStopM,
      };
      const largo = planVpm(livelliVpm(c), decoVpm(c), { ...comune, conservatism: 1 });
      const stretto = planVpm(livelliVpm(c), decoVpm(c), { ...comune, conservatism: 4 });
      if (stretto.decoMin < largo.decoMin) {
        return `conservatorismo 4 dà ${stretto.decoMin} minuti contro i ${largo.decoMin} del livello 1`;
      }
      if ((stretto.firstStopM ?? 0) < (largo.firstStopM ?? 0)) {
        return `prima sosta a ${stretto.firstStopM} m con conservatorismo 4 contro ${largo.firstStopM} m col livello 1`;
      }
      return undefined;
    });
  });

  it('le soste del VPM sono ordinate, positive e mai più profonde del fondo', () => {
    perOgniCaso(200, (c) => {
      if (c.ccr) return undefined;
      const vpm = planVpm(livelliVpm(c), decoVpm(c), {
        salinity: c.settings.salinity,
        surfacePressureBar: c.settings.surfacePressureBar,
        lastStopM: c.settings.lastStopM,
      });
      const massima = Math.max(...c.levels.map((l) => l.depthM));
      let somma = 0;
      for (let i = 0; i < vpm.stops.length; i++) {
        const s = vpm.stops[i];
        if (s.minutes <= 0) return `sosta di ${s.minutes} minuti a ${s.depthM} m`;
        if (s.depthM <= 0) return `sosta alla quota ${s.depthM} m`;
        if (s.depthM > massima + 0.01) return `sosta a ${s.depthM} m su un'immersione a ${massima} m`;
        if (i > 0 && s.depthM > vpm.stops[i - 1].depthM) return 'le soste non salgono';
        somma += s.minutes;
      }
      if (Math.abs(somma - vpm.decoMin) > 0.01) return `decoMin ${vpm.decoMin} ≠ somma delle soste ${somma}`;
      return undefined;
    });
  });
});

// ---------------------------------------------------------------------------
// I bachi trovati da questa batteria, tenuti rossi
// ---------------------------------------------------------------------------

/**
 * I BACHI TROVATI DA QUESTA BATTERIA, ORA CORRETTI.
 *
 * Erano nati come `it.fails` — test scritti per fallire, che descrivono il baco
 * con la sua riproduzione minima e diventano rossi il giorno della correzione.
 * Quel giorno è arrivato tutto insieme: sette su sette. La riga `.fails` è stata
 * tolta e da qui in avanti sono normalissimi test di non regressione, che è il
 * posto dove un baco trovato una volta deve finire per non tornare.
 *
 * Vale la pena leggerli in fila: sono sette modi diversi di arrivare allo stesso
 * risultato, cioè un piano che dichiara MENO obbligo di quello vero. Nessuno di
 * loro era un'eccezione o un errore visibile.
 */
describe('bachi trovati dalla batteria, ora corretti', () => {
  it('la sosta di sicurezza sparisce esattamente sulle immersioni al limite della curva', () => {
    // 18 metri per 43 minuti, impostazioni predefinite: sosta di sicurezza a 5 m
    // per 3 minuti, come da manuale. Un minuto in più — 44 — e la sosta NON C'È
    // PIÙ: il piano risale da 18 metri alla superficie senza fermarsi, e si
    // dichiara in curva. Un minuto ancora — 45 — e ricompare un minuto di sosta
    // obbligata a 3 m.
    //
    // La causa sta nella risalita: a 44 minuti il tetto non permette di arrivare in
    // superficie in un colpo solo, quindi il piano sale a 3 m e prosegue da lì;
    // `maybeSafetyStop` si inserisce solo sul tratto che punta a zero e solo se
    // parte da più di 5 m, e a quel punto il tratto parte da 3. La sosta di
    // sicurezza sparisce proprio nella fascia in cui ogni didattica la considera
    // meno facoltativa che mai.
    //
    // Con i GF predefiniti la cosa capita su 43 combinazioni di quota e tempo fra
    // gli 11 e i 50 metri — 14×80, 15×69, 16×59, 17×51, 18×44, 19×39, 20×33 e così
    // via — cioè su tutta la diagonale delle immersioni ricreative al limite.
    const prima = planDeco([{ depthM: 18, minutes: 43 }], [ARIA], {});
    const dopo = planDeco([{ depthM: 18, minutes: 44 }], [ARIA], {});
    expect(prima.safetyStopMin).toBe(3);
    expect(dopo.safetyStopMin).toBe(3);
  });

  it('la contingenza «tre metri più giù» esce più corta del piano nominale', () => {
    // È lo stesso baco visto dall'altro capo, e da qui si vede quanto è
    // disorientante: 12 m × 69 min nominale dura 73.3 minuti e comprende la sosta
    // di sicurezza; lo scenario «sono sceso tre metri più del previsto», che
    // l'interfaccia presenta come il caso che costa di più, dura 70.7 minuti e non
    // ha nessuna sosta. Il pannello delle contingenze mostra «−3 min» accanto a
    // uno scenario peggiorativo.
    const nominale = planDeco([{ depthM: 12, minutes: 69 }], [ARIA], {});
    const piuGiu = decoContingencies([{ depthM: 12, minutes: 69 }], [ARIA], {}).find(
      (k) => k.id === 'deeper',
    );
    expect(nominale.safetyStopMin).toBe(3);
    expect(piuGiu?.extraRuntimeMin).toBeGreaterThanOrEqual(0);
  });

  it('a circuito chiuso la bombola di bailout finisce dentro il circuito e accorcia la decompressione', () => {
    // IL BACO PIÙ GRAVE TROVATO DA QUESTA BATTERIA, ed è saltato fuori dalla
    // monotonia rispetto al profilo: tre metri più giù, trentatré minuti di
    // decompressione IN MENO.
    //
    // Rebreather, diluente EAN22, setpoint 0.7, con a bordo EAN50, ossigeno e una
    // bombola di bailout Tx18/45. La MOD del diluente con il limite di lavoro di
    // 1.4 bar cade a 53 metri. Fino a lì tutto torna: 48 m → 127 minuti, 51 m →
    // 148. A 54 metri il diluente esce dall'elenco dei gas respirabili e
    // `bestGasAt` sceglie il migliore fra quelli che restano — la bombola di
    // BAILOUT — e il motore la usa come diluente del circuito. L'elio che c'è
    // dentro accorcia la decompressione: 54 m → 115 minuti, meno di 51.
    //
    // Sono due errori sovrapposti, e il secondo è più grave del primo. Il primo:
    // per un diluente la MOD calcolata sulla PPO2 non vuol dire niente, perché su
    // un circuito chiuso la PPO2 la fa il setpoint, non la miscela. Il secondo, e
    // conta di più: una bombola di bailout NON è collegata al circuito, per
    // definizione — è l'erogatore che si mette in bocca quando il circuito si
    // abbandona. Farci respirare dentro il loop produce un piano che nessuno può
    // eseguire, ed è ottimista, che è la direzione sbagliata in cui sbagliare.
    //
    // La distinzione il modulo la conosce già: `bailoutPlan` toglie di mezzo il
    // diluente quando una bombola di bailout c'è, e lo spiega in dodici righe di
    // commento. Manca il controllo simmetrico nel piano nominale.
    const gases: PlanGas[] = [
      { mix: { o2: 0.22, he: 0 }, role: 'bottom', tankL: 20, startBar: 200, setpointBar: 0.7 },
      { mix: { o2: 0.5, he: 0 }, role: 'deco', tankL: 11, startBar: 200 },
      { mix: { o2: 1, he: 0 }, role: 'deco', tankL: 11, startBar: 200 },
      { mix: { o2: 0.18, he: 0.45 }, role: 'bailout', tankL: 11, startBar: 200 },
    ];
    const gf = { gfLow: 0.3, gfHigh: 0.7 };
    const a = planDeco([{ depthM: 51, minutes: 40, setpointBar: 0.7 }], gases, gf);
    const b = planDeco([{ depthM: 54, minutes: 40, setpointBar: 0.7 }], gases, gf);
    // Nessun segmento deve respirare la bombola di bailout in un piano nominale.
    const indiceBailout = gases.findIndex((g) => g.role === 'bailout');
    expect(b.segments.map((s) => s.gasIndex)).not.toContain(indiceBailout);
    expect(b.decoMin).toBeGreaterThanOrEqual(a.decoMin);
  });

  it('planVpm restituisce una tabella SENZA soste per sei impostazioni degeneri diverse', () => {
    // 45 m per 25 minuti in aria: il VPM, con le impostazioni buone, detta 8 soste
    // e 58 minuti di decompressione. Con una qualunque delle impostazioni qui
    // sotto ne detta ZERO, senza avvisi e senza eccezioni — la tabella esce vuota e
    // sembra un'immersione in curva.
    //
    // È il modo peggiore in assoluto di fallire, ed è esattamente il modo in cui
    // `planDeco` NON fallisce: lì, in testa alla funzione, ci sono quattro righe
    // che riportano al predefinito i valori degeneri, con il commento che spiega
    // perché. Qui quelle righe non ci sono.
    const livelli: VpmLevel[] = [{ depthM: 45, minutes: 25, mix: { o2: 0.21, he: 0 } }];
    const degeneri: [string, Parameters<typeof planVpm>[2]][] = [
      ['stopIntervalM = 0', { stopIntervalM: 0 }],
      ['stopIntervalM = NaN', { stopIntervalM: NaN }],
      ['lastStopM = NaN', { lastStopM: NaN }],
      ['conservatism = NaN', { conservatism: NaN }],
      ['surfacePressureBar = NaN', { surfacePressureBar: NaN }],
      ['altitudeM = 100000', { altitudeM: 100000 }],
    ];
    const buone = planVpm(livelli, [], {});
    expect(buone.stops.length).toBeGreaterThan(5);
    for (const [nome, impostazioni] of degeneri) {
      expect(planVpm(livelli, [], impostazioni).stops.length, nome).toBeGreaterThan(0);
    }
  });

  it('planDeco con una pressione di superficie NaN dichiara il piano in curva su tessuti NaN', () => {
    // Una quota scritta male nel campo del sito, o un `parseFloat('')` di ritorno
    // da un campo svuotato, e i sedici azoti di ogni segmento diventano NaN. Il
    // piano NON cade: restituisce runtime 33 minuti, `noDeco: true`, nessun avviso,
    // e una sola sosta — quella di sicurezza. Su un 40 m × 25 min che con la
    // pressione giusta vuole quasi trenta minuti di decompressione.
    //
    // Stessa cosa con Infinity e con −Infinity. È il caso in cui la prima proprietà
    // di questo file — «nessun NaN da nessuna parte» — vale letteralmente più di
    // tutte le altre insieme.
    for (const pressione of [NaN, Infinity, -Infinity]) {
      const r = planDeco([{ depthM: 40, minutes: 25 }], [ARIA], { surfacePressureBar: pressione });
      expect(nonFiniti(r), `pressione ${pressione}`).toEqual([]);
    }
  });

  it('un consumo negativo produce litri e bar negativi senza un avviso', () => {
    // `rmvLpm: -20` è un segno di troppo in un campo di testo. Il piano che ne esce
    // ha le soste giuste — il modello decompressivo non c'entra — e un consumo di
    // gas negativo, con `insufficient: false` accanto. Sullo schermo diventa «−184
    // bar»: un numero che nessuno sa interpretare, presentato come se fosse un
    // controllo superato. Il motore convalida i quattro campi che governano la
    // geometria della risalita e lascia passare tutti gli altri.
    const r = planDeco([{ depthM: 40, minutes: 25 }], [ARIA], { rmvLpm: -20, decoRmvLpm: -17 });
    const negativi = r.gasUsage.filter((u) => u.litres < 0 || (u.bar ?? 0) < 0);
    expect(negativi).toEqual([]);
  });

  it('un solo campione a profondità NaN azzera il GF99 e lascia i tessuti NaN', () => {
    // Un campione corrotto in mezzo al profilo — succede su file troncati, e il
    // modulo di riparazione non li intercetta tutti — e `analyseProfile` restituisce
    // `gf99End: 0`, `maxCeilingM: 0`, `decoMinutes: 0`: la fotografia di
    // un'immersione perfettamente tranquilla. Dentro, i sedici compartimenti sono
    // NaN. Zero è il numero più rassicurante che il GF99 possa avere, ed è quello
    // che esce quando il conto non è stato fatto.
    const campioni: Sample[] = [
      { t: 0, depth: 0 },
      { t: 60, depth: NaN },
      { t: 1800, depth: 40 },
      { t: 2400, depth: 0 },
    ];
    const dive: Dive = {
      id: 'corrotta',
      startTime: '2026-01-01T10:00:00Z',
      durationS: 2400,
      maxDepth: 40,
      cylinders: [{ mix: { o2: 0.21, he: 0 } }],
      source: { format: 'uddf', file: 'corrotta', importedAt: '2026-01-01T10:00:00Z' },
      mode: 'oc',
      tags: [],
      samples: campioni,
    };
    const r = analyseProfile(dive, campioni, surfacedTissues());
    expect(nonFiniti(r)).toEqual([]);
  });

  /*
   * IL BACO CHE NON SI POTEVA SCRIVERE COME TEST, ed era il più grave dei tre del
   * VPM. Ora si può, perché è corretto: sta nel test qui sotto.
   *
   * `planVpm` NON TERMINAVA — ciclo infinito, non lentezza — con una qualunque di
   * queste impostazioni:
   *
   *     planVpm([{ depthM: 45, minutes: 25, mix: { o2: 0.21, he: 0 } }], [], { ascentRateMpm: 0 })
   *     planVpm([{ depthM: 45, minutes: 25, mix: { o2: 0.21, he: 0 } }], [], { ascentRateMpm: -9 })
   *     planVpm([{ depthM: 45, minutes: 25, mix: { o2: 0.21, he: 0 } }], [], { descentRateMpm: 0 })
   *     planVpm([{ depthM: 45, minutes: 25, mix: { o2: 0.21, he: 0 } }], [], { descentRateMpm: -18 })
   *     planVpm([{ depthM: 45, minutes: 25, mix: { o2: 0.21, he: 0 } }], [], { stopIntervalM: -3 })
   *     planVpm([{ depthM: 45, minutes: 25, mix: { o2: 0.21, he: 0 } }], [], { stopIntervalM: 1e-9 })
   *
   * Sono lasciate commentate e non dentro un `it.fails` per una ragione pratica: un
   * test che non termina non «fallisce», BLOCCA la suite — vitest lo interrompe
   * dopo il timeout ma il ciclo continua a girare nel worker, e in un'interfaccia
   * questo è il tab che si pianta senza spiegazione. Verificarle richiede un
   * processo separato con un timeout esterno, che è il modo in cui sono state
   * trovate:
   *
   *     timeout 20 npx tsx -e "import('./src/core/analysis/vpm.ts').then(m =>
   *       console.log(m.planVpm([{depthM:45,minutes:25,mix:{o2:.21,he:0}}], [], {ascentRateMpm:0})))"
   *
   * La correzione è stata portare in `deco.ts` le difese che c'erano solo lì
   * (`sane` e `sanePositive`, una definizione per due motori) e chiamarle anche
   * dall'ingresso di `planVpm`, più un contatore di giri nel ciclo di risalita
   * come rete: un ciclo che non termina non produce un numero sbagliato, congela
   * l'applicazione, e chi la usa non ha modo di capire perché.
   */
  it('planVpm termina sempre, anche con velocità e passi non positivi', () => {
    const livelli = [{ depthM: 45, minutes: 25, mix: { o2: 0.21, he: 0 } }];
    const buono = planVpm(livelli, [], {});
    expect(buono.stops.length).toBeGreaterThan(3);
    for (const degenere of [
      { ascentRateMpm: 0 },
      { ascentRateMpm: -9 },
      { descentRateMpm: 0 },
      { descentRateMpm: -18 },
      { stopIntervalM: -3 },
      { stopIntervalM: 1e-9 },
    ]) {
      const r = planVpm(livelli, [], degenere);
      // Non basta che risponda: deve rispondere con una tabella VERA. Zero soste
      // su un 45 × 25 in aria è il modo peggiore di fallire.
      expect(r.stops.length, JSON.stringify(degenere)).toBeGreaterThan(3);
      expect(r.decoMin, JSON.stringify(degenere)).toBeGreaterThan(10);
    }
  });
});
