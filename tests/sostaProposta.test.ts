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

/** Un profilo a 36 m con una permanenza a 19 m, sotto o senza tetto. */
function conPausaA19(sottoTetto: boolean): Dive {
  const samples: Sample[] = [];
  for (let t = 0; t <= 3000; t += 10) {
    let depth: number;
    if (t < 180) depth = (t / 180) * 36;
    else if (t < 900) depth = 36;
    else if (t < 1100) depth = 36 - ((t - 900) / 200) * 17;
    else if (t < 1650) depth = 19;
    else if (t < 1800) depth = 19 - ((t - 1650) / 150) * 14;
    else if (t < 2100) depth = 5;
    else depth = Math.max(0, 5 - ((t - 2100) / 60) * 5);
    const s: Sample = { t, depth: Math.max(0, depth) };
    // Il tetto c'è per tutta la parte profonda della risalita, come su
    // un'immersione con i gradient factor bassi.
    if (sottoTetto && t >= 900 && t < 1800) {
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
    const m = computeMetrics(conPausaA19(true));
    expect(m.decoS).toBeGreaterThan(600);
    expect(m.deepStopS).toBe(0);
  });

  /*
   * E LA SOSTA PROFONDA VERA RESTA RICONOSCIUTA: stessa quota, stessa durata,
   * nessun tetto. Senza questa metà, «niente soste profonde» sarebbe
   * soddisfatto anche da un rilevatore che non ne trova mai nessuna.
   */
  it('la stessa pausa senza tetto resta una sosta profonda', () => {
    const m = computeMetrics(conPausaA19(false));
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
