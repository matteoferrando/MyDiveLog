import { describe, expect, it } from 'vitest';
import {
  diveIdFor,
  likelySame,
  mergeDive,
  mergeImports,
  profileChannels,
  similar,
  stableId,
} from '../src/core/dedupe';
import { parseFile } from '../src/core/parsers';
import { parseFit } from '../src/core/parsers/garminFit';
import { synthesise, toFit, toShearwaterXml, toSubsurface, toUddf } from './fixtures';
import type { Dive } from '../src/core/model';

const base = (over: Partial<Dive> = {}): Dive => ({
  id: 'x',
  startTime: '2026-06-14T10:38:00.000Z',
  durationS: 42 * 60,
  maxDepth: 32,
  avgDepth: 21,
  mode: 'oc',
  cylinders: [],
  source: { format: 'uddf', file: 'f', importedAt: '2026-06-14T12:00:00.000Z' },
  tags: [],
  ...over,
});

describe('tolleranza proporzionale', () => {
  it('accetta differenze sotto la soglia assoluta', () => {
    expect(similar(32, 32.5, 1)).toBe(true);
    // 2 m su 34 sono comunque entro il 10%: passa dal ramo relativo.
    expect(similar(32, 34, 1)).toBe(true);
    // 8 m su 40 sono il 20%: fuori da entrambi i rami.
    expect(similar(32, 40, 1)).toBe(false);
  });

  it('accetta differenze sotto il 10% del maggiore', () => {
    // 2 minuti su 42 sono meno del 10%: la stessa immersione vista da due computer.
    expect(similar(42 * 60, 44 * 60, 5 * 60)).toBe(true);
    // Su valori grandi la soglia relativa è più permissiva di quella assoluta.
    expect(similar(6000, 6400, 300)).toBe(true);
  });
});

describe('riconoscimento della stessa immersione', () => {
  it('riconosce lo stesso profilo con orologi sfasati di 8 minuti', () => {
    const a = base();
    const b = base({ startTime: '2026-06-14T10:46:00.000Z' });
    // La finestra è metà della durata (21 min), quindi 8 minuti rientrano.
    expect(likelySame(a, b)).toBe(true);
  });

  it('non fonde due immersioni ripetitive dello stesso giorno', () => {
    const a = base();
    // Seconda immersione: più corta e meno profonda. Anche se l'orario cadesse
    // nella finestra, profondità e durata la distinguono.
    const b = base({ startTime: '2026-06-14T11:10:00.000Z', durationS: 20 * 60, maxDepth: 18 });
    expect(likelySame(a, b)).toBe(false);
  });

  it('non fonde immersioni di profondità diversa nella stessa finestra', () => {
    const a = base();
    const b = base({ maxDepth: 45 });
    expect(likelySame(a, b)).toBe(false);
  });

  it('usa la corrispondenza forte quando i computer coincidono', () => {
    const computer = { model: 'Peregrine', deviceId: 'SW1001', diveId: '77' };
    const a = base({ computer });
    const b = base({ computer: { ...computer, model: 'PEREGRINE' } });
    expect(likelySame(a, b)).toBe(true);
  });
});

describe('id stabile', () => {
  it('è deterministico', () => {
    expect(stableId(['a', 1, undefined])).toBe(stableId(['a', 1, undefined]));
    expect(stableId(['a', 1])).not.toBe(stableId(['a', 2]));
  });

  it("preferisce l'identificativo del computer quando esiste", () => {
    const withDc = diveIdFor({
      startTime: '2026-06-14T10:38:00.000Z',
      maxDepth: 32,
      durationS: 2520,
      computer: { model: 'Peregrine', deviceId: 'SW1', diveId: '5' },
    });
    // Cambiando l'orario ma non l'identificativo, l'id resta lo stesso.
    const shifted = diveIdFor({
      startTime: '2026-06-14T11:00:00.000Z',
      maxDepth: 32,
      durationS: 2520,
      computer: { model: 'Peregrine', deviceId: 'SW1', diveId: '5' },
    });
    expect(withDc).toBe(shifted);
  });

  it('reimportare lo stesso file dà lo stesso id', async () => {
    const synth = synthesise();
    const first = await parseFile({ fileName: 'a.uddf', text: toUddf(synth) });
    const second = await parseFile({ fileName: 'a.uddf', text: toUddf(synth) });
    expect(first.dives[0]!.id).toBe(second.dives[0]!.id);
  });
});

