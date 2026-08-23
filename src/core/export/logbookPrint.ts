/**
 * Stampa del logbook: un fascicolo di carta, una pagina per immersione.
 *
 * PERCHÉ ESISTE, VISTO CHE C'È GIÀ L'EXPORT UDDF. Perché l'UDDF è per le
 * macchine. È il formato giusto per portare l'archivio dentro un altro programma,
 * ed è quello che questa applicazione esporta da sempre — ma davanti a un
 * istruttore che deve controfirmare un'immersione, o a un centro che chiede il
 * libretto per validare un brevetto, un file XML non vale niente. Quello che serve
 * lì è un foglio: intestazione leggibile, i numeri della singola immersione, il
 * disegno del profilo e uno spazio bianco dove passare la penna. Lo spazio per la
 * firma e il timbro non è un ornamento in fondo alla pagina: è il motivo per cui
 * questo modulo esiste, e il resto della pagina è ciò che rende quella firma
 * sensata.
 *
 * PERCHÉ HTML PER LA STAMPA E NON UNA LIBRERIA PDF. La strada breve sarebbe stata
 * aggiungere jsPDF, o far girare un browser headless. Costa in tre modi, e nessuno
 * dei tre si vede il primo giorno:
 *
 *  - **una dipendenza in più da mantenere e da spedire.** Un logbook deve
 *    sopravvivere agli anni: ogni pacchetto che entra è una cosa che può smettere
 *    di compilare fra due versioni di Node, e per un'app che deve girare identica
 *    su desktop, iOS e web è peso morto dentro il bundle.
 *  - **i font.** Una libreria PDF disegna con i font che si è portata dietro, e
 *    l'italiano stampato bene vuole gli accenti giusti e una crenatura decente.
 *    Il documento HTML usa i font di SISTEMA: su un Mac esce con San Francisco,
 *    che è esattamente ciò che l'utente si aspetta di vedere uscire dalla sua
 *    stampante.
 *  - **l'anteprima.** Con una libreria si genera un PDF alla cieca e poi lo si
 *    apre per scoprire dove è andato a capo. Aprendo invece un documento pensato
 *    per la stampa, l'anteprima è quella VERA del sistema operativo, con i suoi
 *    margini, la sua scelta del formato carta e — su macOS — «Esporta come PDF»
 *    dalla stessa finestra di stampa. Il PDF lo fa il sistema, che lo sa fare
 *    meglio di noi e lo saprà fare ancora fra dieci anni.
 *
 * Il prezzo di questa scelta è che l'impaginazione dipende da `@page` e da
 * `@media print`, cioè da CSS che in fase di sviluppo non si vede mai a schermo. Per
 * questo l'interruzione di pagina è dichiarata due volte (`break-after` moderno e
 * `page-break-after` storico) e i colori del profilo sono forzati con
 * `print-color-adjust: exact`: senza, i browser tolgono i fondi in stampa e il
 * disegno del profilo esce vuoto.
 *
 * FUNZIONI PURE. Tutto qui dentro prende dati e restituisce stringhe: nessun DOM,
 * nessun React, nessuna finestra. È ciò che rende verificabile la struttura del
 * documento — quante pagine, che cosa c'è scritto, se l'escape ha funzionato —
 * senza montare niente. Chi apre la finestra e chiama `print()` è la UI, e lo fa
 * in due righe.
 *
 * SICUREZZA. Sito, compagno, note, muta ed etichette sono campi liberi: dentro ci
 * può stare qualunque cosa, comprese immersioni importate da file altrui. Ogni
 * singolo pezzo di testo passa da `escapeHtml` prima di entrare nel documento. Non
 * è paranoia astratta: una nota che contiene `<script>` deve comparire STAMPATA,
 * come l'utente l'ha scritta, e non essere eseguita dalla finestra che apriamo.
 */

import type { Cylinder, Dive, Sample } from '../model';
import { formatDuration, mixName } from '../units';
import { modeLabel } from '../analysis/aggregate';
import { condizioniTesto, visibilitaTesto } from '../conditions';
import { zavorraTotaleKg, type Equipment } from '../analysis/gear';
import { libretto, type Subacqueo } from '../libretto';

// ---------------------------------------------------------------------------
// Escape
// ---------------------------------------------------------------------------

/**
 * Sfugge i cinque caratteri che contano in HTML.
 *
 * Anche l'apice e la virgoletta, che nel corpo del testo sarebbero innocui: qui
 * dentro alcune stringhe finiscono dentro attributi (il titolo del documento, il
 * `<title>` dell'SVG), e una regola sola applicata ovunque è l'unica che non si
 * dimentica nel punto sbagliato.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Comodità: sfugge solo se il valore c'è, altrimenti la lineetta. */
const opz = (value: string | undefined | null): string =>
  value === undefined || value === null || value === '' ? '—' : escapeHtml(value);

/** Numero con un numero fisso di decimali, o lineetta se non c'è. */
const num = (v: number | undefined, digits = 1, unit = ''): string =>
  v === undefined || !Number.isFinite(v) ? '—' : `${v.toFixed(digits)}${unit ? ' ' + unit : ''}`;

