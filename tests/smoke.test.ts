/**
 * Il giro completo, su un archivio che non è il suo.
 *
 * PERCHÉ ESISTE. Perché fino a oggi tutto quello che questa app fa è stato provato
 * su un archivio solo: trentotto immersioni Shearwater e un Aladin, di una persona
 * sola, in un mare solo. Ogni test unitario verifica un pezzo con dati costruiti
 * per quel pezzo; nessuno verificava che i pezzi reggano *insieme* su un archivio
 * diverso — con immersioni in lago, ripetitive nella stessa giornata, immersioni
 * decompressive, immersioni senza profilo, e la stessa immersione arrivata da due
 * file in formati diversi.
 *
 * COSA CONTROLLA, E COSA NO. Non controlla che i numeri siano *giusti* — per quello
 * ci sono i test dei singoli moduli e il riscontro con Shearwater. Controlla che la
 * catena non si rompa e che non produca assurdità: che la deduplica non perda né
 * duplichi immersioni, che la riparazione converga, che la catena dei tessuti
 * riconosca le ripetitive, che le statistiche e i suggerimenti non esplodano su
 * casi che l'archivio di riferimento non contiene, che il pianificatore accetti
 * numeri estremi. È il genere di rete che serve quando l'app la userà qualcun altro.
 */

import { describe, expect, it } from 'vitest';
import type { Dive, Sample } from '../src/core/model';
import type { DiveStore } from '../src/storage/types';
import { synthesise, toCsv, toShearwaterXml, toSubsurface, toUddf } from './fixtures';
import { parseFile } from '../src/core/parsers';
import { mergeImports } from '../src/core/dedupe';
import { repairArchive } from '../src/storage/repair';
import { aggregate } from '../src/core/analysis/aggregate';
import { buildPlan, debriefDive } from '../src/core/analysis/coaching';
import { nextDiveBriefing } from '../src/core/analysis/nextDive';
import { exportUddf } from '../src/core/export/uddf';
import { DEFAULT_PLAN, planGas, measuredRmv } from '../src/core/analysis/gasPlan';
import { planDeco, type PlanGas } from '../src/core/analysis/deco';

/**
 * Un archivio deliberatamente scomodo.
 *
 * Ogni voce è un caso che l'archivio di riferimento NON contiene: la coppia di
 * ripetitive a due ore di distanza, il lago freddo, l'immersione con obbligo
 * decompressivo, quella cortissima, quella lunga e bassa. Se un pezzo dell'app dà
 * per scontato il profilo tipico dell'archivio di riferimento, si rompe qui.
 */
function archivio() {
  const day = (d: number, h: number) => new Date(Date.UTC(2026, 5, d, h, 0, 0));
  return [
    synthesise({
      startTime: day(1, 9),
      maxDepth: 38,
      durationS: 34 * 60,
      decoCeilingM: 6,
      o2: 0.28,
      siteName: 'Relitto',
      minTempC: 13,
    }),
    // Ripetitiva della stessa giornata, due ore dopo: il caso che ha fatto
    // scoprire l'errore sul carico residuo.
    synthesise({
      startTime: day(1, 13),
      maxDepth: 22,
      durationS: 48 * 60,
      siteName: 'Relitto',
      minTempC: 14,
    }),
    synthesise({
      startTime: day(2, 10),
      maxDepth: 9,
      durationS: 62 * 60,
      minTempC: 8,
      surfaceTempC: 17,
      siteName: 'Lago',
      o2: 0.21,
      wobbleM: 3.2,
    }),
    synthesise({
      startTime: day(9, 10),
      maxDepth: 45,
      durationS: 26 * 60,
      decoCeilingM: 9,
      o2: 0.21,
      siteName: 'Secca',
      ascentRateMpm: 14,
    }),
    synthesise({
      startTime: day(9, 14),
      maxDepth: 12,
      durationS: 18 * 60,
      siteName: 'Secca',
      safetyStopS: 0,
    }),
    synthesise({ startTime: day(20, 9), maxDepth: 30, durationS: 55 * 60, siteName: 'Punta', rmvLpm: 14 }),
  ];
}

async function importa(files: { name: string; text: string }[]) {
  const enc = new TextEncoder();
  let archive: Dive[] = [];
  for (const f of files) {
    // `text` va passato accanto ai byte: il riconoscimento del formato guarda il
    // contenuto, non l'estensione, e senza il testo nessun parser testuale si
    // dichiara. Nell'app lo fa `parseBrowserFile`.
    const result = await parseFile({ fileName: f.name, bytes: enc.encode(f.text), text: f.text });
    archive = mergeImports(archive, result.dives).dives;
  }
  return archive;
}