describe('merge degli import', () => {
  it('non duplica reimportando lo stesso file', async () => {
    const synth = synthesise();
    const { dives } = await parseFile({ fileName: 'a.uddf', text: toUddf(synth) });
    const once = mergeImports([], dives);
    expect(once.added).toBe(1);
    const twice = mergeImports(once.dives, dives);
    expect(twice.added).toBe(0);
    expect(twice.dives).toHaveLength(1);
  });

  it('unisce la stessa immersione arrivata da tre computer diversi', async () => {
    const synth = synthesise();
    const [uddf, ssrf, fit] = await Promise.all([
      parseFile({ fileName: 'a.uddf', text: toUddf(synth) }),
      parseFile({ fileName: 'b.ssrf', text: toSubsurface(synth) }),
      parseFit({ fileName: 'c.fit', bytes: toFit(synth) }),
    ]);

    let report = mergeImports([], uddf.dives);
    report = mergeImports(report.dives, ssrf.dives);
    report = mergeImports(report.dives, fit.dives);

    expect(report.dives).toHaveLength(1);
  });

  it('non sovrascrive le note scritte a mano con un reimport', async () => {
    const synth = synthesise();
    const { dives } = await parseFile({ fileName: 'a.xml', text: toShearwaterXml(synth) });
    const stored = { ...dives[0]!, notes: 'Annotazione mia', buddy: 'Marco' };
    const report = mergeImports([stored], dives);
    expect(report.dives[0]!.notes).toBe('Annotazione mia');
    expect(report.dives[0]!.buddy).toBe('Marco');
  });

  it('preferisce il profilo più fitto', async () => {
    const dense = synthesise({ intervalS: 2 });
    const sparse = synthesise({ intervalS: 30 });
    const a = await parseFile({ fileName: 'sparse.uddf', text: toUddf(sparse) });
    const b = await parseFile({ fileName: 'dense.uddf', text: toUddf(dense) });

    const report = mergeImports(a.dives, b.dives);
    expect(report.dives).toHaveLength(1);
    expect(report.dives[0]!.samples!.length).toBe(b.dives[0]!.samples!.length);
  });

  it('mantiene distinte due immersioni della stessa giornata', async () => {
    const morning = synthesise({ startTime: new Date('2026-06-14T09:00:00Z'), maxDepth: 34 });
    const afternoon = synthesise({
      startTime: new Date('2026-06-14T14:00:00Z'),
      maxDepth: 20,
      durationS: 35 * 60,
    });
    const a = await parseFile({ fileName: 'm.uddf', text: toUddf(morning, 1) });
    const b = await parseFile({ fileName: 'p.uddf', text: toUddf(afternoon, 2) });
    const report = mergeImports(a.dives, b.dives);
    expect(report.dives).toHaveLength(2);
  });
});

describe('scelta del profilo fra due computer', () => {
  const base = (samples: Dive['samples']): Dive => ({
    id: 'x',
    startTime: '2026-06-14T10:38:00+02:00',
    durationS: 2400,
    maxDepth: 32,
    mode: 'oc',
    cylinders: [{ mix: { o2: 0.21, he: 0 } }],
    source: { format: 'logtrak', file: 'a.logtrak', importedAt: '2026-06-14T20:00:00Z' },
    tags: [],
    samples,
  });

  /** Profilo fitto ma senza niente sulla decompressione: è l'Uwatec. */
  const dense = Array.from({ length: 600 }, (_, i) => ({ t: i * 4, depth: 20, tempC: 18 }));
  /** Profilo più rado ma con tetto, TTS e CNS: è lo Shearwater. */
  const rich = Array.from({ length: 240 }, (_, i) => ({
    t: i * 10,
    depth: 20,
    tempC: 18,
    ndlS: 600,
    ttsS: 120,
    cns: 4,
  }));

  it('conta i canali, non solo i campioni', () => {
    expect(profileChannels(base(dense))).toBe(2);
    expect(profileChannels(base(rich))).toBeGreaterThan(profileChannels(base(dense)));
  });

  it('tiene il profilo con i dati di decompressione anche se ha meno campioni', () => {
    const merged = mergeDive(base(dense), {
      ...base(rich),
      source: { format: 'shearwater-cloud', file: 'b.db', importedAt: 'x' },
    });
    expect(merged.samples).toHaveLength(240);
    expect(merged.samples?.[0]!.ttsS).toBe(120);
  });

  it('e non lo perde quando le fonti arrivano nell’ordine opposto', () => {
    const merged = mergeDive(base(rich), {
      ...base(dense),
      source: { format: 'logtrak', file: 'c.logtrak', importedAt: 'x' },
    });
    expect(merged.samples).toHaveLength(240);
  });

  it('a pari canali tiene il profilo più fitto', () => {
    const denser = Array.from({ length: 1200 }, (_, i) => ({ t: i * 2, depth: 20, tempC: 18 }));
    const merged = mergeDive(base(dense), {
      ...base(denser),
      source: { format: 'uddf', file: 'd.uddf', importedAt: 'x' },
    });
    expect(merged.samples).toHaveLength(1200);
  });
});

