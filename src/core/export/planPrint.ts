/**
 * Il piano su un foglio: quello che si porta in barca, o sott'acqua.
 *
 * PERCHÉ SERVE, VISTO CHE IL PIANO È GIÀ A SCHERMO. Perché il telefono in barca
 * non c'è. Sta nel sacco stagno, o è scarico, o è dentro il gommone mentre tu
 * sei in acqua — e il momento in cui serve rileggere «a che minuto giro» è
 * esattamente quello in cui non lo hai. La didattica tecnica insegna a scrivere
 * il *run time schedule* su una lavagnetta prima di entrare, e questo foglio è
 * quella lavagnetta: la stessa tabella, con gli stessi numeri di quello che hai
 * appena calcolato, senza ricopiarla a mano — che è il passaggio in cui si
 * sbaglia una cifra.
 *
 * PERCHÉ HTML DA STAMPARE E NON UNA LIBRERIA PDF. Per le stesse tre ragioni di
 * `logbookPrint.ts`, e vale la pena ripeterle perché sono la ragione per cui
 * questa applicazione non ha nessuna dipendenza per la stampa: una libreria in
 * più da mantenere per anni; i font, che una libreria si porta dietro e che
 * qui invece sono quelli di sistema; e soprattutto l'anteprima, che con la
 * stampa del sistema è quella VERA — con i suoi margini, il suo formato carta e,
 * su macOS, «Esporta come PDF» dalla stessa finestra. Il PDF lo fa il sistema
 * operativo, che lo sa fare meglio di noi e lo saprà fare ancora fra dieci anni.
 *
 * PERCHÉ LA STRUTTURA È GENERICA. Le due modalità del pianificatore producono
 * fogli diversi — quella ricreativa ha la curva e le pressioni attese, quella
 * tecnica ha le soste e i cambi di gas — e scrivere due generatori significa
 * che il secondo si aggiorna sempre in ritardo sul primo. Qui c'è un foglio di
 * sezioni, e ogni modalità decide quali sezioni metterci: la formattazione dei
 * numeri resta dove i numeri sono, e l'impaginazione sta in un posto solo.
 *
 * FUNZIONI PURE. Nessun DOM, nessun React, nessuna finestra: si prova con una
 * stringa. Chi apre la finestra e chiama `print()` è l'interfaccia, in due righe.
 *
 * SICUREZZA. Il titolo, le note e i nomi dei gas passano tutti da `escapeHtml`:
 * dentro un piano ci può finire testo scritto a mano, e una nota che contiene
 * `<script>` deve comparire STAMPATA com'è stata scritta, non essere eseguita
 * dalla finestra che apriamo.
 */

import { escapeHtml } from './logbookPrint';

export interface SezionePiano {
  titolo: string;
  descrizione?: string;
  /**
   * Le intestazioni di colonna. Assenti = tabella a due colonne
   * etichetta/valore, che è la forma dei riquadri di riepilogo.
   */
  colonne?: string[];
  righe: string[][];
  /**
   * Gli indici delle righe da evidenziare.
   *
   * Serve a una cosa sola e importante: una **sosta obbligatoria** non è come
   * una riga qualunque della tabella. Su carta, in barca, con le mani bagnate,
   * la differenza fra «sosta di sicurezza» e «obbligo» deve saltare all'occhio
   * senza doverla leggere.
   */
  forti?: number[];
  /** Colonne da allineare a destra: gli indici, zero-based. */
  numeriche?: number[];
}

export interface FoglioPiano {
  titolo: string;
  sottotitolo?: string;
  /** ISO. Passato da fuori perché una funzione pura non guarda l'orologio. */
  now?: string;
  sezioni: SezionePiano[];
  avvisi?: { livello: 'info' | 'warning' | 'critical'; testo: string }[];
  /** Il disegno del profilo, già in SVG. Vedi `diveProfileSvg`. */
  profiloSvg?: string;
  /** Testo libero in fondo: le note del piano. */
  note?: string;
}

