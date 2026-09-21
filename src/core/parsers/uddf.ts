/**
 * UDDF 3.x — Universal Dive Data Format.
 *
 * È il formato di scambio da preferire quando un computer lo esporta (Shearwater
 * Cloud lo fa), perché è l'unico con unità dichiarate e non ambigue.
 *
 * ATTENZIONE ALLE UNITÀ: UDDF è interamente SI. Non "quasi" SI.
 *   <depth>18.3</depth>            → 18.3 METRI
 *   <temperature>293.15</temperature> → KELVIN, non Celsius
 *   <tankpressure>20000000</tankpressure> → PASCAL, cioè 200 bar
 *   <setpo2>1.4e5</setpo2>         → PASCAL, cioè 1.4 bar
 *   <tankvolume>0.012</tankvolume> → METRI CUBI, cioè 12 litri
 *   <o2>0.32</o2>                  → FRAZIONE, non percentuale
 *
 * Nota pratica: l'export UDDF di Shearwater non collega correttamente le
 * miscele alle bombole (problema noto, discusso sulla mailing list di
 * Subsurface). Se `tankdata` non ha `link`, associamo la prima miscela
 * definita e lo segnaliamo fra i warning.
 */

import { AIR, type Cylinder, type Dive, type DiveMode, type GasMix, type Sample } from '../model';
import { cubicMToL, frazioneDiGas, kelvinToC, pascalToBar, wallClockToIso } from '../units';
import { diveIdFor } from '../dedupe';
import { computeMetrics } from '../analysis/metrics';
import { comeSta, type Traduci } from '../traduci';
import { asArray, attr, attrNumAny, child, children, num, parseXmlSalvando, text, type XmlNode } from './xml';
import { conDettaglio } from '../ble/causaGuasto';
import type { DiveParser, ParseInput, ParseResult } from './types';

export const uddfParser: DiveParser = {
  format: 'uddf',
  label: 'UDDF (Shearwater Cloud, Subsurface, MacDive…)',
  extensions: ['.uddf', '.xml'],

  detect(input: ParseInput) {
    return !!input.text && /<uddf[\s>]/i.test(input.text);
  },

  parse(input: ParseInput, t: Traduci = comeSta): ParseResult {
    const warnings: string[] = [];
    /*
     * IL FILE POTREBBE ESSERE TRONCATO, e in quel caso si salva il salvabile
     * invece di perdere tutto. Vedi `parseXmlSalvando`: taglia all'ultima
     * `</dive>` chiusa bene e richiude i tag rimasti aperti.
     */
    let root: Record<string, unknown>;
    try {
      const letto = parseXmlSalvando(input.text ?? '', 'dive');
      root = letto.root;
      if (letto.tagliato) {
        warnings.push(
          t(
            'Il file finisce a metà: sono state lette le immersioni complete, quelle dopo il punto di rottura no. Riesportalo dal programma che l’ha scritto.',
          ),
        );
      }
    } catch (err) {
      /*
       * Il motivo grezzo della libreria — «readTagExp returned undefined at
       * position 742510» — non dice niente a chi legge, e prima finiva a
       * schermo tale e quale accanto al nome del file. `conDettaglio` lo tiene
       * per il diario e mostra la frase umana.
       */
      return {
        format: 'uddf',
        dives: [],
        warnings: [
          conDettaglio(t('Questo file non è un XML leggibile: sembra incompleto o danneggiato.'), err),
        ],
      };
    }
    const uddf = (child(root, 'uddf') ?? root) as Record<string, unknown>;
    const importedAt = new Date().toISOString();

    const mixes = readGasDefinitions(uddf);
    const sites = readDiveSites(uddf);
    // Il generatore si legge ma NON diventa un computer subacqueo: è il programma
    // che ha scritto il file, e finisce nell'avviso quando serve, non fra gli
    // strumenti.
    const generator = text(child(child(uddf, 'generator'), 'name'));
    if (generator) warnings.push(`${t('File scritto da')} ${generator}.`);

    const dives: Dive[] = [];
    for (const group of children(child(uddf, 'profiledata'), 'repetitiongroup')) {
      for (const node of children(group, 'dive')) {
        const dive = readDive(node, mixes, sites, input.fileName, importedAt, warnings, t);
        if (dive) dives.push(dive);
      }
    }
    // Alcuni generatori mettono <dive> direttamente sotto <profiledata>.
    if (dives.length === 0) {
      for (const node of children(child(uddf, 'profiledata'), 'dive')) {
        const dive = readDive(node, mixes, sites, input.fileName, importedAt, warnings, t);
        if (dive) dives.push(dive);
      }
    }

    if (dives.length === 0) warnings.push(t('Nessuna immersione trovata nel file UDDF.'));
    return { format: 'uddf', dives, warnings };
  },
};

