/**
 * L'ELENCO DI QUELLO CHE L'EXPORT UDDF PERDE, TENUTO ONESTO DA UNA MACCHINA.
 *
 * ► IL DIFETTO CHE QUESTO FILE CHIUDE, E PERCHÉ TORNAVA. ◄ `core/export/uddf.ts`
 * promette in testa che «un elenco incompleto è peggio di nessun elenco: fa
 * credere di sapere cosa si sta perdendo». L'elenco però era scritto a mano, e
 * un elenco scritto a mano non è sbagliato una volta: si SCOLLA. È partito da
 * quattro voci, è stato portato a venti, e intanto nel modello erano entrati la
 * profondità programmata, il centro, la firma della guida, la miscela
 * analizzata, le soste campione per campione — tutta roba che spariva nel giro
 * export→import senza che l'elenco la nominasse. Ogni volta la correzione era
 * «aggiungere le voci mancanti», cioè la stessa correzione, cioè nessuna.
 *
 * ► COSA FA QUESTA PROVA AL POSTO DI RILEGGERE. ◄ Due domande, tutte e due
 * misurate sul giro vero:
 *
 *   1. **completezza** — si riempie un'immersione con OGNI campo del modello, la
 *      si esporta, la si rilegge, e ogni campo che non torna indietro dev'essere
 *      dichiarato. Se non lo è, la prova dice quale.
 *   2. **onestà nell'altro verso** — ogni campo dichiarato perso deve essere
 *      perso davvero. È il difetto gemello: «restano fuori: il tipo di circuito»
 *      compariva su cento immersioni tutte a circuito aperto, dove non restava
 *      fuori niente.
 *
 * ► E LA TERZA DOMANDA, quella che fa scattare la prova IL GIORNO GIUSTO. ◄ I
 * nomi dei campi si leggono da `model.ts`, non da questo file. Chi aggiunge
 * `Dive.qualcosa` e non lo mette nella scheda finta qui sotto trova subito una
 * prova rossa che gli dice il nome del campo: è il solo modo perché la domanda
 * «e questo, l'export se lo porta dietro?» venga fatta quando il campo nasce e
 * non tre versioni dopo.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { exportUddf } from '../src/core/export/uddf';
import { parseFile } from '../src/core/parsers';
import { computeMetrics } from '../src/core/analysis/metrics';
import { AIR, type Dive, type Sample } from '../src/core/model';

const MODELLO = fileURLToPath(new URL('../src/core/model.ts', import.meta.url));

/**
 * I nomi dei campi di un'interfaccia, letti dal sorgente del modello.
 *
 * Le dichiarazioni stanno tutte a due spazi di rientro (`  nome?: tipo;`); i
 * commenti cominciano con `/` o con `*` e non possono essere scambiati per un
 * campo. È una lettura grezza apposta: deve rompersi rumorosamente se il
 * modello cambia forma, non indovinare.
 */
function campiDi(interfaccia: string): string[] {
  const sorgente = readFileSync(MODELLO, 'utf8');
  const inizio = sorgente.indexOf(`export interface ${interfaccia} {`);
  if (inizio < 0) throw new Error(`interfaccia ${interfaccia} non trovata in model.ts`);
  const corpo = sorgente.slice(inizio, sorgente.indexOf('\n}', inizio));
  const campi = [...corpo.matchAll(/^ {2}([A-Za-z_][A-Za-z0-9_]*)\??:/gm)].map((m) => m[1]!);
  if (campi.length < 3) throw new Error(`lettura di ${interfaccia} sospetta: ${campi.length} campi`);
  return campi;
}

// ---------------------------------------------------------------------------
// L'immersione con TUTTO dentro
// ---------------------------------------------------------------------------

