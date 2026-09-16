/**
 * UN DOCUMENTO CHE AFFERMA UN FATTO VA RIMISURATO COME IL FATTO.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ► I DUE CASI VERI DA CUI NASCE QUESTO FILE. ◄
 *
 * **Il primo, scoperto da una verifica esterna il 16 settembre 2026 e chiuso
 * solo il 17.** Il README diceva, in grassetto, che la funzionalità
 * `computer-esterni` *«è spenta di sua iniziativa»* e *«non entra nei pacchetti
 * che si pubblicano»*. Era falso dal **25 agosto**: `Cargo.toml` la accende per
 * difetto, con accanto un riquadro che lo dice. Due righe dello stesso progetto
 * che si contraddicevano per tre settimane — e quella sbagliata stava nella
 * pagina che si legge per prima.
 *
 * **Il secondo, il 17 settembre.** Cinque file dicevano che «nessun computer
 * subacqueo di terzi è mai stato collegato a questo codice». Era vero, ed era
 * scritto apposta perché lo era; ha smesso di esserlo quando una persona ha
 * scaricato il suo Mares Quad Ci.
 *
 * ► PERCHÉ UNA PROVA E NON UNA RILETTURA. ◄ Perché nessuna delle due si vedeva
 * leggendo il file in cui stava: per accorgersene bisognava avere in mente
 * un'altra riga, in un altro file, scritta un altro giorno. *È esattamente il
 * genere di divergenza che un occhio non prende e un confronto sì.*
 *
 * Le due regole qui sotto sono diverse perché i due fatti lo sono: il primo è
 * scritto in un file e si può **derivare**; il secondo è nel mondo, e allora
 * l'unica cosa che si può pretendere è che l'affermazione **porti la sua data**.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { PROVATI_VIA_LDC } from '../src/core/ble/provati';

/** Tutti i file di testo in cui questo progetto afferma qualcosa. */
function* documenti(): Generator<string> {
  yield 'README.md';
  for (const f of readdirSync('docs')) if (f.endsWith('.md')) yield join('docs', f);
  for (const radice of ['src', join('src-tauri', 'src')]) yield* sorgenti(radice);
}
function* sorgenti(dir: string): Generator<string> {
  for (const voce of readdirSync(dir)) {
    const p = join(dir, voce);
    if (statSync(p).isDirectory()) yield* sorgenti(p);
    else if (/\.(ts|tsx|rs)$/.test(voce)) yield p;
  }
}

describe('«computer-esterni è spenta» — derivato da Cargo.toml', () => {
  /*
   * Il fatto sta in un file e si legge: `default = ["computer-esterni"]`. Quindi
   * qui non si inchioda una frase, si inchioda l'ACCORDO fra la frase e il
   * fatto. Il giorno che la funzionalità cambia stato, i documenti che la
   * descrivono devono cambiare con lei o questa prova diventa rossa — che è
   * quello che sarebbe dovuto succedere il 25 agosto.
   */
  const cargo = readFileSync('src-tauri/Cargo.toml', 'utf8');
  const accesa = /^default\s*=\s*\[[^\]]*"computer-esterni"/m.test(cargo);

  it.each(['README.md', 'docs/architettura.md'])('%s dice la stessa cosa di Cargo.toml', (file) => {
    const testo = readFileSync(file, 'utf8');
    const dove = testo.indexOf('**`computer-esterni`**');
    expect(dove, `${file} non presenta più la funzionalità: il riferimento è cambiato?`).toBeGreaterThan(-1);
    /*
     * Il paragrafo che la presenta, non tutto il file — e **senza le citazioni**.
     *
     * Le righe che cominciano per `>` sono, in Markdown, roba detta da
     * qualcun'altra parte o in un altro momento: nel README, subito sotto,
     * c'è il riquadro che racconta che per tre settimane qui era scritto
     * «è spenta di sua iniziativa». Quella frase deve poterci stare — è la
     * memoria del difetto — senza far credere alla prova che il documento la
     * stia ancora affermando.
     *
     * *Una citazione non è un'affermazione*, e distinguerle è il minimo perché
     * questa guardia non costringa a cancellare la storia per restare verde.
     */
    const paragrafo = testo
      .slice(dove, dove + 900)
      .split('\n')
      .filter((r) => !r.trimStart().startsWith('>'))
      .join('\n');

    const diceAccesa = /\baccesa\b/i.test(paragrafo);
    const diceSpenta = /\bspenta\b/i.test(paragrafo);
    expect(
      diceAccesa !== diceSpenta,
      `${file} non dice chiaramente se «computer-esterni» è accesa o spenta`,
    ).toBe(true);
    expect(
      diceAccesa,
      accesa
        ? `Cargo.toml la accende per difetto, ${file} dice che è spenta`
        : `Cargo.toml non la accende per difetto, ${file} dice che è accesa`,
    ).toBe(accesa);
  });

  it('e l’interprete di Cargo.toml sa fare il suo mestiere', () => {
    // ► LA GUARDIA DELLA GUARDIA: se `accesa` fosse sempre vero, la prova qui
    //   sopra non guarderebbe Cargo.toml — guarderebbe una costante.
    expect(/^default\s*=\s*\[[^\]]*"computer-esterni"/m.test('default = ["computer-esterni"]')).toBe(true);
    expect(/^default\s*=\s*\[[^\]]*"computer-esterni"/m.test('default = []')).toBe(false);
    expect(/^default\s*=\s*\[[^\]]*"computer-esterni"/m.test('# default = ["computer-esterni"]')).toBe(false);
    expect(accesa, 'oggi è accesa, e lo dice Cargo.toml').toBe(true);
  });
});

