/**
 * La vetrina dell'apertura: due schermate impilate, e la seconda che sparisce
 * sul telefono.
 *
 * ► IL GUASTO CHE HA FATTO NASCERE QUESTO FILE. ◄ La regola che nasconde la
 * seconda schermata sotto i 1000 px era scritta `.vetrina-secondo { display:
 * none }`. Non ha mai nascosto niente: più sopra nel foglio c'è
 * `.vetrina-apertura img { display: block }`, e una classe più un tipo (0-1-1)
 * batte una classe sola (0-1-0) — la media query non c'entra, la specificità
 * si conta prima. Il sintomo era beffardo: dentro la stessa media query
 * `.vetrina-pila { position: static }` applicava benissimo, quindi tutto
 * diceva che la media query funzionasse. Misurato in un browser vero servito da
 * HTTP: a 900 px e a 480 px la seconda schermata risultava `display: block`,
 * dopo la correzione `display: none`.
 *
 * ► E NON ERA SOLO `display`. ◄ Corretta quella, una schermata ha mostrato che
 * la seconda immagine era ancora larga quanto la prima e inclinata come la
 * prima: cioè non era una pila, erano due rettangoli uguali in colonna. Stessa
 * aritmetica, altre quattro proprietà — `width`, `margin`, `transform`,
 * `position` — tutte scritte in una regola che perdeva per intero. Di qui la
 * prova che segue, che non guarda una proprietà sola ma tutte quelle che quella
 * regola dichiara: correggere il sintomo visto e fermarsi lì è il modo in cui
 * un difetto sopravvive alla propria correzione.
 *
 * Perché una guardia di testo e non di disegno: il difetto è aritmetica di
 * specificità, e l'aritmetica si conta nel sorgente. La prova gira in
 * millisecondi a ogni `npm test`, mentre aprire Chromium no — e una guardia che
 * nessuno fa girare non è una guardia. Il disegno vero si è misurato a mano
 * quando si è corretto, a cinque larghezze e su tutte e due le lingue.
 *
 * L'altra cosa che questo file difende è che la seconda schermata sia `lazy` e
 * la prima no: la prima sta nella prima schermata di chi apre il sito e deve
 * esserci subito, la seconda sta più in basso e su un telefono non si scarica
 * affatto. Invertirle costa banda a chi apre il sito da una barca.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SITO = fileURLToPath(new URL('../sito', import.meta.url));
const CSS = readFileSync(join(SITO, 'stile.css'), 'utf8');
const PAGINE = ['index.html', 'en/index.html'] as const;

/** I commenti fuori: dentro se ne cita più d'uno di selettore per spiegarlo. */
function senzaCommenti(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * La specificità di un selettore, ridotta a un numero confrontabile. Non serve
 * un parser CSS completo: qui dentro i selettori sono classi, tipi e nient'altro
 * — niente `#id`, niente `:where()`, niente attributi. Se un giorno ce ne
 * fossero, questa conta andrebbe rifatta, e la prova qui sotto sugli id se ne
 * accorge invece di dare un numero sbagliato in silenzio.
 */
function specificita(selettore: string): number {
  if (selettore.includes('#')) throw new Error(`selettore con id, la conta non lo prevede: ${selettore}`);
  const classi = (selettore.match(/\.[a-zA-Z_-][\w-]*/g) ?? []).length;
  const pseudoClassi = (selettore.match(/:[a-zA-Z-]+/g) ?? []).length;
  const tipi = (
    selettore
      .replace(/\.[a-zA-Z_-][\w-]*/g, ' ')
      .replace(/:[a-zA-Z-]+/g, ' ')
      .match(/\b[a-z][a-z0-9]*\b/g) ?? []
  ).length;
  return (classi + pseudoClassi) * 100 + tipi;
}

/** Le proprietà dichiarate in un corpo di regola, in una mappa nome → valore. */
function dichiarazioni(corpo: string): Map<string, string> {
  const fuori = new Map<string, string>();
  for (const riga of corpo.split(';')) {
    const i = riga.indexOf(':');
    if (i < 0) continue;
    const nome = riga.slice(0, i).trim();
    if (nome) fuori.set(nome, riga.slice(i + 1).trim());
  }
  return fuori;
}

/**
 * Il foglio senza le media query. Serve perché le regole di base e quelle
 * dentro una media query non si confrontano fra loro nel modo che questa prova
 * conta: mescolarle darebbe un verdetto sbagliato in silenzio.
 */
function senzaMediaQuery(css: string): string {
  const pulito = senzaCommenti(css);
  let fuori = '';
  let profondita = 0;
  let dentroMedia = 0;
  for (let i = 0; i < pulito.length; i += 1) {
    if (pulito.startsWith('@media', i) && profondita === 0) dentroMedia = profondita + 1;
    if (pulito[i] === '{') profondita += 1;
    if (!dentroMedia) fuori += pulito[i];
    if (pulito[i] === '}') {
      profondita -= 1;
      if (dentroMedia && profondita < dentroMedia) dentroMedia = 0;
    }
  }
  return fuori;
}

/** Tutte le regole `selettore { corpo }` del foglio, in ordine di comparsa. */
function regole(css: string): { selettore: string; corpo: string }[] {
  const fuori: { selettore: string; corpo: string }[] = [];
  const rx = /([^{}@]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(senzaCommenti(css))) !== null) {
    const selettore = m[1].trim();
    if (selettore && !selettore.startsWith('@')) fuori.push({ selettore, corpo: m[2] });
  }
  return fuori;
}