/** Numero per l'SVG: pochi decimali, niente notazione esponenziale. */
const sv = (v: number): string => String(Number(v.toFixed(2)));

// ---------------------------------------------------------------------------
// Date e ore nel fuso del LUOGO
// ---------------------------------------------------------------------------

/**
 * I nomi dei mesi e dei giorni scritti a mano invece di `toLocaleDateString`.
 *
 * Non è diffidenza verso l'internazionalizzazione: è che questo modulo deve
 * produrre lo stesso identico foglio ovunque giri, e `toLocaleDateString` dipende
 * dai dati ICU compilati dentro il runtime. Un Node senza ICU completo stampa
 * «June» su un logbook italiano, e un test che ci gira sopra passa o fallisce a
 * seconda di come è stato costruito l'interprete. Dodici parole scritte qui
 * costano meno di quella incertezza.
 */
const MESI = [
  'gennaio',
  'febbraio',
  'marzo',
  'aprile',
  'maggio',
  'giugno',
  'luglio',
  'agosto',
  'settembre',
  'ottobre',
  'novembre',
  'dicembre',
];
const GIORNI = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];

/**
 * Sposta l'istante nel fuso del SITO e lo legge in UTC.
 *
 * È la stessa regola del resto dell'applicazione, e per un foglio stampato conta
 * ancora di più: l'ora di un'immersione è quella che il computer subacqueo
 * mostrava sott'acqua. Un'immersione delle 9 del mattino alle Maldive stampata
 * come «06:00» perché il foglio è stato generato in Italia sarebbe semplicemente
 * un dato sbagliato su un documento che qualcuno controfirma. Senza fuso
 * dichiarato si legge in UTC, mai nel fuso della macchina che stampa.
 */
function nelFusoDelSito(iso: string, offsetMinutes?: number): Date {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return new Date(NaN);
  return new Date(ms + (offsetMinutes ?? 0) * 60_000);
}

