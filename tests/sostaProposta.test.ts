/**
 * «Ti conviene fermarti» non è «devi fermarti».
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ► LA STESSA FORMA, TROVATA QUATTRO VOLTE IN UN GIORNO. ◄
 *
 * Un computer subacqueo distingue tre soste: quella di **sicurezza**, la
 * **profonda** e la **tappa di decompressione**. Le prime due sono consigli, la
 * terza è un obbligo — ed è la distinzione su cui è costruito tutto il resto
 * dell'applicazione: una si può saltare, l'altra no.
 *
 * L'8 settembre 2026 si è scoperto che veniva appiattita in quattro punti
 * diversi, ogni volta **nel momento in cui il dato arrivava**:
 *
 *  1. `trasporto_ldc.rs` — `DC_DECO_SAFETYSTOP`, `DECOSTOP` e `DEEPSTOP` in un
 *     unico `else`, con tetto e `in_deco = true`;
 *  2. `parsers/uddf.ts` — l'attributo `kind` letto e poi annullato da un `||`;
 *  3. `parsers/shearwater.ts` — `inDeco` ricavato da `firstStopDepth` invece
 *     che da `decoCeiling`, due campi che Shearwater esporta separati;
 *  4. `analysis/metrics.ts` — un ripiego che promuoveva `stopDepth` a tetto.
 *
 * Il sintomo, su un'immersione vera: **«Tempo in deco 13:00»** a un subacqueo
 * che in deco non c'era andato, e **«sosta profonda 9:10 a 19 m»** che era
 * invece la prima tappa obbligatoria, travestita da pausa volontaria.
 *
 * Queste prove partono dai file come li scrivono i computer, non dal modello
 * interno: è lì che la distinzione si perdeva.
 */

import { describe, expect, it } from 'vitest';
import { computeMetrics } from '../src/core/analysis/metrics';
import { uddfParser } from '../src/core/parsers/uddf';
import { shearwaterParser } from '../src/core/parsers/shearwater';
import type { Dive, Sample } from '../src/core/model';

/** Un UDDF con una sola sosta, del tipo dato. */
function uddfConSosta(kind: string): string {
  const punti: string[] = [];
  for (let t = 0; t <= 1800; t += 30) {
    const depth = t < 120 ? (t / 120) * 30 : t < 1200 ? 30 : 5;
    const sosta =
      t >= 1200
        ? `<decostop kind="${kind}" decodepth="5.0" duration="180"/>`
        : '<nodecotime>1200</nodecotime>';
    punti.push(`<waypoint><divetime>${t}</divetime><depth>${depth.toFixed(1)}</depth>${sosta}</waypoint>`);
  }
  return `<?xml version="1.0"?>
<uddf xmlns="http://www.streit.cc/uddf/3.2/" version="3.2.0">
  <profiledata><repetitiongroup id="g1"><dive id="d1">
    <informationbeforedive><datetime>2026-08-21T10:15:00</datetime></informationbeforedive>
    <samples>${punti.join('')}</samples>
    <informationafterdive><greatestdepth>30.0</greatestdepth><diveduration>1800</diveduration></informationafterdive>
  </dive></repetitiongroup></profiledata>
</uddf>`;
}

function minutiInDeco(xml: string): number {
  const res = uddfParser.parse({ fileName: 'p.uddf', text: xml });
  const d = res.dives[0];
  return computeMetrics({ ...d, samples: d.samples }).decoS;
}