// ---------------------------------------------------------------------------

function readGasDefinitions(uddf: Record<string, unknown>): Map<string, GasMix & { name?: string }> {
  const out = new Map<string, GasMix & { name?: string }>();
  for (const mix of children(child(uddf, 'gasdefinitions'), 'mix')) {
    const id = attr(mix, 'id');
    if (!id) continue;
    out.set(id, {
      /*
       * ► `21` NON È IL VENTUNO PER CENTO, ED È PEGGIO DI UN NUMERO MANCANTE. ◄
       *
       * UDDF vuole la frazione (`0.21`), ma i file scritti a mano e diversi
       * esportatori ci mettono la percentuale. Senza questa normalizzazione
       * `mix.o2` vale 21, la frazione inerte diventa zero, i tessuti non
       * caricano mai e l'immersione più impegnativa dell'archivio esce con
       * GF99 **0**, tetto **0** e zero minuti di deco: *si presenta come la più
       * tranquilla di tutte.* Il lettore Shearwater questa riga ce l'ha già.
       */
      o2: frazioneDiGas(num(child(mix, 'o2'))) ?? 0.21,
      he: frazioneDiGas(num(child(mix, 'he'))) ?? 0,
      name: text(child(mix, 'name')),
    });
  }
  return out;
}

interface SiteRecord {
  name: string;
  region?: string;
  country?: string;
  lat?: number;
  lon?: number;
}

function readDiveSites(uddf: Record<string, unknown>): Map<string, SiteRecord> {
  const out = new Map<string, SiteRecord>();
  for (const site of children(child(uddf, 'divesite'), 'site')) {
    const id = attr(site, 'id');
    if (!id) continue;
    const geo = child(site, 'geography');
    out.set(id, {
      name: text(child(site, 'name')) ?? id,
      region: text(child(geo, 'location')) ?? text(child(geo, 'province')),
      country: text(child(geo, 'country')),
      lat: num(child(geo, 'latitude')),
      lon: num(child(geo, 'longitude')),
    });
  }
  return out;
}

