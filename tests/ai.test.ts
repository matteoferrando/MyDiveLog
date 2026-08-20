/**
 * Analisi con Claude: contesto, prompt, client e resa del markdown.
 *
 * Il client viene provato con un `fetch` iniettato: si verificano gli header, il
 * corpo della richiesta, lo streaming spezzato a metà fra due blocchi di rete e la
 * traduzione degli errori. Nessuna chiave, nessuna rete, nessun costo.
 *
 * Sul contesto la proprietà che conta è una sola e vale più di tutte le altre:
 * **un dato che l'app non ha non deve comparire nel contesto come numero.** È
 * l'unico modo di impedire che un modello riempia un buco con un valore
 * plausibile che poi finisce in un piano di gas.
 */

import { describe, expect, it, vi } from 'vitest';
import { gasPlanContext } from '../src/ai/context';
import {
  DEFAULT_PLAN,
  contingencies,
  measuredRmv,
  planGas,
  similarDives,
} from '../src/core/analysis/gasPlan';
import { ask, listModels, testKey, AiError } from '../src/ai/client';
import { archiveContext, diveContext, reduceProfile } from '../src/ai/context';
import { diveAnalysis, archiveAnalysis, planAnalysis, decoPlanAnalysis, SYSTEM } from '../src/ai/prompts';
import { decoPlanContext } from '../src/ai/context';
import {
  DEFAULT_DECO,
  decoContingencies,
  planDeco,
  type DecoSettings,
  type PlanGas,
} from '../src/core/analysis/deco';
import { aggregate } from '../src/core/analysis/aggregate';
import { computeMetrics } from '../src/core/analysis/metrics';
import type { Dive, Sample } from '../src/core/model';

const CREDS = { apiKey: 'sk-ant-test', model: 'test-model' };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** Un flusso SSE spezzato in blocchi arbitrari, come arriva dalla rete. */
function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

function dive(overrides: Partial<Dive> = {}): Dive {
  const base: Dive = {
    id: 'abc123',
    startTime: '2026-06-14T10:38:00+02:00',
    durationS: 2400,
    maxDepth: 32.4,
    avgDepth: 18.2,
    mode: 'oc',
    cylinders: [{ mix: { o2: 0.21, he: 0 }, sizeL: 12, startBar: 220, endBar: 70, material: 'steel' }],
    source: { format: 'logtrak', file: 'a.logtrak', importedAt: '2026-06-14T20:00:00Z' },
    tags: [],
    samples: profile(240),
    ...overrides,
  };
  return { ...base, metrics: computeMetrics(base) };
}

function profile(n: number): Sample[] {
  return Array.from({ length: n }, (_, i) => ({
    t: i * 10,
    depth: i < 12 ? i * 2.7 : i > n - 12 ? Math.max(0, (n - i) * 2.7) : 25 + Math.sin(i / 8) * 2,
    tempC: 18,
    ndlS: 600,
    ttsS: 120,
    cns: Math.min(99, Math.round(i / 10)),
  }));
}

describe('sottocampionamento del profilo', () => {
  it('tiene i minimi e i massimi di ogni intervallo', () => {
    const samples = profile(600);
    const reduced = reduceProfile(samples, 40);
    expect(reduced.length).toBeLessThan(samples.length);
    // Il punto più profondo dell'originale deve sopravvivere: è quello su cui si
    // giudica l'immersione, e un campionamento uniforme lo perderebbe.
    const deepest = Math.max(...samples.map((s) => s.depth));
    expect(Math.max(...reduced.map((s) => s.depth))).toBe(deepest);
    expect(reduced.map((s) => s.t)).toEqual([...reduced.map((s) => s.t)].sort((a, b) => a - b));
  });

  it('non tocca un profilo già corto', () => {
    const samples = profile(20);
    expect(reduceProfile(samples, 40)).toHaveLength(20);
  });
});

