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