function readDive(
  node: unknown,
  mixes: Map<string, GasMix & { name?: string }>,
  sites: Map<string, SiteRecord>,
  fileName: string,
  importedAt: string,
  warnings: string[],
  t: Traduci = comeSta,
): Dive | null {
  const before = child(node, 'informationbeforedive');
  const after = child(node, 'informationafterdive');

  const datetime = text(child(before, 'datetime'));
  if (!datetime) {
    warnings.push(t('Un’immersione del file è stata saltata: manca la data.'));
    return null;
  }
  const startTime = normaliseDateTime(datetime);
  const fuso = fusoDichiarato(datetime);
  if (!startTime) {
    /*
     * SPEZZATA IN TRE, e la ragione vale per tutti gli avvisi che seguono: una
     * chiave di dizionario con dentro una data è una voce diversa per ogni file
     * che si importa, cioè una voce che non si può tradurre. Le virgolette
     * basse restano fuori dalle chiavi perché sono punteggiatura attorno al
     * dato, non parte della frase.
     */
    warnings.push(
      `${t('Immersione scartata: data')} «${datetime}» ${t('in un formato che non so leggere.')} ` +
        t(
          'Un UDDF scrive «2026-06-14T10:38:00»: se il tuo programma la scrive altrimenti, riesporta il file scegliendo un altro formato di data.',
        ),
    );
    return null;
  }

  // --- bombole e miscele ---
  const mixIds = [...mixes.keys()];
  const cylinders: Cylinder[] = [];
  let linkFallbackUsed = false;
  for (const tank of children(node, 'tankdata')) {
    const refs = asArray(child(tank, 'link'))
      .map((l) => attr(l, 'ref'))
      .filter(Boolean) as string[];
    let mix = refs.map((r) => mixes.get(r)).find(Boolean);
    if (!mix && mixIds.length) {
      mix = mixes.get(mixIds[0]!);
      linkFallbackUsed = true;
    }
    const volumeM3 = num(child(tank, 'tankvolume'));
    cylinders.push({
      /*
       * ► LA SIGLA DELLA BOMBOLA NON SI INVENTA: RESTA VUOTA. ◄
       *
       * Qui c'era `description: mix?.name`, cioè il nome della MISCELA messo
       * nella casella dell'etichetta scritta dall'utente. `description` è
       * «D12 lungo», «stage 40%»: l'esportazione la dichiara persa, ed è
       * giusto — UDDF non ha un posto per lei. Riempirla col nome del gas non
       * recuperava niente e faceva peggio di così: dopo un giro
       * esporta→reimporta «D12 lungo» tornava come «EAN32», un'etichetta che
       * sembra scritta a mano e che nessuno ha scritto. E con un 31.5%
       * analizzato la sigla diceva «EAN32» mentre `o2` valeva 0.315, cioè due
       * numeri diversi per lo stesso gas nella stessa bombola.
       *
       * Una casella vuota si vede ed è vera. Un'etichetta inventata no.
       */
      description: undefined,
      sizeL: volumeM3 !== undefined ? round1(cubicMToL(volumeM3)) : undefined,
      startBar: toBar(num(child(tank, 'tankpressurebegin'))),
      endBar: toBar(num(child(tank, 'tankpressureend'))),
      mix: mix ? { o2: mix.o2, he: mix.he } : AIR,
    });
  }
  if (linkFallbackUsed) {
    warnings.push(
      t(
        "Alcune bombole non hanno il collegamento alla miscela (limite noto dell'export UDDF di Shearwater): assegnata la prima miscela definita.",
      ),
    );
  }
  if (cylinders.length === 0 && mixIds.length) {
    // Stessa ragione della riga sopra: si sa che gas era, non come la chiamava
    // chi l'ha respirata.
    const first = mixes.get(mixIds[0]!)!;
    cylinders.push({ mix: { o2: first.o2, he: first.he } });
  }
  if (cylinders.length === 0) cylinders.push({ mix: AIR });

  /*
   * L'identificativo di ogni `<tankdata>` verso la sua posizione: serve a
   * mettere la `<tankpressure ref="…">` sulla bombola giusta invece che su
   * quella del gas respirato. Vedi il commento dove si leggono le pressioni.
   */
  const indiceBombolaPerId = new Map<string, number>();
  children<XmlNode>(node, 'tankdata').forEach((tank, i) => {
    const id = attr(tank, 'id');
    if (id) indiceBombolaPerId.set(id, i);
  });

  /*
   * --- profilo ---
   *
   * Da una miscela alla bombola che la porta, e con DUE BOMBOLE DELLO STESSO GAS
   * VINCE LA PRIMA.
   *
   * `<switchmix ref="…">` riferisce il gas, non la bombola: è il formato a
   * volerlo così, e quando due bombole portano lo stesso gas — due D12 ad aria
   * in sidemount — il riferimento non basta più a dire quale delle due. Qui si
   * scriveva `set(ref, i)` per ogni `tankdata`, quindi vinceva l'ULTIMA: un
   * `gasIndex` 0 tornava indietro come 1, sempre, e il consumo finiva sulla
   * bombola sbagliata. Nessuna delle due scelte è dimostrabile dal file, ma la
   * prima è quella che sbaglia meno spesso: è la bombola con cui si comincia, ed
   * è quella che le nostre stesse esportazioni indicano quando il campione non
   * dichiara nessun cambio. Quello che resta indecidibile lo dichiara
   * l'esportazione fra le perdite, invece di far finta che il file lo sappia.
   */
  const gasIndexByRef = new Map<string, number>();
  children(node, 'tankdata').forEach((tank, i) => {
    asArray(child(tank, 'link')).forEach((l) => {
      const ref = attr(l, 'ref');
      if (ref && !gasIndexByRef.has(ref)) gasIndexByRef.set(ref, i);
    });
  });

  const samples: Sample[] = [];
  let currentGas: number | undefined;
  for (const wp of children(child(node, 'samples'), 'waypoint')) {
    const tempoS = num(child(wp, 'divetime'));
    const depth = num(child(wp, 'depth'));
    if (tempoS === undefined || depth === undefined) continue;

    const switchRef = attr(child(wp, 'switchmix'), 'ref');
    if (switchRef) currentGas = gasIndexByRef.get(switchRef) ?? currentGas;

    const decostop = child(wp, 'decostop');
    const stopDepth = attrNumAny(decostop, 'decodepth', 'depth');
    const stopTime = attrNumAny(decostop, 'duration', 'time');
    const kind = attr(decostop, 'kind');

    /*
     * ► TUTTE LE PRESSIONI DEL WAYPOINT, E CIASCUNA SULLA SUA BOMBOLA. ◄
     *
     * Erano due difetti in una riga sola, `num(child(wp, 'tankpressure'))`:
     *
     *  1. con **più di una** `<tankpressure>` — che è quello che scrive la
     *     nostra stessa esportazione, una per bombola — `child` restituisce un
     *     array e `num` su un array dà `undefined`: sparivano **tutte**. Un giro
     *     esporta-reimporta perdeva 41 pressioni su 41, e la perdita non era
     *     nemmeno fra quelle che l'esportazione dichiara.
     *  2. l'attributo `ref="cyl-i"` era ignorato, e la lettura finiva
     *     all'indice del **gas respirato** invece che della bombola a cui
     *     appartiene. Con un trasmettitore sulla principale e uno stage deco,
     *     i 130 bar della principale finivano sullo stage, che risultava
     *     consumato senza essere mai stato respirato.
     */
    const pressioni: (number | undefined)[] = [];
    for (const tp of children<XmlNode>(wp, 'tankpressure')) {
      const pa = num(tp);
      if (pa === undefined) continue;
      const rif = attr(tp, 'ref');
      // Senza `ref` non si sa a quale bombola appartenga: la prima è
      // l'assunzione meno sbagliata, il gas respirato è quella peggiore.
      const i = rif !== undefined ? (indiceBombolaPerId.get(rif) ?? 0) : 0;
      if (pressioni.length <= i) pressioni.length = i + 1;
      pressioni[i] = pascalToBar(pa);
    }
    const sample: Sample = {
      t: Math.round(tempoS),
      depth,
      tempC: mapDefined(num(child(wp, 'temperature')), kelvinToC),
      pressureBar: pressioni.length ? pressioni : undefined,
      ndlS: num(child(wp, 'nodecotime')),
      ttsS: num(child(wp, 'remainingbottomtime')),
      stopDepth,
      stopTimeS: stopTime,
      /*
       * ► `kind` DISTINGUE LE DUE COSE, E L'OR LO ANNULLAVA. ◄
       *
       * UDDF marca ogni sosta con `kind`, e i due valori che contano sono
       * `mandatory` e **`safety`**. La riga di prima diceva
       * `kind === 'mandatory' || stopDepth > 0`: la seconda metà **cancella la
       * prima**, perché una sosta di sicurezza una profondità ce l'ha, eccome.
       * Il campo che risolve la domanda veniva letto e poi buttato.
       *
       * *È la terza volta che questo progetto trova la stessa forma: il computer
       * distingue fra «ti conviene fermarti» e «devi fermarti», e noi
       * appiattiamo le due cose nel punto in cui le riceviamo.*
       *
       * Quando `kind` manca — e in parecchi file manca — non si può sapere, e si
       * tiene il comportamento di prima: una sosta con una quota vale obbligo.
       * *Nel dubbio si resta prudenti, ma il dubbio non si estende ai file che
       * la risposta ce l'hanno scritta dentro.*
       */
      inDeco: kind === 'safety' ? false : kind === 'mandatory' || (stopDepth !== undefined && stopDepth > 0),
      /*
       * ► LA CNS CROLLAVA ESATTAMENTE QUANDO SUPERAVA IL 100%. ◄
       *
       * La regola era `v <= 1 ? v * 100 : v`, cioè «se sembra una frazione
       * moltiplica». Continua sotto il 100% e discontinua sopra: `0.98` →
       * **98**, `1.02` → **1.02**. Cioè l'orologio dell'ossigeno si azzerava
       * nell'istante esatto in cui si sfora il limite NOAA — l'unico istante in
       * cui quella colonna serve a qualcosa.
       *
       * UDDF la scrive come frazione e lo dichiara nel formato: si converte
       * **sempre**, senza indovinare. Un file che sbagliasse scala darebbe un
       * numero cento volte troppo grande, che si vede; la regola di prima dava
       * un numero cento volte troppo piccolo *solo oltre il limite*, che non si
       * vede e rassicura.
       */
      cns: mapDefined(num(child(wp, 'cns')), (v) => v * 100),
      ppo2: mapDefined(num(child(wp, 'measuredpo2')) ?? num(child(wp, 'calculatedpo2')), pascalToBar),
      setpoint: mapDefined(num(child(wp, 'setpo2')), pascalToBar),
      gasIndex: currentGas,
      heartRate: num(child(wp, 'heartrate')) ?? num(child(wp, 'pulserate')),
    };
    samples.push(sample);
  }

  // Durata e profondità dichiarate dal file, oppure dedotte dai campioni.
  //
  // Dedurle va benissimo quando il file semplicemente non le scrive. Va molto
  // meno bene quando il file è TRONCATO — un download interrotto — perché allora
  // i campioni finiscono a metà e ne esce un'immersione che sembra vera: venti
  // minuti invece di quaranta, che la deduplica non riconosce come la stessa
  // (durata troppo diversa) e che quindi entra in archivio ACCANTO all'originale.
  // Non possiamo sapere se un file è troncato, ma possiamo dire che quei numeri
  // sono dedotti, ed è tutto quello che serve per non fidarsene.
  const declaredDuration = num(child(after, 'diveduration'));
  const declaredDepth = num(child(after, 'greatestdepth'));
  const durationS = declaredDuration ?? (samples.length ? samples[samples.length - 1]!.t : 0);
  const maxDepth = declaredDepth ?? (samples.length ? Math.max(...samples.map((s) => s.depth)) : 0);
  if (declaredDuration === undefined && declaredDepth === undefined && samples.length > 2) {
    warnings.push(
      `${t('Immersione del')} ${startTime.slice(0, 16)}: ` +
        t(
          'il file non dichiara durata né profondità massima, ricavate dai campioni. Se il file è stato scaricato a metà, questi numeri descrivono solo la parte arrivata.',
        ),
    );
  }

  if (!durationS || !maxDepth) {
    warnings.push(`${t('Immersione del')} ${startTime} ${t('scartata: durata o profondità mancanti.')}`);
    return null;
  }

  const siteRef = asArray(child(before, 'link'))
    .map((l) => attr(l, 'ref'))
    .find(Boolean);
  const site = siteRef ? sites.get(siteRef) : undefined;

  const apparatus = text(child(before, 'apparatus'));
  const mode: DiveMode =
    apparatus === 'rebreather' || apparatus === 'closed-circuit'
      ? 'ccr'
      : apparatus === 'semi-closed-circuit'
        ? 'scr'
        : 'oc';

  const base = {
    startTime,
    maxDepth: round1(maxDepth),
    durationS: Math.round(durationS),
    // NIENTE `model` dal generatore del file.
    //
    // Prima ci finiva il nome del programma che aveva scritto l'UDDF.
    // Reimportando un nostro export, ogni immersione si portava dietro un secondo
    // «computer» chiamato MyDiveLog, che la deduplica non toglieva perché è
    // genuinamente diverso dal principale. Il generatore è software: sta nella
    // provenienza (`source`), non fra gli strumenti.
    computer: {
      model: undefined as string | undefined,
      decoModel: text(child(child(child(node, 'applicationdata'), 'decomodel'), 'name')),
    },
  };

  const dive: Dive = {
    id: diveIdFor(base),
    number: num(child(before, 'divenumber')),
    startTime: base.startTime,
    durationS: base.durationS,
    maxDepth: base.maxDepth,
    avgDepth: mapDefined(num(child(after, 'averagedepth')), round1),
    minTempC: mapDefined(num(child(after, 'lowesttemperature')), (k) => round1(kelvinToC(k))),
    airTempC: mapDefined(num(child(before, 'airtemperature')), (k) => round1(kelvinToC(k))),
    site: site ? { ...site } : undefined,
    // Le note UDDF stanno dentro <para>, non come testo diretto di <notes>:
    // è così che le scrivono Subsurface e gli altri, e finora le buttavamo via
    // in silenzio. Si accettano entrambe le forme.
    notes: text(child(child(after, 'notes'), 'para')) ?? text(child(after, 'notes')),
    mode,
    cylinders,
    /*
     * La densità quando c'è, salata quando manca.
     *
     * `'salt'` fisso trasformava ogni immersione in lago in un'immersione in
     * mare — anche quelle che questa stessa applicazione aveva appena
     * esportato. La soglia è a metà fra i 1000 kg/m³ dell'acqua dolce e i 1030
     * della salata: qualunque valore intermedio scritto da un altro programma
     * cade dalla parte giusta.
     */
    salinity: (() => {
      const densita = num(child(before, 'density'));
      if (densita === undefined) return 'salt';
      return densita < 1015 ? 'fresh' : 'salt';
    })(),
    // Il fuso scritto nel file è un dato, non un dettaglio di formattazione:
    // senza, la scheda mostra un'ora in cui nessuno si è immerso.
    utcOffsetMinutes: fuso,
    surfacePressureBar: mapDefined(num(child(before, 'surfacepressure')), pascalToBar),
    surfaceIntervalS: num(child(child(before, 'surfaceintervalbeforedive'), 'passedtime')),
    computer: base.computer,
    source: { format: 'uddf', file: fileName, importedAt },
    /*
     * ► IL VOTO IN UDDF È ANNIDATO. ◄ `<rating><ratingvalue>4</ratingvalue></rating>`
     * è la forma del formato 3.2, ed è quella che scrive l'esportazione di
     * Subsurface: `num()` su un nodo con figli dà `undefined`, e il voto
     * spariva da ogni file scritto secondo lo standard. Si prova prima la forma
     * annidata e poi quella diretta, che è quella che scriviamo noi.
     */
    rating: num(child(child(after, 'rating'), 'ratingvalue')) ?? num(child(after, 'rating')),
    visibilityM: num(child(after, 'visibility')),
    tags: [],
    samples,
  };
  dive.metrics = computeMetrics(dive);
  if (dive.avgDepth === undefined) dive.avgDepth = dive.metrics.avgDepth;
  return dive;
}

