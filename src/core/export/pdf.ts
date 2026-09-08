/**
 * Il PDF della scheda immersione, scritto a mano.
 *
 * ► PERCHÉ ESISTE, VISTO CHE C'È GIÀ LA STAMPA. ◄ Perché la stampa **su iPhone
 * non c'è**. Sul Mac apriamo un documento HTML e passiamo la parola alla
 * finestra di stampa del sistema, che sa fare i PDF meglio di chiunque; dentro
 * una WKWebView non esiste nessuna finestra di stampa e `window.open`
 * restituisce `null`. Il risultato era che il foglio da mandare a chi lo chiede
 * — un centro, un istruttore, un'assicurazione — si poteva fare solo dal
 * computer di casa, cioè nel momento sbagliato: quello giusto è in barca,
 * cinque minuti dopo l'immersione.
 *
 * ► PERCHÉ SENZA LIBRERIA. ◄ Le stesse tre ragioni per cui la stampa non usa
 * jsPDF, più una nuova. Una dipendenza in più da spedire e da mantenere per
 * sempre; i font che si porterebbe dietro; e il fatto che un logbook deve
 * sopravvivere agli anni. La nuova: qui serve una cosa piccola e prevedibile —
 * testo, righe e una spezzata — e per quella un generatore di duecento righe è
 * più facile da capire di una libreria da mezzo megabyte. È la stessa scelta
 * fatta per SQLite e per gzip, e ha retto.
 *
 * ► IL TRUCCO CHE RENDE TUTTO SEMPLICE: IL PDF ESCE IN ASCII PURO. ◄ Niente
 * compressione, niente font incorporati, niente byte fuori dai 127. I caratteri
 * accentati diventano sequenze ottali dentro le stringhe (`\350` per la è), che
 * è una forma prevista dal formato. Due conseguenze pratiche, e sono il motivo
 * della scelta:
 *
 *  - la lunghezza in caratteri COINCIDE con la lunghezza in byte, quindi la
 *    tabella degli offset — l'unica parte del formato dove un errore rende il
 *    file illeggibile — si calcola contando caratteri;
 *  - il file si può passare come STRINGA a `esporta()`, che su iPhone lo scrive
 *    attraverso il guscio Rust. Un PDF con byte binari andrebbe codificato in
 *    base64 e servirebbe un comando nuovo dall'altra parte.
 *
 * ► I FONT SONO QUELLI DEL LETTORE. ◄ Helvetica e Helvetica-Bold fanno parte
 * dei quattordici caratteri che ogni lettore PDF deve avere: non si incorpora
 * niente, il file pesa una decina di chilobyte e si apre uguale ovunque. Il
 * prezzo, dichiarato: senza le tabelle delle larghezze non si può misurare il
 * testo, quindi il testo lungo si TRONCA a un numero di caratteri prudente
 * invece di andare a capo da solo. Su una scheda di logbook — nomi di siti,
 * miscele, numeri — si vede solo sulle note lunghe, che infatti vanno a capo a
 * mano.
 */

import type { Dive, Sample } from '../model';
import { libretto, type Subacqueo } from '../libretto';
import { firmaVuota, type FirmaGuida } from '../firma';
import { formatDuration } from '../units';
import type { FoglioPiano } from './planPrint';

/** A4 in punti tipografici, arrotondato: il PDF misura tutto in questa unità. */
const LARGHEZZA = 595;
const ALTEZZA = 842;
const MARGINE = 48;

/**
 * Da carattere a byte WinAnsi, per quelli che servono all'italiano.
 *
 * Non è una tabella completa e non deve esserlo: copre le lettere accentate, le
 * virgolette tipografiche, il grado e il trattino lungo — cioè tutto quello che
 * questa applicazione scrive davvero. Quello che non c'è diventa un punto
 * interrogativo, che è brutto ma onesto: meglio di un byte a caso che rende
 * illeggibile una riga.
 */
const WINANSI: Record<string, number> = {
  à: 0xe0,
  á: 0xe1,
  â: 0xe2,
  ä: 0xe4,
  è: 0xe8,
  é: 0xe9,
  ê: 0xea,
  ë: 0xeb,
  ì: 0xec,
  í: 0xed,
  î: 0xee,
  ï: 0xef,
  ò: 0xf2,
  ó: 0xf3,
  ô: 0xf4,
  ö: 0xf6,
  ù: 0xf9,
  ú: 0xfa,
  û: 0xfb,
  ü: 0xfc,
  ç: 0xe7,
  ñ: 0xf1,
  À: 0xc0,
  È: 0xc8,
  É: 0xc9,
  Ì: 0xcc,
  Ò: 0xd2,
  Ù: 0xd9,
  '°': 0xb0,
  '·': 0xb7,
  '—': 0x97,
  '–': 0x96,
  '’': 0x92,
  '‘': 0x91,
  '“': 0x93,
  '”': 0x94,
  '«': 0xab,
  '»': 0xbb,
  '€': 0x80,
  '…': 0x85,
};