/** «domenica 14 giugno 2026», nel fuso del sito. */
export function dataLunga(iso: string, offsetMinutes?: number): string {
  const d = nelFusoDelSito(iso, offsetMinutes);
  if (Number.isNaN(d.getTime())) return 'data sconosciuta';
  return `${GIORNI[d.getUTCDay()]} ${d.getUTCDate()} ${MESI[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** «09:38», nel fuso del sito. */
export function oraLocale(iso: string, offsetMinutes?: number): string {
  const d = nelFusoDelSito(iso, offsetMinutes);
  if (Number.isNaN(d.getTime())) return '—';
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

/**
 * «UTC+3» — sul foglio si scrive SEMPRE quando il fuso è noto.
 *
 * A schermo l'etichetta viene nascosta se coincide con il fuso di chi guarda, che
 * ha senso: chi guarda è uno solo e sa dove si trova. Un foglio stampato invece
 * non sa chi lo leggerà né dove né quando, e «09:38» senza altra indicazione è
 * ambiguo per chiunque non fosse su quella barca.
 */
export function etichettaFuso(offsetMinutes: number | undefined): string | undefined {
  if (offsetMinutes === undefined) return undefined;
  const segno = offsetMinutes < 0 ? '-' : '+';
  const abs = Math.abs(offsetMinutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `UTC${segno}${h}${m ? ':' + String(m).padStart(2, '0') : ''}`;
}

// ---------------------------------------------------------------------------
// Il profilo, disegnato in SVG
// ---------------------------------------------------------------------------

export interface ProfiloSvgOptions {
  /** Larghezza del `viewBox`. Non sono pixel: l'SVG si adatta alla colonna. */
  width?: number;
  height?: number;
  /**
   * Fondo scala dell'asse verticale, metri. Passandolo uguale su più immersioni
   * i profili diventano confrontabili a occhio sfogliando il fascicolo.
   */
  maxDepthM?: number;
  /** Descrizione per chi legge con uno screen reader il documento a schermo. */
  title?: string;
}

/**
 * Il profilo dell'immersione come SVG in linea, ricostruito dai campioni.
 *
 * È il disegno che rende un logbook riconoscibile: la forma del tuffo si legge in
 * un colpo d'occhio molto prima dei numeri, e un foglio senza profilo sembra una
 * ricevuta. L'asse verticale è invertito — zero in alto, il fondo in basso — perché
 * è così che un subacqueo legge un'immersione.
 *
 * SVG in linea e non un `<img>`: il documento deve restare un file solo, apribile
 * e stampabile senza rete e senza allegati, e i vettori escono nitidi a qualunque
 * risoluzione di stampa, cosa che un PNG rasterizzato a schermo non fa.
 *
 * Restituisce la stringa vuota quando i campioni non bastano a disegnare
 * qualcosa di vero (meno di due punti, o tutti allo stesso istante). Chi chiama
 * deve scrivere che il profilo non c'è: inventarne uno rettangolare da profondità
 * media e durata sarebbe un disegno plausibile e falso, e su un foglio che
 * qualcuno controfirma è esattamente ciò che non si può fare.
 */
export function diveProfileSvg(samples: Sample[], opts: ProfiloSvgOptions = {}): string {
  const punti = samples.filter((s) => Number.isFinite(s?.t) && Number.isFinite(s?.depth));
  if (punti.length < 2) return '';

  const W = opts.width ?? 660;
  const H = opts.height ?? 210;
  const pad = { top: 12, right: 12, bottom: 24, left: 36 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;

  const t0 = punti[0].t;
  const tMax = Math.max(...punti.map((s) => s.t)) - t0;
  if (tMax <= 0) return '';

  const dMisurata = Math.max(...punti.map((s) => s.depth), 0);
  const fondoScala = Math.max(opts.maxDepthM ?? dMisurata, 1);
  const passoD = passoAsse(fondoScala);
  const dTop = Math.max(passoD, Math.ceil(fondoScala / passoD) * passoD);

  const x = (t: number) => pad.left + ((t - t0) / tMax) * plotW;
  const y = (d: number) => pad.top + (Math.max(0, d) / dTop) * plotH;
  const ySuperficie = y(0);

  const coordinate = punti.map((s) => `${sv(x(s.t))},${sv(y(s.depth))}`);
  const area = [
    `M ${sv(x(t0))},${sv(ySuperficie)}`,
    `L ${coordinate.join(' L ')}`,
    `L ${sv(x(punti[punti.length - 1].t))},${sv(ySuperficie)}`,
    'Z',
  ].join(' ');

  const parti: string[] = [];
  const titolo = opts.title ?? 'Profilo dell’immersione: profondità in metri, tempo in minuti';
  parti.push(
    `<svg class="profilo-svg" viewBox="0 0 ${W} ${H}" width="100%" role="img" ` +
      `aria-label="${escapeHtml(titolo)}" xmlns="http://www.w3.org/2000/svg">`,
  );
  parti.push(`<title>${escapeHtml(titolo)}</title>`);

  // Griglia orizzontale con le quote. Le linee vanno sotto il riempimento,
  // altrimenti in stampa attraversano il profilo e lo rendono sporco.
  for (let d = 0; d <= dTop + 1e-9; d += passoD) {
    const yy = y(d);
    parti.push(
      `<line class="griglia" x1="${sv(pad.left)}" y1="${sv(yy)}" x2="${sv(W - pad.right)}" y2="${sv(yy)}" />`,
    );
    parti.push(
      `<text class="tacca" x="${sv(pad.left - 6)}" y="${sv(yy + 3)}" text-anchor="end">${sv(d)}</text>`,
    );
  }

  // Griglia verticale a minuti tondi.
  const passoT = passoTempo(tMax);
  for (let t = passoT; t < tMax; t += passoT) {
    const xx = x(t0 + t);
    parti.push(
      `<line class="griglia" x1="${sv(xx)}" y1="${sv(pad.top)}" x2="${sv(xx)}" y2="${sv(pad.top + plotH)}" />`,
    );
    parti.push(
      `<text class="tacca" x="${sv(xx)}" y="${sv(H - 8)}" text-anchor="middle">${Math.round(t / 60)}</text>`,
    );
  }

  parti.push(`<path class="profilo-area" d="${area}" />`);
  parti.push(`<polyline class="profilo-linea" points="${coordinate.join(' ')}" />`);

  // Il punto più profondo, marcato ed etichettato: è il numero che chi sfoglia un
  // logbook cerca per primo, e trovarlo sul disegno invece che solo in tabella
  // evita di dover leggere due volte lo stesso foglio.
  const piuProfondo = punti.reduce((a, b) => (b.depth > a.depth ? b : a), punti[0]);
  const xp = x(piuProfondo.t);
  const yp = y(piuProfondo.depth);
  parti.push(`<circle class="picco" cx="${sv(xp)}" cy="${sv(yp)}" r="2.5" />`);
  parti.push(
    `<text class="picco-testo" x="${sv(Math.min(xp + 6, W - pad.right - 2))}" y="${sv(Math.min(yp + 12, H - pad.bottom - 2))}" ` +
      `text-anchor="${xp > W - pad.right - 60 ? 'end' : 'start'}">${piuProfondo.depth.toFixed(1)} m</text>`,
  );

  parti.push(`<text class="asse" x="${sv(pad.left - 6)}" y="${sv(H - 8)}" text-anchor="end">m</text>`);
  parti.push(`<text class="asse" x="${sv(W - pad.right)}" y="${sv(H - 8)}" text-anchor="end">minuti</text>`);
  parti.push('</svg>');
  return parti.join('');
}

/** Passo dell'asse delle profondità: una scaletta di valori che si leggono. */
function passoAsse(max: number, quante = 5): number {
  const grezzo = max / quante;
  for (const p of [1, 2, 2.5, 5, 10, 20, 25, 50]) if (p >= grezzo) return p;
  return 100;
}

/** Passo dell'asse dei tempi, in secondi: sempre minuti tondi. */
function passoTempo(tMaxS: number): number {
  const grezzo = tMaxS / 6;
  for (const p of [60, 120, 300, 600, 900, 1800, 3600]) if (p >= grezzo) return p;
  return 7200;
}

// ---------------------------------------------------------------------------
// La pagina
// ---------------------------------------------------------------------------

export interface LogbookPrintOptions {
  /** Titolo del fascicolo, in testa alla finestra e sulla prima riga di ogni pagina. */
  title?: string;
  /** A chi appartiene il logbook: sta accanto alla firma, ed è ciò che si firma. */
  owner?: string;
  /** Istante di generazione, ISO. Passato da fuori per rendere l'output ripetibile nei test. */
  now?: string;
  /** Lo spazio per firma e timbro. Vero salvo richiesta contraria: è il motivo della stampa. */
  signature?: boolean;
  /** Fondo scala comune dell'asse delle profondità, per confrontare i profili a occhio. */
  maxDepthM?: number;
  /**
   * L'inventario dell'attrezzatura, per recuperare i chili della piastra sulle
   * immersioni che hanno il GAV ma non il peso scritto sopra. Vedi
   * `piastraDellImmersione`: senza, il foglio da firmare dichiara metà zavorra.
   */
  inventario?: Pick<Equipment, 'id' | 'plateKg' | 'backplateKg'>[];
  /**
   * Chi tiene il libretto: lettere a) e b) dell'art. 12, comma 8 della legge
   * 70/2026. Vengono dalle impostazioni, non dall'immersione, perché non
   * cambiano a ogni immersione.
   */
  subacqueo?: Subacqueo;
}

/** Una coppia etichetta/valore della griglia dei numeri. */
type Voce = [string, string];

/**
 * Il fascicolo completo: un documento HTML autosufficiente, una pagina per
 * immersione.
 *
 * `samplesById` è separato dalle immersioni perché lo storage tiene i profili
 * staccati dalla lista (vedi `storage/types.ts`): la lista del logbook non li
 * carica mai, e chi stampa decide quanti caricarne. Un'immersione senza voce nella
 * mappa non è un errore — è un'immersione senza profilo, e la sua pagina lo dice.
 *
 * L'ordine è cronologico a prescindere da come arrivano le immersioni: un fascicolo
 * da archiviare si sfoglia dalla più vecchia alla più recente, come un libretto di
 * carta.
 */
export function logbookHtml(
  dives: Dive[],
  samplesById: Map<string, Sample[]>,
  opts: LogbookPrintOptions = {},
): string {
  const {
    title = 'Logbook',
    owner,
    now = new Date().toISOString(),
    signature = true,
    maxDepthM,
    inventario,
    subacqueo,
  } = opts;

  const ordinate = [...dives].sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime));

  const pagine = ordinate.map((dive, i) =>
    paginaImmersione(dive, samplesById.get(dive.id) ?? dive.samples ?? [], {
      indice: i,
      totale: ordinate.length,
      titolo: title,
      owner,
      firma: signature,
      maxDepthM,
      inventario,
      subacqueo,
    }),
  );

  const corpo = pagine.length
    ? pagine.join('\n')
    : '<section class="scheda vuota"><h1>Nessuna immersione da stampare</h1>' +
      '<p>La selezione da cui è partita questa stampa non contiene immersioni.</p></section>';

  return [
    '<!DOCTYPE html>',
    '<html lang="it">',
    '<head>',
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    `<title>${escapeHtml(title)}</title>`,
    `<style>${FOGLIO_DI_STILE}</style>`,
    '</head>',
    '<body>',
    istruzioni(ordinate.length, now),
    corpo,
    '</body>',
    '</html>',
  ].join('\n');
}

/**
 * Il riquadro che si vede solo a schermo e non finisce mai sulla carta.
 *
 * Serve a spiegare che cosa è questa finestra e come ottenerne un PDF, perché la
 * scorciatoia del sistema è l'unico passaggio che l'applicazione non può fare al
 * posto dell'utente. In stampa sparisce: `@media print` lo nasconde, così la
 * prima pagina del fascicolo comincia dall'immersione e non dalle istruzioni.
 */
function istruzioni(quante: number, now: string): string {
  const data = dataLunga(now);
  return [
    '<div class="nostampa">',
    '<strong>Anteprima di stampa.</strong> ',
    `Questo documento contiene ${quante === 1 ? 'una pagina' : `${quante} pagine`}, una per immersione. `,
    'Usa la stampa del sistema (⌘P su macOS, Ctrl+P altrove): dalla stessa finestra puoi scegliere ',
    '«Esporta come PDF» per archiviarlo, oppure stamparlo e farlo firmare. ',
    `<span class="muto">Generato il ${escapeHtml(data)}.</span>`,
    '</div>',
  ].join('');
}

function paginaImmersione(
  dive: Dive,
  samples: Sample[],
  ctx: {
    indice: number;
    totale: number;
    titolo: string;
    owner?: string;
    firma: boolean;
    maxDepthM?: number;
    inventario?: Pick<Equipment, 'id' | 'plateKg' | 'backplateKg'>[];
    subacqueo?: Subacqueo;
  },
): string {
  const m = dive.metrics;
  const fuso = etichettaFuso(dive.utcOffsetMinutes);

  // Il numero progressivo è quello del computer o del logbook di origine quando
  // c'è. Quando non c'è NON se ne inventa uno che sembri suo: si dichiara la
  // posizione dentro questo fascicolo, che è un'informazione diversa e vera.
  const progressivo =
    dive.number !== undefined ? `n. ${dive.number}` : `${ctx.indice + 1}ª di questo fascicolo`;

  const luogo = [dive.site?.name, dive.site?.region, dive.site?.country]
    .filter((s): s is string => !!s)
    .join(', ');

  const voci: Voce[] = [
    ['Profondità massima', num(dive.maxDepth, 1, 'm')],
    ['Profondità media', num(m?.avgDepth ?? dive.avgDepth, 1, 'm')],
    ['Durata', formatDuration(dive.durationS)],
    ['Temperatura', temperatura(dive)],
    ['Miscela', miscele(dive)],
    ['Bombole e pressioni', bombole(dive)],
    ['Consumo', consumo(dive)],
    ['Modalità', escapeHtml(modeLabel(dive))],
    // Senza salinità si scrive «—», non «Salata»: tutti gli altri campi assenti
    // stampano il trattino, e questo inventava un dato su un foglio da firmare.
    ['Acqua', dive.salinity === undefined ? '—' : dive.salinity === 'fresh' ? 'Dolce' : 'Salata'],
    /*
     * LA ZAVORRA È IL TOTALE, piastra compresa.
     *
     * `zavorraTotaleKg` esiste apposta, e questa pagina la ignorava: con 2 kg di
     * zavorra e una piastra d'acciaio da 3, il foglio da far firmare diceva 2.
     * È esattamente il difetto che i due campi separati invitano a fare.
     */
    [
      'Zavorra',
      zavorraTotaleKg(dive, ctx.inventario) > 0 ? num(zavorraTotaleKg(dive, ctx.inventario), 1, 'kg') : '—',
    ],
    // La guida sub mancava proprio dal foglio la cui riga da firmare si intitola
    // «Firma dell'istruttore o della guida»: il nome di chi firma non c'era.
    ['Guida sub', opz(dive.guide)],
    ['Muta', opz(dive.gear?.suit?.name ?? dive.suit)],
    ['Erogatori', opz(dive.gear?.regulators?.map((r) => r.name).join(' · '))],
    ['GAV', opz(dive.gear?.bcd?.name)],
    /*
     * VISIBILITÀ E CONDIZIONI DALLE FUNZIONI CONDIVISE, non dai campi grezzi.
     *
     * Questa pagina leggeva `dive.tags` per le condizioni e `visibilityM` da
     * solo. Da quando la scheda salva nel campo nuovo e TOGLIE i tag
     * corrispondenti, aprire un'immersione e premere Salva senza toccare niente
     * svuotava la riga «Condizioni» del logbook cartaceo — quello con lo spazio
     * per la firma. E una fascia «da 5 a 10 m» veniva stampata come «5 m», cioè
     * una stima diventava una misura.
     */
    ['Visibilità', escapeHtml(visibilitaTesto(dive))],
    ['Voto', voto(dive.rating)],
    ['Condizioni', escapeHtml(condizioniTesto(dive) || '—')],
    ['Etichette', dive.tags?.length ? escapeHtml(dive.tags.join(' · ')) : '—'],
  ];

  const svg = diveProfileSvg(samples, {
    maxDepthM: ctx.maxDepthM,
    title: `Profilo dell’immersione ${progressivo}: profondità in metri, tempo in minuti`,
  });

  const out: string[] = [];
  out.push('<section class="scheda">');

  out.push('<header class="testa">');
  out.push('<div class="testa-sinistra">');
  out.push(
    `<div class="fascicolo">${escapeHtml(ctx.titolo)}${ctx.owner ? ` · ${escapeHtml(ctx.owner)}` : ''}</div>`,
  );
  out.push(`<h1>${luogo ? escapeHtml(luogo) : 'Sito non indicato'}</h1>`);
  /*
   * Il titolo che le hai dato tu, sotto il sito.
   *
   * A schermo è l'intestazione della scheda e il contesto per il modello lo
   * manda; il foglio da firmare era l'unica superficie che lo perdeva, insieme
   * alla guida sub. Sono le due cose che una persona scrive a mano dopo
   * l'immersione, cioè proprio quelle che rendono il foglio suo.
   */
  if (dive.title) out.push(`<p class="titolo-immersione">${escapeHtml(dive.title)}</p>`);
  out.push(
    `<p class="quando">${escapeHtml(dataLunga(dive.startTime, dive.utcOffsetMinutes))} · ` +
      `ore ${escapeHtml(oraLocale(dive.startTime, dive.utcOffsetMinutes))}` +
      (fuso ? ` <span class="muto">(${escapeHtml(fuso)}, ora locale del sito)</span>` : '') +
      '</p>',
  );
  out.push(`<p class="compagno">Compagno: <strong>${opz(dive.buddy)}</strong></p>`);
  out.push('</div>');
  out.push('<div class="testa-destra">');
  out.push(`<div class="progressivo">${escapeHtml(progressivo)}</div>`);
  /*
   * «immersione N di M», non «pagina».
   *
   * Contare le pagine da qui non si può — quante facciate escano lo decide il
   * motore di stampa — e infatti su una nota lunga ne uscivano due mentre
   * l'intestazione ne dichiarava una. Il numero dell'immersione dentro il
   * fascicolo invece è vero sempre, ed è l'informazione che serve per
   * ritrovarla.
   */
  out.push(`<div class="muto">immersione ${ctx.indice + 1} di ${ctx.totale}</div>`);
  out.push('</div>');
  out.push('</header>');

  out.push('<dl class="numeri">');
  for (const [etichetta, valore] of voci) {
    out.push(`<div class="voce"><dt>${escapeHtml(etichetta)}</dt><dd>${valore}</dd></div>`);
  }
  out.push('</dl>');

  out.push('<section class="blocco profilo">');
  out.push('<h2>Profilo</h2>');
  if (svg) {
    out.push(svg);
    out.push(
      `<p class="didascalia">Ricostruito da ${samples.length} campioni registrati dal computer` +
        (dive.computer?.model ? ` ${escapeHtml(dive.computer.model)}` : '') +
        '.</p>',
    );
  } else {
    // Nessun profilo finto. Vedi il commento su `diveProfileSvg`.
    out.push(
      '<p class="assente">Questa immersione non ha un profilo campionato: è stata inserita a mano ' +
        'oppure importata da una fonte che salva solo i dati di sintesi. I numeri qui sopra restano ' +
        'validi; la curva non esiste e non viene disegnata.</p>',
    );
  }
  out.push('</section>');

  if (m?.tissuesEstimated) {
    // Va detto sulla carta, non solo a schermo: chi controfirma il foglio deve
    // sapere che la saturazione non viene da un profilo registrato.
    out.push(
      '<p class="avviso">I valori di saturazione di questa immersione sono <strong>stimati</strong>: ' +
        'mancando un profilo registrato sono stati ricavati da un profilo quadro ricostruito da ' +
        'profondità media e durata. Sono una stima, non una misura.</p>',
    );
  }

  /*
   * ► IL LIBRETTO DELLE IMMERSIONI, COM'È SCRITTO NELLA LEGGE. ◄
   *
   * Le stesse cose stanno anche nella griglia qui sopra, e non è un doppione: la
   * griglia è fatta per essere letta da un subacqueo, questo blocco è fatto per
   * essere CONTROLLATO. Chi verifica un libretto scorre le lettere dell'art. 12,
   * comma 8 — a), b), c) … o) — e trovarle mescolate ad altri quindici numeri lo
   * costringe a cercare. Qui ci sono tutte e tredici, in quell'ordine, con la
   * lettera davanti.
   *
   * Quello che manca resta un trattino. Su un foglio che qualcuno controfirma,
   * un dato inventato è peggio di un dato mancante — e la lettera o), la firma,
   * è vuota per costruzione: la riga per la penna è più in basso.
   */
  const vociLegge = libretto(dive, ctx.subacqueo ?? {});
  out.push('<section class="blocco libretto">');
  out.push('<h2>Libretto delle immersioni</h2>');
  out.push(
    '<p class="muto">Art. 12, comma 8 della legge 7 maggio 2026, n. 70. Il testo ammette espressamente il formato digitale.</p>',
  );
  out.push('<dl class="lettere">');
  for (const voce of vociLegge) {
    out.push(
      `<div class="lettera"><dt><span class="sigla">${voce.lettera})</span> ${escapeHtml(voce.etichetta)}</dt>` +
        `<dd>${voce.valore === null ? '<span class="assente">—</span>' : escapeHtml(voce.valore)}</dd></div>`,
    );
  }
  out.push('</dl>');
  out.push('</section>');

  out.push('<section class="blocco note">');
  out.push('<h2>Note</h2>');
  out.push(
    dive.notes
      ? `<p class="testo-note">${escapeHtml(dive.notes)}</p>`
      : '<p class="assente">Nessuna nota.</p>',
  );
  out.push('</section>');

  if (ctx.firma) {
    out.push('<section class="blocco firma">');
    out.push('<div class="riga-firma">');
    out.push(
      '<div class="campo-firma"><span class="riga"></span><span class="etichetta">Firma del subacqueo</span></div>',
    );
    out.push(
      '<div class="campo-firma"><span class="riga"></span><span class="etichetta">Firma dell’istruttore o della guida</span></div>',
    );
    out.push('</div>');
    out.push(
      '<div class="riquadro-timbro"><span class="etichetta">Timbro del centro o della didattica</span></div>',
    );
    out.push('</section>');
  }

  out.push('</section>');
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// I numeri, uno per uno
// ---------------------------------------------------------------------------

function temperatura(dive: Dive): string {
  const parti: string[] = [];
  if (dive.minTempC !== undefined) parti.push(`min ${dive.minTempC.toFixed(1)} °C`);
  if (dive.airTempC !== undefined) parti.push(`aria ${dive.airTempC.toFixed(0)} °C`);
  return parti.length ? escapeHtml(parti.join(' · ')) : '—';
}

function miscele(dive: Dive): string {
  const nomi = [...new Set(dive.cylinders.map((c) => mixName(c.mix)))];
  return nomi.length ? escapeHtml(nomi.join(' · ')) : '—';
}

/** «12 L Aria 200 → 70 bar (130 usati)», una riga per bombola. */
function bombole(dive: Dive): string {
  if (!dive.cylinders.length) return '—';
  return dive.cylinders.map((c) => escapeHtml(descriviBombola(c))).join('<br />');
}

function descriviBombola(c: Cylinder): string {
  const testa = [c.sizeL !== undefined ? `${c.sizeL.toFixed(0)} L` : undefined, mixName(c.mix)]
    .filter(Boolean)
    .join(' ');
  if (c.startBar === undefined && c.endBar === undefined) return `${testa} · pressioni non registrate`;
  const da = c.startBar !== undefined ? `${Math.round(c.startBar)}` : '?';
  const a = c.endBar !== undefined ? `${Math.round(c.endBar)}` : '?';
  const usati =
    c.startBar !== undefined && c.endBar !== undefined ? ` (${Math.round(c.startBar - c.endBar)} usati)` : '';
  return `${testa} · ${da} → ${a} bar${usati}`;
}

/**
 * Il consumo, e SOLO se è calcolabile.
 *
 * Il L/min è l'unico numero confrontabile fra bombole diverse, e per averlo serve
 * il volume in litri. Quando manca resta il bar/min, che è un dato vero ma vale
 * solo per quella bombola: il foglio lo scrive e lo dichiara, invece di far
 * sembrare confrontabile una cosa che non lo è. Quando non c'è nemmeno quello, si
 * scrive che cosa manca — mai un numero stimato.
 */
function consumo(dive: Dive): string {
  const m = dive.metrics;
  if (m?.rmvLpm !== undefined) {
    const sac = m.sacBarPerMin !== undefined ? ` · ${m.sacBarPerMin.toFixed(1)} bar/min` : '';
    return escapeHtml(`${m.rmvLpm.toFixed(1)} L/min${sac}`);
  }
  const sac = m?.sacBarPerMin ?? sacDaBombole(dive);
  if (sac !== undefined) {
    return escapeHtml(
      `${sac.toFixed(1)} bar/min — senza il volume della bombola non è convertibile in L/min`,
    );
  }
  return escapeHtml('non calcolabile: servono pressione iniziale e finale della bombola');
}

/** Bar al minuto sulla prima bombola con entrambe le pressioni. */
function sacDaBombole(dive: Dive): number | undefined {
  if (!(dive.durationS > 0)) return undefined;
  const c = dive.cylinders.find((x) => x.startBar !== undefined && x.endBar !== undefined);
  if (!c) return undefined;
  const usati = (c.startBar as number) - (c.endBar as number);
  return usati > 0 ? usati / (dive.durationS / 60) : undefined;
}

/** «★★★★☆ (4 su 5)». Le stelline si stampano bene e si contano in un colpo d'occhio. */
function voto(rating: number | undefined): string {
  if (rating === undefined || !Number.isFinite(rating)) return '—';
  const r = Math.max(0, Math.min(5, Math.round(rating)));
  return escapeHtml(`${'★'.repeat(r)}${'☆'.repeat(5 - r)} (${r} su 5)`);
}

// ---------------------------------------------------------------------------
// Il foglio di stile
// ---------------------------------------------------------------------------

/**
 * Tutto il CSS in una costante, dentro un `<style>` nel documento.
 *
 * Un foglio esterno renderebbe il file non autosufficiente: questo documento deve
 * poter essere salvato, spedito o riaperto fra un anno e continuare a impaginarsi
 * uguale, anche senza l'applicazione che lo ha prodotto.
 */
const FOGLIO_DI_STILE = `
/* Il libretto di legge: due colonne di lettere, compatte, da scorrere in verticale. */
.blocco.libretto .lettere {
  margin: 0;
  columns: 2;
  column-gap: 14mm;
}
.blocco.libretto .lettera {
  break-inside: avoid;
  display: flex;
  justify-content: space-between;
  gap: 4mm;
  border-bottom: 0.2mm dotted #bbb;
  padding: 0.8mm 0;
}
.blocco.libretto dt {
  font-weight: 400;
  color: #555;
}
.blocco.libretto dd {
  margin: 0;
  font-weight: 600;
  text-align: right;
}
.blocco.libretto .sigla {
  display: inline-block;
  min-width: 4mm;
  color: #999;
}

