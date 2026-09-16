/**
 * Esportazione dell'archivio in UDDF 3.2.
 *
 * PERCHÉ ESISTE. I dati entrano da sette formati diversi e finora non uscivano da
 * nessuna parte. Un archivio di anni chiuso dentro un'applicazione è un archivio
 * a rischio, e la fiducia in un logbook si misura anche dalla facilità con cui se
 * ne può uscire. UDDF è l'unico formato standard che i programmi del settore
 * leggono davvero, ed è quello che l'app importa già: il giro si chiude.
 *
 * COSA GARANTISCE. Il file prodotto è rileggibile dal nostro stesso parser e
 * ricostruisce le immersioni con gli stessi valori — è la proprietà che i test
 * verificano, ed è l'unica definizione utile di "export corretto". Quello che UDDF
 * non sa rappresentare (il tetto di decompressione campione per campione di
 * Shearwater, i gradient factor impostati, la provenienza multipla) resta fuori, e
 * la funzione lo dichiara invece di far finta.
 *
 * UNITÀ. UDDF è interamente SI e va preso alla lettera: pressioni in **pascal**,
 * temperature in **kelvin**, volumi in **metri cubi**, frazioni di gas fra 0 e 1,
 * profondità in metri, tempi in secondi. La conversione avviene qui, in un posto
 * solo: dentro l'app tutto resta nelle unità canoniche.
 */

import type { Dive, GasMix, Sample } from '../model';
import { barToPascal, cToKelvin, mixName } from '../units';
import { temperaturaMinimaC } from '../temperatura';
import { profonditaMedia } from '../profondita';
import { firmaVuota } from '../firma';
import { perData } from '../oraAParete';

export interface UddfExportOptions {
  /** Nome del generatore scritto nel file. */
  generator?: string;
  /** Istante di generazione, ISO. Passato da fuori per rendere l'output ripetibile. */
  now?: string;
  /** Includere i profili campionati: senza, il file è molto più piccolo. */
  includeProfiles?: boolean;
}

/**
 * Una perdita dichiarata, insieme ai campi del modello che la producono.
 *
 * ► PERCHÉ I CAMPI E NON SOLO LA FRASE. ◄ Questo modulo promette in testa che
 * «un elenco incompleto è peggio di nessun elenco». Un elenco di frasi però è
 * scollegato dal modello: il giorno in cui si aggiunge un campo a `Dive`,
 * l'elenco resta quello di prima e continua a sembrare completo — che è il modo
 * esatto in cui era diventato incompleto la prima volta. Con il campo scritto
 * accanto alla frase, una prova può fare il giro esporta→reimporta, guardare
 * quali campi non sopravvivono e pretendere che ognuno sia dichiarato: a
 * dirlo non è più una persona che si ricorda, è la prova.
 *
 * Il verso opposto vale quanto questo: un campo dichiarato che invece
 * sopravvive è una bugia nell'altra direzione, e la stessa prova la vede.
 */
export interface PerditaDichiarata {
  /**
   * I campi del modello che restano fuori, come percorsi dentro `Dive`:
   * `buddy`, `site.region`, `cylinders.analisi`, `samples.setpoint`. Un passo
   * che cade su un array vale «almeno un elemento».
   */
  campi: string[];
  /** La frase mostrata a chi esporta. */
  testo: string;
}

export interface UddfExportResult {
  xml: string;
  dives: number;
  /** Cosa non è entrato nel file, in chiaro: serve a chi lo userà come backup. */
  omitted: string[];
  /** Le stesse perdite di `omitted`, ognuna legata ai campi che la producono. */
  perdite: PerditaDichiarata[];
}

/** Escape XML: i nomi dei siti e le note contengono di tutto. */
function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const n = (v: number, digits = 3) => {
  const r = Number(v.toFixed(digits));
  return Number.isFinite(r) ? String(r) : '0';
};