/**
 * Le larghezze di Helvetica, in millesimi di corpo.
 *
 * ► SONO ARRIVATE DOPO, E IL COMMENTO IN TESTA DICEVA CHE NON C'ERANO. ◄ La
 * nota sopra dichiarava il prezzo dei font non incorporati: «senza le tabelle
 * delle larghezze non si può misurare il testo, quindi il testo lungo si TRONCA
 * a un numero di caratteri prudente». Per la scheda di un'immersione — etichetta
 * a sinistra, valore a destra — bastava. **Per il foglio del piano no**: lì ci
 * sono tabelle di numeri, e una colonna di bar allineata a sinistra si legge
 * male esattamente nel momento in cui la si legge male, cioè in barca con le
 * mani bagnate e il foglio piegato in quattro.
 *
 * Sono le metriche pubblicate del font, quelle dei file AFM che Adobe distribuisce
 * dal 1985: non misure nostre, e non cambiano. Quello che manca dalla tabella
 * prende la larghezza della `n` — sbagliare di poco un carattere raro sposta un
 * millimetro, non conoscere nessuna larghezza costa la colonna intera.
 *
 * *La scheda dell'immersione continua a troncare per caratteri: cambiare anche
 * quella vorrebbe dire rifare un'impaginazione che funziona, in una versione in
 * cui il lavoro è un altro. Adesso però è un residuo, non un limite.*
 */
const LARGHEZZE: Record<string, number> = {
  ' ': 278,
  '!': 278,
  '"': 355,
  '#': 556,
  $: 556,
  '%': 889,
  '&': 667,
  "'": 191,
  '(': 333,
  ')': 333,
  '*': 389,
  '+': 584,
  ',': 278,
  '-': 333,
  '.': 278,
  '/': 278,
  '0': 556,
  '1': 556,
  '2': 556,
  '3': 556,
  '4': 556,
  '5': 556,
  '6': 556,
  '7': 556,
  '8': 556,
  '9': 556,
  ':': 278,
  ';': 278,
  '<': 584,
  '=': 584,
  '>': 584,
  '?': 556,
  '@': 1015,
  A: 667,
  B: 667,
  C: 722,
  D: 722,
  E: 667,
  F: 611,
  G: 778,
  H: 722,
  I: 278,
  J: 500,
  K: 667,
  L: 556,
  M: 833,
  N: 722,
  O: 778,
  P: 667,
  Q: 778,
  R: 722,
  S: 667,
  T: 611,
  U: 722,
  V: 667,
  W: 944,
  X: 667,
  Y: 667,
  Z: 611,
  '[': 278,
  '\\': 278,
  ']': 278,
  '^': 469,
  _: 556,
  '`': 333,
  a: 556,
  b: 556,
  c: 500,
  d: 556,
  e: 556,
  f: 278,
  g: 556,
  h: 556,
  i: 222,
  j: 222,
  k: 500,
  l: 222,
  m: 833,
  n: 556,
  o: 556,
  p: 556,
  q: 556,
  r: 333,
  s: 500,
  t: 278,
  u: 556,
  v: 500,
  w: 722,
  x: 500,
  y: 500,
  z: 500,
  '{': 334,
  '|': 260,
  '}': 334,
  '~': 584,
  // Gli accenti hanno la larghezza della lettera di base: è come il font li
  // disegna davvero, non un'approssimazione.
  à: 556,
  á: 556,
  â: 556,
  ä: 556,
  è: 556,
  é: 556,
  ê: 556,
  ë: 556,
  ì: 278,
  í: 278,
  î: 278,
  ï: 278,
  ò: 556,
  ó: 556,
  ô: 556,
  ö: 556,
  ù: 556,
  ú: 556,
  û: 556,
  ü: 556,
  ç: 500,
  ñ: 556,
  À: 667,
  È: 667,
  É: 667,
  Ì: 278,
  Ò: 778,
  Ù: 722,
  '«': 556,
  '»': 556,
  '’': 222,
  '‘': 222,
  '“': 333,
  '”': 333,
  '—': 1000,
  '–': 556,
  '…': 1000,
  '°': 400,
  '·': 278,
  '€': 556,
};

/** Larghezza di un testo in punti tipografici, al corpo dato. */
export function larghezzaTesto(valore: string, corpo: number): number {
  let mille = 0;
  for (const carattere of valore) mille += LARGHEZZE[carattere] ?? LARGHEZZE.n;
  return (mille / 1000) * corpo;
}

/** Manda a capo misurando davvero, invece di contare i caratteri. */
function aCapoMisurato(valore: string, corpo: number, larghezza: number): string[] {
  const righe: string[] = [];
  for (const paragrafo of valore.split(/\n+/)) {
    let corrente = '';
    for (const parola of paragrafo.split(/\s+/).filter(Boolean)) {
      const prova = corrente ? `${corrente} ${parola}` : parola;
      if (corrente && larghezzaTesto(prova, corpo) > larghezza) {
        righe.push(corrente);
        corrente = parola;
      } else {
        corrente = prova;
      }
    }
    if (corrente) righe.push(corrente);
  }
  return righe;
}

