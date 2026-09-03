/**
 * La trappola della specificità su `sito/stile.css`, e le due cose che ci sono
 * cascate dentro.
 *
 * ► IL CONTO DELLE VOLTE. ◄ Otto. Questo foglio mescola regole di tipo
 * (`.vetrina-apertura img`) e regole di classe (`.vetrina-secondo`) sugli stessi
 * elementi, e ogni volta che qualcuno scrive la seconda credendo che vinca
 * perché sta più sotto — o perché sta dentro una media query — perde. Non è
 * distrazione di chi scrive: è una proprietà del foglio. Otto volte non si
 * correggono una riga per volta; si mette una guardia che conta l'aritmetica.
 *
 * I DUE GUASTI VERI, tutti e due visti guardando la pagina e non il foglio:
 *
 * 1. `.vetrina-secondo { display: none }` dentro `@media (max-width: 1000px)`
 *    non ha mai nascosto niente, perché `.vetrina-apertura img { display: block }`
 *    è 0-1-1 contro 0-1-0. La media query non c'entra: la specificità si conta
 *    prima. Il sintomo era beffardo — nella stessa media query un'altra regola
 *    applicava benissimo, quindi tutto diceva che la media query funzionasse.
 *
 * 2. `.scheda-piattaforma, .scheda-piattaforma.principale { flex: 1 1 44% }`
 *    dentro `@media (max-width: 560px)` non toccava le tre schede piccole,
 *    perché `.scheda-piattaforma.minore { flex: 1 1 128px }` è 0-2-0 contro
 *    0-1-0. Misurato a 390 px: due schede da 166 px e la terza da 342, larga il
 *    doppio delle sue sorelle. `flex` non dà errore quando manda a capo — è il
 *    suo mestiere — e il risultato sembrava una scelta.
 *
 * ► LA FORMA DELLA GUARDIA, E LA VERSIONE SBAGLIATA CHE È VENUTA PRIMA. ◄
 *
 * Il primo tentativo diceva: «per ogni proprietà che la media query cambia su
 * una famiglia, esista lì dentro una regola almeno specifica quanto la più
 * specifica regola di base». Suonava bene ed era **inutile**: messa alla prova
 * rinominando `.scheda-piattaforma.minore` in `.scheda-piattaforma.altro`
 * dentro la media query — cioè rifacendo esattamente il guasto numero 2 — la
 * guardia è rimasta VERDE. Il massimo di specificità c'era ancora; veniva da
 * una regola che non colpisce quegli elementi. Una famiglia non è un insieme di
 * elementi, e confrontare massimi dentro una famiglia non dimostra niente su
 * nessun elemento.
 *
 * La forma giusta guarda un elemento per volta, e sono elementi veri presi
 * dalle pagine: *per ogni elemento del sito e per ogni proprietà, fra tutte le
 * regole che lo colpiscono davvero vince quella che il browser farebbe
 * vincere — e se una media query prova a cambiargli una proprietà, deve essere
 * lei a vincere.* Le regole che colpiscono un elemento si sanno: sono quelle
 * il cui selettore è soddisfatto dalle sue classi e dal suo tag.
 *
 * *Una guardia che passa quando le si rifà il difetto sotto il naso non è una
 * guardia: è una frase che descrive il difetto.*
 *
 * Perché di testo e non di disegno: è aritmetica, e l'aritmetica si conta nel
 * sorgente. Gira in millisecondi a ogni `npm test`, mentre aprire Chromium no —
 * e una guardia che nessuno fa girare non è una guardia. Il disegno vero si è
 * misurato a mano quando si è corretto, a cinque larghezze e su due lingue.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SITO = fileURLToPath(new URL('../sito', import.meta.url));
const CSS = readFileSync(join(SITO, 'stile.css'), 'utf8');
const PAGINE = ['index.html', 'en/index.html'] as const;

/**
 * Tutte le pagine del sito, e non solo le due home: una regola può essere viva
 * su «Privacy» e morta sulla home, e chiedere «questa riga colpisce qualcosa?»
 * guardando due pagine su otto darebbe una risposta che non vale niente.
 */
const TUTTE_LE_PAGINE = [
  'index.html',
  'privacy.html',
  'termini.html',
  'libretto-immersioni.html',
  'aiuto.html',
  'en/index.html',
  'en/privacy.html',
  'en/terms.html',
  'en/dive-logbook-law.html',
  'en/help.html',
] as const;

type Regola = { selettore: string; corpo: string; ordine: number };

