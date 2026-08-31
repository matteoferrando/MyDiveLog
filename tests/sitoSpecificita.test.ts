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
  'en/index.html',
  'en/privacy.html',
  'en/terms.html',
  'en/dive-logbook-law.html',
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

/** Il contenuto di una media query, presa per la sua condizione esatta. */
function dentroMedia(css: string, condizione: string): string {
  const pulito = senzaCommenti(css);
  const apre = pulito.indexOf(`@media ${condizione} {`);
  if (apre < 0) throw new Error(`nessuna \`@media ${condizione}\` nel foglio`);
  let i = pulito.indexOf('{', apre);
  let profondita = 0;
  const inizio = i + 1;
  for (; i < pulito.length; i += 1) {
    if (pulito[i] === '{') profondita += 1;
    if (pulito[i] === '}') {
      profondita -= 1;
      if (profondita === 0) return pulito.slice(inizio, i);
    }
  }
  throw new Error(`la \`@media ${condizione}\` non si chiude`);
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

  for (const pagina of PAGINE) {
    describe(pagina, () => {
      const html = readFileSync(join(SITO, pagina), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
      const vetrina = /<div class="vetrina-apertura">([\s\S]*?)<\/div>/.exec(html);

      it('ha una schermata sola', () => {
        expect(vetrina, 'nessuna `.vetrina-apertura` nella pagina').not.toBeNull();
        expect((vetrina![1].match(/<img/g) ?? []).length).toBe(1);
      });

      it('è alta, se no la colonna resta mezza vuota', () => {
        // Una 16:10 larga quanto la colonna riempie 381 px di 1128. Nessun CSS
        // chiude quel vuoto: un'immagine non diventa più alta perché le si dà
        // più spazio. Serve una fotografia alta, e questa riga difende che lo
        // resti — reinfilare qui una schermata larga rifà il buco.
        const l = Number(/width="(\d+)"/.exec(vetrina![1])![1]);
        const h = Number(/height="(\d+)"/.exec(vetrina![1])![1]);
        expect(h, `la schermata dell’apertura è larga ${l}×${h}, non alta`).toBeGreaterThan(l);
      });

      it('si scarica subito, e dichiara le sue misure', () => {
        expect(vetrina![1]).toMatch(/loading="eager"/);
        expect(vetrina![1]).toMatch(/width="\d+"/);
        expect(vetrina![1]).toMatch(/height="\d+"/);
      });

      it('è nella lingua della pagina, e non è una delle cinque là sotto', () => {
        const src = /src="([^"]+)"/.exec(vetrina![1])![1];
        expect(src).toContain(pagina.startsWith('en/') ? '-en.jpg' : '-it.jpg');
        expect(src, 'in apertura c’è una delle schermate della galleria').toContain('vetrina-');
      });

      it('ha un alt che descrive, non un’etichetta', () => {
        const alt = /alt="([^"]+)"/.exec(vetrina![1])![1];
        expect(alt.length).toBeGreaterThan(40);
      });
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