/**
 * Una stringa PDF: parentesi, barre e accenti messi in salvo.
 *
 * Le parentesi delimitano le stringhe nel formato: una non chiusa dentro il
 * testo — «Camogli (Dragone» — sposta la fine della stringa e rompe tutto il
 * resto della pagina. È il difetto classico di chi scrive PDF a mano.
 */
function testoPdf(valore: string): string {
  let fuori = '';
  for (const carattere of valore) {
    if (carattere === '(' || carattere === ')' || carattere === '\\') {
      fuori += '\\' + carattere;
      continue;
    }
    const codice = carattere.codePointAt(0) ?? 63;
    if (codice >= 32 && codice <= 126) {
      fuori += carattere;
      continue;
    }
    const winansi = WINANSI[carattere];
    fuori += winansi === undefined ? '?' : '\\' + winansi.toString(8).padStart(3, '0');
  }
  return fuori;
}

/** Tronca senza spezzare a metà una parola, quando può. */
function accorcia(valore: string, massimo: number): string {
  if (valore.length <= massimo) return valore;
  const tagliato = valore.slice(0, massimo - 1);
  const spazio = tagliato.lastIndexOf(' ');
  return (spazio > massimo * 0.6 ? tagliato.slice(0, spazio) : tagliato) + '…';
}

/** Un pezzo di contenuto della pagina. Si accumulano e si concatenano. */
type Comandi = string[];

function scrivi(c: Comandi, x: number, y: number, testo: string, corpo = 9, grassetto = false): void {
  if (!testo) return;
  c.push(
    'BT',
    `/${grassetto ? 'FB' : 'FR'} ${corpo} Tf`,
    `1 0 0 1 ${x} ${y} Tm`,
    `(${testoPdf(testo)}) Tj`,
    'ET',
  );
}

/**
 * Come `scrivi`, ma ancorato a DESTRA: `x` è dove finisce il testo.
 *
 * Serve alle colonne numeriche del piano. È una funzione a parte e non un
 * parametro in più su `scrivi` perché quella firma la usano trenta chiamate
 * della scheda immersione, e un parametro opzionale in mezzo è il posto dove
 * un giorno qualcuno passa il corpo al posto dell'allineamento.
 */
function scriviADestra(c: Comandi, x: number, y: number, testo: string, corpo = 9, grassetto = false): void {
  scrivi(c, x - larghezzaTesto(testo, corpo), y, testo, corpo, grassetto);
}

function riga(c: Comandi, x1: number, y1: number, x2: number, y2: number, spessore = 0.5): void {
  c.push(`${spessore} w`, `${x1} ${y1} m`, `${x2} ${y2} l`, 'S');
}

function grigio(c: Comandi, valore: number): void {
  c.push(`${valore} g`, `${valore} G`);
}

/**
 * Il profilo, come spezzata.
 *
 * Stesso disegno della stampa e della scheda, con la profondità che cresce
 * verso il basso: un profilo capovolto è la prima cosa che un subacqueo nota, e
 * l'ultima di cui perdona l'errore.
 */
function profilo(c: Comandi, samples: Sample[], x: number, y: number, w: number, h: number): void {
  grigio(c, 0.85);
  c.push(`${x} ${y} ${w} ${h} re`, 'S');
  if (samples.length < 2) {
    grigio(c, 0.55);
    scrivi(c, x + 8, y + h / 2, 'Nessun profilo registrato per questa immersione', 8);
    grigio(c, 0);
    return;
  }
  const tMax = Math.max(...samples.map((s) => s.t)) || 1;
  const dMax = Math.max(...samples.map((s) => s.depth)) || 1;
  grigio(c, 0.1);
  c.push('1 w');
  samples.forEach((s, i) => {
    const px = x + (s.t / tMax) * w;
    const py = y + h - (s.depth / dMax) * h;
    c.push(`${px.toFixed(1)} ${py.toFixed(1)} ${i === 0 ? 'm' : 'l'}`);
  });
  c.push('S');
  grigio(c, 0.45);
  scrivi(c, x + 4, y + h - 11, `0 m`, 7);
  scrivi(c, x + 4, y + 5, `${dMax.toFixed(1)} m`, 7);
  grigio(c, 0);
}

/** La firma, se c'è: gli stessi tratti, ridisegnati nello spazio del foglio. */
function segnoFirma(c: Comandi, firma: FirmaGuida, x: number, y: number, w: number, h: number): void {
  const k = Math.min(w / (firma.larghezza || 1), h / (firma.altezza || 1));
  grigio(c, 0.05);
  c.push('1.2 w');
  for (const tratto of firma.tratti) {
    tratto.forEach((p, i) => {
      const px = x + p.x * k;
      // Le y del riquadro di firma crescono verso il basso, quelle del PDF no.
      const py = y + h - p.y * k;
      c.push(`${px.toFixed(1)} ${py.toFixed(1)} ${i === 0 ? 'm' : 'l'}`);
    });
    c.push('S');
  }
  grigio(c, 0);
}