describe('contesto di una immersione', () => {
  it('include i dati misurati con le unità', () => {
    const context = diveContext(dive());
    expect(context).toContain('profonditaMassimaM');
    expect(context).toContain('consumoDiSuperficieLMin');
    expect(context).toContain('"litri": 12');
    expect(context).toContain('materiale');
  });

  it('dichiara i dati assenti come nulli, senza inventarli', () => {
    const d = dive({ cylinders: [{ mix: { o2: 0.21, he: 0 } }], avgDepth: undefined });
    const context = diveContext(d);
    const parsed = JSON.parse(context);
    expect(parsed.bombole[0].litri).toBeNull();
    expect(parsed.bombole[0].barIniziali).toBeNull();
    expect(parsed.immersione.profonditaMediaM).toBeNull();
    // Nessun consumo: senza volume e pressioni non è calcolabile e non compare.
    expect(parsed.calcolatoDallApp.consumoDiSuperficieLMin).toBeNull();
  });

  it('tiene separati i valori letti dal computer da quelli calcolati', () => {
    const d = dive({ reported: { gf99End: 67, maxDecoObligationS: 120 } });
    const parsed = JSON.parse(diveContext(d));
    expect(parsed.lettoDalComputer.gf99AllUscitaPct).toBe(67);
    expect(parsed.calcolatoDallApp).toHaveProperty('oscillazioneAQuotaTenutaMMin');
    expect(parsed.lettoDalComputer).not.toHaveProperty('oscillazioneAQuotaTenutaMMin');
  });

  it('porta le impostazioni di tutti i computer che hanno registrato l’immersione', () => {
    const d = dive({
      computer: { model: 'Shearwater Peregrine', gfLow: 45, gfHigh: 95 },
      otherComputers: [{ model: 'Scubapro Aladin Sport Matrix', ppo2MaxBar: 1.4 }],
    });
    const parsed = JSON.parse(diveContext(d));
    expect(parsed.computer).toHaveLength(2);
    expect(parsed.computer[0].gfImpostati).toBe('45/95');
    expect(parsed.computer[1].limitePpo2Bar).toBe(1.4);
  });
});

describe('contesto dell’archivio', () => {
  it('manda una riga per immersione più le aggregate', () => {
    const dives = [dive(), dive({ id: 'b', startTime: '2026-06-15T10:00:00+02:00', maxDepth: 22 })];
    const parsed = JSON.parse(archiveContext(dives, aggregate(dives, Date.parse('2026-07-01T00:00:00Z'))));
    expect(parsed.immersioni.righe).toHaveLength(2);
    expect(parsed.archivio.immersioni).toBe(2);
    expect(parsed.immersioni.colonne).toContain('consumo(L/min)');
    expect(parsed.immersioni.nota).toMatch(/nullo significa dato assente/);
    expect(parsed.limitiDiRiferimentoUsatiDallApp.risalitaSopraI10mMMin).toBe(6);
  });
});

describe('istruzioni', () => {
  it('vietano di stimare e impongono di distinguere letto da calcolato', () => {
    expect(SYSTEM).toMatch(/Non stimare/);
    expect(SYSTEM).toMatch(/LETTI dal computer/);
    expect(SYSTEM).toMatch(/CALCOLATI/);
    expect(SYSTEM).toMatch(/Niente consigli medici/);
  });

  it('ogni analisi porta il contesto e un limite di token sensato', () => {
    for (const spec of [diveAnalysis('CTX'), archiveAnalysis('CTX'), planAnalysis('CTX')]) {
      expect(spec.prompt).toContain('CTX');
      expect(spec.system).toBe(SYSTEM);
      expect(spec.maxTokens).toBeGreaterThan(2000);
    }
  });
});