const CAMPIONI: Sample[] = Array.from({ length: 9 }, (_, i) => ({
  t: i * 300,
  depth: 20,
  tempC: 18,
  pressureBar: [200 - i * 5, 200 - i],
  ndlS: 600,
  ttsS: 180,
  stopDepth: 6,
  stopTimeS: 120,
  ceiling: 3,
  inDeco: true,
  inSafetyStop: true,
  inDeepStop: true,
  cns: 12,
  ppo2: 1.2,
  setpoint: 1.3,
  rbtMin: 14,
  bearing: 220,
  // Su ogni campione e non solo su quelli del cambio: un campione senza
  // `gasIndex` tornerebbe indietro con lo zero che il file scrive comunque, e
  // la differenza non direbbe niente sul campo che stiamo misurando.
  gasIndex: i < 6 ? 0 : 1,
  heartRate: 88,
}));

function immersionePiena(): Dive {
  const base: Dive = {
    id: 'piena-1',
    updatedAt: '2026-07-01T09:00:00.000Z',
    // Il registro dei campi svuotati: qui dentro non ha un campo vuoto a cui
    // riferirsi — la scheda è piena per costruzione — ma deve esserci, perché
    // questa prova pretende ogni chiave del modello.
    svuotatiIl: { guide: '2026-07-01T08:00:00.000Z' },
    number: 42,
    startTime: '2026-06-14T10:00:00.000Z',
    utcOffsetMinutes: 120,
    durationS: 2400,
    maxDepth: 20,
    avgDepth: 20,
    minTempC: 18,
    airTempC: 27,
    site: { name: 'Punta Chiappa', region: 'Liguria', country: 'Italia', lat: 44.3167, lon: 9.15 },
    buddy: 'Luca Bianchi',
    notes: 'Corrente da nord',
    mode: 'ccr',
    cylinders: [
      {
        id: 'c-1',
        description: 'D12 lungo',
        material: 'steel',
        sizeL: 12,
        workPressureBar: 232,
        startBar: 200,
        endBar: 80,
        mix: AIR,
        analisi: { o2: 0.21, he: 0, quando: '2026-06-14T08:00:00.000Z', chi: 'Mario' },
      },
      {
        id: 'c-2',
        description: 'stage 50%',
        material: 'alu',
        sizeL: 7,
        workPressureBar: 200,
        startBar: 200,
        endBar: 150,
        mix: { o2: 0.5, he: 0 },
        analisi: { o2: 0.5 },
      },
    ],
    rmvLpmManual: 16.5,
    salinity: 'fresh',
    surfacePressureBar: 1.013,
    surfaceIntervalS: 3600,
    computer: { model: 'Perdix', serial: 'X1', decoModel: 'ZHL-16C', gfLow: 20, gfHigh: 85 },
    otherComputers: [{ model: 'Peregrine', serial: 'Y2' }],
    source: { format: 'uddf', file: 'x.uddf', importedAt: '2026-06-14T12:00:00.000Z' },
    extraSources: [{ format: 'logtrak', file: 'y.logtrak', importedAt: '2026-06-14T13:00:00.000Z' }],
    rating: 4,
    title: 'Il relitto di sera',
    guide: 'Alessandro Boschi',
    center: 'Diving Camogli',
    plannedMaxDepth: 32,
    firmaGuida: {
      tratti: [
        [
          { x: 0, y: 20 },
          { x: 30, y: 4 },
          { x: 60, y: 24 },
          { x: 90, y: 6 },
        ],
      ],
      larghezza: 100,
      altezza: 30,
      quando: '2026-06-14T12:30:00.000Z',
      offsetMinuti: 120,
    },
    visibilityM: 8,
    visibilityMaxM: 12,
    visibilityRating: 4,
    conditions: { weather: 'rainy', waves: 'rough' },
    gear: { bcd: { name: 'Ala 17' }, suit: { name: 'Stagna 7mm' }, backplateKg: 3 },
    weightKg: 5.5,
    suit: 'Stagna 7mm',
    annotations: { origine: 'logbook di carta' },
    reported: { minNdlS: 300, maxDecoObligationS: 600 },
    events: [{ t: 900, label: 'polpo', bearing: 180 }],
    tags: ['mare', 'notte'],
    samples: CAMPIONI,
    altSamples: CAMPIONI.map((s) => ({ ...s, t: s.t + 5 })),
  };
  const metrics = computeMetrics(base);
  // La media che l'export scrive è quella MISURATA (vedi `core/profondita.ts`):
  // la scheda finta dichiara lo stesso numero, altrimenti la differenza fra
  // andata e ritorno racconterebbe quella scelta invece di una perdita.
  return { ...base, avgDepth: Math.round((metrics.avgDepth ?? 20) * 10) / 10, metrics };
}