/** Bombole e pressioni in una riga sola. */
function bombole(dive: Dive): string {
  const pezzi = (dive.cylinders ?? []).map((b) => {
    const misura = b.sizeL ? `${b.sizeL} L` : (b.description ?? '');
    // NIENTE FRECCIA. Le quattordici famiglie di Helvetica non hanno il glifo
    // «→»: la tabella WinAnsi qui sopra non può convertirlo e sul foglio
    // usciva «210?60 bar», che sembra un errore di lettura del computer. Le
    // due preposizioni costano quattro caratteri e si leggono ad alta voce.
    const pressioni = b.startBar && b.endBar ? `da ${b.startBar} a ${b.endBar} bar` : '';
    /*
     * L'analisi va sul foglio che consegni, ed è il posto dove serve di più:
     * chi te lo chiede — un centro, un istruttore — vuole sapere che il gas
     * l'hai verificato, non che c'era scritto sull'adesivo.
     */
    const analisi = b.analisi ? `(${Math.round(b.analisi.o2 * 100)}% analizzato)` : '';
    return [misura, pressioni, analisi].filter(Boolean).join(' ');
  });
  return pezzi.filter(Boolean).join(' · ') || '—';
}

/**
 * Da dove viene questa immersione: la fusione dichiarata, non nascosta.
 *
 * Le etichette leggibili dei formati stanno in `ui/format.ts` e il nucleo non
 * può importare dall'interfaccia — è la regola che tiene `core` compilabile
 * ovunque. Quindi si accetta la mappa da fuori e, quando non c'è, si scrive la
 * sigla grezza: brutta ma vera, invece di niente.
 */
function provenienza(dive: Dive, etichette: Record<string, string>): string {
  const fonti = [dive.source, ...(dive.extraSources ?? [])]
    .filter((f): f is NonNullable<typeof f> => !!f)
    .map((f) => etichette[f.format] ?? f.format);
  return [...new Set(fonti)].join(' + ') || '—';
}

/** A capo contando i caratteri, senza spezzare le parole. */
function aCapo(testo: string, quanti: number): string[] {
  const righe: string[] = [];
  for (const paragrafo of testo.split(/\n+/)) {
    let corrente = '';
    for (const parola of paragrafo.split(/\s+/)) {
      if (corrente && (corrente + ' ' + parola).length > quanti) {
        righe.push(corrente);
        corrente = parola;
      } else {
        corrente = corrente ? corrente + ' ' + parola : parola;
      }
    }
    if (corrente) righe.push(corrente);
  }
  return righe;
}

export interface PdfOptions {
  subacqueo?: Subacqueo;
  /** Le etichette leggibili dei formati d'origine, che vivono nell'interfaccia. */
  etichetteFormato?: Record<string, string>;
  /** Istante di generazione, per rendere l'uscita ripetibile nei test. */
  now?: string;
}

/**
 * Una pagina per immersione, in un PDF solo.
 *
 * Restituisce una **stringa ASCII**: è già il contenuto del file, byte per
 * byte. Vedi la nota in testa a questo modulo.
 */
export function schedePdf(dives: Dive[], samplesById: Map<string, Sample[]>, opts: PdfOptions = {}): string {
  const ordinate = [...dives].sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime));
  const pagine = ordinate.map((d) => contenutoPagina(d, samplesById.get(d.id) ?? d.samples ?? [], opts));
  return assembla(pagine.length ? pagine : ['']);
}