@page { size: A4 portrait; margin: 14mm 13mm 12mm; }

:root {
  --inchiostro: #16202b;
  --tenue: #5b6875;
  --filo: #c3ccd5;
  --acqua: #2c5f86;
  --acqua-chiara: #d7e5ef;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  padding: 16px;
  color: var(--inchiostro);
  background: #eef1f4;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
  font-size: 11pt;
  line-height: 1.35;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

.nostampa {
  max-width: 190mm;
  margin: 0 auto 16px;
  padding: 10px 14px;
  border: 1px solid var(--filo);
  border-radius: 8px;
  background: #fff;
  font-size: 10pt;
  color: var(--tenue);
}

.scheda {
  max-width: 190mm;
  margin: 0 auto 16px;
  padding: 10mm;
  background: #fff;
  border: 1px solid var(--filo);
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  gap: 6mm;
}

/* L'interruzione di pagina, dichiarata due volte: 'break-after' è la proprietà
   moderna, 'page-break-after' quella che i motori più vecchi conoscono ancora. */
.scheda { break-after: page; page-break-after: always; }
.scheda:last-of-type { break-after: auto; page-break-after: auto; }

.testa {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 10mm;
  border-bottom: 1.5px solid var(--inchiostro);
  padding-bottom: 3mm;
}
.fascicolo { font-size: 8pt; letter-spacing: .08em; text-transform: uppercase; color: var(--tenue); }
.testa h1 { margin: 1mm 0 1.5mm; font-size: 17pt; line-height: 1.15; }
.quando { margin: 0; font-size: 10.5pt; }
.compagno { margin: 1mm 0 0; font-size: 10.5pt; }
.testa-destra { text-align: right; flex-shrink: 0; }
.progressivo { font-size: 14pt; font-weight: 650; white-space: nowrap; }
.muto { color: var(--tenue); font-weight: 400; }

.numeri {
  margin: 0;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 2.5mm 6mm;
}
.voce { border-top: 1px solid var(--filo); padding-top: 1.2mm; break-inside: avoid; }
.voce dt { font-size: 8pt; letter-spacing: .05em; text-transform: uppercase; color: var(--tenue); }
.voce dd { margin: .6mm 0 0; font-size: 10.5pt; font-variant-numeric: tabular-nums; }

.blocco { break-inside: avoid; }
/*
 * LE NOTE POSSONO SPEZZARSI, la firma no.
 *
 * Con break-inside: avoid anche sulle note (niente apici inversi qui dentro:
 * siamo in un template literal), una nota di seicento caratteri spingeva il
 * riquadro delle firme su una SECONDA facciata per il resto bianca:
 * l'istruttore si trovava a firmare un foglio senza i dati che sta
 * controfirmando, e l'intestazione continuava a dire «pagina 1 di 1». Misurato
 * col PDF vero: 400 caratteri una pagina, 600 due. È lo stesso difetto che
 * planPrint.ts documenta di aver già corretto sul foglio del piano.
 */
.titolo-immersione { margin: .6mm 0 0; font-size: 11pt; font-style: italic; }
.blocco.note { break-inside: auto; }
.blocco.note h2 { break-after: avoid; }
.blocco h2 {
  margin: 0 0 2mm;
  font-size: 8pt;
  letter-spacing: .08em;
  text-transform: uppercase;
  color: var(--tenue);
  border-bottom: 1px solid var(--filo);
  padding-bottom: 1mm;
}

.profilo-svg { display: block; width: 100%; height: auto; }
.griglia { stroke: var(--filo); stroke-width: .5; }
.tacca, .asse, .picco-testo { font-size: 8px; fill: var(--tenue); font-family: inherit; }
.picco-testo { fill: var(--acqua); font-weight: 600; }
.profilo-area { fill: var(--acqua-chiara); stroke: none; }
.profilo-linea { fill: none; stroke: var(--acqua); stroke-width: 1.4; stroke-linejoin: round; stroke-linecap: round; }
.picco { fill: var(--acqua); }
.didascalia { margin: 1.5mm 0 0; font-size: 8.5pt; color: var(--tenue); }

.assente { margin: 0; font-size: 10pt; color: var(--tenue); font-style: italic; }
.testo-note { margin: 0; white-space: pre-wrap; font-size: 10.5pt; }

.avviso {
  margin: 0;
  padding: 2mm 3mm;
  border-left: 2.5px solid var(--acqua);
  background: var(--acqua-chiara);
  font-size: 9.5pt;
  break-inside: avoid;
}

/* Firma e timbro: il motivo per cui questa stampa esiste. Spinti in fondo alla
   pagina con 'margin-top: auto', così restano sempre nello stesso punto del
   foglio anche quando le note sono corte — chi firma sa già dove guardare. */
.firma { margin-top: auto; display: flex; gap: 8mm; align-items: flex-end; }
.riga-firma { flex: 1; display: flex; gap: 8mm; }
.campo-firma { flex: 1; }
.campo-firma .riga { display: block; border-bottom: 1px solid var(--inchiostro); height: 12mm; }
.etichetta { display: block; margin-top: 1mm; font-size: 8pt; color: var(--tenue); }
.riquadro-timbro {
  width: 42mm;
  height: 30mm;
  border: 1px dashed var(--filo);
  border-radius: 4px;
  padding: 1.5mm;
  display: flex;
  align-items: flex-end;
}
.riquadro-timbro .etichetta { margin: 0; line-height: 1.15; }

@media print {
  body { background: #fff; padding: 0; font-size: 10pt; }
  .nostampa { display: none; }
  .scheda {
    max-width: none;
    margin: 0;
    padding: 0;
    border: 0;
    border-radius: 0;
    min-height: 100%;
  }
}
`;