// ---------------------------------------------------------------------------
// Leggere un percorso dentro l'immersione
// ---------------------------------------------------------------------------

/**
 * I valori che stanno in fondo a un percorso come `site.region` o
 * `samples.setpoint`. Un passo che cade su un array vale «per ogni elemento»,
 * che è il modo in cui `PerditaDichiarata` nomina i campi delle bombole e dei
 * campioni.
 */
function valoriDi(radice: unknown, percorso: string): unknown[] {
  let correnti: unknown[] = [radice];
  for (const passo of percorso.split('.')) {
    const dopo: unknown[] = [];
    for (const v of correnti) {
      for (const e of Array.isArray(v) ? v : [v]) {
        if (e === null || e === undefined || typeof e !== 'object') continue;
        dopo.push((e as Record<string, unknown>)[passo]);
      }
    }
    correnti = dopo;
  }
  return correnti.filter((v) => v !== null && v !== undefined);
}

/**
 * Due valori «uguali abbastanza» dopo un giro in pascal, kelvin e metri cubi.
 *
 * I numeri si confrontano con la tolleranza degli arrotondamenti dichiarati
 * dall'esportazione (due o tre decimali, poi il decimo del lettore); tutto il
 * resto si confronta per valore. Non è una tolleranza di comodo: una tolleranza
 * larga farebbe passare per «sopravvissuto» un dato tornato sbagliato.
 */