/**
 * Un identificativo XML che NON fa collidere due nomi diversi.
 *
 * ► COSA FACEVA PRIMA. ◄ `raw.replace(/[^A-Za-z0-9_-]/g, '')`: **cancellava** i
 * caratteri che non gli piacevano. Cancellare non è codificare, e la differenza
 * si vede subito: «Grotta Azzurra (Capri)» e «Grotta Azzurra Capri» uscivano
 * identiche, e due nomi scritti in un alfabeto non latino diventavano tutti e
 * due la stringa vuota, cioè `site-`. Nel file restava un `<site>` solo, e
 * reimportandolo la seconda immersione si prendeva nome e coordinate della
 * prima: due posti diversi diventavano lo stesso posto, senza un avviso e senza
 * che nel file rimanesse traccia di quello perso.
 *
 * ► COSA FA ADESSO. ◄ Codifica invece di cancellare. Ogni carattere fuori da
 * `[A-Za-z0-9-]` diventa `_<codice esadecimale>_`, e l'underscore letterale
 * diventa `__`. La trasformazione si ripercorre all'indietro senza ambiguità —
 * dopo un `_` o c'è un altro `_`, e allora era un underscore vero, o ci sono
 * cifre esadecimali fino al `_` di chiusura — quindi da nomi diversi escono per
 * COSTRUZIONE identificativi diversi, e da nomi uguali lo stesso
 * identificativo. Non è una probabilità di collisione bassa: è zero.
 *
 * Quello che esce resta un `ID` XML valido: comincia con la lettera del
 * prefisso e contiene solo lettere, cifre, `-` e `_`.
 */
function idOf(prefix: string, raw: string): string {
  let corpo = '';
  // Il ciclo `for…of` su una stringa scorre per punto di codice e non per unità
  // UTF-16: senza, un carattere fuori dal piano base si spezzerebbe in due metà
  // e due caratteri diversi potrebbero condividerne una.
  for (const carattere of raw) {
    if (carattere === '_') corpo += '__';
    else if (/[A-Za-z0-9-]/.test(carattere)) corpo += carattere;
    else corpo += `_${(carattere.codePointAt(0) ?? 0).toString(16)}_`;
  }
  return `${prefix}-${corpo}`;
}

/**
 * Il numero quando c'è davvero; `undefined` in ogni altro caso.
 *
 * ► PERCHÉ `=== undefined` NON BASTA SU QUELLO CHE ARRIVA DALL'ARCHIVIO. ◄ I
 * campioni sono salvati con `JSON.stringify` (vedi `storage/sqlite.ts`), e
 * dentro un array quella funzione scrive `null` dove in memoria c'era un buco o
 * un `undefined`. Una bombola senza trasmettitore ha esattamente quella forma —
 * `pressureBar` valorizzata per la stage e vuota per la principale — quindi
 * `if (bar === undefined) continue` lasciava passare il `null`, `barToPascal`
 * ne faceva 0 e il file usciva con `<tankpressure>0</tankpressure>` su OGNI
 * campione: chi lo apre vede la bombola principale a zero bar dall'inizio alla
 * fine, cioè un'immersione fatta con una bombola vuota. Senza questa riga torna
 * esattamente quello.
 */
const numeroVero = (v: number | null | undefined): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;

/**
 * Vero quando il campo porta davvero qualcosa.
 *
 * Serve alle dichiarazioni di perdita: `!== undefined` da solo fa scattare la
 * riga anche su una lista vuota o su una stringa vuota, cioè su un campo che
 * non ha niente da perdere. Vedi il commento sul tipo di circuito più in basso:
 * una voce che compare quando non ti riguarda è una voce che si smette di
 * leggere.
 */
function valorizzato(v: unknown): boolean {
  if (v === undefined || v === null || v === '') return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.values(v).some((x) => x !== undefined);
  return true;
}

function gasKey(mix: GasMix): string {
  return `mix-${Math.round(mix.o2 * 1000)}-${Math.round((mix.he ?? 0) * 1000)}`;
}