describe('«nessun apparecchio di terzi è mai stato collegato» — deve portare la data', () => {
  /*
   * Questo fatto non sta in nessun file: sta nel mondo, e lo cambia una persona
   * che accende un computer. Non si può derivare, quindi si pretende l'unica
   * cosa che rende un'affermazione del genere onesta nel tempo: **che sia
   * datata**. «Fino al 17 settembre qui c'era scritto…» invecchia bene; «nessun
   * apparecchio è mai stato collegato» no.
   *
   * La prova si accende solo quando qualcuno HA collegato qualcosa: finché
   * l'elenco è vuoto, quella frase è vera al presente e va scritta al presente.
   */
  const FRASI = [
    /nessun (computer subacqueo|apparecchio|computer) di terzi è mai stato collegato/i,
    /il primo apparecchio vero non è ancora esistito/i,
  ];
  /** Le parole che datano un'affermazione, cioè la mettono al passato. */
  const DATATA =
    /c'era scritto|era ver|è stato vero|sono stati veri|ha smesso|hanno smesso|fino a|finché è stato|smentit/i;

  it('se qualcuno l’ha collegato, nessun file la afferma al presente', () => {
    if (PROVATI_VIA_LDC.length === 0) return; // niente da pretendere: è ancora vera

    const colpevoli: string[] = [];
    for (const file of documenti()) {
      /*
       * ► GLI SPAZI SI APPIATTISCONO PRIMA DI CERCARE, E NON È UN DETTAGLIO. ◄
       *
       * La prima stesura cercava la frase nel testo così com'era, e una
       * mutazione l'ha smascherata restando **verde** con l'affermazione
       * rimessa: nel documento vero quella frase sta su due righe — «…è mai\n
       * stato collegato…» — e uno spazio letterale non combacia con un a capo.
       * Cioè la guardia avrebbe mancato **il caso reale**, che è scritto a
       * settanta colonne come tutto il resto.
       *
       * *Una prova che cerca in un testo va scritta contro il testo come è
       * impaginato, non come si pronuncia.*
       */
      const testo = readFileSync(file, 'utf8').replace(/\s+/g, ' ');
      for (const frase of FRASI) {
        const m = frase.exec(testo);
        if (!m) continue;
        // Il contorno: quello che sta intorno all'affermazione deve dire quando
        // era vera. Abbondante da tutte e due le parti, perché la data può
        // precedere o seguire.
        const da = Math.max(0, m.index - 500);
        const contorno = testo.slice(da, m.index + 500);
        if (!DATATA.test(contorno)) colpevoli.push(`${file}: «${m[0]}»`);
      }
    }
    expect(
      colpevoli,
      `qualcuno ha collegato un computer di terzi (${PROVATI_VIA_LDC.map((p) => `${p.marca} ${p.modello}`).join(', ')}), ` +
        `ma questi punti lo negano ancora senza dire quando era vero:\n  ${colpevoli.join('\n  ')}`,
    ).toEqual([]);
  });

  it('e il riconoscitore riconosce davvero', () => {
    // ► LA GUARDIA DELLA GUARDIA. Se le espressioni non prendessero niente, la
    //   prova qui sopra passerebbe su qualunque documento.
    const finto =
      'Nessun computer subacqueo di terzi è mai stato collegato a questo codice, e il primo apparecchio vero non è ancora esistito.';
    expect(FRASI.some((f) => f.test(finto))).toBe(true);
    expect(DATATA.test(finto), 'e non è datata').toBe(false);
    expect(DATATA.test(`Fino al 17 settembre 2026 ${finto}`), 'questa invece sì').toBe(true);
  });
});