/** Uno store in memoria che conserva davvero i profili, come fa quello vero. */
function memoryStore(dives: Dive[]) {
  const byId = new Map<string, Dive>();
  const samples = new Map<string, Sample[]>();
  for (const d of dives) {
    const { samples: s, ...rest } = d;
    byId.set(d.id, rest as Dive);
    if (s?.length) samples.set(d.id, s);
  }
  const store: DiveStore = {
    kind: 'indexeddb',
    location: 'memoria',
    async init() {},
    async listDives() {
      return [...byId.values()];
    },
    async getDive(id) {
      return byId.get(id);
    },
    async getSamples(id) {
      return samples.get(id) ?? [];
    },
    async getAltSamples() {
      return [];
    },
    async sampleCounts() {
      return new Map([...samples].map(([id, s]) => [id, s.length]));
    },
    async altSampleCounts() {
      return new Map();
    },
    async putDives(list) {
      for (const d of list) {
        const { samples: s, ...rest } = d;
        byId.set(d.id, rest as Dive);
        if (s?.length) samples.set(d.id, s);
      }
    },
    async deleteDive(id) {
      byId.delete(id);
      samples.delete(id);
    },
    async clear() {
      byId.clear();
      samples.clear();
    },
    async getSetting() {
      return undefined;
    },
    async setSetting() {},
  };
  return store;
}

describe('il giro completo su un archivio nuovo', () => {
  const dives = archivio();

  it('import da quattro formati diversi con sovrapposizioni: niente perso, niente doppio', async () => {
    const archive = await importa([
      { name: 'tutto.uddf', text: multiUddf(dives) },
      // Le stesse prime tre, da un altro programma: devono fondersi, non sommarsi.
      { name: 'parziale.ssrf', text: multiSubsurface(dives.slice(0, 3)) },
      { name: 'singola.xml', text: toShearwaterXml(dives[3], { diveNumber: 4 }) },
      // Il CSV non ha profilo: aggiunge campi, non immersioni.
      { name: 'vecchio.csv', text: toCsv(dives.slice(0, 2)) },
    ]);
    expect(archive).toHaveLength(dives.length);
    const ids = new Set(archive.map((d) => d.id));
    expect(ids.size).toBe(dives.length);
  });

  it('la riparazione converge: la seconda volta non tocca più niente', async () => {
    const archive = await importa([{ name: 'tutto.uddf', text: multiUddf(dives) }]);
    const store = memoryStore(archive);
    const primo = await repairArchive(store, await store.listDives());
    const secondo = await repairArchive(store, primo.dives);
    expect(secondo.report.repaired).toBe(0);
  });

  it('la catena dei tessuti riconosce le ripetitive e solo quelle', async () => {
    const archive = await importa([{ name: 'tutto.uddf', text: multiUddf(dives) }]);
    const store = memoryStore(archive);
    const { dives: healed } = await repairArchive(store, await store.listDives());

    const ripetitive = healed.filter((d) => d.metrics?.surfaceIntervalMin !== undefined);
    // TRE, non due, e la terza insegna qualcosa: le due coppie della stessa
    // giornata più l'immersione del 2 giugno, che comincia ventuno ore dopo la
    // fine di quella del 1º. La catena si spezza a ventiquattro ore, non a
    // mezzanotte — «ripetitiva» è una questione di azoto, non di calendario.
    expect(ripetitive).toHaveLength(3);
    for (const r of ripetitive) {
      expect(r.metrics!.residualN2Bar!).toBeGreaterThan(0);
      expect(r.metrics!.gf99Pct!).toBeGreaterThanOrEqual(r.metrics!.gf99CleanPct!);
      expect(r.metrics!.surfaceIntervalMin!).toBeLessThan(24 * 60);
    }
    // E tutte hanno un GF99 nostro, non solo quelle di un computer particolare.
    for (const d of healed) expect(d.metrics?.gf99Pct).toBeGreaterThan(0);
  });

  it('statistiche, suggerimenti e briefing reggono senza numeri assurdi', async () => {
    const archive = await importa([{ name: 'tutto.uddf', text: multiUddf(dives) }]);
    const store = memoryStore(archive);
    const { dives: healed } = await repairArchive(store, await store.listDives());

    const agg = aggregate(healed);
    expect(agg.count).toBe(dives.length);
    expect(agg.withProfile).toBe(dives.length);
    expect(agg.gf99).toHaveLength(dives.length);
    expect(agg.avgGf99!).toBeGreaterThan(0);
    expect(agg.avgGf99!).toBeLessThan(200);
    expect(agg.decoDives).toBeGreaterThan(0);
    expect(agg.coldDives).toBeGreaterThan(0);

    const plan = buildPlan(healed, agg);
    expect(plan.findings.length).toBeGreaterThan(0);
    for (const f of plan.findings) {
      expect(f.headline).not.toContain('undefined');
      expect(f.headline).not.toContain('NaN');
      for (const e of f.evidence) expect(e).not.toMatch(/undefined|NaN/);
    }

    // Il debrief di ogni singola immersione, compresa quella senza sosta e quella
    // in lago: è il punto in cui un caso non previsto salta fuori.
    for (const d of healed) {
      for (const o of debriefDive({ ...d, samples: await store.getSamples(d.id) })) {
        expect(o.text).not.toMatch(/undefined|NaN/);
      }
    }

    // Ventiquattro ore meno un'ora dopo l'ultima uscita: zero giorni pieni, e il
    // conto parte dalla FINE dell'immersione.
    const briefing = nextDiveBriefing(healed, undefined, Date.UTC(2026, 5, 21, 9));
    expect(briefing.notes.length).toBeGreaterThan(0);
    expect(briefing.daysSinceLast).toBe(0);
    expect(briefing.hoursSinceLast!).toBeGreaterThan(22);
  });

  it('l’export UDDF fa il giro e torna indietro', async () => {
    const archive = await importa([{ name: 'tutto.uddf', text: multiUddf(dives) }]);
    const store = memoryStore(archive);
    const { dives: healed } = await repairArchive(store, await store.listDives());
    const withProfiles = await Promise.all(
      healed.map(async (d) => ({ ...d, samples: await store.getSamples(d.id) })),
    );

    const { xml } = exportUddf(withProfiles, { generator: 'smoke', now: '2026-08-18T00:00:00Z' });
    const back = await parseFile({ fileName: 'giro.uddf', bytes: new TextEncoder().encode(xml), text: xml });
    expect(back.dives).toHaveLength(healed.length);
    for (const d of back.dives) {
      const original = healed.find(
        (o) => Math.abs(Date.parse(o.startTime) - Date.parse(d.startTime)) < 60_000,
      );
      expect(original).toBeDefined();
      expect(d.maxDepth).toBeCloseTo(original!.maxDepth, 0);
    }
  });
});