function contenutoPagina(dive: Dive, samples: Sample[], opts: PdfOptions): string {
  const c: Comandi = [];
  const voci = libretto(dive, opts.subacqueo ?? {});
  let y = ALTEZZA - MARGINE;

  const luogo = [dive.site?.name, dive.site?.region, dive.site?.country].filter(Boolean).join(', ');
  scrivi(c, MARGINE, y, accorcia(luogo || 'Sito non indicato', 46), 17, true);
  y -= 18;
  grigio(c, 0.4);
  const quando = voci.find((v) => v.lettera === 'c')?.valore ?? '';
  const inizio = voci.find((v) => v.lettera === 'e')?.valore ?? '';
  scrivi(c, MARGINE, y, `${quando}${inizio ? ` · ore ${inizio}` : ''}`, 10);
  grigio(c, 0);
  y -= 10;
  riga(c, MARGINE, y, LARGHEZZA - MARGINE, y, 0.8);
  y -= 22;

  // I quattro numeri che si guardano per primi, in fila.
  const numeri: [string, string][] = [
    ['Profondità massima', `${dive.maxDepth.toFixed(1)} m`],
    ['Durata', formatDuration(dive.durationS)],
    ['Profondità media', dive.avgDepth === undefined ? '—' : `${dive.avgDepth.toFixed(1)} m`],
    ['Temperatura minima', dive.minTempC === undefined ? '—' : `${dive.minTempC.toFixed(1)} °C`],
  ];
  const passo = (LARGHEZZA - MARGINE * 2) / numeri.length;
  numeri.forEach(([etichetta, valore], i) => {
    const x = MARGINE + i * passo;
    grigio(c, 0.45);
    scrivi(c, x, y, etichetta, 8);
    grigio(c, 0);
    scrivi(c, x, y - 15, valore, 14, true);
  });
  y -= 40;

  profilo(c, samples, MARGINE, y - 150, LARGHEZZA - MARGINE * 2, 150);
  y -= 168;

  /*
   * IL LIBRETTO STA SU UNA COLONNA SOLA, e la ragione è un difetto visto sul
   * foglio stampato.
   *
   * Su due colonne ogni valore aveva novantasette punti di spazio, cioè
   * ventiquattro caratteri: «Autorespiratore a circuito aperto (ARA)» usciva
   * troncato proprio sull'acronimo, che è la parte che dice qualcosa, e la
   * località finiva in tre puntini. Su un documento che qualcuno controlla,
   * un dato tagliato vale meno di nessun dato: sembra che l'applicazione non
   * lo sappia, mentre lo sa e non ha saputo scriverlo.
   *
   * In colonna singola il valore ha tutta la larghezza del foglio, e le
   * tredici lettere si leggono in verticale nell'ordine della norma — che è
   * poi il modo in cui le scorre chi le sta cercando. Lo spazio c'era: la
   * metà bassa della pagina era bianca.
   */
  scrivi(c, MARGINE, y, 'Libretto delle immersioni', 11, true);
  grigio(c, 0.45);
  scrivi(c, MARGINE + 150, y, 'art. 12, comma 8 della legge 7 maggio 2026, n. 70', 8);
  grigio(c, 0);
  y -= 17;

  const PASSO = 14;
  voci.forEach((voce, i) => {
    const riy = y - i * PASSO;
    grigio(c, 0.45);
    scrivi(c, MARGINE, riy, `${voce.lettera})`, 8);
    scrivi(c, MARGINE + 14, riy, accorcia(voce.etichetta, 36), 8);
    grigio(c, 0);
    // Il filo di puntini fra etichetta e valore. Senza, su una riga larga
    // mezza pagina l'occhio perde la corrispondenza e legge il valore della
    // riga sopra: è il motivo per cui i moduli di carta lo hanno sempre avuto.
    grigio(c, 0.82);
    riga(c, MARGINE + 175, riy - 2, LARGHEZZA - MARGINE, riy - 2, 0.3);
    grigio(c, 0);
    scrivi(c, MARGINE + 180, riy, accorcia(voce.valore ?? '—', 72), 8, true);
  });
  y -= voci.length * PASSO + 20;

  /*
   * Il resto della scheda, sotto il libretto: quello che un subacqueo guarda e
   * che la legge non chiede. Sta DOPO apposta — il foglio serve prima a chi
   * controlla, poi a chi ricorda.
   */
  const dettagli: [string, string][] = [
    ['Compagno', dive.buddy ?? '—'],
    ['Acqua', dive.salinity === undefined ? '—' : dive.salinity === 'fresh' ? 'Dolce' : 'Salata'],
    ['Bombole', bombole(dive)],
    ['Muta', dive.gear?.suit?.name ?? dive.suit ?? '—'],
    ['Zavorra', dive.weightKg === undefined ? '—' : `${dive.weightKg} kg`],
    ['Provenienza', accorcia(provenienza(dive, opts.etichetteFormato ?? {}), 40)],
  ];
  scrivi(c, MARGINE, y, 'La scheda', 11, true);
  y -= 16;
  // Qui le due colonne restano: sono coppie brevi — «Zavorra», «6 kg» — e su
  // una colonna sola sprecherebbero mezza pagina per sei righe.
  const mezzo = (LARGHEZZA - MARGINE * 2) / 2;
  const metaDettagli = Math.ceil(dettagli.length / 2);
  dettagli.forEach(([etichetta, valore], i) => {
    const colonna = i < metaDettagli ? 0 : 1;
    const riy = y - (i % metaDettagli) * 13;
    const x = MARGINE + colonna * mezzo;
    grigio(c, 0.45);
    scrivi(c, x, riy, accorcia(etichetta, 30), 7.5);
    grigio(c, 0);
    scrivi(c, x + 152, riy, accorcia(valore, 24), 7.5, true);
  });
  y -= metaDettagli * 13 + 20;

  if (dive.notes) {
    scrivi(c, MARGINE, y, 'Note', 11, true);
    y -= 14;
    // A capo contando i caratteri: senza le tabelle delle larghezze non si può
    // misurare il testo, e novantacinque caratteri a corpo otto stanno dentro
    // il foglio con margine di sicurezza. Al massimo sei righe: una nota lunga
    // sta nell'applicazione, non su un foglio da firmare.
    for (const linea of aCapo(dive.notes, 95).slice(0, 6)) {
      scrivi(c, MARGINE, y, linea, 8);
      y -= 11;
    }
  }

  /*
   * Le firme stanno a un'altezza FISSA, in fondo alla pagina, e non dove
   * finisce il testo. Un foglio da firmare in cui la riga della firma si sposta
   * a seconda della lunghezza delle note sembra fatto male, e su una pila di
   * schede impilate si vede al primo colpo d'occhio.
   */
  const yFirme = MARGINE + 64;
  const larghezzaFirma = 200;
  if (!firmaVuota(dive.firmaGuida)) {
    segnoFirma(c, dive.firmaGuida!, MARGINE, yFirme + 4, larghezzaFirma, 40);
  }
  riga(c, MARGINE, yFirme, MARGINE + larghezzaFirma, yFirme, 0.6);
  grigio(c, 0.45);
  scrivi(c, MARGINE, yFirme - 11, 'Firma dell’istruttore o della guida', 8);
  riga(c, LARGHEZZA - MARGINE - larghezzaFirma, yFirme, LARGHEZZA - MARGINE, yFirme, 0.6);
  scrivi(c, LARGHEZZA - MARGINE - larghezzaFirma, yFirme - 11, 'Firma del subacqueo', 8);
  grigio(c, 0);

  // Il piede: da dove viene il foglio, che su un documento che gira serve.
  grigio(c, 0.55);
  scrivi(c, MARGINE, MARGINE - 14, 'MyDiveLog — mydivelog.site', 7);
  grigio(c, 0);

  return c.join('\n');
}