describe('client', () => {
  it('manda gli header richiesti dall’API', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fake = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return jsonResponse({
        content: [{ type: 'text', text: 'ciao' }],
        model: 'test-model',
        usage: { input_tokens: 10, output_tokens: 3 },
      });
    });
    const result = await ask(CREDS, { system: 'S', prompt: 'P', fetchImpl: fake });
    expect(result.text).toBe('ciao');
    expect(result.usage?.inputTokens).toBe(10);
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('sk-ant-test');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    // Senza questo header il browser blocca la richiesta.
    expect(headers['anthropic-dangerous-direct-browser-access']).toBe('true');
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.model).toBe('test-model');
    expect(body.system).toBe('S');
    expect(body.messages).toEqual([{ role: 'user', content: 'P' }]);
    expect(body.stream).toBe(false);
  });

  it('legge un flusso spezzato fra due blocchi di rete', async () => {
    // Il taglio cade in mezzo a un evento: se il resto non viene conservato, il
    // testo esce mutilato e nessun test lo noterebbe con blocchi "puliti".
    const chunks = [
      'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":42}}}\n\n',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Prima "}}\n\ndata: {"type":"content_bl',
      'ock_delta","delta":{"type":"text_delta","text":"parte"}}\n\ndata: {"type":"message_delta","usage":{"output_tokens":7}}\n\n',
    ];
    const seen: string[] = [];
    const result = await ask(CREDS, {
      system: 'S',
      prompt: 'P',
      onChunk: (t) => seen.push(t),
      fetchImpl: async () => sseResponse(chunks),
    });
    expect(result.text).toBe('Prima parte');
    expect(seen[seen.length - 1]).toBe('Prima parte');
    expect(result.usage).toEqual({ inputTokens: 42, outputTokens: 7 });
  });

  it('traduce gli errori dell’API in messaggi utili', async () => {
    await expect(
      ask(CREDS, {
        system: 'S',
        prompt: 'P',
        fetchImpl: async () => jsonResponse({ error: { message: 'x' } }, 401),
      }),
    ).rejects.toThrow(/non valida/);
    await expect(
      ask(CREDS, { system: 'S', prompt: 'P', fetchImpl: async () => jsonResponse({}, 429) }),
    ).rejects.toThrow(/Limite di richieste/);
    await expect(
      ask(CREDS, { system: 'S', prompt: 'P', fetchImpl: async () => jsonResponse({}, 503) }),
    ).rejects.toThrow(/503/);
  });

  it('rifiuta di chiamare senza chiave o senza modello', async () => {
    await expect(ask({ apiKey: '' }, { system: 'S', prompt: 'P' })).rejects.toThrow(AiError);
    await expect(ask({ apiKey: 'k' }, { system: 'S', prompt: 'P' })).rejects.toThrow(/modello/);
  });

  it('elenca i modelli senza fissarne nessuno nel codice', async () => {
    const models = await listModels(CREDS, async () =>
      jsonResponse({ data: [{ id: 'modello-b', display_name: 'B' }, { id: 'modello-a' }] }),
    );
    expect(models.map((m) => m.id)).toEqual(['modello-b', 'modello-a']);
    const check = await testKey(CREDS, async () => jsonResponse({ data: [{ id: 'x' }] }));
    expect(check.ok).toBe(true);
  });

  it('una chiave valida senza modelli non passa per buona', async () => {
    const check = await testKey(CREDS, async () => jsonResponse({ data: [] }));
    expect(check).toEqual({ ok: false, error: expect.stringContaining('nessun modello') });
  });
});

/**
 * Le istruzioni contro il contesto vero.
 *
 * Un'istruzione che cita un campo che il contesto non produce è peggio di
 * un'istruzione assente: dice al modello di cercare qualcosa che non c'è, e quello
 * che non c'è viene inventato. Questi test tengono agganciate le due cose.
 */