describe('la vetrina dell’apertura', () => {
  it('la conta della specificità sa che una classe batte un tipo', () => {
    // La conta è lo strumento di misura di questo file: se sbaglia lei, le
    // prove qui sotto passano per il motivo sbagliato. Quindi si misura prima
    // lo strumento, su casi di cui la risposta è nota dallo standard.
    expect(specificita('.vetrina-secondo')).toBeLessThan(specificita('.vetrina-apertura img'));
    expect(specificita('.vetrina-apertura img')).toBeLessThan(
      specificita('.vetrina-apertura .vetrina-secondo'),
    );
    expect(specificita('img')).toBeLessThan(specificita('.a'));
  });

  it('sotto i 1000 px la regola che nasconde la seconda schermata batte quelle che la mostrano', () => {
    const stretta = /@media \(max-width: 1000px\) \{([\s\S]*?)\n\}/.exec(senzaCommenti(CSS));
    expect(stretta, 'nessuna @media (max-width: 1000px) nel foglio').not.toBeNull();

    const nasconde = regole(stretta![1]).filter((r) => /display:\s*none/.test(r.corpo));
    expect(nasconde.length, 'nessuna regola nasconde niente nella media query stretta').toBeGreaterThan(0);

    // La regola che nasconde la seconda schermata, qualunque forma abbia.
    const suSecondo = nasconde.filter((r) => r.selettore.includes('.vetrina-secondo'));
    expect(suSecondo.length, 'sotto i 1000 px la seconda schermata non viene nascosta').toBe(1);

    // Chiunque, prima, dia un `display` a quell’immagine: la regola che
    // nasconde deve batterlo. È il difetto vero, e questa è la riga che lo vede.
    const mostrano = regole(CSS).filter(
      (r) =>
        /display:\s*(?!none)/.test(r.corpo) &&
        (r.selettore.includes('.vetrina-apertura') || r.selettore.includes('.vetrina-secondo')),
    );
    expect(
      mostrano.length,
      'nessuna regola dà un display alla vetrina: la prova non misura niente',
    ).toBeGreaterThan(0);
    for (const r of mostrano) {
      expect(
        specificita(suSecondo[0].selettore),
        `\`${suSecondo[0].selettore}\` non batte \`${r.selettore}\`: sul telefono la seconda schermata resta visibile`,
      ).toBeGreaterThanOrEqual(specificita(r.selettore));
    }
  });

  it('ogni proprietà della seconda schermata batte quelle che le arrivano addosso', () => {
    // Fuori dalle media query: sono le regole di base, quelle che si applicano
    // a schermo largo, ed è lì che la pila deve esistere.
    const base = regole(senzaMediaQuery(CSS));

    const suSecondo = base.filter((r) => r.selettore.includes('.vetrina-secondo'));
    expect(suSecondo.length, 'nessuna regola veste la seconda schermata').toBe(1);
    const nostra = suSecondo[0];
    const posizioneNostra = base.indexOf(nostra);

    const proprietaNostre = new Set(dichiarazioni(nostra.corpo).keys());
    expect(proprietaNostre.size, 'la regola della seconda schermata è vuota').toBeGreaterThan(3);

    // Chiunque altro colpisca quella stessa immagine. `.vetrina-apertura img`
    // la colpisce: la seconda schermata È un `img` dentro `.vetrina-apertura`.
    //
    // Le pseudo-classi restano fuori, e non per comodità: `:hover` descrive uno
    // stato, non il riposo. `.vetrina-apertura img:hover` batte davvero questa
    // regola sulla `transform` — la prova l'ha trovato da sola — ma quello che
    // fa è raddrizzare l'immagine sotto il mouse, ed è quello che deve fare
    // anche sulla seconda. Escluderla è una scelta, scritta qui perché si veda:
    // se un giorno una pseudo-classe toccasse la LARGHEZZA, questa riga
    // andrebbe rifatta invece di lasciar passare la cosa in silenzio.
    const rivali = base.filter(
      (r) =>
        r !== nostra &&
        r.selettore.includes('.vetrina-apertura') &&
        /(^|\s)img\b/.test(r.selettore) &&
        !r.selettore.includes(':'),
    );
    expect(
      rivali.length,
      'nessuna regola contende la seconda schermata: la prova non misura niente',
    ).toBeGreaterThan(0);

    for (const rivale of rivali) {
      const contese = [...dichiarazioni(rivale.corpo).keys()].filter((k) => proprietaNostre.has(k));
      if (contese.length === 0) continue;
      const nostraSpecificita = specificita(nostra.selettore);
      const suaSpecificita = specificita(rivale.selettore);
      const nostraVince =
        nostraSpecificita > suaSpecificita ||
        // A parità di specificità decide l'ordine: vince chi è scritto dopo.
        (nostraSpecificita === suaSpecificita && posizioneNostra > base.indexOf(rivale));
      expect(
        nostraVince,
        `\`${rivale.selettore}\` batte \`${nostra.selettore}\` su ${contese.join(', ')}: ` +
          'la seconda schermata non è sfalsata né rimpicciolita, e la pila non è una pila',
      ).toBe(true);
    }
  });

  it('la pila segue la lettura, e sul telefono smette di seguirla', () => {
    const base = regole(CSS).find((r) => r.selettore === '.vetrina-pila');
    expect(base, 'nessuna `.vetrina-pila` nel foglio').toBeDefined();
    expect(base!.corpo).toMatch(/position:\s*sticky/);
    // `sticky` senza `top` non si attacca a niente: sarebbe una riga che sembra
    // fare qualcosa e non fa niente.
    expect(base!.corpo).toMatch(/top:\s*\d/);

    const stretta = /@media \(max-width: 1000px\) \{([\s\S]*?)\n\}/.exec(senzaCommenti(CSS))![1];
    const suTelefono = regole(stretta).find((r) => r.selettore.includes('.vetrina-pila'));
    expect(suTelefono, 'la pila resta appiccicata anche su una colonna sola').toBeDefined();
    expect(suTelefono!.corpo).toMatch(/position:\s*static/);
  });

  it('la griglia è stirata, se no la pila non ha spazio in cui scorrere', () => {
    // `align-items: center` fa la cella alta quanto il contenuto, e dentro una
    // cella alta quanto il contenuto `sticky` non ha corsa: si comporta come
    // `static` senza dirlo. È il modo silenzioso in cui questa correzione
    // tornerebbe indietro.
    const griglia = regole(CSS).find((r) => r.selettore === '.apertura-griglia');
    expect(griglia, 'nessuna `.apertura-griglia` nel foglio').toBeDefined();
    expect(griglia!.corpo).not.toMatch(/align-items:\s*center/);
  });

  for (const pagina of PAGINE) {
    describe(pagina, () => {
      const html = readFileSync(join(SITO, pagina), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
      const pila = /<div class="vetrina-pila">([\s\S]*?)<\/div>/.exec(html);

      it('ha la pila con due schermate', () => {
        expect(pila, 'nessuna `.vetrina-pila` nella pagina').not.toBeNull();
        expect((pila![1].match(/<img/g) ?? []).length).toBe(2);
      });

      it('la prima si scarica subito, la seconda solo se serve', () => {
        const immagini = pila![1].split('<img').slice(1);
        expect(immagini[0]).toMatch(/loading="eager"/);
        expect(immagini[1]).toMatch(/class="vetrina-secondo"/);
        expect(immagini[1]).toMatch(/loading="lazy"/);
      });

      it('le due schermate non sono la stessa immagine e non hanno lo stesso alt', () => {
        const src = [...pila![1].matchAll(/src="([^"]+)"/g)].map((m) => m[1]);
        expect(new Set(src).size, `due volte la stessa immagine: ${src.join(', ')}`).toBe(2);
        const alt = [...pila![1].matchAll(/alt="([^"]+)"/g)].map((m) => m[1]);
        expect(alt.length, 'una delle due schermate non ha alt').toBe(2);
        expect(new Set(alt).size, 'le due schermate hanno lo stesso alt').toBe(2);
        for (const a of alt) expect(a.length).toBeGreaterThan(30);
      });

      it('ogni schermata dichiara le sue misure, se no la pagina salta mentre carica', () => {
        for (const img of pila![1].split('<img').slice(1)) {
          expect(img).toMatch(/width="\d+"/);
          expect(img).toMatch(/height="\d+"/);
        }
      });

      it('la lingua della pagina è la lingua delle schermate', () => {
        const suffisso = pagina.startsWith('en/') ? '-en.jpg' : '-it.jpg';
        for (const m of pila![1].matchAll(/src="([^"]+)"/g)) {
          expect(m[1], `schermata nella lingua sbagliata: ${m[1]}`).toContain(suffisso);
        }
      });
    });
  }
});