function gasDefinitions(dives: Dive[]): string[] {
  const seen = new Map<string, GasMix>();
  for (const dive of dives) {
    for (const cyl of dive.cylinders) seen.set(gasKey(cyl.mix), cyl.mix);
  }
  return [...seen].map(([key, mix]) => {
    const he = mix.he ?? 0;
    return [
      `    <mix id="${key}">`,
      `      <name>${esc(mixName(mix))}</name>`,
      `      <o2>${n(mix.o2)}</o2>`,
      `      <n2>${n(Math.max(0, 1 - mix.o2 - he))}</n2>`,
      `      <he>${n(he)}</he>`,
      '    </mix>',
    ].join('\n');
  });
}

/**
 * L'identificativo XML della bombola `i` di una data immersione.
 *
 * ► GLI IDENTIFICATIVI ERANO DUPLICATI DENTRO LO STESSO DOCUMENTO. ◄ Era
 * `cyl-${i}`, e `i` ripartiva da zero a ogni immersione: un file con tre
 * immersioni conteneva `cyl-0` tre volte. In XML un `ID` è unico nel documento,
 * non nell'elemento che lo contiene: un validatore rifiuta il file («ID cyl-0
 * already defined»), e un lettore che risolva i riferimenti sull'intero
 * documento — invece che dentro la singola immersione, come fa il nostro —
 * attacca la pressione della terza immersione alla bombola della prima. Il
 * prefisso è l'identificativo dell'immersione, che nel documento è già unico.
 */
const idBombola = (idDive: string, i: number) => `${idDive}-cyl-${i}`;

function sampleXml(s: Sample, dive: Dive, idDive: string): string {
  const parts = [`        <divetime>${n(s.t, 1)}</divetime>`, `        <depth>${n(s.depth, 2)}</depth>`];
  if (s.tempC !== undefined) parts.push(`        <temperature>${n(cToKelvin(s.tempC), 2)}</temperature>`);
  if (s.pressureBar) {
    for (const [i, grezzo] of s.pressureBar.entries()) {
      const bar = numeroVero(grezzo);
      // Niente pressione, niente riga: vedi `numeroVero`. E niente riga nemmeno
      // per una bombola che nel documento non esiste — un `ref` che non si
      // risolve manda il lettore sulla bombola sbagliata invece che su nessuna.
      if (bar === undefined || !dive.cylinders[i]) continue;
      parts.push(
        `        <tankpressure ref="${idBombola(idDive, i)}">${n(barToPascal(bar), 0)}</tankpressure>`,
      );
    }
  }
  /*
   * `<switchmix>` riferisce il GAS, non la bombola: è il formato a volerlo così.
   * Quando due bombole portano lo stesso gas l'informazione su QUALE delle due
   * fosse in respirazione non ha un posto dove stare, e viene dichiarata fra le
   * perdite invece di essere scritta in un attributo inventato da noi.
   */
  const cyl = dive.cylinders[s.gasIndex ?? 0];
  if (cyl) parts.push(`        <switchmix ref="${gasKey(cyl.mix)}" />`);
  return `      <waypoint>\n${parts.join('\n')}\n      </waypoint>`;
}

