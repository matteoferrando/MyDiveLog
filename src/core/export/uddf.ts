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

export interface UddfExportOptions {
  /** Nome del generatore scritto nel file. */
  generator?: string;
  /** Istante di generazione, ISO. Passato da fuori per rendere l'output ripetibile. */
  now?: string;
  /** Includere i profili campionati: senza, il file è molto più piccolo. */
  includeProfiles?: boolean;
}

export interface UddfExportResult {
  xml: string;
  dives: number;
  /** Cosa non è entrato nel file, in chiaro: serve a chi lo userà come backup. */
  omitted: string[];
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

/** Identificatore XML valido: gli id dell'app sono esadecimali, ma non si sa mai. */
const idOf = (prefix: string, raw: string) => `${prefix}-${raw.replace(/[^A-Za-z0-9_-]/g, '')}`;

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

function sampleXml(s: Sample, gasKeyByIndex: (i: number | undefined) => string | undefined): string {
  const parts = [`        <divetime>${n(s.t, 1)}</divetime>`, `        <depth>${n(s.depth, 2)}</depth>`];
  if (s.tempC !== undefined) parts.push(`        <temperature>${n(cToKelvin(s.tempC), 2)}</temperature>`);
  if (s.pressureBar) {
    for (const [i, bar] of s.pressureBar.entries()) {
      if (bar === undefined) continue;
      parts.push(`        <tankpressure ref="cyl-${i}">${n(barToPascal(bar), 0)}</tankpressure>`);
    }
  }
  const key = gasKeyByIndex(s.gasIndex);
  if (key) parts.push(`        <switchmix ref="${key}" />`);
  return `      <waypoint>\n${parts.join('\n')}\n      </waypoint>`;
}

export function exportUddf(dives: Dive[], options: UddfExportOptions = {}): UddfExportResult {
  const { generator = 'MyDiveLog', now = new Date().toISOString(), includeProfiles = true } = options;
  const sorted = [...dives].sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime));

  const sites = new Map<string, { name: string; lat?: number; lon?: number }>();
  for (const dive of sorted) {
    if (dive.site?.name) {
      const key = idOf('site', dive.site.name.toLowerCase().replace(/\s+/g, '-'));
      if (!sites.has(key)) {
        sites.set(key, { name: dive.site.name, lat: dive.site.lat, lon: dive.site.lon });
      }
    }
  }
  const siteKeyOf = (dive: Dive) =>
    dive.site?.name ? idOf('site', dive.site.name.toLowerCase().replace(/\s+/g, '-')) : undefined;

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
    for (const [key, site] of sites) {
      out.push(`    <site id="${key}">`);
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
    const gasKeyByIndex = (i: number | undefined) => {
      const cyl = dive.cylinders[i ?? 0];
      return cyl ? gasKey(cyl.mix) : undefined;
    };
    out.push(`      <dive id="${idOf('dive', dive.id)}">`);
    out.push('        <informationbeforedive>');
    out.push(`          <datetime>${esc(dive.startTime)}</datetime>`);
    if (dive.number !== undefined) out.push(`          <divenumber>${dive.number}</divenumber>`);
    const siteKey = siteKeyOf(dive);
    if (siteKey) out.push(`          <link ref="${siteKey}" />`);
    if (dive.airTempC !== undefined) {
      out.push(`          <airtemperature>${n(cToKelvin(dive.airTempC), 2)}</airtemperature>`);
    }
    if (dive.surfaceIntervalS !== undefined) {
      out.push('          <surfaceintervalbeforedive>');
      out.push(`            <passedtime>${n(dive.surfaceIntervalS, 0)}</passedtime>`);
      out.push('          </surfaceintervalbeforedive>');
    }
    out.push('        </informationbeforedive>');

    // Le bombole: volume in metri cubi, pressioni in pascal.
    for (const [i, cyl] of dive.cylinders.entries()) {
      out.push(`        <tankdata id="cyl-${i}">`);
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
      for (const s of dive.samples) out.push(sampleXml(s, gasKeyByIndex));
      out.push('      </samples>');
    }

    out.push('        <informationafterdive>');
    out.push(`          <greatestdepth>${n(dive.maxDepth, 2)}</greatestdepth>`);
    if (dive.avgDepth !== undefined)
      out.push(`          <averagedepth>${n(dive.avgDepth, 2)}</averagedepth>`);
    out.push(`          <diveduration>${n(dive.durationS, 0)}</diveduration>`);
    if (dive.minTempC !== undefined) {
      out.push(`          <lowesttemperature>${n(cToKelvin(dive.minTempC), 2)}</lowesttemperature>`);
    }
    if (dive.notes) out.push(`          <notes><para>${esc(dive.notes)}</para></notes>`);
    out.push('        </informationafterdive>');
    out.push('      </dive>');
  }

  out.push('    </repetitiongroup>');
  out.push('  </profiledata>');
  out.push('</uddf>');

  // Cosa resta fuori. Dichiararlo è parte dell'export: chi usa questo file come
  // backup deve sapere che non è una copia completa dell'archivio.
  const omitted: string[] = [];
  if (sorted.some((d) => d.computer?.gfLow !== undefined)) {
    omitted.push('i gradient factor impostati sul computer (UDDF non li prevede)');
  }
  if (sorted.some((d) => d.samples?.some((s) => s.ceiling !== undefined || s.ndlS !== undefined))) {
    omitted.push('tetto di decompressione, NDL e TTS campione per campione');
  }
  if (sorted.some((d) => d.extraSources?.length)) {
    omitted.push('la provenienza multipla delle immersioni fuse da più computer');
  }
  if (sorted.some((d) => d.altSamples?.length)) {
    omitted.push('il secondo profilo, quello più fitto registrato dall’altro computer');
  }
  // L'elenco dichiarava quattro perdite su venti.
  //
  // Il modulo promette in testa di dichiarare quello che UDDF non sa
  // rappresentare, e il giro export→import ne perdeva molto di più in silenzio:
  // il tipo di circuito (un rebreather tornava a circuito aperto), il compagno,
  // la zavorra, la muta, la visibilità, i tag, il fuso del sito, la pressione di
  // superficie — che entra nel calcolo Bühlmann, quindi il backup non
  // ricostruiva nemmeno le saturazioni. Un elenco incompleto è peggio di nessun
  // elenco: fa credere di sapere cosa si sta perdendo.
  const perde = <K extends keyof Dive>(key: K, label: string) => {
    if (sorted.some((d) => d[key] !== undefined && d[key] !== null)) omitted.push(label);
  };
  perde('mode', 'il tipo di circuito (un rebreather torna a circuito aperto)');
  perde('buddy', 'il compagno');
  perde('rating', 'la valutazione');
  perde('weightKg', 'la zavorra');
  perde('suit', 'la muta');
  perde('visibilityM', 'la visibilità');
  perde('utcOffsetMinutes', 'il fuso orario del sito (gli orari restano in UTC)');
  perde('surfacePressureBar', 'la pressione di superficie, che serve al calcolo della saturazione');
  perde('annotations', 'le annotazioni del logbook di origine');
  perde('reported', 'i valori di sintesi letti dal computer (GF99, TTS, NDL minimo)');
  perde('events', 'i segnalibri messi durante l’immersione');
  perde('otherComputers', 'le impostazioni degli altri computer che hanno registrato l’immersione');
  if (sorted.some((d) => d.tags?.length)) omitted.push('le etichette');
  if (sorted.some((d) => d.site?.region || d.site?.country)) omitted.push('regione e paese del sito');
  if (sorted.some((d) => d.cylinders?.some((c) => c.material || c.workPressureBar))) {
    omitted.push('materiale e pressione di esercizio delle bombole');
  }
  if (sorted.some((d) => d.samples?.some((s) => s.cns !== undefined || s.ppo2 !== undefined))) {
    omitted.push('CNS, PPO2, setpoint e battito campione per campione');
  }
  if (sorted.some((d) => d.computer?.model)) {
    omitted.push('modello, matricola e impostazioni del computer subacqueo');
  }
  if (!includeProfiles) omitted.push('i profili campionati, esclusi su richiesta');

  return { xml: out.join('\n'), dives: sorted.length, omitted };
}