function uguale(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= 0.06 + Math.abs(a) * 0.002;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => uguale(v, b[i]));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const chiavi = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
    return chiavi.every((k) => uguale((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return a === b;
}

const sopravvive = (prima: Dive, dopo: Dive, percorso: string): boolean => {
  const a = valoriDi(prima, percorso);
  const b = valoriDi(dopo, percorso);
  return a.length === b.length && a.every((v, i) => uguale(v, b[i]));
};

/**
 * I campi che NON hanno bisogno di essere dichiarati, e perché.
 *
 * Deve restare corto, e ogni riga deve dire una ragione che regge da sola: una
 * lista di deroghe che cresce è il modo elegante di tornare all'elenco scritto a
 * mano. Sono tutti campi che non sono dati dell'immersione ma del modo in cui
 * l'immersione è arrivata o è stata calcolata.
 */
const NON_SONO_PERDITE: Record<string, string> = {
  id: 'è ricavato dal contenuto: chi rilegge il file lo ricalcola identico',
  source: 'la provenienza di un file è il file che stai leggendo, e il lettore la riscrive',
  metrics: 'sono derivate: `computeMetrics` le rifà a ogni lettura da profilo e bombole',
  'cylinders.id':
    'è la chiave con cui la scheda di modifica tiene le bombole al loro posto mentre le modifichi, non un dato che descrive la bombola',
  svuotatiIl:
    'è il registro dei campi che qualcuno ha tolto, e serve solo alla fusione fra due dispositivi: un file UDDF non ha due lati da mettere d’accordo, e portarlo fuori direbbe a un altro programma una cosa che riguarda soltanto noi',
};

describe('l’elenco delle perdite dell’export UDDF', () => {
  const piena = immersionePiena();

  it('la scheda di prova copre OGNI campo del modello, altrimenti non misura niente', () => {
    /*
     * La domanda che fa scattare la prova il giorno giusto. Chi aggiunge un
     * campo a `Dive`, `Sample`, `Cylinder` o `DiveSite` e non lo mette qui
     * trova questo controllo rosso con il nome del campo scritto dentro: la
     * domanda «e questo, l'export se lo porta dietro?» arriva quando il campo
     * nasce, non tre versioni dopo.
     */
    const mancanti: string[] = [];
    for (const campo of campiDi('Dive')) if (!(campo in piena)) mancanti.push(`Dive.${campo}`);
    for (const campo of campiDi('Sample'))
      if (!(campo in piena.samples![0]!)) mancanti.push(`Sample.${campo}`);
    for (const campo of campiDi('Cylinder')) {
      if (!(campo in piena.cylinders[0]!)) mancanti.push(`Cylinder.${campo}`);
    }
    for (const campo of campiDi('DiveSite')) if (!(campo in piena.site!)) mancanti.push(`DiveSite.${campo}`);
    expect(mancanti, 'campi del modello non coperti dalla scheda di prova in questo file').toEqual([]);
  });

  it('ogni campo che non sopravvive al giro è dichiarato', async () => {
    const { xml, perdite } = exportUddf([piena], { now: '2026-09-15T00:00:00Z' });
    const dopo = (await parseFile({ fileName: 'piena.uddf', text: xml })).dives[0]!;
    expect(dopo, 'il file non si rilegge nemmeno').toBeDefined();

    const dichiarati = new Set(perdite.flatMap((p) => p.campi));
    /*
     * `site`, `cylinders` e `samples` non si misurano per intero: sono strutture
     * di cui si perde QUALCHE campo e se ne conserva qualche altro, e un
     * confronto in blocco direbbe soltanto «qualcosa è cambiato». Si scende
     * dentro, campo per campo, che è anche il modo in cui le perdite li nominano.
     */
    const percorsi = [
      ...campiDi('Dive').filter((c) => !['site', 'cylinders', 'samples'].includes(c)),
      ...campiDi('DiveSite').map((c) => `site.${c}`),
      ...campiDi('Cylinder').map((c) => `cylinders.${c}`),
      ...campiDi('Sample').map((c) => `samples.${c}`),
    ];

    const persiInSilenzio = percorsi.filter((p) => {
      if (p in NON_SONO_PERDITE) return false;
      if (sopravvive(piena, dopo, p)) return false;
      // Vale anche una dichiarazione su un campo che contiene questo: chi
      // dichiara `computer` ha già detto che dentro non torna niente.
      return ![...dichiarati].some((d) => d === p || p.startsWith(`${d}.`));
    });
    expect(persiInSilenzio, 'campi persi nel giro esporta→reimporta e non dichiarati').toEqual([]);
  });

  it('e ogni campo dichiarato perso è perso davvero', async () => {
    /*
     * Il verso opposto, e non è pignoleria: è il difetto gemello. «Restano
     * fuori: il tipo di circuito» compariva su cento immersioni tutte a circuito
     * aperto, dove non restava fuori niente — e una voce che compare quando non
     * ti riguarda è una voce che si smette di leggere, cioè proprio quella su
     * cui bisognerebbe contare.
     */
    const { xml, perdite } = exportUddf([piena], { now: '2026-09-15T00:00:00Z' });
    const dopo = (await parseFile({ fileName: 'piena.uddf', text: xml })).dives[0]!;

    const bugie = perdite
      .flatMap((p) => p.campi)
      // Un campo che l'archivio non ha non si può misurare: non c'era niente da
      // perdere, e la dichiarazione parla di altri archivi.
      .filter((p) => valoriDi(piena, p).length > 0 && sopravvive(piena, dopo, p));
    expect(bugie, 'campi dichiarati persi che invece tornano indietro interi').toEqual([]);
  });

  it('le due liste raccontano la stessa cosa: una frase per perdita, nessuna muta', () => {
    const { omitted, perdite } = exportUddf([piena]);
    expect(omitted).toEqual(perdite.map((p) => p.testo));
    expect(perdite.every((p) => p.campi.length > 0)).toBe(true);
    expect(perdite.every((p) => p.testo.trim().length > 0)).toBe(true);
  });
});