function senzaCommenti(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * La specificità di un selettore semplice, ridotta a un numero confrontabile.
 * Non serve un parser completo: qui dentro ci sono classi, tipi e pseudo, e
 * nient'altro. Un `#id` fa sollevare un errore invece di produrre un numero
 * sbagliato in silenzio — che è il modo in cui una guardia diventa verde per il
 * motivo sbagliato.
 */
function specificita(selettore: string): number {
  if (selettore.includes('#')) throw new Error(`selettore con id, la conta non lo prevede: ${selettore}`);
  const classi = (selettore.match(/\.[a-zA-Z_-][\w-]*/g) ?? []).length;
  const pseudoClassi = (selettore.match(/(?<!:):[a-zA-Z-]+/g) ?? []).length;
  const tipi = (
    selettore
      .replace(/\.[a-zA-Z_-][\w-]*/g, ' ')
      .replace(/::?[a-zA-Z-]+/g, ' ')
      .match(/\b[a-z][a-z0-9]*\b/g) ?? []
  ).length;
  return (classi + pseudoClassi) * 100 + tipi;
}

/** Le proprietà dichiarate in un corpo di regola. */
function proprieta(corpo: string): Set<string> {
  const fuori = new Set<string>();
  for (const riga of corpo.split(';')) {
    const i = riga.indexOf(':');
    if (i > 0) fuori.add(riga.slice(0, i).trim());
  }
  fuori.delete('');
  return fuori;
}

/**
 * Le regole di un pezzo di foglio, una per ogni ramo della lista di selettori.
 * `a, b { … }` diventa due regole: per un elemento che li soddisfa entrambi
 * decide il ramo che lo colpisce, non la somma dei due, e sommarli darebbe una
 * specificità che non esiste.
 */
function regole(css: string): Regola[] {
  const fuori: Regola[] = [];
  const rx = /([^{}@]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  let ordine = 0;
  while ((m = rx.exec(css)) !== null) {
    const testa = m[1].trim();
    if (!testa || testa.startsWith('@')) continue;
    for (const ramo of testa.split(',')) {
      const selettore = ramo.trim();
      if (selettore) fuori.push({ selettore, corpo: m[2], ordine });
    }
    ordine += 1;
  }
  return fuori;
}

/** Il foglio senza le media query, cioè le regole che valgono sempre. */
function soloBase(css: string): string {
  const pulito = senzaCommenti(css);
  let fuori = '';
  let profondita = 0;
  let dentroMedia = 0;
  for (let i = 0; i < pulito.length; i += 1) {
    if (pulito.startsWith('@media', i) && profondita === 0) dentroMedia = 1;
    if (pulito[i] === '{') profondita += 1;
    if (!dentroMedia) fuori += pulito[i];
    if (pulito[i] === '}') {
      profondita -= 1;
      if (dentroMedia && profondita < dentroMedia) dentroMedia = 0;
    }
  }
  return fuori;
}

/**
 * Il contenuto di TUTTE le media query con questa condizione, una dietro
 * l'altra.
 *
 * «Tutte» e non «la prima», e l'ha insegnato un falso rosso: di
 * `prefers-reduced-motion: reduce` in questo foglio ce n'è più d'una — una per
 * il profilo che si traccia, una per la scena — e prendendo solo la prima la
 * guardia cercava la scena dentro il blocco del profilo e non la trovava. Il
 * browser le applica tutte; una prova che ne guarda una sola sta misurando un
 * foglio che non esiste.
 */
function dentroMedia(css: string, condizione: string): string {
  const pulito = senzaCommenti(css);
  const cerca = `@media ${condizione} {`;
  let da = 0;
  let fuori = '';
  for (;;) {
    const apre = pulito.indexOf(cerca, da);
    if (apre < 0) break;
    let i = pulito.indexOf('{', apre);
    const inizio = i + 1;
    let profondita = 0;
    for (; i < pulito.length; i += 1) {
      if (pulito[i] === '{') profondita += 1;
      if (pulito[i] === '}') {
        profondita -= 1;
        if (profondita === 0) break;
      }
    }
    if (profondita !== 0) throw new Error(`la \`@media ${condizione}\` non si chiude`);
    fuori += `${pulito.slice(inizio, i)}\n`;
    da = i;
  }
  if (!fuori) throw new Error(`nessuna \`@media ${condizione}\` nel foglio`);
  return fuori;
}

/** Un elemento come lo vede questa prova: sé stesso e la sua catena di antenati. */
type Nodo = { tag: string; classi: Set<string> };
type Elemento = { tag: string; classi: Set<string>; antenati: Nodo[]; dove: string };

/** Elementi che non si chiudono: la pila di annidamento non deve aspettarli. */
const VUOTI = new Set(['img', 'br', 'hr', 'meta', 'link', 'input', 'source', 'path', 'use', 'col']);

/**
 * L'albero della pagina, ridotto a tag + classi + antenati.
 *
 * ► PERCHÉ GLI ANTENATI SERVONO DAVVERO. ◄ La prima versione di questa prova li
 * ignorava: guardava solo l'ultimo pezzo del selettore e dichiarava, nel proprio
 * commento, che «sopravvalutare rende la guardia più severa, mai più
 * permissiva». Era falso, ed è costato il difetto che questa prova esiste per
 * prendere. Ignorando gli antenati, `.appaiate > .scheda-piattaforma` sembrava
 * colpire ANCHE le schede fuori da `.appaiate`; siccome quel selettore sta anche
 * nella media query, la media query sembrava coprire elementi che non copre, e
 * la guardia restava verde mentre le si rifaceva il guasto sotto il naso.
 *
 * *Un'approssimazione che «può solo essere più severa» va dimostrata, non
 * dichiarata: se sbaglia verso, non se ne accorge nessuno finché non serve.*
 *
 * Se la pila non torna vuota, questa funzione SOLLEVA invece di restituire un
 * albero storto: un albero sbagliato darebbe risposte sbagliate in silenzio, che
 * è precisamente il guasto che si sta rincorrendo.
 */
function albero(html: string, dove: string): Elemento[] {
  const pulito = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)\b[\s\S]*?<\/\1>/g, '');
  const fuori: Elemento[] = [];
  const pila: Nodo[] = [];
  for (const m of pulito.matchAll(/<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|[^">])*)(\/?)>/g)) {
    const [, chiusura, nomeGrezzo, attributi, autochiusa] = m;
    const tag = nomeGrezzo.toLowerCase();
    if (chiusura) {
      const i = pila.map((n) => n.tag).lastIndexOf(tag);
      if (i < 0) throw new Error(`${dove}: </${tag}> senza apertura`);
      pila.length = i;
      continue;
    }
    const classi = new Set(
      (/class="([^"]*)"/.exec(attributi)?.[1] ?? '').trim().split(/\s+/).filter(Boolean),
    );
    const nodo = { tag, classi };
    fuori.push({ tag, classi, antenati: [...pila], dove });
    if (!autochiusa && !VUOTI.has(tag)) pila.push(nodo);
  }
  if (pila.length) throw new Error(`${dove}: restano aperti ${pila.map((n) => n.tag).join(', ')}`);
  return fuori.filter((e) => e.classi.size > 0 || e.tag === 'img');
}

/** Un compound (`div.a.b`) contro un nodo. */
function compoundColpisce(compound: string, n: Nodo): boolean {
  if (compound.includes(':') || compound.includes('#') || compound.includes('[')) return false;
  const classi = (compound.match(/\.[a-zA-Z_-][\w-]*/g) ?? []).map((c) => c.slice(1));
  const tag = /^[a-zA-Z][\w-]*/.exec(compound)?.[0]?.toLowerCase();
  if (tag && tag !== '*' && tag !== n.tag) return false;
  if (!tag && classi.length === 0) return false;
  return classi.every((c) => n.classi.has(c));
}

/**
 * Il selettore colpisce l'elemento, antenati compresi. Si legge da destra a
 * sinistra, che è come lo legge il browser e come si risolve senza tornare
 * indietro: l'ultimo compound deve descrivere l'elemento, e ogni compound più a
 * sinistra deve trovare un antenato — il padre se il combinatore è `>`, un
 * antenato qualunque se è uno spazio.
 */
function colpisce(selettore: string, e: Elemento): boolean {
  const pezzi = selettore
    .trim()
    .split(/\s*(>)\s*|\s+/)
    .filter(Boolean);
  const compounds = pezzi.filter((x) => x !== '>');
  if (compounds.some((c) => c.includes('+') || c.includes('~'))) return false;
  if (!compoundColpisce(compounds[compounds.length - 1], e)) return false;

  // I combinatori, nell'ordine in cui separano i compound.
  const sequenza: ('>' | ' ')[] = [];
  for (let i = 0; i < pezzi.length; i += 1) {
    if (pezzi[i] === '>') sequenza.push('>');
    else if (i > 0 && pezzi[i - 1] !== '>') sequenza.push(' ');
  }

  let risalita = [...e.antenati];
  for (let i = compounds.length - 2; i >= 0; i -= 1) {
    const combinatore = sequenza[i];
    if (combinatore === '>') {
      const padre = risalita[risalita.length - 1];
      if (!padre || !compoundColpisce(compounds[i], padre)) return false;
      risalita = risalita.slice(0, -1);
    } else {
      const trovato = risalita
        .map((n, k) => [n, k] as const)
        .reverse()
        .find(([n]) => compoundColpisce(compounds[i], n));
      if (!trovato) return false;
      risalita = risalita.slice(0, trovato[1]);
    }
  }
  return true;
}

/**
 * Il cuore: chi vince davvero su questo elemento e questa proprietà. Ordine
 * della cascata, ridotto a quello che serve qui: prima la specificità, poi la
 * posizione nel foglio. Le regole di una media query stanno in fondo al foglio
 * e arrivano già in coda, quindi a parità di specificità vincono — che è
 * esattamente ciò che chi le scrive si aspetta, e non succede appena la
 * specificità non pareggia.
 */
function vincitrice(regole: Regola[], e: Elemento, prop: string): Regola | undefined {
  let vince: Regola | undefined;
  for (const r of regole) {
    if (!proprieta(r.corpo).has(prop) || !colpisce(r.selettore, e)) continue;
    if (
      !vince ||
      specificita(r.selettore) > specificita(vince.selettore) ||
      (specificita(r.selettore) === specificita(vince.selettore) && r.ordine >= vince.ordine)
    ) {
      vince = r;
    }
  }
  return vince;
}

/**
 * Le proprietà che una media query PROVA a cambiare e non cambia.
 *
 * ► LA DOMANDA GIUSTA NON È «VINCE QUESTA RIGA». ◄ Una media query scrive spesso
 * più righe sulla stessa proprietà — una generale e una per un caso
 * particolare — e la generale perde di proposito sul caso particolare. Chiedere
 * a ogni riga di vincere sempre segnala come guasti proprio le coppie scritte
 * bene: era il primo esito di questa prova, dodici righe rosse di cui dieci
 * innocenti, e una guardia che grida sempre è una guardia che si impara a
 * ignorare.
 *
 * La domanda è sull'ESITO: su questo elemento e questa proprietà, dopo che la
 * media query ha detto la sua, vince ancora una regola di base? Allora la media
 * query, TUTTA, non ha ottenuto niente lì — ed è l'unico caso che vale la pena
 * far diventare rosso.
 */
function righeCheNonFannoNiente(condizione: string, tutti: Elemento[]): string[] {
  const base = regole(soloBase(CSS));
  const stretta = regole(dentroMedia(CSS, condizione)).map((r) => ({
    ...r,
    ordine: r.ordine + 1_000_000,
  }));
  const dentro = new Set(stretta);
  const tutte = [...base, ...stretta];
  const guasti = new Set<string>();

  for (const r of stretta) {
    for (const prop of proprieta(r.corpo)) {
      for (const e of tutti) {
        if (!colpisce(r.selettore, e)) continue;
        const v = vincitrice(tutte, e, prop);
        if (v && !dentro.has(v)) {
          guasti.add(
            `\`${prop}\` non cambia su ${e.dove} (classi: ${[...e.classi].join(' ')}): ` +
              `\`@media ${condizione}\` prova con \`${r.selettore}\`, ma vince \`${v.selettore}\``,
          );
        }
      }
    }
  }
  return [...guasti];
}

describe('la specificità sul foglio del sito', () => {
  it('la conta sa che una classe batte un tipo, e si rifiuta sugli id', () => {
    // La conta è lo strumento di misura di tutto il file: se sbaglia lei, le
    // prove qui sotto passano per il motivo sbagliato. Si misura prima lei, su
    // casi la cui risposta è nota dallo standard.
    expect(specificita('.vetrina-secondo')).toBeLessThan(specificita('.vetrina-apertura img'));
    expect(specificita('.vetrina-apertura img')).toBeLessThan(
      specificita('.vetrina-apertura .vetrina-secondo'),
    );
    expect(specificita('.scheda-piattaforma')).toBeLessThan(specificita('.scheda-piattaforma.minore'));
    expect(specificita('img')).toBeLessThan(specificita('.a'));
    expect(() => specificita('#tutto')).toThrow();
  });

  it('una lista di selettori si conta un ramo per volta', () => {
    // `.a, .b.c { … }` non è una regola da tre classi: è una regola da una e una
    // da due. Contarle insieme direbbe che la media query vince quando non vince.
    const r = regole('.a, .b.c { flex: 1 }');
    expect(r.map((x) => x.selettore)).toEqual(['.a', '.b.c']);
    expect(r.map((x) => specificita(x.selettore))).toEqual([100, 200]);
  });

  const TUTTI = PAGINE.flatMap((p) => albero(readFileSync(join(SITO, p), 'utf8'), p));

  it('gli elementi delle pagine si leggono davvero', () => {
    // Se questa lettura tornasse vuota, le due prove qui sotto passerebbero
    // guardando il nulla. È il modo classico in cui una guardia diventa verde
    // per il motivo sbagliato, e questa riga lo esclude.
    expect(TUTTI.length).toBeGreaterThan(100);
    expect(TUTTI.some((e) => e.classi.has('scheda-piattaforma') && e.classi.has('minore'))).toBe(true);
    expect(TUTTI.some((e) => e.classi.has('vetrina-apertura'))).toBe(true);
    // E la conta della cascata sa il suo mestiere, misurata su un caso finto di
    // cui la risposta è nota: due classi battono una classe più un tipo.
    const finto = { tag: 'a', classi: new Set(['x', 'y']), antenati: [], dove: 'prova' };
    const scelta = vincitrice(
      [
        { selettore: '.x a', corpo: 'flex: 1;', ordine: 0 },
        { selettore: '.x.y', corpo: 'flex: 2;', ordine: 1 },
      ],
      finto,
      'flex',
    );
    expect(scelta?.selettore).toBe('.x.y');
  });

  it('nessuna regola delle media query punta a un selettore che non esiste', () => {
    // L'altra faccia della lettera morta: non «perde contro una regola più
    // forte» ma «non colpisce nessuno». Succede quando una classe viene
    // rinominata o tolta dall'HTML e la regola resta nel foglio: non dà errore,
    // non si vede, e il caso che doveva coprire resta scoperto.
    const ovunque = TUTTE_LE_PAGINE.flatMap((p) => albero(readFileSync(join(SITO, p), 'utf8'), p));
    expect(ovunque.length).toBeGreaterThan(300);
    const morte: string[] = [];
    for (const condizione of ['(max-width: 1000px)', '(max-width: 560px)']) {
      for (const r of regole(dentroMedia(CSS, condizione))) {
        if (r.selettore.includes(':') || r.selettore.includes('[')) continue;
        if (!ovunque.some((e) => colpisce(r.selettore, e))) {
          morte.push(`\`${r.selettore}\` in \`@media ${condizione}\` non colpisce niente in tutto il sito`);
        }
      }
    }
    expect(morte).toEqual([]);
  });

  it('sotto i 1000 px nessuna riga della media query è lettera morta', () => {
    expect(righeCheNonFannoNiente('(max-width: 1000px)', TUTTI)).toEqual([]);
  });

  it('sotto i 560 px nessuna riga della media query è lettera morta', () => {
    expect(righeCheNonFannoNiente('(max-width: 560px)', TUTTI)).toEqual([]);
  });

  it('le tre schede piccole hanno la stessa base e lo stesso accrescimento', () => {
    // Sono tre risposte alla stessa domanda — «c'è per il mio sistema?» — e una
    // più larga delle altre direbbe che una conta di più. Stessa `flex-basis` e
    // stesso `flex-grow` è ciò che le rende identiche a qualunque larghezza; è
    // una sola regola per tutte e tre, e questa prova difende che resti una.
    const minori = regole(soloBase(CSS)).filter((r) => r.selettore === '.scheda-piattaforma.minore');
    expect(minori.length, 'la regola delle schede minori non è una sola').toBe(1);
    expect(minori[0].corpo).toMatch(/flex:\s*1 1 \d+px/);
  });
});

describe('la vetrina dell’apertura', () => {
  it('la griglia dà più larghezza alla vetrina che al testo', () => {
    // A sinistra sono rimasti due gruppi di schede su tre: quella colonna si è
    // accorciata, e la larghezza che le avanza vale di più data all'immagine.
    const g = regole(soloBase(CSS)).find((r) => r.selettore === '.apertura-griglia');
    expect(g, 'nessuna `.apertura-griglia` nel foglio').toBeDefined();
    const colonne = /grid-template-columns:\s*1fr\s+([\d.]+)fr/.exec(g!.corpo);
    expect(colonne, 'le colonne dell’apertura non sono `1fr Nfr`').not.toBeNull();
    expect(Number(colonne![1])).toBeGreaterThan(1);
  });

  it('la scena resta sul logbook, e non tiene nessun fotogramma', () => {
    /*
     * ► QUESTA PROVA È STATA ROVESCIATA IL 3 SETTEMBRE 2026. ◄
     *
     * Prima PRETENDEVA `forwards` su tutte le animazioni della scena, con questa
     * motivazione: senza, l'ultimo fotogramma torna al primo e il sito mostra
     * per sempre la schermata di importazione. Il ragionamento era giusto e la
     * premessa no — la premessa era che lo stato a riposo di `.scena-poi` fosse
     * quello NASCOSTO. Reggeva l'animazione, e lasciava il `clip-path`
     * applicato per sempre.
     *
     * Il proprietario ha segnalato, da Chrome su Linux, **una riga chiara ferma
     * in mezzo all'immagine, che spariva passandoci sopra col mouse**. Passare
     * il mouse cambia la trasformazione della scena, quindi la ridisegna: è la
     * firma di un artefatto di composizione, e la sua causa è un livello che
     * resta separato — che è esattamente quello che un `clip-path` vivo dentro
     * un antenato con trasformazione 3D obbliga il browser a tenere.
     *
     * Adesso lo stato a riposo è quello FINALE, come ovunque su questo sito, e
     * la regola è l'opposto di prima: **nella scena nessuna animazione tiene il
     * suo ultimo fotogramma.** Chi rimettesse `forwards` qui rimetterebbe il
     * livello, e con lui la riga.
     *
     * ► E QUESTA PROVA NON PUÒ VEDERE LA RIGA. ◄ L'artefatto è della scheda
     * video; headless rasterizza via software e non lo riproduce — provato. Qui
     * si difende la CAUSA, non il sintomo, e va detto: se un giorno la riga
     * tornasse con questa prova verde, non è questa prova ad aver mentito, è la
     * causa a essere un'altra.
     */
    const stretta = regole(
      dentroMedia(CSS, '(min-width: 1001px) and (prefers-reduced-motion: no-preference)'),
    );
    const animate = stretta.filter((r) => /animation:/.test(r.corpo));
    expect(animate.length, 'nessuna animazione nella scena').toBeGreaterThan(0);

    /*
     * La regola vale per quello che sta DENTRO `.scena` — cioè dentro la
     * scatola con la trasformazione 3D e `overflow: hidden` — e non per le
     * etichette dei formati, che sono sorelle della scena e non figlie: lo dice
     * il commento di `.scena-file` nel foglio di stile, e non è un dettaglio.
     * Quelle il loro ultimo fotogramma lo devono tenere, o le targhette
     * riapparirebbero in eterno.
     *
     * *Una regola scritta più larga di quello che ha capito si accende su
     * qualcosa che va bene, e insegna a spegnerla.* La prima versione di questa
     * prova è diventata rossa proprio così, su `.scena-file span`.
     */
    // `.scena` stessa è entrata in questo elenco il 3 settembre, quando
    // l'inclinazione è diventata un'animazione d'ingresso invece di uno stato a
    // riposo: se un giorno tenesse il suo ultimo fotogramma, si riavrebbe una
    // trasformazione applicata per sempre — cioè di nuovo un livello separato.
    const dentroLaScatola = animate.filter((r) =>
      ['.scena', '.scena-poi', '.scena::after'].includes(r.selettore),
    );
    expect(dentroLaScatola.length, 'nessuna animazione dentro la scena').toBeGreaterThan(0);
    for (const r of dentroLaScatola) {
      expect(
        r.corpo,
        `\`${r.selettore}\` tiene l'ultimo fotogramma: il livello resta separato e su alcune schede video lascia una riga`,
      ).not.toMatch(/animation:[^;]*\bforwards\b/);
    }

    // E la tendina deve partire nascosta, o durante i 2,2 s di attesa si
    // vedrebbe già il logbook e l'animazione non racconterebbe più niente.
    const tendina = animate.find((r) => r.selettore === '.scena-poi');
    expect(tendina, "la tendina non c'è più").toBeDefined();
    expect(tendina!.corpo, 'senza `backwards` la tendina parte già scoperta').toMatch(
      /animation:[^;]*\bbackwards\b/,
    );

    // Lo stato a riposo è quello finale: NESSUNA regola di `.scena-poi` ritaglia
    // più con un `inset`. Il fotogramma nascosto vive solo dentro i keyframes,
    // dove dura il tempo dell'animazione e non un minuto di più.
    // `soloBase` e non `CSS`: toglie i commenti e le media query, cioè lascia
    // le regole che valgono sempre. Serve togliere i commenti perché questo
    // punto del foglio di stile SPIEGA il ritaglio citandolo per esteso, e
    // cercarlo nel testo grezzo lo troverebbe nella spiegazione — la prima
    // versione di questa prova faceva così ed era verde anche rimettendo il
    // difetto. *È lo stesso inganno di `aria-current` contato nei commenti,
    // due metri più su in questo stesso file.*
    const riposo = regole(soloBase(CSS)).filter((r) => r.selettore === '.scena-poi');
    expect(riposo.length, '`.scena-poi` non ha più una regola fuori dalle media query').toBe(1);
    expect(riposo[0].corpo, '`.scena-poi` ritaglia a riposo: il livello resta separato').not.toMatch(
      /clip-path:\s*inset/,
    );
  });

  it('la scena non si inclina in 3D: in 3D si spezzava', () => {
    /*
     * ► IL DIFETTO CHE QUESTA PROVA DIFENDE, E CHE NON PUÒ VEDERE. ◄
     *
     * Il 3 settembre 2026 il proprietario ha segnalato, da Chrome su Linux, una
     * riga blu ferma che tagliava in mezzo la schermata dell'apertura, e che
     * spariva passandoci sopra col mouse. La causa non era nel foglio di stile
     * ma nel modo in cui il browser disegna: un livello ruotato in 3D e più
     * alto di una certa misura viene spezzato in piastrelle, disegnato e
     * ricucito ruotato — e la giuntura si vede. Il mouse la faceva sparire
     * perché raddrizzava la scena, cioè costringeva a ridisegnare.
     *
     * Isolato una prova alla volta dalla console, sulla sua macchina: la
     * prospettiva da sola migliorava «in parte», il passaggio al 2D l'ha fatta
     * sparire del tutto.
     *
     * **Headless non la riproduce**: qui la rasterizzazione è software e
     * l'immagine è sempre stata pulita — provato prima di scrivere questa
     * prova. Quindi qui si difende la CAUSA e non il sintomo: sulla scena non
     * entra nessuna trasformazione 3D. È il tipo di guardia che vale solo
     * quanto il commento che porta, e per questo il commento c'è.
     */
    const funzioni3D =
      /\b(perspective|rotate3d|rotateX|rotateY|rotateZ|translateZ|translate3d|matrix3d)\s*\(/;
    /*
     * `\.scena(?![\w-])` e non `^\.scena`: la regola che conta di più è
     * `.vetrina-apertura:hover .scena`, dove `.scena` non sta in testa. La prima
     * versione di questa prova tagliava il selettore al primo `:` e guardava
     * solo la parte davanti — quindi la regola del mouse over non la vedeva
     * affatto, ed è rimasta verde rimettendoci il 3D. Trovato mutando, non
     * rileggendo. Il `(?![\w-])` tiene fuori `.scena-poi`, `.scena-quadro` e
     * `.scena-file`, che sono altri elementi.
     */
    const sceniche = regole(CSS).filter((r) => /\.scena(?![\w-])/.test(r.selettore));
    expect(sceniche.length, 'nessuna regola per `.scena`').toBeGreaterThan(0);
    for (const r of sceniche) {
      const trasformazioni = [...r.corpo.matchAll(/transform:\s*([^;]*)/g)].map((m) => m[1]);
      for (const t of trasformazioni) {
        expect(t, `\`${r.selettore}\` torna in 3D: la riga blu torna con lui`).not.toMatch(funzioni3D);
      }
    }

    // E la prospettiva non deve rientrare dal contenitore, che è dove stava
    // anche prima — applicata due volte, sul contenitore e dentro il transform.
    const contenitore = regole(soloBase(CSS)).find((r) => r.selettore === '.vetrina-apertura');
    expect(contenitore, '`.vetrina-apertura` non ha più una regola sua').toBeDefined();
    expect(contenitore!.corpo, '`.vetrina-apertura` rimette la prospettiva').not.toMatch(/perspective:/);
  });

  it('nemmeno i fotogrammi dell’ingresso tornano in 3D', () => {
    // La regola «niente 3D sulla scena» si aggira scrivendolo nei keyframes
    // invece che nella regola: durante l'ingresso la riga tornerebbe, e chi
    // guarda la vedrebbe proprio nel momento in cui sta guardando. Il parser
    // delle regole non entra nei `@keyframes`, quindi qui si guarda il testo.
    const funzioni3D =
      /\b(perspective|rotate3d|rotateX|rotateY|rotateZ|translateZ|translate3d|matrix3d)\s*\(/;
    const blocchi = [...senzaCommenti(CSS).matchAll(/@keyframes\s+(scena-[\w-]+)\s*\{([\s\S]*?)\n\}/g)];
    expect(blocchi.length, 'nessun keyframe della scena').toBeGreaterThan(0);
    for (const [, nome, corpo] of blocchi) {
      expect(corpo, `\`@keyframes ${nome}\` usa una trasformazione 3D`).not.toMatch(funzioni3D);
    }
  });

  it('al passaggio del mouse la scena non si muove', () => {
    // Decisione del proprietario, 3 settembre 2026: l'inclinazione a riposo dava
    // fastidio, quindi la scena resta dritta e l'effetto al passaggio è stato
    // tolto. Raddrizzare una cosa già dritta non è un effetto: è un
    // ingrandimento improvviso. Qui si difende che non rientri per inerzia,
    // insieme a qualche altro ritocco.
    const conMouse = regole(CSS).filter(
      (r) => /:hover/.test(r.selettore) && /\.scena(?![\w-])/.test(r.selettore),
    );
    expect(conMouse, 'è tornata una regola :hover sulla scena').toEqual([]);
  });

  it('chi ha chiesto meno movimento vede comunque il logbook', () => {
    // La scena si regge su `clip-path: inset(0 0 100% 0)`, cioè il logbook è
    // ritagliato a zero finché l'animazione non lo scopre. Se l'animazione non
    // parte — ed è esattamente quello che chiede `prefers-reduced-motion` — quel
    // ritaglio va tolto a mano, se no resta una finestra vuota. *Un fotogramma
    // iniziale che serve solo all'animazione diventa il risultato finale per chi
    // l'animazione non la vuole.*
    const quiete = regole(dentroMedia(CSS, '(prefers-reduced-motion: reduce)'));
    const scoperta = quiete.find((r) => r.selettore === '.scena-poi');
    expect(scoperta, 'senza animazione il logbook resta ritagliato via').toBeDefined();
    expect(scoperta!.corpo).toMatch(/clip-path:\s*none/);
  });

  for (const pagina of PAGINE) {
    describe(pagina, () => {
      const html = readFileSync(join(SITO, pagina), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
      const vetrina = /<div class="vetrina-apertura">([\s\S]*?)<div class="scena-file"/.exec(html);
      const quadri = vetrina
        ? [...vetrina[1].matchAll(/<picture[^>]*>([\s\S]*?)<\/picture>/g)].map((m) => m[1])
        : [];

      it('ha due schermate: quella da cui si parte e quella a cui si arriva', () => {
        expect(vetrina, 'nessuna `.vetrina-apertura` nella pagina').not.toBeNull();
        expect(quadri.length, 'la scena non ha due `picture`').toBe(2);
      });

      it('l’alt vero sta solo sulla seconda', () => {
        // Chi legge con la voce non deve sentirsi raccontare due schermate quando
        // ne resta una: la prima è un fotogramma, la seconda è il risultato.
        const alt = quadri.map((q) => /alt="([^"]*)"/.exec(q)![1]);
        expect(alt[0], 'la prima schermata ha un alt: ne verrebbero letti due').toBe('');
        expect(alt[1].length, 'la seconda schermata non ha un alt che descriva').toBeGreaterThan(40);
      });

      it('su una colonna sola non si scaricano nemmeno', () => {
        // ► NASCONDERE NON È NON SCARICARE. ◄ Con delle `img` normali il telefono
        // si prendeva lo stesso i 350 kB delle due fotografie, `display: none` o
        // no: misurato a 390 px, le richieste partivano. `loading="lazy"` lo
        // evitava ma costava 70 ms sul desktop — questa è l'immagine più grande
        // sopra la piega — e allora `picture`: sopra i 1000 px la `source` porta
        // la fotografia, sotto non corrisponde nessuna `source` e resta il `src`,
        // che è un GIF trasparente di quarantatré byte.
        //
        // Rimettere lì una fotografia rifarebbe il difetto **senza cambiare
        // niente di visibile**: la pagina apparirebbe identica a chiunque la
        // guardi, e il telefono ricomincerebbe a pagarla.
        for (const q of quadri) {
          const src = /<img[\s\S]*?src="([^"]+)"/.exec(q)![1];
          expect(src.startsWith('data:image/'), `un src della scena è \`${src}\``).toBe(true);
          expect(src.length).toBeLessThan(200);
          expect(q).toMatch(/media="\(min-width: 1001px\)"/);
        }
      });

      it('le due soglie combaciano: la `source` parte dove il foglio smette di nascondere', () => {
        // La `source` vale da 1001 px, il foglio nasconde fino a 1000. Se una
        // delle due si muovesse da sola ci sarebbe una fascia di larghezze in cui
        // la vetrina si vede vuota — oppure una in cui c'è ma non si scarica.
        const stretta = regole(dentroMedia(CSS, '(max-width: 1000px)'));
        const nascosta = stretta.find(
          (r) => r.selettore === '.vetrina-apertura' && /display:\s*none/.test(r.corpo),
        );
        expect(nascosta, 'sotto i 1000 px la vetrina non è nascosta').toBeDefined();
        const soglie = [...vetrina![1].matchAll(/media="\(min-width: (\d+)px\)"/g)].map((m) => Number(m[1]));
        expect(soglie.length).toBe(2);
        expect(new Set(soglie).size, 'le due `source` hanno soglie diverse').toBe(1);
        expect(soglie[0]).toBe(1001);
      });

      it('sono della stessa misura, se no la tendina salta', () => {
        // Si sovrappongono: due fotografie di forma diversa si vedrebbero
        // «saltare» a metà tendina. Si scattano nello stesso giro, con la stessa
        // finestra, e qui si controlla che lo dichiarino.
        const misure = quadri.map((q) =>
          /width="(\d+)"\s+height="(\d+)"/.exec(q.replace(/\s+/g, ' '))!.slice(1, 3).join('×'),
        );
        expect(misure[0], `misure diverse: ${misure.join(' e ')}`).toBe(misure[1]);
        const [l, h] = misure[0].split('×').map(Number);
        // Alta e non larga: una 16:10 in una colonna alta lascia mezza colonna
        // vuota, e non c'è CSS che chiuda quel vuoto.
        expect(h, `la scena è ${l}×${h}, non è alta`).toBeGreaterThan(l);
      });

      it('sono nella lingua della pagina, e sono le due giuste', () => {
        const srcset = [...vetrina![1].matchAll(/srcset="([^"]+)"/g)].map((m) => m[1]);
        expect(srcset.length).toBe(2);
        for (const x of srcset) expect(x).toContain(pagina.startsWith('en/') ? '-en.jpg' : '-it.jpg');
        expect(srcset[0], 'la prima non è la schermata di importazione').toContain('vetrina-importa-');
        expect(srcset[1], 'la seconda non è il logbook').toMatch(/vetrina-(it|en)\.jpg/);
      });

      it('le etichette dei formati sono decorazione, e dicono cose vere', () => {
        const striscia = /<div class="scena-file"([\s\S]*?)<\/div>/.exec(html);
        expect(striscia, 'la scena non ha le etichette dei formati').not.toBeNull();
        expect(striscia![1], 'le etichette non sono aria-hidden: verrebbero lette').toContain(
          'aria-hidden="true"',
        );
        const nomi = [...striscia![1].matchAll(/<span>([^<]+)<\/span>/g)].map((m) => m[1]);
        expect(nomi.length).toBe(5);
        // Ogni formato che vola deve essere un formato che il programma legge
        // davvero, e la scheda «Importa da quello che hai già» è dove sta scritto.
        const scheda = /Importa da quello che hai già|Imports what you already have/.test(html);
        expect(scheda, 'la scheda dei formati non c’è più: le etichette non hanno più una fonte').toBe(true);
        // ► SI CERCA NELLA PAGINA SENZA LE ETICHETTE. ◄ Cercare in tutta la
        // pagina era una prova che non poteva fallire: il nome sta scritto
        // nell'etichetta da cui l'ho appena preso, quindi `includes` era vero
        // per costruzione. Visto verde su un'etichetta inventata di sana pianta,
        // che è il difetto che doveva prendere. *Una guardia circolare non è una
        // guardia debole: è una riga che non guarda niente.*
        const restoDellaPagina = html.replace(striscia![0], '');
        for (const n of nomi) {
          const radice = n.split(' ')[0];
          expect(
            restoDellaPagina.includes(radice),
            `\`${n}\` vola in apertura ma non è scritto da nessun’altra parte della pagina`,
          ).toBe(true);
        }
      });
    });
  }
});

describe('le animazioni d’ingresso', () => {
  /*
   * ► UN'ANIMAZIONE CHE NESSUNO VEDE NON È UN'ANIMAZIONE. ◄
   *
   * Il profilo che si traccia cominciava a 0,35 s dal caricamento e sta sotto la
   * piega: chi ci arrivava scorrendo, tre secondi dopo, trovava un disegno
   * fermo. Nessun comando se n'era accorto — l'animazione girava davvero, solo
   * fuori dallo schermo di chiunque.
   *
   * La regola che questo blocco difende: **fuori dall'apertura, un'animazione a
   * un colpo solo (`forwards`) deve essere agganciata a `in-vista`.** Non
   * «il profilo sia agganciato»: qualunque animazione, anche quella che qualcuno
   * aggiungerà fra sei mesi in una sezione che oggi non esiste.
   *
   * L'apertura è l'eccezione dichiarata: quella si vede appena la pagina si
   * apre, e aspettare uno scorrimento vorrebbe dire non mostrarla mai.
   */
  const APERTURA = ['.scena', '.scena-poi', '.scena-file', '.scena::after'];

  it('ogni animazione a un colpo solo fuori dall’apertura parte scorrendo', () => {
    const colpevoli: string[] = [];
    for (const r of regole(senzaCommenti(CSS))) {
      if (!/animation:[^;]*\bforwards\b/.test(r.corpo)) continue;
      if (APERTURA.some((a) => r.selettore.startsWith(a))) continue;
      if (!r.selettore.includes('in-vista')) colpevoli.push(r.selettore);
    }
    expect(colpevoli, 'partono al caricamento, quindi sotto la piega non le vede nessuno').toEqual([]);
  });

  it('lo stato di riposo è quello FINALE, non il primo fotogramma', () => {
    // La difesa vera per chi non ha JavaScript. Se il riposo fosse la tela
    // bianca e la classe non arrivasse mai, il profilo resterebbe vuoto per
    // sempre — e non lo direbbe nessun errore.
    const base = regole(soloBase(CSS));
    const riposo = base.find((r) => r.selettore === '.profilo .linea');
    expect(riposo, 'non c’è più una regola di riposo per la linea del profilo').toBeDefined();
    expect(riposo!.corpo, 'a riposo la linea è arrotolata: senza script non si disegna mai').toMatch(
      /stroke-dashoffset:\s*0\b/,
    );
    expect(riposo!.corpo, 'l’animazione è ancora sullo stato di riposo').not.toMatch(/animation:/);

    for (const sel of ['.profilo .area', '.profilo .segno']) {
      const r = base.find((x) => x.selettore === sel);
      expect(r, `manca la regola di riposo per \`${sel}\``).toBeDefined();
      expect(r!.corpo, `\`${sel}\` a riposo è invisibile: senza script non comparirebbe mai`).toMatch(
        /opacity:\s*1\b/,
      );
    }
  });

  for (const pagina of PAGINE) {
    it(`${pagina}: chi si anima lo dichiara, e c’è chi lo osserva`, () => {
      const html = readFileSync(join(SITO, pagina), 'utf8');
      const senzaMarcatore = html.replace(/<!--[\s\S]*?-->/g, '');
      expect(
        /<div class="profilo"[^>]*\bdata-in-vista\b/.test(senzaMarcatore),
        'il profilo non è marcato `data-in-vista`: la classe non arriverà mai',
      ).toBe(true);
      // E qualcuno deve mettere quella classe. Il marcatore senza osservatore è
      // un attributo che non fa niente — e la pagina resterebbe ferma senza che
      // niente dia errore.
      expect(html).toContain('IntersectionObserver');
      expect(html).toContain("classList.add('in-vista')");
      // Chi ha chiesto meno movimento non deve nemmeno riceverla.
      expect(html).toContain('prefers-reduced-motion: reduce');
    });
  }
});

describe('le schede delle piattaforme', () => {
  for (const pagina of PAGINE) {
    describe(pagina, () => {
      const html = readFileSync(join(SITO, pagina), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
      // `class="schede-piattaforma appaiate"` sul primo gruppo: la classe si
      // cerca DENTRO l'attributo e non come attributo intero, se no il primo
      // gruppo non si trova e la conta dice uno invece di due.
      const gruppi = [...html.matchAll(/<div class="schede-piattaforma[^"]*">([\s\S]*?)<\/div>/g)].map(
        (m) => m[1],
      );

      it('i gruppi sono due, e il secondo ha tutte e tre le piattaforme', () => {
        expect(gruppi.length, 'i gruppi di schede non sono due').toBe(2);
        const ultimo = gruppi[1];
        for (const nome of ['Windows', 'Android', 'Linux']) {
          expect(ultimo, `${nome} non è nel secondo gruppo`).toContain(`>${nome}<`);
        }
        expect((ultimo.match(/<a\b/g) ?? []).length).toBe(3);
      });

      it('le tre schede sono dello stesso tipo', () => {
        // Una scheda con una classe in più è una scheda con una forma in più, e
        // tre risposte alla stessa domanda devono avere la stessa forma. `larga`
        // era la forma della scheda che stava da sola: non deve tornare.
        const classi = [...gruppi[1].matchAll(/class="(scheda-piattaforma[^"]*)"/g)].map((m) => m[1].trim());
        expect(classi.length).toBe(3);
        expect(new Set(classi).size, `classi diverse fra le tre schede: ${classi.join(' | ')}`).toBe(1);
        expect(classi[0]).not.toContain('larga');
      });

      it('il limite del pacchetto Linux è scritto dov’è la spiegazione, non davanti al pulsante', () => {
        const sezione = /<section id="altre-piattaforme">([\s\S]*?)<\/section>/.exec(html);
        expect(sezione, 'manca la sezione delle altre piattaforme').not.toBeNull();
        expect(sezione![1]).toContain('WebKitGTK 4.1');
        expect(sezione![1]).toMatch(/Ubuntu 24\.04/);
        expect(sezione![1]).toMatch(/Debian 13/);
        // E NON in cima: là davanti erano tre righe fra chi legge e il pulsante.
        const cima = html.slice(0, html.indexOf('<section id="altre-piattaforme">'));
        expect(cima, 'il limite di WebKitGTK è tornato in apertura').not.toContain('WebKitGTK');
      });

      it('ogni piattaforma ha le stesse righe, nello stesso ordine', () => {
        // Una tabella in cui le colonne non hanno le stesse righe non si legge
        // in orizzontale, e leggerla in orizzontale è tutto il motivo per cui è
        // una tabella.
        const sezione = /<section id="altre-piattaforme">([\s\S]*?)<\/section>/.exec(html)![1];
        const colonne = [...sezione.matchAll(/<dl class="dati-piattaforma">([\s\S]*?)<\/dl>/g)].map((m) =>
          [...m[1].matchAll(/<dt>([^<]+)<\/dt>/g)].map((d) => d[1].trim()),
        );
        expect(colonne.length, 'le colonne delle piattaforme non sono tre').toBe(3);
        expect(colonne[1]).toEqual(colonne[0]);
        expect(colonne[2]).toEqual(colonne[0]);
        expect(colonne[0].length).toBeGreaterThanOrEqual(3);
      });

      it('ogni riquadro tiene il suo titolo vero, anche con l’icona', () => {
        // Il segno è decorazione, il titolo è struttura: chi naviga per
        // intestazioni deve continuare a trovarle. Un riquadro che perde l'`h3`
        // per guadagnare un'icona ha fatto un cattivo affare.
        for (const capo of html.matchAll(/<(\w+) class="capo-scheda">([\s\S]*?)<\/\1>/g)) {
          expect(capo[1], `un capo-scheda è un <${capo[1]}> invece di un h3`).toBe('h3');
          expect(capo[2], 'un capo-scheda ha un segno senza aria-hidden').toContain('aria-hidden="true"');
          expect(capo[2]).toMatch(/<span>[^<]{2,}<\/span>/);
        }
        // La conta: sei funzioni, tre piattaforme, tre sulla fusione. Non è
        // pignoleria — è la riga che si accorge se una sezione viene rifatta
        // senza il suo segno, che è il modo in cui una pagina torna a essere
        // metà con le icone e metà senza.
        expect((html.match(/class="capo-scheda"/g) ?? []).length, 'i capi-scheda non sono dodici').toBe(12);
      });
    });
  }
});