/*
 * L'IMPRONTA DEL PROFILO DEVE ARRIVARE ANCHE SULLE RIGHE GIÀ IN ARCHIVIO.
 *
 * Il caso è quello vero: l'archivio conteneva le immersioni del file di LogTRAK
 * importate quando il lettore ancora non calcolava l'impronta. Quelle righe un
 * `computer` ce l'avevano, e per questo il vecchio `takeIfEmpty` non le toccava:
 * reimportare lo stesso file col lettore nuovo non scriveva l'impronta, e
 * l'unico criterio capace di riconoscere una copia con la data corretta a mano
 * restava spento proprio dove serviva.
 */
describe('il blocco computer si fonde campo per campo', () => {
  const conComputer = (over: Partial<Dive['computer']> = {}): Dive => ({
    ...base(),
    computer: { model: 'Scubapro Aladin Sport Matrix', serial: '63034502', ...over },
  });

  it('scrive l’impronta su un’immersione che aveva già un computer senza impronta', () => {
    const vecchia = conComputer();
    const nuova = conComputer({ profileFingerprint: 'f1-b7b8c6f2', firmware: '2.1' });
    const fusa = mergeDive(vecchia, nuova);
    expect(fusa.computer?.profileFingerprint).toBe('f1-b7b8c6f2');
    expect(fusa.computer?.firmware).toBe('2.1');
    // e il modello di partenza resta quello che era
    expect(fusa.computer?.serial).toBe('63034502');
  });

  it('non sovrascrive un campo che c’è già', () => {
    const vecchia = conComputer({ firmware: '2.0' });
    const fusa = mergeDive(vecchia, conComputer({ firmware: '2.1' }));
    expect(fusa.computer?.firmware).toBe('2.0');
  });

  it('tiene separati due computer diversi sulla stessa immersione', () => {
    const aladin = conComputer({ profileFingerprint: 'aaa' });
    const peregrine: Dive = {
      ...base(),
      computer: { model: 'Shearwater Peregrine', serial: '99999', profileFingerprint: 'bbb' },
    };
    const fusa = mergeDive(aladin, peregrine);
    expect(fusa.computer?.profileFingerprint).toBe('aaa');
    expect(fusa.otherComputers?.some((c) => c.serial === '99999')).toBe(true);
  });

  it('e dopo la fusione le due copie si riconoscono anche a mesi di distanza', () => {
    // la data corretta a mano nell'applicazione: 118 giorni di scarto
    const daFile: Dive = {
      ...conComputer({ profileFingerprint: 'f1' }),
      startTime: '2026-02-14T09:52:00.000Z',
    };
    const daBluetooth: Dive = {
      ...conComputer({ profileFingerprint: 'f1' }),
      id: 'y',
      startTime: '2025-10-19T09:52:00.000Z',
    };
    expect(likelySame(daFile, daBluetooth)).toBe(true);
    const dopo = mergeImports([daFile], [daBluetooth]);
    expect(dopo.dives).toHaveLength(1);
  });
});

/**
 * IL TEST CHE IMPEDISCE AL PROSSIMO CAMPO DI SPARIRE.
 *
 * `mergeDive` riempie i buchi della scheda di base con i valori di quella in
 * arrivo, ma solo per le chiavi elencate a mano dentro `takeIfEmpty`. Un campo
 * nuovo del modello che nessuno aggiunge a quell'elenco esce `undefined` dalla
 * fusione — mentre `changed` si accende per altri motivi e l'interfaccia
 * annuncia «arricchita». È già successo tre volte: con `conditions` e `gear`,
 * con la miscela delle bombole, e da ultimo con `center`, `plannedMaxDepth`,
 * `firmaGuida` (le lettere i, m, o del libretto di legge) e con `analisi`, la
 * miscela misurata col banco.
 *
 * Quindi non si elencano di nuovo i campi qui dentro: si costruisce una scheda
 * PIENA IN OGNI CHIAVE DEL MODELLO e si verifica che fondendola su una scheda
 * scarna non se ne perda nessuna. Aggiungere un campo a `Dive` senza aggiungerlo
 * a `mergeDive` fa diventare rosso questo test, non un utente.
 */