describe('il pianificatore non si fa mettere in crisi', () => {
  const estremi = [
    { depthM: 6, bottomMin: 5, tankL: 3, startBar: 50 },
    { depthM: 60, bottomMin: 60, tankL: 24, startBar: 300 },
    { depthM: 12, bottomMin: 180, tankL: 15, startBar: 200 },
  ];

  for (const e of estremi) {
    it(`gas a ${e.depthM} m per ${e.bottomMin} min con ${e.tankL} L`, () => {
      const p = planGas({ ...DEFAULT_PLAN, ...e, totalMin: e.bottomMin + 10, rmvLpm: 20 });
      expect(Number.isFinite(p.plannedL)).toBe(true);
      expect(p.reserveBar).toBeGreaterThanOrEqual(0);
      expect(p.expectedEndBar).toBeLessThanOrEqual(e.startBar);
      for (const ph of p.planned) expect(ph.minutes).toBeGreaterThanOrEqual(0);
    });
  }

  it('la deco non va in ciclo nemmeno su un profilo assurdo', () => {
    const gas: PlanGas[] = [{ mix: { o2: 0.21, he: 0 }, role: 'bottom', tankL: 24, startBar: 200 }];
    const r = planDeco([{ depthM: 60, minutes: 120 }], gas, { gfLow: 0.2, gfHigh: 0.7 });
    expect(r.runtimeMin).toBeLessThan(2000);
    expect(r.stops.length).toBeGreaterThan(0);
    expect(r.warnings.some((w) => w.level === 'critical')).toBe(true);
  });

  it('un archivio senza pressioni non produce un consumo inventato', async () => {
    const senzaGas = synthesise({ startTime: new Date('2026-06-01T09:00:00Z'), startBar: 0, tankSizeL: 0 });
    const archive = await importa([{ name: 'x.uddf', text: toUddf(senzaGas, 1) }]);
    expect(measuredRmv(archive).median).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// I fixture producono un file per immersione: qui si fondono, come arrivano
// gli export veri.
// ---------------------------------------------------------------------------

function multiUddf(list: ReturnType<typeof synthesise>[]): string {
  const parts = list.map((d, i) => {
    const single = toUddf(d, i + 1);
    const dive = single.slice(single.indexOf('<dive '), single.indexOf('</dive>') + 7);
    return dive.replaceAll('ref="site1"', `ref="site${i + 1}"`);
  });
  const sites = list
    .map((d, i) => `<site id="site${i + 1}"><name>${d.spec.siteName}</name></site>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<uddf version="3.2.3">
  <generator><name>smoke</name></generator>
  <gasdefinitions><mix id="mix1"><name>EAN32</name><o2>0.32</o2><he>0</he></mix></gasdefinitions>
  <divesite>${sites}</divesite>
  <profiledata><repetitiongroup id="rg1">
${parts.join('\n')}
  </repetitiongroup></profiledata>
</uddf>`;
}

function multiSubsurface(list: ReturnType<typeof synthesise>[]): string {
  const parts = list.map((d, i) => {
    const single = toSubsurface(d, i + 1);
    return single.slice(single.indexOf('<dive '), single.indexOf('</dive>') + 7);
  });
  return `<divelog program='smoke' version='3'><dives>
${parts.join('\n')}
</dives></divelog>`;
}