describe('istruzioni tarate sul contesto', () => {
  const dive: Dive = {
    id: 'x',
    startTime: '2026-06-01T09:00:00Z',
    durationS: 2400,
    maxDepth: 30,
    cylinders: [{ mix: { o2: 0.21, he: 0 }, sizeL: 12, startBar: 200, endBar: 70 }],
    source: { format: 'shearwater-cloud', file: 't.db', importedAt: '2026-06-01T09:00:00Z' },
    mode: 'oc',
    tags: [],
    metrics: {
      phases: { descentS: 120, bottomS: 1800, ascentS: 480, descentEndS: 120, ascentStartS: 1920 },
      fastAscentS: 0,
      fastShallowAscentS: 0,
      safetyStopS: 180,
      didSafetyStop: true,
      decoS: 0,
      ceilingViolationS: 0,
      deepStopS: 0,
      badGasSwitches: 0,
      gf99Pct: 71,
      gf99MaxPct: 74,
      leadingCompartment: 5,
      residualN2Bar: 0.14,
      gf99CleanPct: 63,
      surfaceIntervalMin: 75,
      quality: {
        sampleCount: 240,
        sampleIntervalS: 10,
        hasProfile: true,
        hasCeiling: false,
        hasTankPressure: true,
        hasCylinderVolume: true,
        ratesIntervalS: 10,
        ratesFromAlt: false,
        caveats: [],
      },
    } as Dive['metrics'],
    reported: { gf99End: 70 },
  };

  it('ogni campo nominato nelle istruzioni esiste davvero nel contesto', () => {
    const ctx = diveContext(dive);
    for (const field of [
      'gf99AllUscitaPct',
      'intervalloDiSuperficieMin',
      'azotoResiduoIngressoBar',
      'gf99SenzaResiduoPct',
    ]) {
      expect(SYSTEM).toContain(field);
      expect(ctx).toContain(field);
    }
  });

  it('il contesto porta i due GF99 in posti distinti, come le istruzioni promettono', () => {
    const parsed = JSON.parse(diveContext(dive));
    expect(parsed.lettoDalComputer.gf99AllUscitaPct).toBe(70);
    expect(parsed.calcolatoDallApp.gf99AllUscitaPct).toBe(71);
    expect(parsed.calcolatoDallApp.gf99SenzaResiduoPct).toBe(63);
  });

  it('le istruzioni non dicono più che il GF99 è un valore del computer', () => {
    // Lo diceva, ed era vero finché il modello nostro non c'era. Adesso è falso, e
    // un'istruzione falsa fa attribuire male ogni numero che tocca.
    expect(SYSTEM).not.toMatch(/valori LETTI dal computer \(GF99/);
  });

  it('dicono cosa fare quando i campi scritti a mano mancano tutti', () => {
    // È il caso NORMALE di un archivio importato da un computer subacqueo: senza
    // questa istruzione l'analisi elenca dodici mancanze una per una.
    expect(SYSTEM).toMatch(/compilati a mano/);
    expect(SYSTEM).toMatch(/Non elencarli uno per uno/);
  });
});

/**
 * Il contesto del piano di decompressione.
 *
 * È l'unico contesto che descrive qualcosa che non è ancora successo, e per questo
 * l'errore da evitare è diverso dagli altri: non «hai inventato un numero» ma «hai
 * riscritto una tabella di decompressione». L'istruzione che lo vieta va tenuta
 * agganciata al contesto tanto quanto i nomi dei campi.
 */
describe('contesto del piano di decompressione', () => {
  const levels = [{ depthM: 45, minutes: 25 }];
  const gases: PlanGas[] = [
    { mix: { o2: 0.21, he: 0.35 }, role: 'bottom', tankL: 24, startBar: 200 },
    { mix: { o2: 0.5, he: 0 }, role: 'deco', tankL: 11, startBar: 200 },
    { mix: { o2: 1, he: 0 }, role: 'deco', tankL: 11, startBar: 200 },
  ];
  const settings: DecoSettings = { ...DEFAULT_DECO, gfLow: 0.3, gfHigh: 0.8, lastStopM: 6 };
  const result = planDeco(levels, gases, settings);
  const ctx = decoPlanContext(
    result,
    levels,
    gases,
    settings,
    decoContingencies(levels, gases, settings),
    'Bühlmann ZH-L16C con GF 30/80',
  );
  const parsed = JSON.parse(ctx);

  it('porta il piano intero: soste, gas, ossigeno, contingenze', () => {
    expect(parsed.soste.length).toBe(result.stops.length);
    expect(parsed.gas.length).toBeGreaterThan(0);
    expect(parsed.ossigeno.cnsPct).toBeGreaterThan(0);
    expect(parsed.contingenze.length).toBeGreaterThan(3);
    expect(parsed.risultato.runtimeMin).toBeCloseTo(result.runtimeMin, 1);
  });

  it('dichiara che nessun numero è misurato', () => {
    expect(parsed.nota).toMatch(/CALCOLATI/);
    expect(parsed.nota).toMatch(/nessuno è stato misurato/);
    expect(parsed.modello).toContain('30/80');
  });

  it('distingue le soste obbligate da quella di sicurezza', () => {
    // Un profilo davvero in curva, con i gradient factor larghi: con quelli
    // stretti del piano tecnico qui sopra anche diciotto metri prendono un obbligo,
    // e la sosta di sicurezza sparisce — che è il comportamento giusto ma non
    // quello che questo test vuole misurare.
    const curva = [{ depthM: 18, minutes: 35 }];
    const larghi: DecoSettings = { ...DEFAULT_DECO, gfLow: 0.45, gfHigh: 0.95 };
    const conSosta = planDeco(curva, [gases[0]], larghi);
    expect(conSosta.noDeco).toBe(true);
    const c = JSON.parse(decoPlanContext(conSosta, curva, [gases[0]], larghi, [], 'x'));
    expect(c.soste.every((s: { obbligatoria: boolean }) => s.obbligatoria === false)).toBe(true);
    expect(c.risultato.sostaDiSicurezzaMin).toBe(3);
  });

  it('le istruzioni vietano esplicitamente di riscrivere la tabella', () => {
    const spec = decoPlanAnalysis(ctx);
    expect(spec.prompt).toMatch(/non proporre soste, tempi o profondità diversi/i);
    expect(spec.prompt).toMatch(/sta inventando numeri/);
    expect(spec.prompt).toContain(ctx);
  });
});

/*
 * IL CONTESTO DEL PIANIFICATORE GAS non aveva NESSUN test.
 *
 * Era anche l'unico che `dump:ai` non stampava, e infatti è lì che una revisione
 * ha trovato un contesto che dichiarava al modello un filtro non applicato:
 * `filtrateAncheSullaDurata: true` su un confronto filtrato solo sulla
 * profondità, con l'avvertenza scritta apposta per quel caso che non si attivava
 * mai. Due buchi che si tenevano per mano — nessuno lo leggeva, nessuno lo
 * provava.
 */
describe('contesto del pianificatore gas', () => {
  const piano = () =>
    planGas({ ...DEFAULT_PLAN, depthM: 30, avgDepthM: 24, bottomMin: 20, rmvLpm: 18, tankL: 15 });

  const archivio = (n: number, depth: number, min: number): Dive[] =>
    Array.from({ length: n }, (_, i) => ({
      id: `d${i}`,
      startTime: `2026-0${(i % 8) + 1}-14T10:00:00.000Z`,
      durationS: min * 60,
      maxDepth: depth,
      mode: 'oc',
      cylinders: [{ mix: { o2: 0.21, he: 0 }, sizeL: 15, startBar: 200, endBar: 60 }],
      tags: [],
      source: { format: 'uddf', file: 'a', importedAt: 'x' },
      metrics: { rmvLpm: 17, endPressureBar: 60 } as Dive['metrics'],
    })) as unknown as Dive[];

  it('non dichiara un filtro sulla durata che non è stato applicato', () => {
    const p = piano();
    // Immersioni alla stessa profondità ma lunghe il DOPPIO: senza il filtro
    // sulla durata entrerebbero comunque, e il contesto direbbe di averle
    // filtrate anche su quella.
    const dives = archivio(6, 30, 50);
    const j = JSON.parse(
      gasPlanContext(
        p,
        contingencies(p.input),
        similarDives(dives, p.input.depthM, 5, p.input.bottomMin),
        measuredRmv(dives),
        'tutto l’archivio',
      ),
    );
    const simili = j.immersioniVereAProfonditaSimile;
    if (simili?.filtrateAncheSullaDurata) {
      // Se dichiara il filtro, la durata tipica deve somigliare a quella
      // pianificata: altrimenti la dichiarazione è falsa.
      expect(Math.abs((simili.durataTipicaMin ?? 0) - p.input.bottomMin)).toBeLessThan(20);
    } else {
      expect(simili?.avvertenza ?? '').toMatch(/SOLO sulla profondità|molto diversa/);
    }
  });

  it('dichiara che i numeri sono calcolati dall’app, non letti da un computer', () => {
    const p = piano();
    const j = JSON.parse(
      gasPlanContext(p, contingencies(p.input), similarDives([], 30, 5, 20), measuredRmv([]), 'x'),
    );
    expect(j.nota).toMatch(/CALCOLATI da questa app/);
  });

  it('non spedisce `undefined` né `NaN` su un archivio vuoto', () => {
    const p = piano();
    const testo = gasPlanContext(
      p,
      contingencies(p.input),
      similarDives([], 30, 5, 20),
      measuredRmv([]),
      'x',
    );
    expect(testo).not.toContain('undefined');
    expect(testo).not.toContain('NaN');
    expect(() => JSON.parse(testo)).not.toThrow();
  });
});