/**
 * ════════════════════════════════════════════════════════════════════════════
 * IL FOGLIO DEL PIANO, e perché sta in questo file e non in uno nuovo.
 *
 * Perché il PDF è **uno solo**: il generatore, la tabella degli offset, la
 * codifica degli accenti, il modo di scrivere una riga. Un secondo file
 * avrebbe voluto dire una seconda `assembla`, e la `xref` è la parte del
 * formato che non perdona — averne due copie significa che un giorno una delle
 * due si corregge e l'altra no.
 *
 * ► COSA RENDE, e cosa NON ridecide. ◄ Rende `FoglioPiano`, la stessa struttura
 * a sezioni che `planPrint.ts` trasforma in HTML: *quali* sezioni, in che
 * ordine e con che numeri lo decide `foglioDelPiano` nel pianificatore, una
 * volta sola per tutti e due i formati. Qui si decide solo come stanno sulla
 * carta. È la ragione per cui quella struttura era stata fatta generica, ed è
 * la prova che serviva a qualcosa.
 *
 * ► PERCHÉ SERVE, VISTO CHE LA STAMPA C'ERA. ◄ Perché la stampa c'era **solo
 * sui computer**. Su iPhone il pulsante non c'era del tutto; su Android c'era e
 * non funzionava. E il foglio del piano serve in barca, dove il computer di
 * casa non è: è la lavagnetta della didattica tecnica, e finora si poteva fare
 * solo nel posto in cui non serve.
 */
