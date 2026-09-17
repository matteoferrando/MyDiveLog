/**
 * UNA COLONNA CHE SI ALLARGA È IL CONTRARIO DI QUELLO CHE SEMBRA.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * ► LA TRAPPOLA. ◄ `flex-wrap: wrap` su una riga significa «va a capo», ed è
 * quasi sempre quello che si vuole. Sulla stessa regola messa in COLONNA per il
 * telefono significa un'altra cosa: che il contenitore può aprire una SECONDA
 * COLONNA accanto alla prima. E la larghezza di una colonna la detta il figlio
 * più largo che contiene — **non il contenitore**. Se poi c'è anche
 * `align-items: stretch`, quella larghezza viene imposta a tutti i figli, e il
 * risultato è un blocco più largo del suo contenitore con la pagina che scappa
 * di lato.
 *
 * ► È GIÀ SUCCESSO DUE VOLTE. ◄
 *
 *  - **15 settembre 2026, `.filters`**: a 320 px, contenitore 280, `label`
 *    dentro larga **325**. Il colpevole era il `<select>` dell'obiettivo, che
 *    prende la propria misura dall'opzione più lunga («Subacquea Tecnica
 *    Avanzato»). Risolto con `flex-wrap: nowrap`, e scritto nel foglio per
 *    esteso.
 *  - **17 settembre 2026, `.page-title-row`**: incolonnata per far stare i
 *    pulsanti della scheda a tutta larghezza. Stessa identica trappola, un
 *    livello più su, sulla stessa pagina e con lo stesso `<select>`:
 *    contenitore 280, figli **342**. La lezione era scritta trenta righe più
 *    in basso nello stesso file e non ha protetto niente, perché *una lezione
 *    imparata dentro un percorso protegge solo quel percorso*.
 *
 * Questa prova è la lezione tolta dal suo percorso: cerca la forma, non il
 * nome. Ogni regola che mette in colonna qualcosa che altrove riceve
 * `flex-wrap: wrap` deve dire `nowrap`, o spiegare perché no.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

interface Regola {
  selettori: string[];
  dichiarazioni: string;
  dentro: string;
}

/** Lo stesso lettore di regole di `vestitoDeiCampi`, con la condizione @media. */
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

/**
 * L’ultimo pezzo di un selettore: quello che descrive l’elemento vero.
 *
 * `.page-title-row > .row` parla di un `.row`, e `.row` è dove sta
 * `flex-wrap: wrap`. `.runtime-parts > div` parla di un `div`, che non riceve
 * niente: guardare il selettore intero, o cercare i nomi dentro la stringa,
 * darebbe allarmi finti — `.nav` è dentro `.navigatore-sezioni` e non c’entra
 * niente.
 */
function ultimoPezzo(selettore: string): string {
  const pezzi = selettore
    .trim()
    .split(/[\s>+~]+/)
    .filter(Boolean);
  return pezzi[pezzi.length - 1] ?? selettore.trim();
}

const TUTTE = regole(readFileSync('src/ui/styles.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''));

describe('le colonne non si allargano da sole', () => {
  it('chi va in colonna e altrove ha flex-wrap: wrap deve dire nowrap', () => {
    const conWrap = new Set<string>();
    for (const r of TUTTE) {
      if (!/flex-wrap:\s*wrap/.test(r.dichiarazioni)) continue;
      for (const s of r.selettori) conWrap.add(ultimoPezzo(s));
    }
    // Una guardia che non guarda niente è verde per sempre.
    expect(conWrap.size, 'nessuna regola con flex-wrap: wrap: il lettore di CSS è rotto').toBeGreaterThan(5);

    const scoperte: string[] = [];
    for (const r of TUTTE) {
      if (!/flex-direction:\s*column/.test(r.dichiarazioni)) continue;
      if (/flex-wrap:\s*nowrap/.test(r.dichiarazioni)) continue;
      for (const s of r.selettori) {
        if (conWrap.has(ultimoPezzo(s))) {
          scoperte.push(`${s}${r.dentro ? ' dentro ' + r.dentro : ''}`);
        }
      }
    }
    expect(
      scoperte,
      'regole che mettono in colonna qualcosa che riceve flex-wrap: wrap senza annullarlo: a schermo stretto il blocco diventa più largo del suo contenitore',
    ).toEqual([]);
  });
});