export function pianoHtml(f: FoglioPiano): string {
  const sezioni = f.sezioni
    .filter((s) => s.righe.length > 0)
    .map(sezione)
    .join('\n');

  return [
    '<!DOCTYPE html>',
    '<html lang="it">',
    '<head>',
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    `<title>${escapeHtml(f.titolo)}</title>`,
    `<style>${STILE}</style>`,
    '</head>',
    '<body>',
    istruzioni(f.now),
    '<main class="foglio">',
    `<h1>${escapeHtml(f.titolo)}</h1>`,
    f.sottotitolo ? `<p class="sotto">${escapeHtml(f.sottotitolo)}</p>` : '',
    f.profiloSvg ? `<div class="profilo">${f.profiloSvg}</div>` : '',
    sezioni,
    avvisi(f.avvisi),
    f.note ? `<section class="note"><h2>Note</h2><p>${escapeHtml(f.note)}</p></section>` : '',
    /*
     * Lo spazio per la firma non è un ornamento.
     *
     * Un piano di decompressione lo si controlla in due prima di entrare: è la
     * procedura, non una gentilezza. Il riquadro esiste perché quel controllo
     * lasci una traccia — e perché su carta la traccia si fa con la penna.
     */
    '<section class="firme">',
    '<div><span>Pianificato da</span><i></i></div>',
    '<div><span>Controllato da</span><i></i></div>',
    '<div><span>Data e ora d’ingresso</span><i></i></div>',
    '</section>',
    '<p class="piede">',
    'Calcolato da MyDiveLog. Un piano non sostituisce il computer subacqueo, ',
    'e le soste che vedi qui valgono per il profilo scritto sopra: se in acqua ',
    'vai più giù o resti di più, il piano che conta è quello che il computer ',
    'ricalcola sul momento.',
    '</p>',
    '</main>',
    '</body>',
    '</html>',
  ]
    .filter(Boolean)
    .join('\n');
}

// ---------------------------------------------------------------------------

function sezione(s: SezionePiano): string {
  const destra = new Set(s.numeriche ?? []);
  const forti = new Set(s.forti ?? []);
  const testa = s.colonne?.length
    ? `<thead><tr>${s.colonne
        .map((c, i) => `<th${destra.has(i) ? ' class="num"' : ''}>${escapeHtml(c)}</th>`)
        .join('')}</tr></thead>`
    : '';
  const corpo = s.righe
    .map(
      (r, i) =>
        `<tr${forti.has(i) ? ' class="forte"' : ''}>${r
          .map((c, j) => `<td${destra.has(j) ? ' class="num"' : ''}>${escapeHtml(c)}</td>`)
          .join('')}</tr>`,
    )
    .join('');
  return [
    '<section>',
    `<h2>${escapeHtml(s.titolo)}</h2>`,
    s.descrizione ? `<p class="desc">${escapeHtml(s.descrizione)}</p>` : '',
    `<table class="${s.colonne?.length ? 'griglia' : 'coppie'}">${testa}<tbody>${corpo}</tbody></table>`,
    '</section>',
  ]
    .filter(Boolean)
    .join('');
}

function avvisi(elenco: FoglioPiano['avvisi']): string {
  if (!elenco?.length) return '';
  return [
    '<section class="avvisi">',
    '<h2>Da sapere prima di entrare</h2>',
    '<ul>',
    ...elenco.map((a) => `<li class="${a.livello}">${escapeHtml(a.testo)}</li>`),
    '</ul>',
    '</section>',
  ].join('');
}

/**
 * Il riquadro che si vede solo a schermo e non finisce mai sulla carta.
 *
 * Spiega come ottenere il PDF, perché la scorciatoia del sistema è l'unico
 * passaggio che l'applicazione non può fare al posto di chi la usa.
 */
function istruzioni(now?: string): string {
  const quando = now ? new Date(now) : undefined;
  const data =
    quando && !Number.isNaN(quando.getTime())
      ? quando.toLocaleString('it-IT', { dateStyle: 'long', timeStyle: 'short' })
      : undefined;
  return [
    '<div class="nostampa">',
    '<strong>Anteprima di stampa.</strong> ',
    'Usa la stampa del sistema (⌘P su macOS, Ctrl+P altrove): dalla stessa finestra ',
    'puoi scegliere «Esporta come PDF» per archiviarlo, oppure stamparlo e portartelo dietro. ',
    data ? `<span class="muto">Generato il ${escapeHtml(data)}.</span>` : '',
    '</div>',
  ].join('');
}