export function pianoPdf(f: FoglioPiano, opts: PdfOptions = {}): string {
  const pagine: Comandi[] = [];
  let c: Comandi = [];
  let y = 0;

  /*
   * L'IMPAGINAZIONE È IL PEZZO CHE LA STAMPA DI SISTEMA FACEVA GRATIS.
   *
   * Il browser sa dove finisce una pagina; qui bisogna saperlo noi. `spazio`
   * chiede se ci stanno ancora N punti e, se non ci stanno, chiude la pagina e
   * ne apre una nuova con la sua intestazione — perché una tabella di soste che
   * continua sul retro senza dire di che piano parla, in barca, è un foglio
   * anonimo.
   */
  const nuovaPagina = (continua: boolean) => {
    if (c.length) pagine.push(c);
    c = [];
    y = ALTEZZA - MARGINE;
    scrivi(c, MARGINE, y, accorcia(f.titolo, 52), continua ? 12 : 17, true);
    if (continua) {
      grigio(c, 0.45);
      scriviADestra(c, LARGHEZZA - MARGINE, y, 'segue', 9);
      grigio(c, 0);
    }
    y -= continua ? 12 : 18;
    if (!continua && f.sottotitolo) {
      grigio(c, 0.4);
      scrivi(c, MARGINE, y, accorcia(f.sottotitolo, 90), 10);
      grigio(c, 0);
      y -= 10;
    }
    riga(c, MARGINE, y, LARGHEZZA - MARGINE, y, 0.8);
    y -= 20;
  };

  /** Vero se ci stanno ancora `quanto` punti; altrimenti apre una pagina nuova. */
  const spazio = (quanto: number) => {
    if (y - quanto >= MARGINE + 70) return;
    nuovaPagina(true);
  };

  nuovaPagina(false);

  for (const s of f.sezioni) {
    if (!s.righe.length) continue;
    // Il titolo di una sezione non resta mai da solo in fondo alla pagina: si
    // chiede spazio per lui E per la prima riga.
    spazio(34);
    scrivi(c, MARGINE, y, s.titolo, 11, true);
    y -= s.descrizione ? 11 : 14;
    if (s.descrizione) {
      grigio(c, 0.45);
      for (const linea of aCapoMisurato(s.descrizione, 8, LARGHEZZA - 2 * MARGINE)) {
        scrivi(c, MARGINE, y, linea, 8);
        y -= 9;
      }
      grigio(c, 0);
      y -= 5;
    }

    const destra = new Set(s.numeriche ?? []);
    const forti = new Set(s.forti ?? []);
    const quante = Math.max(s.colonne?.length ?? 0, ...s.righe.map((r) => r.length));
    /*
     * LE COLONNE SI MISURANO SUL CONTENUTO, non si dividono in parti uguali.
     *
     * Una tabella con «Sosta» e «Profondità» larghe uguali spreca metà foglio
     * sulla prima e manda a capo la seconda. Si prende la voce più larga di
     * ogni colonna, intestazione compresa, e si distribuisce quello che avanza:
     * il risultato è la stessa impaginazione che fa il browser, calcolata a
     * mano perché qui il browser non c'è.
     */
    const larghezze = Array.from({ length: quante }, (_, i) =>
      Math.max(
        larghezzaTesto(s.colonne?.[i] ?? '', 8.5),
        ...s.righe.map((r) => larghezzaTesto(r[i] ?? '', 9)),
      ),
    );
    const disponibile = LARGHEZZA - 2 * MARGINE;
    const somma = larghezze.reduce((a, b) => a + b, 0) || 1;
    const spaziatura = 10;
    const utile = disponibile - spaziatura * (quante - 1);
    /*
     * ► LE COLONNE NON SI DISTENDONO SU TUTTA LA RIGA, ED È UNA SCELTA GUARDATA. ◄
     *
     * La prima versione le allargava fino al margine, come fa una tabella HTML
     * con `width: 100%`. Il foglio reso e guardato diceva un'altra cosa: la
     * colonna «Minuti» finiva in mezzo alla pagina, lontanissima dalla sua
     * intestazione e dai metri a cui si riferisce, e per leggere una riga
     * l'occhio doveva attraversare cinque centimetri di bianco. *Su un foglio
     * piegato in quattro, tenuto con una mano, quel viaggio è esattamente dove
     * si sbaglia riga.*
     *
     * Le colonne restano larghe quanto il loro contenuto e il bianco resta a
     * destra, dove non disturba. Si riducono solo se sforano: un testo che esce
     * dal margine è sempre peggio di un testo stretto.
     */
    const scala = Math.min(1, utile / somma);
    const finali = larghezze.map((l) => l * scala);
    const x = (i: number) => MARGINE + finali.slice(0, i).reduce((a, b) => a + b, 0) + spaziatura * i;

    if (s.colonne?.length) {
      grigio(c, 0.45);
      for (let i = 0; i < quante; i++) {
        const testo = s.colonne[i] ?? '';
        if (destra.has(i)) scriviADestra(c, x(i) + finali[i], y, testo, 8.5);
        else scrivi(c, x(i), y, testo, 8.5);
      }
      grigio(c, 0);
      y -= 4;
      riga(c, MARGINE, y, LARGHEZZA - MARGINE, y, 0.4);
      y -= 11;
    }

    for (const [indice, r] of s.righe.entries()) {
      spazio(16);
      const forte = forti.has(indice);
      if (forte) {
        // Una sosta obbligatoria non è una riga come le altre, e su carta
        // bagnata il grassetto da solo non basta: la fascia si vede da lontano.
        grigio(c, 0.92);
        c.push(`${MARGINE - 4} ${y - 3.5} ${disponibile + 8} 13 re`, 'f');
        grigio(c, 0);
      }
      for (let i = 0; i < quante; i++) {
        const testo = r[i] ?? '';
        if (destra.has(i)) scriviADestra(c, x(i) + finali[i], y, testo, 9, forte);
        else scrivi(c, x(i), y, accorcia(testo, 60), 9, forte);
      }
      y -= 13;
    }
    y -= 10;
  }

  for (const a of f.avvisi ?? []) {
    spazio(30);
    /*
     * GLI AVVISI SI VEDONO ANCHE IN BIANCO E NERO. Un foglio stampato in barca
     * esce da una stampante che il colore non ce l'ha, e comunque il PDF qui
     * dentro è tutto in scala di grigi: il livello lo dice la PAROLA, non la
     * tinta. «Attenzione» e «Critico» si leggono anche fotocopiati.
     */
    const etichetta = a.livello === 'critical' ? 'CRITICO' : a.livello === 'warning' ? 'ATTENZIONE' : 'NOTA';
    const righe = aCapoMisurato(a.testo, 9, disponibileAvviso());
    grigio(c, 0.9);
    c.push(
      `${MARGINE - 4} ${y - 4 - (righe.length - 1) * 11} ${LARGHEZZA - 2 * MARGINE + 8} ${righe.length * 11 + 6} re`,
      'f',
    );
    grigio(c, 0);
    scrivi(c, MARGINE, y, etichetta, 8, true);
    for (const [i, linea] of righe.entries()) {
      scrivi(c, MARGINE + 62, y - i * 11, linea, 9);
    }
    y -= righe.length * 11 + 8;
  }

  if (f.note) {
    spazio(30);
    scrivi(c, MARGINE, y, 'Note', 11, true);
    y -= 14;
    for (const linea of aCapoMisurato(f.note, 9, LARGHEZZA - 2 * MARGINE)) {
      spazio(12);
      scrivi(c, MARGINE, y, linea, 9);
      y -= 11;
    }
    y -= 8;
  }

  /*
   * ► LE FIRME E L'AVVERTENZA STANNO SULL'ULTIMA PAGINA, IN FONDO. ◄
   *
   * Le firme perché un piano di decompressione si controlla in due prima di
   * entrare: è la procedura, non una gentilezza, e su carta la traccia si fa
   * con la penna. L'avvertenza perché **il foglio gira senza lo schermo che lo
   * ha prodotto**: chi lo raccoglie in barca deve leggere lì sopra che un piano
   * non sostituisce il computer, non doverselo ricordare.
   */
  const yFirme = MARGINE + 58;
  const terzo = (LARGHEZZA - 2 * MARGINE - 24) / 3;
  const etichette = ['Pianificato da', 'Controllato da', 'Data e ora d’ingresso'];
  for (const [i, etichetta] of etichette.entries()) {
    const x0 = MARGINE + i * (terzo + 12);
    riga(c, x0, yFirme, x0 + terzo, yFirme, 0.6);
    grigio(c, 0.45);
    scrivi(c, x0, yFirme - 11, etichetta, 8);
    grigio(c, 0);
  }
  grigio(c, 0.5);
  const avvertenza =
    'Calcolato da MyDiveLog. Un piano non sostituisce il computer subacqueo, e le soste ' +
    'qui sopra valgono per il profilo scritto: se in acqua vai più giù o resti di più, ' +
    'il piano che conta è quello che il computer ricalcola sul momento.';
  let yAvv = MARGINE + 26;
  for (const linea of aCapoMisurato(avvertenza, 7.5, LARGHEZZA - 2 * MARGINE)) {
    scrivi(c, MARGINE, yAvv, linea, 7.5);
    yAvv -= 9;
  }
  const quando = opts.now ?? f.now;
  scrivi(
    c,
    MARGINE,
    MARGINE - 14,
    `MyDiveLog — mydivelog.site${quando ? ` — ${quando.slice(0, 16).replace('T', ' ')}` : ''}`,
    7,
  );
  grigio(c, 0);

  pagine.push(c);
  return assembla(pagine.map((p) => p.join('\n')));
}

