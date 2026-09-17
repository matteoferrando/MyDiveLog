/**
 * I CAMPI DELL'APPLICAZIONE DEVONO AVERE ADDOSSO IL VESTITO DELL'APPLICAZIONE.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ► IL DIFETTO CHE HA FATTO NASCERE QUESTE PROVE, il 16 settembre 2026. ◄
 *
 * In `styles.css` c'era una regola sola per tutti i campi — `select`, i campi di
 * testo, il `textarea` — che dava carattere, riempimento, bordo, raggio e
 * fondo. Il 13 settembre (`df03688`, la 1.8.23) fra l'ultima riga dell'elenco
 * dei selettori e la parentesi graffa è stata infilata una regola nuova, quella
 * della freccia del `select`. La virgola che chiudeva l'elenco si è tirata
 * dentro il selettore della regola nuova, e da quel momento:
 *
 *   - `select, input[type=text], …, select { padding-right: 26px }` — cioè tutti
 *     i campi ricevevano UNA dichiarazione, il riempimento a destra;
 *   - le dichiarazioni vere restavano attaccate al solo `textarea`.
 *
 * Nessun errore, nessun avviso, il foglio di stile valido. Semplicemente, per
 * tre settimane, ogni campo e ogni menu a tendina del desktop ha avuto il
 * vestito di fabbrica del motore: bordo `2px inset` grigio, spigoli vivi,
 * altezza 19 px accanto a pulsanti alti 36. Misurato su Chromium, a 1280 px.
 *
 * ► PERCHÉ QUESTE PROVE LEGGONO IL CSS E NON UNA SCHERMATA. ◄ La geometria vera
 * si misura con il browser (`scripts/screenshot.mjs`), che però gira a mano. Il
 * difetto qui non era geometrico: era una virgola. Leggere le regole trova la
 * causa, a ogni giro della catena, in venti millisecondi.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const CSS = readFileSync('src/ui/styles.css', 'utf8');

/** Via i commenti: dentro ce ne sono di lunghissimi, e contengono graffe. */
function senzaCommenti(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

interface Regola {
  selettori: string[];
  dichiarazioni: string;
  /** La condizione `@media` che la racchiude, o stringa vuota se è di base. */
  dentro: string;
}

/**
 * Un lettore di regole minimo, che tiene conto di una sola cosa: se una regola
 * sta dentro un `@media` oppure no. È la distinzione che conta qui — una misura
 * dichiarata solo dentro `@media (pointer: coarse)` non protegge il desktop.
 */
function regole(css: string): Regola[] {
  const fuori: Regola[] = [];
  let i = 0;
  let condizione = '';
  let testa = '';
  while (i < css.length) {
    const c = css[i];
    if (c === '{') {
      const intestazione = testa.trim();
      testa = '';
      if (intestazione.startsWith('@')) {
        // Un blocco condizionale: da qui dentro le regole sono condizionate.
        condizione = intestazione;
        i += 1;
        continue;
      }
      let profondita = 1;
      let corpo = '';
      i += 1;
      while (i < css.length && profondita > 0) {
        if (css[i] === '{') profondita += 1;
        else if (css[i] === '}') {
          profondita -= 1;
          if (profondita === 0) break;
        }
        corpo += css[i];
        i += 1;
      }
      fuori.push({
        selettori: intestazione
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        dichiarazioni: corpo,
        dentro: condizione,
      });
      i += 1;
      continue;
    }
    if (c === '}') {
      condizione = '';
      testa = '';
      i += 1;
      continue;
    }
    testa += c;
    i += 1;
  }
  return fuori;
}

const TUTTE = regole(senzaCommenti(CSS));

/** Tutte le dichiarazioni che un selettore riceve fuori da ogni `@media`. */
function vestito(selettore: string): string {
  return TUTTE.filter((r) => r.dentro === '' && r.selettori.includes(selettore))
    .map((r) => r.dichiarazioni)
    .join('\n');
}

describe('il vestito dei campi', () => {
  /*
   * `textarea` è in fondo apposta: era l'unico che il difetto NON aveva perso,
   * quindi una prova scritta solo su di lui sarebbe passata anche col difetto
   * dentro. È il motivo per cui l'elenco li nomina tutti.
   */
  const CAMPI = ['select', "input[type='text']", "input[type='number']", "input[type='search']", 'textarea'];

  it.each(CAMPI)('%s ha carattere, bordo, raggio e fondo dell’applicazione', (campo) => {
    const suo = vestito(campo);
    expect(suo, `${campo} non riceve nessuna regola di base`).not.toBe('');
    expect(suo, 'il carattere dei campi deve essere quello dei pulsanti').toMatch(/font-size:\s*13px/);
    expect(suo, 'senza padding il campo è alto quanto il testo').toMatch(/padding:\s*6px 9px/);
    expect(suo, 'il bordo dell’applicazione, non quello di fabbrica').toMatch(
      /border:\s*1px solid var\(--border-strong\)/,
    );
    expect(suo, 'gli angoli dei campi sono quelli dei pulsanti').toMatch(
      /border-radius:\s*var\(--radius-sm\)/,
    );
    expect(suo, 'il fondo del campo deve seguire il tema, chiaro o scuro').toMatch(
      /background:\s*var\(--surface-1\)/,
    );
  });

  it('e la freccia del select resta una regola a parte, che non si mangia l’elenco', () => {
    /*
     * La regola della freccia deve valere SOLO per `select`: su un campo di
     * testo il riempimento a destra lascerebbe un vuoto senza ragione. Ed è
     * proprio infilandola dentro l'elenco che il difetto era nato: qui si
     * controlla che nessuna regola che dichiara solo `padding-right` porti con
     * sé anche i campi di testo.
     */
    for (const r of TUTTE) {
      if (!/padding-right:\s*26px/.test(r.dichiarazioni)) continue;
      expect(r.selettori, 'la regola della freccia si è ripresa l’elenco dei campi').toEqual(['select']);
    }
  });
});

describe('i bersagli, anche con il mouse', () => {
  it('la casella di spunta ha una misura di base, non quella di fabbrica', () => {
    /*
     * 13×13 px è la misura che mette il motore quando nessuno dice niente, ed è
     * quella che il desktop ha avuto finché la regola stava solo dentro
     * `@media (pointer: coarse), (max-width: 700px)`. Una lezione imparata
     * dentro un percorso protegge solo quel percorso.
     */
    const base = vestito("input[type='checkbox']");
    const misura = base.match(/width:\s*(\d+)px/);
    expect(misura, 'la casella non ha nessuna misura fuori dai media query').not.toBeNull();
    expect(Number(misura![1]), 'sotto i 16 px il bersaglio è quello di fabbrica').toBeGreaterThanOrEqual(16);
  });

  it('e col dito sale a 24, che è il minimo di WCAG senza eccezioni', () => {
    const colDito = TUTTE.filter(
      (r) => /pointer:\s*coarse/.test(r.dentro) && r.selettori.includes("input[type='checkbox']"),
    );
    expect(colDito.length, 'nessuna regola alza la casella per chi tocca lo schermo').toBeGreaterThan(0);
    expect(colDito.map((r) => r.dichiarazioni).join('\n')).toMatch(/width:\s*24px/);
  });

  it('il riassunto di una sezione apribile è un bersaglio, non una riga di testo', () => {
    /*
     * Cinque `<details>` nell'applicazione, nessuna regola addosso: vestito di
     * fabbrica, **18 px** di altezza misurati sulla build vera, col mouse e col
     * dito. La lezione delle caselle di spunta e delle date-pulsante non li
     * aveva raggiunti perché nessuno li aveva mai misurati: le sonde contavano
     * `button, a, input, select`, e `summary` non è nessuno di quelli.
     */
    const suo = vestito('summary');
    expect(suo, 'summary non ha regole di base: ha il vestito di fabbrica').not.toBe('');
    expect(suo, 'sotto i 24 px il riassunto è sotto il minimo di WCAG 2.2 AA').toMatch(/min-height:\s*24px/);
    const colDito = TUTTE.filter(
      (r) => /pointer:\s*coarse/.test(r.dentro) && r.selettori.includes('summary'),
    );
    expect(colDito.length, 'nessuna regola alza il riassunto per chi tocca lo schermo').toBeGreaterThan(0);
    expect(colDito.map((r) => r.dichiarazioni).join('\n')).toMatch(/min-height:\s*44px/);
  });

  it('la data-pulsante del logbook è alta almeno 24 px per tutti', () => {
    // È l'unico modo di aprire un'immersione da tastiera: se è alta 20 px, il
    // bersaglio più importante del logbook è sotto il minimo.
    const cella = vestito('.cell-link');
    expect(cella, '.cell-link non ha regole di base: era dentro un media query').not.toBe('');
    expect(cella).toMatch(/min-height:\s*24px/);
  });
});

/*
 * ═════════════════════════════════════════════════════════════════════════════
 * ► L'ALTEZZA DEI CONTROLLI È UNA MISURA DICHIARATA, NON UN RISULTATO. ◄
 *
 * Misurato sulla build vera il 17 settembre 2026, a 1280 px, su nove schede: un
 * pulsante 35,5 px, un campo di testo 33,5, un menu a tendina 31. Tre altezze
 * per tre cose che stanno nella stessa riga di filtri. Nessuna era sbagliata:
 * ognuna usciva dal proprio riempimento e dal proprio carattere. È il motivo
 * per cui nessuno le aveva mai viste — *sono numeri che nascono da soli, e
 * nascere da soli non li mette d'accordo.*
 *
 * Sul telefono la differenza cambiava di segno e diventava anche un problema di
 * accessibilità: i campi salgono a 16 px di carattere (l'unico modo di non far
 * ingrandire la pagina a Safari) e arrivavano a 38 px, i menu a 35, e i
 * pulsanti restavano a 35,5 — sotto i 44 px che iOS chiede a un bersaglio da
 * premere col dito, nella stessa schermata dove la barra in basso era già a 44.
 *
 * Questa prova non misura pixel: guarda che l'altezza arrivi DAL TOKEN. Una
 * misura scritta a mano su un solo controllo è esattamente il modo in cui le
 * tre altezze erano nate.
 */
describe('l’altezza dei controlli', () => {
  /** I controlli che stanno uno accanto all’altro e devono venire alti uguale. */
  const CONTROLLI = [
    'button.btn',
    'label.btn',
    'select',
    "input[type='text']",
    "input[type='number']",
    "input[type='search']",
    "input[type='password']",
    'textarea',
  ];

  it('il token esiste fuori da ogni media query, se no il desktop non è protetto', () => {
    const radice = vestito(':root');
    expect(radice, 'nessuna regola di base su :root').not.toBe('');
    expect(radice, 'manca --h-controllo').toMatch(/--h-controllo:\s*\d+px/);
    expect(radice, 'manca --h-pastiglia').toMatch(/--h-pastiglia:\s*\d+px/);
  });

  it('e col dito cresce, senza che nessun controllo debba saperlo', () => {
    const colDito = TUTTE.filter((r) => /pointer:\s*coarse/.test(r.dentro) && r.selettori.includes(':root'))
      .map((r) => r.dichiarazioni)
      .join('\n');
    expect(colDito, 'il token non cresce col dito: i pulsanti restano sotto i 44 px').toMatch(
      /--h-controllo:\s*44px/,
    );
    expect(colDito).toMatch(/--h-pastiglia:\s*\d+px/);
  });

  it.each(CONTROLLI)('%s prende l’altezza dal token', (sel) => {
    const suo = vestito(sel);
    expect(suo, `${sel} non riceve nessuna regola di base`).not.toBe('');
    expect(suo, `${sel} non dichiara min-height: la sua altezza è un risultato, non una misura`).toMatch(
      /min-height:\s*var\(--h-controllo\)/,
    );
  });

  it('la pastiglia ha la sua, e viene anche lei dal token', () => {
    expect(vestito('.pastiglia')).toMatch(/min-height:\s*var\(--h-pastiglia\)/);
  });

  it('nessun controllo si tiene un’altezza tutta sua scritta a mano', () => {
    /*
     * Il pulsante di Apple aveva `min-height: 44px` fisso: giusto col dito,
     * sbagliato col mouse, dove accanto al pulsante di Google — alto 35,5 —
     * faceva una riga con 8,5 px di scarto. Un numero scritto a mano su un solo
     * controllo è un secondo sistema di misura che nessuno sa di avere.
     */
    /*
     * ► SI GUARDANO LE REGOLE GENERICHE, NON QUELLE DI UN POSTO PRECISO. ◄ Un
     * selettore con un combinatore — `.catalogo-computer .modelli .btn` — dice
     * «il pulsante LÌ DENTRO», ed è il modo legittimo di dare a una riga di
     * elenco la misura che quella riga chiede: nell'elenco dei computer i
     * pulsanti sono 44 px anche col mouse, perché sono righe fra righe e
     * sbagliare riga significa parlare al dispositivo di qualcun altro.
     *
     * Un selettore SENZA combinatore — `button.btn.bottone-apple` — parla
     * invece del controllo in quanto tale, ovunque si trovi: lì una misura
     * scritta a mano è un secondo sistema di misura che nessuno sa di avere, ed
     * è esattamente com'era nato lo scarto di 8,5 px con il pulsante di Google.
     *
     * La differenza è nella forma del selettore e non in un elenco di nomi
     * permessi, che invecchierebbe da solo.
     */
    const generico = (s: string) => !/[\s>+~]/.test(s.trim());
    const colpevoli: string[] = [];
    for (const r of TUTTE) {
      const misura = /min-height:\s*(\d+)px/.exec(r.dichiarazioni);
      if (!misura) continue;
      const tocca = r.selettori.filter(
        (s) => generico(s) && (/\bbtn\b|bottone-apple|pastiglia/.test(s) || CONTROLLI.includes(s)),
      );
      if (tocca.length) colpevoli.push(`${tocca.join(', ')} → ${misura[0]}`);
    }
    expect(
      colpevoli,
      'altezze scritte a mano su un controllo: usa var(--h-controllo) o var(--h-pastiglia)',
    ).toEqual([]);
  });
});