export function exportUddf(dives: Dive[], options: UddfExportOptions = {}): UddfExportResult {
  const { generator = 'MyDiveLog', now = new Date().toISOString(), includeProfiles = true } = options;
  const sorted = [...dives].sort(perData((d) => d.startTime));

  /*
   * ► IL SITO SI COSTRUISCE SU TUTTE LE IMMERSIONI CHE LO NOMINANO, NON SULLA PRIMA. ◄
   *
   * `if (!sites.has(key))` congelava il sito alla prima occorrenza. Se la prima
   * immersione a «Relitto Haven» era stata inserita a mano senza GPS e la
   * seconda aveva le coordinate, il `<site>` usciva senza `<geography>`: le
   * coordinate non comparivano da nessuna parte nel file, e non erano nemmeno
   * fra le perdite dichiarate — chi usa l'UDDF come backup non aveva modo di
   * accorgersene. L'export KML, sugli stessi dati, quelle coordinate le scrive:
   * era l'applicazione a dare due risposte diverse sullo stesso archivio.
   *
   * Latitudine e longitudine si prendono IN COPPIA e dalla stessa immersione:
   * metà coordinata di un'immersione e metà di un'altra non è un punto a metà, è
   * un punto inventato in mezzo al mare.
   *
   * La chiave è il nome ripulito dagli spazi ai bordi — la stessa che usa
   * l'export KML per raggruppare i segnaposti, perché due esportazioni dello
   * stesso archivio che contano i siti in modo diverso sono un difetto in sé.
   */
  const chiaveSito = (dive: Dive): string | undefined => {
    const nome = dive.site?.name?.trim();
    return nome ? nome : undefined;
  };
  const sites = new Map<string, { name: string; lat?: number; lon?: number }>();
  for (const dive of sorted) {
    const chiave = chiaveSito(dive);
    if (chiave === undefined) continue;
    const sito = sites.get(chiave) ?? { name: chiave };
    if (sito.lat === undefined || sito.lon === undefined) {
      const lat = numeroVero(dive.site?.lat);
      const lon = numeroVero(dive.site?.lon);
      if (lat !== undefined && lon !== undefined) {
        sito.lat = lat;
        sito.lon = lon;
      }
    }
    sites.set(chiave, sito);
  }
  const siteKeyOf = (dive: Dive) => {
    const chiave = chiaveSito(dive);
    return chiave === undefined ? undefined : idOf('site', chiave);
  };

  const out: string[] = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push('<uddf version="3.2.0" xmlns="http://www.streit.cc/uddf/3.2/">');
  out.push('  <generator>');
  out.push(`    <name>${esc(generator)}</name>`);
  out.push(`    <datetime>${esc(now)}</datetime>`);
  out.push('  </generator>');

  out.push('  <gasdefinitions>');
  out.push(...gasDefinitions(sorted));
  out.push('  </gasdefinitions>');

  if (sites.size) {
    out.push('  <divesite>');
    for (const [chiave, site] of sites) {
      out.push(`    <site id="${idOf('site', chiave)}">`);
      out.push(`      <name>${esc(site.name)}</name>`);
      if (site.lat !== undefined && site.lon !== undefined) {
        out.push('      <geography>');
        out.push(`        <latitude>${n(site.lat, 6)}</latitude>`);
        out.push(`        <longitude>${n(site.lon, 6)}</longitude>`);
        out.push('      </geography>');
      }
      out.push('    </site>');
    }
    out.push('  </divesite>');
  }

  out.push('  <profiledata>');
  out.push('    <repetitiongroup id="rg-1">');

  for (const dive of sorted) {
    const idDive = idOf('dive', dive.id);
    out.push(`      <dive id="${idDive}">`);
    out.push('        <informationbeforedive>');
    out.push(`          <datetime>${esc(dive.startTime)}</datetime>`);
    if (dive.number !== undefined) out.push(`          <divenumber>${dive.number}</divenumber>`);
    const siteKey = siteKeyOf(dive);
    if (siteKey) out.push(`          <link ref="${siteKey}" />`);
    if (dive.airTempC !== undefined) {
      out.push(`          <airtemperature>${n(cToKelvin(dive.airTempC), 2)}</airtemperature>`);
    }
    /*
     * LA SALINITÀ SI SCRIVE, non si dichiara persa.
     *
     * Il lettore UDDF mette `salinity: 'salt'` fisso, quindi un'immersione in
     * lago tornava in mare dopo un giro di export e reimport — e la densità non
     * è cosmetica: entra nella pressione ambiente, quindi nel GF99, nel CNS,
     * nella MOD. Cinque lettori su sette producono `fresh`, e l'archivio di
     * riferimento si immerge anche in lago. Peggio, la perdita non era nemmeno
     * nell'elenco di quello che l'export dichiara di non saper rappresentare.
     *
     * `<density>` in kg/m³ è la forma che usa Subsurface, quindi il file resta
     * leggibile da fuori invece di portare un campo inventato da noi.
     */
    if (dive.salinity !== undefined) {
      out.push(`          <density>${dive.salinity === 'fresh' ? 1000 : 1030}</density>`);
    }
    // La pressione di superficie era dichiarata persa, e bastava scriverla: il
    // lettore la legge già, ed è quella con cui si ricostruiscono le
    // saturazioni di un archivio ripristinato da questo file.
    if (dive.surfacePressureBar !== undefined) {
      out.push(`          <surfacepressure>${n(barToPascal(dive.surfacePressureBar), 0)}</surfacepressure>`);
    }
    if (dive.surfaceIntervalS !== undefined) {
      out.push('          <surfaceintervalbeforedive>');
      out.push(`            <passedtime>${n(dive.surfaceIntervalS, 0)}</passedtime>`);
      out.push('          </surfaceintervalbeforedive>');
    }
    out.push('        </informationbeforedive>');

    // Le bombole: volume in metri cubi, pressioni in pascal.
    for (const [i, cyl] of dive.cylinders.entries()) {
      out.push(`        <tankdata id="${idBombola(idDive, i)}">`);
      out.push(`          <link ref="${gasKey(cyl.mix)}" />`);
      if (cyl.sizeL !== undefined) out.push(`          <tankvolume>${n(cyl.sizeL / 1000, 5)}</tankvolume>`);
      if (cyl.startBar !== undefined) {
        out.push(`          <tankpressurebegin>${n(barToPascal(cyl.startBar), 0)}</tankpressurebegin>`);
      }
      if (cyl.endBar !== undefined) {
        out.push(`          <tankpressureend>${n(barToPascal(cyl.endBar), 0)}</tankpressureend>`);
      }
      out.push('        </tankdata>');
    }

    if (includeProfiles && dive.samples?.length) {
      out.push('      <samples>');
      for (const s of dive.samples) out.push(sampleXml(s, dive, idDive));
      out.push('      </samples>');
    }

    out.push('        <informationafterdive>');
    out.push(`          <greatestdepth>${n(dive.maxDepth, 2)}</greatestdepth>`);
    const media = profonditaMedia(dive);
    if (media !== undefined) out.push(`          <averagedepth>${n(media, 2)}</averagedepth>`);
    out.push(`          <diveduration>${n(dive.durationS, 0)}</diveduration>`);
    /*
     * La temperatura si prende da dove c'è: dichiarata o misurata sul profilo.
     * Leggendo solo il campo dichiarato, riesportare un'immersione importata da
     * un formato che non lo scrive **perdeva** un dato che era in archivio — e
     * il file usciva senza `<lowesttemperature>` come se la temperatura non
     * fosse mai stata registrata.
     */
    const tMin = temperaturaMinimaC(dive);
    if (tMin !== undefined) {
      out.push(`          <lowesttemperature>${n(cToKelvin(tMin), 2)}</lowesttemperature>`);
    }
    if (dive.notes) out.push(`          <notes><para>${esc(dive.notes)}</para></notes>`);
    out.push('        </informationafterdive>');
    out.push('      </dive>');
  }

  out.push('    </repetitiongroup>');
  out.push('  </profiledata>');
  out.push('</uddf>');

  /*
   * COSA RESTA FUORI. Dichiararlo è parte dell'export: chi usa questo file come
   * backup deve sapere che non è una copia completa dell'archivio.
   *
   * L'elenco dichiarava quattro perdite su venti, e poi venti su trenta. Il
   * modulo promette in testa di dichiarare quello che UDDF non sa rappresentare,
   * e il giro export→import ne perdeva di più in silenzio ogni volta che un
   * campo nuovo entrava nel modello: la profondità programmata, il centro, la
   * firma della guida, la miscela analizzata, le soste campione per campione.
   * Un elenco incompleto è peggio di nessun elenco: fa credere di sapere cosa si
   * sta perdendo.
   *
   * Per questo ogni voce porta con sé i CAMPI del modello che la producono (vedi
   * `PerditaDichiarata`): così la completezza dell'elenco non dipende più dal
   * fatto che qualcuno si ricordi di aggiornarlo — la si misura facendo il giro
   * esporta→reimporta e guardando cosa non torna.
   */
  const perdite: PerditaDichiarata[] = [];
  const dichiara = (campi: string[], testo: string) => perdite.push({ campi, testo });

  /** Dichiara la perdita di un campo dell'immersione, se almeno una ce l'ha. */
  const perde = <K extends keyof Dive>(key: K, label: string) => {
    if (sorted.some((d) => valorizzato(d[key]))) dichiara([key], label);
  };
  /** Come sopra per un campo del campione: basta un campione in tutto l'archivio. */
  const perdeCampione = (campi: string[], test: (s: Sample) => boolean, label: string) => {
    if (sorted.some((d) => d.samples?.some(test))) dichiara(campi, label);
  };
  /** Come sopra per un campo della bombola. */
  const perdeBombola = (campi: string[], test: (c: Dive['cylinders'][number]) => boolean, label: string) => {
    if (sorted.some((d) => d.cylinders?.some(test))) dichiara(campi, label);
  };

  if (sorted.some((d) => d.computer?.gfLow !== undefined || d.computer?.gfHigh !== undefined)) {
    dichiara(
      ['computer.gfLow', 'computer.gfHigh'],
      'i gradient factor impostati sul computer (UDDF non li prevede)',
    );
  }
  perdeCampione(
    ['samples.ceiling', 'samples.ndlS', 'samples.ttsS'],
    (s) => s.ceiling !== undefined || s.ndlS !== undefined || s.ttsS !== undefined,
    'tetto di decompressione, NDL e TTS campione per campione',
  );
  if (sorted.some((d) => d.extraSources?.length)) {
    dichiara(['extraSources'], 'la provenienza multipla delle immersioni fuse da più computer');
  }

  /*
   * ► IL SECONDO PROFILO: LA DICHIARAZIONE NON COMPARIVA MAI. ◄
   *
   * La condizione era `d.altSamples?.length`, e da qui dentro è sempre falsa.
   * Chi esporta l'archivio (`ui/state.tsx`) passa i RIEPILOGHI delle immersioni
   * e ci aggiunge i campioni del profilo principale letti dall'archivio:
   * `altSamples` in quei riepiloghi non c'è, e non perché l'immersione non ne
   * abbia uno — perché non è stato caricato. Il secondo profilo si perdeva e
   * l'avviso taceva proprio nel caso normale.
   *
   * ► PERCHÉ LA DECISIONE NON PUÒ STARE QUI. ◄ Da dentro questa funzione «non
   * ce l'ha» e «non me l'hanno dato» sono lo stesso `undefined`, e nel parametro
   * non c'è nient'altro che le distingua: non è una svista da correggere con un
   * controllo più furbo, è informazione che non è arrivata. Quello che si può
   * fare è non far passare il dubbio per un no. Un array VUOTO invece è una
   * risposta vera — quell'immersione un secondo profilo non ce l'ha — e infatti
   * non fa scattare niente.
   */
  if (sorted.some((d) => d.altSamples?.length)) {
    dichiara(['altSamples'], 'il secondo profilo, quello più fitto registrato dall’altro computer');
  } else if (sorted.some((d) => d.altSamples === undefined || d.altSamples === null)) {
    dichiara(['altSamples'], 'il secondo profilo dell’altro computer, se l’immersione ne ha uno');
  }

  /*
   * ► «RESTANO FUORI: IL TIPO DI CIRCUITO» COMPARIVA SEMPRE. ◄
   *
   * `mode` è obbligatorio nel modello, quindi `d.mode !== undefined` è vero per
   * ogni immersione — comprese cento immersioni tutte a circuito aperto. Chi
   * esportava leggeva «un rebreather torna a circuito aperto» senza avere un
   * rebreather, e una voce che compare quando non ti riguarda è una voce che si
   * smette di leggere: proprio quella su cui poi bisognerebbe contare. Il
   * lettore UDDF ricostruisce `oc` quando `<apparatus>` manca, quindi
   * un'immersione a circuito aperto non perde niente e la riga ha senso solo
   * per le altre.
   */
  if (sorted.some((d) => d.mode !== undefined && d.mode !== 'oc')) {
    dichiara(['mode'], 'il tipo di circuito (un rebreather torna a circuito aperto)');
  }

  perde('buddy', 'il compagno');
  perde('rating', 'la valutazione');
  perde('weightKg', 'la zavorra');
  perde('suit', 'la muta');
  perde('visibilityM', 'la visibilità');
  perde('visibilityMaxM', 'l’estremo alto della fascia di visibilità, quando è una fascia');
  perde('visibilityRating', 'la visibilità a stelle dei logbook che la danno come voto');
  perde('title', 'il titolo dell’immersione');
  perde('guide', 'la guida sub');
  perde('center', 'il centro di immersione');
  perde('plannedMaxDepth', 'la profondità massima programmata');
  perde('rmvLpmManual', 'il consumo in L/min scritto a mano');
  perde('updatedAt', 'la data dell’ultima modifica della scheda');
  perde('conditions', 'meteo e stato del mare');
  perde('gear', 'l’attrezzatura usata: erogatori, GAV, e il peso della piastra');
  perde('utcOffsetMinutes', 'il fuso orario del sito (gli orari restano in UTC)');
  perde('annotations', 'le annotazioni del logbook di origine');
  perde('reported', 'i valori di sintesi letti dal computer (GF99, TTS, NDL minimo)');
  perde('events', 'i segnalibri messi durante l’immersione');
  perde('otherComputers', 'le impostazioni degli altri computer che hanno registrato l’immersione');
  perde('tags', 'le etichette');
  // La firma è un disegno, e un disegno vuoto non è una perdita: `firmaVuota`
  // sa già distinguere i tratti raccolti sul posto da un tocco per sbaglio.
  if (sorted.some((d) => !firmaVuota(d.firmaGuida))) {
    dichiara(['firmaGuida'], 'la firma della guida raccolta sul posto');
  }
  if (sorted.some((d) => d.site?.region || d.site?.country)) {
    dichiara(['site.region', 'site.country'], 'regione e paese del sito');
  }
  perdeBombola(
    ['cylinders.material', 'cylinders.workPressureBar'],
    (c) => !!c.material || c.workPressureBar !== undefined,
    'materiale e pressione di esercizio delle bombole',
  );
  perdeBombola(
    ['cylinders.description'],
    (c) => !!c.description,
    'la descrizione delle bombole («D12 lungo», «stage 40%»)',
  );
  /*
   * ► LA MISCELA ANALIZZATA NON È LA MISCELA DICHIARATA. ◄ UDDF ha un posto per
   * la composizione del gas e non ne ha uno per dire che quella composizione
   * l'hai MISURATA: la percentuale letta all'analizzatore, quando l'hai letta e
   * chi l'ha letta restano fuori tutte e tre. Sul file esce il 32% della sigla
   * anche quando l'analizzatore aveva detto 31.5, ed è la differenza fra un dato
   * verificato e un adesivo.
   */
  perdeBombola(['cylinders.analisi'], (c) => !!c.analisi, 'la miscela analizzata: quanto, quando e da chi');
  perdeCampione(
    ['samples.cns', 'samples.ppo2'],
    (s) => s.cns !== undefined || s.ppo2 !== undefined,
    'CNS e PPO2 campione per campione',
  );
  /*
   * ► IL SETPOINT AVEVA LA CONDIZIONE DI UN ALTRO. ◄ Stava dentro la riga di CNS
   * e PPO2 — «CNS, PPO2 e setpoint» — e quindi si accendeva solo se c'era uno
   * degli altri due. Un rebreather che registra il setpoint e non la CNS lo
   * perdeva in silenzio, cioè perdeva in silenzio il numero che dice a quale
   * pressione parziale di ossigeno stava lavorando l'elettronica.
   */
  perdeCampione(
    ['samples.setpoint'],
    (s) => s.setpoint !== undefined,
    'il setpoint del rebreather campione per campione',
  );
  /*
   * ► LE SOSTE. ◄ Il lettore UDDF legge `<decostop>` — quota, durata e `kind`,
   * che è quello che distingue la sosta obbligatoria da quella di sicurezza — e
   * l'esportazione non lo scrive. Il profilo torna indietro con ogni campione
   * fuori deco e nessuna sosta programmata: non un buco, un profilo tranquillo.
   */
  perdeCampione(
    [
      'samples.stopDepth',
      'samples.stopTimeS',
      'samples.inDeco',
      'samples.inSafetyStop',
      'samples.inDeepStop',
    ],
    (s) =>
      s.stopDepth !== undefined ||
      s.stopTimeS !== undefined ||
      s.inDeco !== undefined ||
      s.inSafetyStop !== undefined ||
      s.inDeepStop !== undefined,
    'la prossima sosta, l’obbligo di decompressione e la sosta di sicurezza campione per campione',
  );
  perdeCampione(
    ['samples.heartRate'],
    (s) => s.heartRate !== undefined,
    'il battito cardiaco campione per campione',
  );
  perdeCampione(
    ['samples.rbtMin', 'samples.bearing'],
    (s) => s.rbtMin !== undefined || s.bearing !== undefined,
    'il tempo di fondo residuo e la bussola campione per campione',
  );
  if (sorted.some((d) => d.computer?.model)) {
    dichiara(['computer'], 'modello, matricola e impostazioni del computer subacqueo');
  }
  /*
   * ► CON DUE BOMBOLE DELLO STESSO GAS, IL GAS RESPIRATO TORNA SULLA BOMBOLA SBAGLIATA. ◄
   *
   * UDDF segna il cambio con `<switchmix ref="…">`, e quel riferimento punta a
   * una `<mix>` delle `gasdefinitions`: al GAS, non alla bombola. Finché i gas
   * sono diversi la bombola si ricava dal gas; con due D12 ad aria in sidemount
   * il gas è lo stesso e il collegamento non esiste più. Il formato non ha un
   * posto dove scriverlo, e inventare un attributo nostro darebbe un file che
   * rilegge solo chi l'ha scritto — cioè il contrario del motivo per cui si
   * esporta in UDDF. Il lettore sceglie la PRIMA bombola che porta quel gas,
   * che è l'assunzione che sbaglia meno spesso; se stavi respirando la seconda,
   * quell'informazione nel file non c'è.
   *
   * La riga compare solo quando c'è davvero da perdere qualcosa: due bombole
   * con lo stesso gas E un campione che dichiara di respirare proprio quella
   * che il lettore non saprà scegliere.
   */
  if (includeProfiles && sorted.some(bombolaNonRicostruibile)) {
    dichiara(
      ['samples.gasIndex'],
      'quale bombola stavi respirando, quando due bombole portano lo stesso gas (UDDF collega il cambio al gas, non alla bombola)',
    );
  }
  if (!includeProfiles) dichiara(['samples'], 'i profili campionati, esclusi su richiesta');

  return {
    xml: out.join('\n'),
    dives: sorted.length,
    omitted: perdite.map((p) => p.testo),
    perdite,
  };
}

/**
 * Vero se in questa immersione un campione dichiara di respirare una bombola che
 * il lettore non può ricostruire dal solo gas.
 *
 * Vedi il commento sulla dichiarazione che la usa: succede quando due bombole
 * portano lo stesso gas e il campione punta a quella che NON è la prima con
 * quel gas — la prima è l'unica che un lettore possa dedurre da `<switchmix>`.
 */
function bombolaNonRicostruibile(dive: Dive): boolean {
  const primaConQuelGas = new Map<string, number>();
  dive.cylinders.forEach((c, i) => {
    const k = gasKey(c.mix);
    if (!primaConQuelGas.has(k)) primaConQuelGas.set(k, i);
  });
  return (dive.samples ?? []).some((s) => {
    const i = numeroVero(s.gasIndex);
    if (i === undefined) return false;
    const cyl = dive.cylinders[i];
    return cyl !== undefined && primaConQuelGas.get(gasKey(cyl.mix)) !== i;
  });
}