// ---------------------------------------------------------------------------

const toBar = (pa: number | undefined) => (pa === undefined ? undefined : Math.round(pascalToBar(pa)));
const round1 = (v: number) => Math.round(v * 10) / 10;

function mapDefined<T, R>(v: T | undefined, fn: (v: T) => R): R | undefined {
  return v === undefined ? undefined : fn(v);
}

/**
 * UDDF usa ISO 8601, ma non tutti i generatori includono il fuso.
 *
 * Senza fuso quei numeri sono la lettura dell'orologio del computer subacqueo, e
 * vengono fissati su UTC: interpretarli nel fuso della macchina che importa
 * renderebbe l'istante — e quindi l'identificativo dell'immersione — diverso da
 * dispositivo a dispositivo. Vedi `wallClockToIso`.
 */
export function normaliseDateTime(raw: string): string | undefined {
  // Prima, una data che il parser non capiva diventava il 1° gennaio 1970.
  //
  // Il danno non era la data sbagliata: era che TUTTE le immersioni del file
  // finivano allo stesso istante, e a quel punto la deduplica — che riconosce
  // come «la stessa immersione» due tuffi vicini nel tempo e simili per
  // profondità — ne fondeva a due a due. Tre immersioni entravano, due restavano,
  // e la schermata di import diceva «1 duplicato». Senza un avviso.
  return wallClockToIso(raw);
}