/** La larghezza utile per il testo di un avviso, che rientra dopo l'etichetta. */
function disponibileAvviso(): number {
  return LARGHEZZA - 2 * MARGINE - 62;
}

/**
 * Gli oggetti, la tabella degli offset e il rimando finale.
 *
 * La `xref` è l'unica parte del formato in cui un errore non si vede a metà: o
 * il lettore apre il file, o dice che è corrotto. Gli offset sono conteggi di
 * caratteri, ed è per questo che tutto qui dentro resta ASCII.
 */
function assembla(pagine: string[]): string {
  const oggetti: string[] = [];
  const numeroPagine = pagine.length;

  // 1 catalogo, 2 albero delle pagine, 3 e 4 i font, poi due oggetti per pagina.
  const idPagina = (i: number) => 5 + i * 2;
  const idContenuto = (i: number) => 6 + i * 2;

  oggetti.push('<< /Type /Catalog /Pages 2 0 R >>');
  oggetti.push(
    `<< /Type /Pages /Count ${numeroPagine} /Kids [${pagine.map((_, i) => `${idPagina(i)} 0 R`).join(' ')}] >>`,
  );
  oggetti.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  oggetti.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');

  pagine.forEach((contenuto, i) => {
    oggetti.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${LARGHEZZA} ${ALTEZZA}] ` +
        `/Resources << /Font << /FR 3 0 R /FB 4 0 R >> >> /Contents ${idContenuto(i)} 0 R >>`,
    );
    oggetti.push(`<< /Length ${contenuto.length} >>\nstream\n${contenuto}\nendstream`);
  });

  let fuori = '%PDF-1.4\n';
  const offset: number[] = [];
  oggetti.forEach((corpo, i) => {
    offset.push(fuori.length);
    fuori += `${i + 1} 0 obj\n${corpo}\nendobj\n`;
  });

  const inizioXref = fuori.length;
  fuori += `xref\n0 ${oggetti.length + 1}\n0000000000 65535 f \n`;
  for (const o of offset) fuori += `${String(o).padStart(10, '0')} 00000 n \n`;
  fuori += `trailer\n<< /Size ${oggetti.length + 1} /Root 1 0 R >>\nstartxref\n${inizioXref}\n%%EOF\n`;
  return fuori;
}