describe('nessun campo si perde nella fusione', () => {
  const profilo = (n: number, passoS: number, deco = false) =>
    Array.from({ length: n }, (_, i) => ({
      t: i * passoS,
      depth: 5 + (i % 20),
      tempC: 18,
      ...(deco ? { ndlS: 600, ttsS: 60, ceiling: 0, cns: 3 } : {}),
    }));

  /*
   * ════════════════════════════════════════════════════════════════════════
   * ► «OGNI CHIAVE DI `Dive`» ERA UNA PROMESSA CHE QUESTO FILE NON MANTENEVA. ◄
   *
   * Qui sotto c'era scritto `const piena: Dive`, e la prova in fondo scorreva
   * `Object.keys(piena)`: le chiavi di un oggetto scritto A MANO, non quelle
   * del modello. Un campo nuovo aggiunto a `Dive` — opzionale, come sono tutti
   * quelli che una persona scrive — non compariva qui, quindi non veniva
   * cercato, quindi la fusione poteva perderlo **in silenzio e a prova verde**.
   *
   * Ed è successo: il 13 settembre 2026, aggiungendo `rmvLpmManual`, questa
   * prova è restata verde mentre `mergeDive` lo buttava via. Il commento
   * accanto all'elenco dei campi in `dedupe.ts` prometteva il contrario —
   * *«così il prossimo campo nuovo non ricasca qui»* — e una riga che afferma
   * una cosa che non succede è peggio di nessuna riga.
   *
   * `Required<Dive>` è la differenza: è superficiale, cioè pretende che ogni
   * chiave di PRIMO livello ci sia, e il compilatore diventa rosso il giorno
   * che al modello se ne aggiunge una. Le poche che non si possono riempire
   * sono tolte QUI, una per una e con il motivo accanto: un'esclusione
   * dichiarata si discute, una dimenticata no.
   */
  type SchedaPiena = Required<
    Omit<
      Dive,
      /*
       * Derivata: `computeMetrics` la rifà da capo, e infatti la prova in fondo
       * controlla a parte che dopo la fusione ci sia.
       *
       * ► QUI C'ERA ANCHE `'tissues'`, E `Dive` NON HA NESSUNA CHIAVE COSÌ. ◄
       * `Omit` non si lamenta di una chiave inesistente, quindi quella riga non
       * faceva niente e diceva che il modello aveva un campo che non ha — la
       * saturazione vive dentro `metrics.tissuesEnd`. Scritta, per giunta, nel
       * commento in cui si spiegava che una guardia non guardava.
       */
      | 'metrics'
      /*
       * ► ANCHE QUESTA È DERIVATA, MA IN UN MODO PIÙ SOTTILE. ◄ `svuotatiIl`
       * registra i campi che qualcuno ha tolto, e la fusione toglie da sé la
       * voce di un campo che ADESSO ha un valore: tenerla vorrebbe dire
       * rifiutare il prossimo completamento legittimo di quel campo.
       *
       * Questa scheda ha ogni campo valorizzato per costruzione — è tutto il suo
       * senso — quindi qualunque voce ci si metta dentro è stantia per
       * definizione e sparisce. Pretenderla in uscita vorrebbe dire pretendere
       * che la fusione conservi un'informazione che si è appena smentita da
       * sola. Il comportamento vero è coperto da `svuotareSiPropaga.test.ts`.
       */
      | 'svuotatiIl'
    >
  >;

  /** Una scheda con OGNI chiave di `Dive` valorizzata. Davvero, stavolta. */
  const piena: SchedaPiena = {
    id: 'x',
    updatedAt: '2026-08-20T10:00:00.000Z',
    number: 137,
    startTime: '2026-06-14T10:38:00.000Z',
    utcOffsetMinutes: 120,
    durationS: 44 * 60,
    maxDepth: 33,
    avgDepth: 19.4,
    minTempC: 15.2,
    airTempC: 27,
    site: { name: 'Punta Chiappa', region: 'Liguria', country: 'IT', lat: 44.3, lon: 9.15 },
    buddy: 'Marco',
    notes: 'corrente forte in uscita',
    mode: 'oc',
    cylinders: [
      {
        description: 'D12 200',
        material: 'steel',
        sizeL: 12,
        workPressureBar: 200,
        startBar: 210,
        endBar: 70,
        mix: { o2: 0.32, he: 0 },
        analisi: { o2: 0.305, he: 0, quando: '2026-06-14T08:00:00.000Z', chi: 'Diving del Golfo' },
      },
    ],
    salinity: 'salt',
    surfacePressureBar: 1.013,
    surfaceIntervalS: 3600,
    computer: { model: 'Peregrine', serial: 'SW1001', firmware: '92', gfLow: 30, gfHigh: 85 },
    otherComputers: [{ model: 'Aladin', serial: '63034502', ppo2MaxBar: 1.4 }],
    source: { format: 'shearwater-xml', file: 'sw.xml', importedAt: '2026-06-14T20:00:00.000Z' },
    extraSources: [{ format: 'logtrak', file: 'a.logtrak', importedAt: '2026-06-15T08:00:00.000Z' }],
    rating: 4,
    title: 'notturna al relitto',
    guide: 'Anna',
    center: 'Diving del Golfo',
    plannedMaxDepth: 30,
    firmaGuida: {
      tratti: [
        [
          { x: 1, y: 2 },
          { x: 3, y: 4 },
        ],
      ],
      larghezza: 320,
      altezza: 120,
      quando: '2026-06-14T21:00:00.000Z',
      nome: 'Anna',
    },
    visibilityM: 8,
    visibilityMaxM: 12,
    conditions: { weather: 'sunny', waves: 'calm' },
    gear: {
      regulators: [{ id: 'r1', name: 'MK25' }],
      bcd: { id: 'b1', name: 'Ala 17' },
      suit: { id: 's1', name: 'Umida 7 mm' },
      backplateKg: 3,
      other: [{ id: 'o1', name: 'Torcia' }],
    },
    weightKg: 6,
    suit: 'umida 7 mm',
    annotations: { 'Comfort termico': 'Fresco' },
    reported: { gf99End: 71, maxDecoObligationS: 0, minNdlS: 300, avgSac: '14' },
    events: [{ t: 600, bearing: 180, label: 'relitto' }],
    tags: ['relitto'],
    samples: profilo(200, 10, true),
    altSamples: profilo(500, 4),
    // Il consumo di superficie calcolato a mano: lo scrive una persona, quindi
    // nessuna fonte automatica lo riporta e perderlo qui vuol dire perderlo.
    rmvLpmManual: 13.4,
    visibilityRating: 4,
  };

  /** Il minimo indispensabile: solo i campi obbligatori del modello. */
  const scarna: Dive = {
    id: 'x',
    startTime: '2026-06-14T10:38:00.000Z',
    durationS: 40 * 60,
    maxDepth: 31,
    mode: 'oc',
    cylinders: [{ mix: { o2: 0.21, he: 0 } }],
    source: { format: 'manual', file: 'a mano', importedAt: '2026-08-01T00:00:00.000Z' },
    tags: [],
  };

  it('fonde due schede e non lascia indietro nessuna chiave del modello', () => {
    const fusa = mergeDive(scarna, piena, '2026-08-25T00:00:00.000Z');
    const perse = Object.keys(piena).filter(
      (k) =>
        (piena as unknown as Record<string, unknown>)[k] !== undefined &&
        (fusa as unknown as Record<string, unknown>)[k] === undefined,
    );
    expect(perse, `campi persi dalla fusione: ${perse.join(', ')}`).toEqual([]);
    // Le metriche non si ereditano, si ricalcolano: la chiave c'è comunque.
    expect(fusa.metrics).toBeDefined();
  });

  it('► e non ne lascia indietro nemmeno il VALORE, che è un’altra cosa ◄', () => {
    /*
     * ════════════════════════════════════════════════════════════════════════
     * ► LA PROVA QUI SOPRA NON POTEVA FALLIRE SUI CAMPI OBBLIGATORI. ◄
     *
     * Il criterio era «la chiave c'era e adesso è `undefined`»: intercetta un
     * campo **mancante**, non un campo **sbagliato**. Per `mode` — che nel
     * modello è obbligatorio, quindi presente anche nella scheda scarna —
     * `fusa.mode` non può essere `undefined` per costruzione, e l'asserzione
     * era strutturalmente incapace di dire qualcosa.
     *
     * È il motivo per cui `mode` e `salinity` non si fondevano da sempre senza
     * che nessuno se ne accorgesse: la scheda scarna portava i ripieghi di chi
     * non sa — `'oc'` e `'salt'`, che `csv.ts` scrive per default — e vincevano
     * loro. *Una guardia che controlla la presenza di una chiave non controlla
     * il dato: controlla la forma dell'oggetto.*
     */
    const fusa = mergeDive(scarna, piena, '2026-08-25T00:00:00.000Z');
    const sbagliati = Object.keys(piena).filter((k) => {
      if (k === 'metrics' || k === 'id' || k === 'source' || k === 'extraSources') return false;
      if (k === 'updatedAt') return false;
      const mio = (scarna as unknown as Record<string, unknown>)[k];
      const suo = (piena as unknown as Record<string, unknown>)[k];
      const dopo = (fusa as unknown as Record<string, unknown>)[k];
      // Solo dove la scarna non aveva niente di suo da difendere.
      if (mio !== undefined && JSON.stringify(mio) !== JSON.stringify(dopo)) return false;
      return JSON.stringify(dopo) !== JSON.stringify(suo);
    });
    expect(
      sbagliati,
      `campi che non hanno preso il valore della scheda piena: ${sbagliati.join(', ')}`,
    ).toEqual([]);
  });

  it('il ripiego di chi non sa cede a chi sa: modalità e acqua', () => {
    /*
     * Una riga di riepilogo da CSV già in archivio, poi arriva il log vero: un
     * rebreather in lago diventava «circuito aperto in acqua salata», e a
     * ordine di import invertito vinceva l'altro. *`salinity` entra nella
     * pressione ambiente, quindi in `avgAta`, `maxPpo2`, CNS, OTU, nei cambi
     * gas e in tutta la catena dei tessuti* — e la scheda intanto dichiarava
     * «arricchita».
     */
    const daCsv: Dive = { ...scarna, mode: 'oc', salinity: 'salt' };
    const daLog: Dive = { ...piena, mode: 'ccr', salinity: 'fresh' };
    const fusa = mergeDive(daCsv, daLog, '2026-08-25T00:00:00.000Z');
    expect(fusa.mode).toBe('ccr');
    expect(fusa.salinity).toBe('fresh');
  });

  it('ma chi sa non cede a chi non sa, nemmeno a ordine invertito', () => {
    // Il rovescio: il ripiego non deve scalzare un dato vero.
    const daLog: Dive = { ...piena, mode: 'ccr', salinity: 'fresh' };
    const daCsv: Dive = { ...scarna, mode: 'oc', salinity: 'salt' };
    const fusa = mergeDive(daLog, daCsv, '2026-08-25T00:00:00.000Z');
    expect(fusa.mode).toBe('ccr');
    expect(fusa.salinity).toBe('fresh');
  });

  it('un riscarico porta il CAMBIO GAS dentro un’immersione che era già in archivio', () => {
    /*
     * ════════════════════════════════════════════════════════════════════════
     * ► LA DOMANDA ERA: «PER AVERE IL CAMBIO GAS VANNO REIMPORTATE LE
     *   IMMERSIONI?» ◄
     *
     * Sì, e questa prova dice anche **come va a finire**, che è la metà che non
     * si legge dal codice: riscaricando, l'immersione che c'è già non viene
     * duplicata e non viene persa — viene **arricchita**.
     *
     * Il meccanismo è `profileChannels`: il gas respirato conta come un canale
     * del profilo, quindi lo stesso identico scarico fatto con la versione
     * nuova ne ha **uno in più** di quello in archivio, e il confronto lo fa
     * vincere. Tutto il resto della scheda — sito, compagno, note, zavorra, il
     * consumo scritto a mano — resta dov'è, perché la fusione tocca il profilo
     * e non quelli.
     *
     * *Senza questa prova la risposta sarebbe stata una lettura del codice; con
     * questa è una misura.*
     */
    const senzaGas: Dive = {
      ...scarna,
      source: { format: 'libdivecomputer', file: 'Puck 4', importedAt: '2026-09-01T00:00:00.000Z' },
      cylinders: [{ mix: { o2: 0.21, he: 0 } }, { mix: { o2: 0.5, he: 0 } }],
      samples: [
        { t: 0, depth: 30, tempC: 18 },
        { t: 600, depth: 30, tempC: 18 },
        { t: 1200, depth: 6, tempC: 19 },
      ],
      // Due cose scritte da una persona: devono sopravvivere al riscarico.
      notes: 'corrente in uscita',
      rmvLpmManual: 13.4,
    };
    const conGas: Dive = {
      ...senzaGas,
      source: { format: 'libdivecomputer', file: 'Puck 4', importedAt: '2026-09-14T00:00:00.000Z' },
      samples: [
        { t: 0, depth: 30, tempC: 18, gasIndex: 0 },
        { t: 600, depth: 30, tempC: 18, gasIndex: 0 },
        { t: 1200, depth: 6, tempC: 19, gasIndex: 1 },
      ],
      notes: undefined,
      rmvLpmManual: undefined,
    };

    const fusa = mergeDive(senzaGas, conGas, '2026-09-14T01:00:00.000Z');
    expect(fusa.samples!.map((s) => s.gasIndex)).toEqual([0, 0, 1]);
    // E non ha perso quello che aveva scritto una persona.
    expect(fusa.notes).toBe('corrente in uscita');
    expect(fusa.rmvLpmManual).toBe(13.4);
  });

  it('e riscaricando DUE volte non succede più niente: il profilo è già quello', () => {
    /*
     * ► IL ROVESCIO, E COSTA CARO SBAGLIARLO. ◄ Lo scarico Bluetooth ripresenta
     * ogni volta l'intera memoria del computer. Se un profilo identico a quello
     * già in archivio contasse come «migliore», ogni collegamento riscriverebbe
     * tutte le immersioni — e riscriverle vuol dire ricalcolarne le metriche,
     * che è il modo in cui, un tempo, la saturazione spariva dall'archivio a
     * ogni scarico.
     */
    const conGas: Dive = {
      ...scarna,
      source: { format: 'libdivecomputer', file: 'Puck 4', importedAt: '2026-09-14T00:00:00.000Z' },
      cylinders: [{ mix: { o2: 0.21, he: 0 } }, { mix: { o2: 0.5, he: 0 } }],
      samples: [
        { t: 0, depth: 30, tempC: 18, gasIndex: 0 },
        { t: 1200, depth: 6, tempC: 19, gasIndex: 1 },
      ],
    };
    const fusa = mergeDive(conGas, { ...conGas }, '2026-09-14T02:00:00.000Z');
    expect(fusa.samples).toBe(conGas.samples);
    expect(fusa.altSamples).toBeUndefined();
  });

  it('porta con sé le tre voci del libretto che solo una persona può aver scritto', () => {
    // i) profondità programmata, m) centro, o) firma della guida. Non le
    // ricava nessun computer e nessun formato: o si fondono o si perdono.
    const fusa = mergeDive(scarna, piena, '2026-08-25T00:00:00.000Z');
    expect(fusa.plannedMaxDepth).toBe(30);
    expect(fusa.center).toBe('Diving del Golfo');
    expect(fusa.firmaGuida?.tratti).toHaveLength(1);
  });

  it('porta con sé la miscela ANALIZZATA, che non è la miscela dichiarata', () => {
    // `mix` è l'etichetta della bombola, `analisi` è la misura fatta col banco.
    // Perdendo la seconda si perde proprio l'informazione che conta: che i due
    // numeri non coincidono, e che la MOD mostrata finora era più profonda.
    const fusa = mergeDive(scarna, piena, '2026-08-25T00:00:00.000Z');
    expect(fusa.cylinders[0]!.analisi?.o2).toBe(0.305);
    expect(fusa.cylinders[0]!.analisi?.chi).toBe('Diving del Golfo');
    // …e non ha sovrascritto la dichiarazione.
    expect(fusa.cylinders[0]!.mix.o2).toBe(0.32);
  });

  it('non sovrascrive un’analisi già presente con quella dell’altra scheda', () => {
    const mia: Dive = {
      ...scarna,
      cylinders: [{ mix: { o2: 0.32, he: 0 }, analisi: { o2: 0.318, chi: 'io' } }],
    };
    const fusa = mergeDive(mia, piena, '2026-08-25T00:00:00.000Z');
    expect(fusa.cylinders[0]!.analisi?.chi).toBe('io');
  });
});