/**
 * IL FUSO DICHIARATO NEL FILE, quando c'è.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ► IL DIFETTO CHE CHIUDE, misurato il 15 settembre 2026. ◄
 *
 * UDDF 3.2 permette di scrivere `<datetime>2026-06-14T10:38:00+02:00</datetime>`,
 * e quando lo fa quel `+02:00` è un'informazione vera: l'immersione è cominciata
 * alle 10:38 ORA DEL POSTO. `wallClockToIso` fa la cosa giusta con la data —
 * converte in UTC — ma l'offset lo butta via, e `readDive` non scriveva mai
 * `utcOffsetMinutes`.
 *
 * Risultato: la scheda mostrava **08:38**, cioè un'ora che nel file non c'è e
 * in cui il subacqueo non si è immerso. `logtrak.ts` l'offset lo conserva da
 * mesi; qui no.
 *
 * `Z` vale zero ed è un fuso dichiarato quanto gli altri: un file scritto in
 * UTC dice «l'ora locale era UTC», e va distinto da un file che il fuso non lo
 * dice affatto.
 */
export function fusoDichiarato(raw: string): number | undefined {
  const m = /([+-])(\d{2}):?(\d{2})$|Z$/i.exec(raw.trim());
  if (!m) return undefined;
  if (!m[1]) return 0;
  const minuti = Number(m[2]) * 60 + Number(m[3]);
  return m[1] === '-' ? -minuti : minuti;
}