// ---------------------------------------------------------------------------

/*
 * I colori sono forzati con `print-color-adjust: exact`.
 *
 * Senza, i browser tolgono i fondi in stampa «per risparmiare inchiostro»: le
 * righe delle soste obbligatorie uscirebbero identiche a tutte le altre, e la
 * distinzione che serve in acqua sparirebbe proprio sulla carta, cioè
 * nell'unico posto in cui non si può cliccare per scoprirla.
 */
const STILE = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 24px 20px 40px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: #111; background: #fff; font-size: 12px; line-height: 1.45;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .foglio { max-width: 760px; margin: 0 auto; }
  h1 { font-size: 20px; margin: 0 0 2px; }
  .sotto { margin: 0 0 16px; color: #555; font-size: 12px; }
  h2 { font-size: 13px; margin: 18px 0 6px; padding-bottom: 3px; border-bottom: 1px solid #ddd; }
  .desc { margin: 0 0 6px; color: #555; font-size: 11px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 4px 6px; text-align: left; vertical-align: top; }
  th { font-size: 10px; text-transform: uppercase; letter-spacing: .04em; color: #555; border-bottom: 1px solid #bbb; }
  .griglia tbody tr { border-bottom: 1px solid #eee; }
  .coppie td:first-child { color: #555; width: 42%; }
  .coppie tbody tr { border-bottom: 1px solid #f2f2f2; }
  .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  tr.forte td { font-weight: 700; background: #fdeeee; }
  .profilo { margin: 10px 0 4px; }
  .profilo svg { width: 100%; height: auto; }
  .avvisi ul { margin: 4px 0 0; padding-left: 18px; }
  .avvisi li { margin-bottom: 3px; }
  .avvisi li.critical { color: #a10000; font-weight: 600; }
  .avvisi li.warning { color: #8a5300; }
  .note p { white-space: pre-wrap; margin: 4px 0 0; }
  .firme { display: flex; gap: 18px; margin-top: 26px; }
  .firme div { flex: 1; }
  .firme span { display: block; font-size: 10px; color: #666; text-transform: uppercase; letter-spacing: .04em; }
  .firme i { display: block; border-bottom: 1px solid #999; height: 28px; }
  .piede { margin-top: 18px; font-size: 10px; color: #666; }
  .nostampa {
    max-width: 760px; margin: 0 auto 18px; padding: 10px 12px;
    background: #eef4ff; border: 1px solid #cfdcf5; border-radius: 6px; font-size: 12px;
  }
  .nostampa .muto { color: #555; }
  @page { size: A4 portrait; margin: 14mm; }
  @media print {
    body { padding: 0; font-size: 11px; }
    .nostampa { display: none; }
    /*
     * LE SEZIONI SI POSSONO SPEZZARE, LE RIGHE NO.
     *
     * La regola break-inside:avoid su tutta la sezione sembrava prudente e sprecava
     * pagine intere: guardando il PDF vero, la prima pagina conteneva solo il
     * riquadro del piano e due terzi di bianco, perché il run time schedule non
     * ci stava per intero e passava alla successiva. Su un foglio che si porta
     * in barca, una pagina in più è una pagina in più da tenere asciutta.
     *
     * Quello che non si può spezzare è una RIGA — una sosta tagliata a metà fra
     * due fogli è illeggibile — e l'intestazione della tabella, che
     * table-header-group fa ripetere in cima a ogni pagina: senza, dalla
     * seconda pagina in poi le colonne sono numeri senza nome.
     */
    tr { break-inside: avoid; page-break-inside: avoid; }
    thead { display: table-header-group; }
    h2, .desc { break-after: avoid; page-break-after: avoid; }
    .desc { break-inside: avoid; page-break-inside: avoid; }
    .firme, .avvisi { break-inside: avoid; page-break-inside: avoid; }
  }
`;