describe('UDDF: l’attributo che dice di che sosta si tratta', () => {
  /*
   * ► È IL CASO CHE IL CODICE SAPEVA RICONOSCERE E POI BUTTAVA. ◄ La condizione
   * era `kind === 'mandatory' || stopDepth > 0`: la seconda metà cancella la
   * prima, perché una sosta di sicurezza una profondità ce l'ha.
   */
  it('una sosta di sicurezza non è tempo in decompressione', () => {
    expect(minutiInDeco(uddfConSosta('safety'))).toBe(0);
  });

  it('una tappa obbligatoria lo è', () => {
    expect(minutiInDeco(uddfConSosta('mandatory'))).toBeGreaterThan(0);
  });

  /*
   * E QUANDO IL FILE NON LO DICE, si resta prudenti: parecchi UDDF `kind` non
   * ce l'hanno, e lì una sosta con una quota continua a valere obbligo. *Il
   * dubbio non si estende ai file che la risposta ce l'hanno scritta dentro.*
   */
  it('senza l’attributo resta un obbligo, come prima', () => {
    const senzaKind = uddfConSosta('mandatory').replace(/ kind="mandatory"/g, '');
    expect(minutiInDeco(senzaKind)).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------

/**
 * Un profilo a 36 m con una permanenza a 19 m, sotto o senza tetto.
 *
 * `durataPausaS` esiste perché la prima versione di questa prova la teneva a
 * nove minuti — la durata vera dell'immersione che aveva fatto scoprire il
 * difetto — e poi pretendeva che senza tetto restasse una «sosta profonda».
 * **Nove minuti non sono una sosta profonda nemmeno senza tetto**: il fixture
 * aveva lo stesso difetto del rilevatore, e se n'è accorto il tetto di durata.
 */
function conPausaA19(sottoTetto: boolean, durataPausaS = 120): Dive {
  const samples: Sample[] = [];
  for (let t = 0; t <= 3000; t += 10) {
    let depth: number;
    if (t < 180) depth = (t / 180) * 36;
    else if (t < 900) depth = 36;
    else if (t < 1100) depth = 36 - ((t - 900) / 200) * 17;
    else if (t < 1100 + durataPausaS) depth = 19;
    else if (t < 1250 + durataPausaS) depth = 19 - ((t - 1100 - durataPausaS) / 150) * 14;
    else if (t < 1550 + durataPausaS) depth = 5;
    else depth = Math.max(0, 5 - ((t - 1550 - durataPausaS) / 60) * 5);
    const s: Sample = { t, depth: Math.max(0, depth) };
    // Il tetto c'è per tutta la parte profonda della risalita, come su
    // un'immersione con i gradient factor bassi.
    if (sottoTetto && t >= 900 && t < 1250 + durataPausaS) {
      s.ceiling = 19;
      s.inDeco = true;
    }
    samples.push(s);
  }
  return {
    id: 'x',
    startTime: '2026-08-21T10:15:00Z',
    durationS: 3000,
    maxDepth: 36,
    mode: 'oc',
    cylinders: [],
    samples,
  } as unknown as Dive;
}

describe('la sosta profonda non è il tempo passato sotto un tetto', () => {
  /*
   * ► IL CASO VERO, dallo schermo di un subacqueo. ◄ Nove minuti a 19 metri su
   * un'immersione a 36 cadono in pieno nella fascia della sosta profonda
   * (15–23 m). Erano la prima tappa obbligatoria.
   */
  it('la prima tappa a 19 m non diventa una sosta profonda', () => {
    // Nove minuti sotto il tetto, come sull'immersione vera da cui nasce.
    const m = computeMetrics(conPausaA19(true, 550));
    expect(m.decoS).toBeGreaterThan(600);
    expect(m.deepStopS).toBe(0);
  });

  /*
   * ► E OLTRE I CINQUE MINUTI NON È UNA SOSTA NEMMENO SENZA TETTO. ◄
   *
   * Senza questo limite il rilevatore trovava una sosta profonda su **36
   * immersioni su 45** di un archivio vero, fino a ventisette minuti: profili
   * multilivello, dove la parte poco profonda cade nella fascia. Col limite ne
   * restano dieci.
   */
  it('una permanenza di nove minuti a metà profondità è un livello, non una sosta', () => {
    const m = computeMetrics(conPausaA19(false, 550));
    expect(m.decoS).toBe(0);
    expect(m.deepStopS).toBe(0);
  });

  /*
   * E LA SOSTA PROFONDA VERA RESTA RICONOSCIUTA: stessa quota, stessa durata,
   * nessun tetto. Senza questa metà, «niente soste profonde» sarebbe
   * soddisfatto anche da un rilevatore che non ne trova mai nessuna.
   */
  it('due minuti senza tetto restano una sosta profonda', () => {
    const m = computeMetrics(conPausaA19(false, 120));
    expect(m.decoS).toBe(0);
    expect(m.deepStopS).toBeGreaterThanOrEqual(60);
    expect(m.deepStopDepthM).toBeCloseTo(19, 0);
  });
});

// ---------------------------------------------------------------------------

/**
 * Un export di Shearwater Cloud con la sosta descritta dai due campi separati.
 *
 * `decoCeiling` è l'obbligo, `firstStopDepth` è la sosta che il computer
 * propone — e la propone anche per la sosta di sicurezza. Il parser leggeva il
 * secondo per decidere `inDeco`.
 */
function shearwaterCon(tetto: number, primaSosta: number): string {
  const rec: string[] = [];
  for (let t = 0; t <= 1800; t += 10) {
    const depth = t < 120 ? (t / 120) * 30 : t < 1200 ? 30 : 5;
    rec.push(
      `<diveLogRecord><currentTime>${t * 1000}</currentTime><currentDepth>${depth.toFixed(2)}</currentDepth>` +
        `<waterTemp>18</waterTemp><currentNdl>${tetto > 0 ? 0 : 20}</currentNdl>` +
        `<decoCeiling>${t >= 1200 ? tetto : 0}</decoCeiling>` +
        `<firstStopDepth>${t >= 1200 ? primaSosta : 0}</firstStopDepth>` +
        `<firstStopTime>${t >= 1200 ? 3 : 0}</firstStopTime>` +
        `<fractionHe>0</fractionHe><currentCircuitSetting>1</currentCircuitSetting><CNSPercent>2</CNSPercent>` +
        `</diveLogRecord>`,
    );
  }
  return `<?xml version="1.0" encoding="utf-8"?>
<dive><diveLog>
  <computerModel>Peregrine</computerModel><computerSerial>SW1048</computerSerial>
  <number>1</number><startDate>2026-08-21 10:15:00</startDate>
  <maxTime>1800</maxTime><maxDepth>30.00</maxDepth>
  <startSurfacePressure>1013</startSurfacePressure><imperialUnits>0</imperialUnits>
  <decoModel>GF</decoModel><gfMin>20</gfMin><gfMax>85</gfMax>
  <diveLogRecords>${rec.join('')}</diveLogRecords>
</diveLog></dive>`;
}

function decoDaShearwater(xml: string): number {
  const d = shearwaterParser.parse({ fileName: 'p.xml', text: xml }).dives[0];
  return computeMetrics({ ...d, samples: d.samples }).decoS;
}

describe('Shearwater Cloud: due campi, e si leggeva quello sbagliato', () => {
  /*
   * ► LA SOSTA DI SICUREZZA HA UNA QUOTA, E NON HA UN TETTO. ◄ È il caso in cui
   * i due campi divergono, ed è l'unico in cui si vede quale dei due si sta
   * leggendo: con `firstStopDepth` a 5 e `decoCeiling` a 0, l'immersione
   * risultava «in decompressione» per tutta la sosta finale.
   */
  it('una sosta proposta senza tetto non è tempo in decompressione', () => {
    expect(decoDaShearwater(shearwaterCon(0, 5))).toBe(0);
  });

  it('un tetto vero lo è', () => {
    expect(decoDaShearwater(shearwaterCon(6, 6))).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------

describe('«ho dovuto fermarmi?» è un’altra domanda da «per quanto ho avuto un obbligo»', () => {
  /*
   * ► IL CASO VERO, ed è quello che ha fatto nascere questo campo. ◄
   *
   * Tetto a 3 metri per tredici minuti, mentre il subacqueo risaliva da 30 a
   * 11. Sempre almeno otto metri più sotto del limite: il computer non l'ha mai
   * bloccato, e l'obbligo si è sciolto durante la risalita. La scheda diceva
   * «Tempo in deco 13:00» e lui rispondeva, con ragione, di non aver preso
   * nessuna deco. **Erano vere tutte e due.**
   */
  it('un obbligo mai vincolante lascia un margine largo', () => {
    const samples: Sample[] = [];
    for (let t = 0; t <= 1800; t += 10) {
      const depth = t < 600 ? 30 : t < 1500 ? 30 - ((t - 600) / 900) * 19 : 11;
      const s: Sample = { t, depth: Math.round(depth * 10) / 10 };
      if (t >= 600 && t < 1500) {
        s.ceiling = 3;
        s.inDeco = true;
      }
      samples.push(s);
    }
    const m = computeMetrics({
      id: 'x',
      startTime: '2026-09-08T10:47:00Z',
      durationS: 1800,
      maxDepth: 30,
      mode: 'oc',
      cylinders: [],
      samples,
    } as unknown as Dive);
    expect(m.decoS).toBeGreaterThan(600);
    // Mai sceso vicino al tetto: il minimo è stato a 11 m con il tetto a 3.
    expect(m.ceilingMarginM!).toBeGreaterThan(5);
    expect(m.ceilingViolationS).toBe(0);
  });

  /*
   * E CHI LA SOSTA L'HA FATTA DAVVERO ha un margine quasi nullo: è fermo **sul**
   * tetto, che è cosa vuol dire rispettare una tappa. Senza questa metà, un
   * margine «grande» sarebbe soddisfatto anche da un campo che non guarda
   * niente.
   */
  it('chi si ferma sulla tappa ha margine quasi zero', () => {
    const samples: Sample[] = [];
    for (let t = 0; t <= 1800; t += 10) {
      const depth = t < 600 ? 30 : t < 900 ? 30 - ((t - 600) / 300) * 21 : 9;
      const s: Sample = { t, depth: Math.round(depth * 10) / 10 };
      if (t >= 600 && t < 1500) {
        s.ceiling = 9;
        s.inDeco = true;
      }
      samples.push(s);
    }
    const m = computeMetrics({
      id: 'y',
      startTime: '2026-09-08T10:47:00Z',
      durationS: 1800,
      maxDepth: 30,
      mode: 'oc',
      cylinders: [],
      samples,
    } as unknown as Dive);
    expect(m.ceilingMarginM!).toBeLessThan(0.5);
  });

  it('senza obbligo il margine non esiste, e non si inventa uno zero', () => {
    const samples: Sample[] = [];
    for (let t = 0; t <= 1200; t += 10) samples.push({ t, depth: t < 600 ? 20 : 5 });
    const m = computeMetrics({
      id: 'z',
      startTime: '2026-09-08T10:47:00Z',
      durationS: 1200,
      maxDepth: 20,
      mode: 'oc',
      cylinders: [],
      samples,
    } as unknown as Dive);
    expect(m.decoS).toBe(0);
    expect(m.ceilingMarginM).toBeUndefined();
  });
});
