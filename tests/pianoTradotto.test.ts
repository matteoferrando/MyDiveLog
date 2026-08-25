/**
 * Il piano di miglioramento parla due lingue, e resta così.
 *
 * ► PERCHÉ QUESTO TEST ESISTE. ◄ Il dizionario di questo progetto ha la frase
 * italiana COME CHIAVE (vedi `ui/lingua.tsx`), e quando una chiave non c'è non
 * succede niente di rumoroso: `t()` restituisce l'italiano, la frase è corretta,
 * la schermata è a posto. È la proprietà che rende il dizionario incompletabile
 * senza danni — ed è anche quello che ha lasciato novantuno frasi del piano in
 * italiano dentro un'applicazione impostata in inglese, per mesi, senza che
 * niente lo segnalasse.
 *
 * Un difetto che non si vede è un difetto che nessuno corregge. Questo file
 * rende visibile l'unica cosa che nessuna schermata può mostrare: che una frase
 * **è stata avvolta in `t()` ma la sua voce inglese non è mai stata scritta**.
 * Il costo di sbagliare è invisibile a chi scrive in italiano, quindi il
 * controllo deve stare qui e non nell'occhio di chi rilegge.
 *
 * ► PERCHÉ LEGGE IL SORGENTE E NON IMPORTA LE FUNZIONI. ◄ Chiamare `buildPlan`
 * su un archivio finto proverebbe solo i rami che quell'archivio fa scattare —
 * cioè quattro o cinque regole su sedici, e nessuno dei rami "buoni". Le frasi
 * che restano indietro sono per definizione quelle che non capitano quasi mai:
 * la violazione del tetto, il cambio gas sotto la MOD, il caso peggiore delle
 * ripetitive. Il TESTO SORGENTE le contiene tutte, sempre, senza dover costruire
 * l'archivio che le provoca.
 *
 * ► PERCHÉ CONTROLLA ANCHE I SEGNAPOSTI. ◄ Una traduzione inglese che perde un
 * `{0}` non dà errore e non sembra rotta: la frase resta grammaticale, sparisce
 * solo il numero. Su «{0} immersioni su {1} con almeno 30 s sopra il limite» un
 * `{1}` dimenticato produce una frase inglese che si legge benissimo e che non
 * dice più su quante immersioni. È esattamente il genere di cosa che si trova
 * con una riga di test e non si trova mai rileggendo. Vedi `segnapostiDi` in
 * `core/frase.ts`, che sta lì per questo.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { chiaviDi } from './chiaviDelSorgente';
import { frase, segnapostiDi } from '../src/core/frase';
import { INGLESE } from '../src/ui/traduzioni';

/**
 * I due file che scrivono il piano.
 *
 * `nextDive.ts` sta qui insieme a `coaching.ts` perché è la stessa schermata per
 * chi la usa — quello che si legge prima di scendere — e perché sono passati
 * dallo stesso lavoro di conversione: separarli vorrebbe dire che uno dei due
 * può regredire senza che nessuno se ne accorga.
 */
const SORGENTI = ['../src/core/analysis/coaching.ts', '../src/core/analysis/nextDive.ts'];

const chiavi = [
  ...new Set(
    SORGENTI.flatMap((f) => chiaviDi(readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8'))),
  ),
];

describe('il piano di miglioramento passa dal dizionario', () => {
  /*
   * La rete sotto la rete.
   *
   * Se un giorno `t()` viene rinominato, o le chiamate cambiano forma, l'estrazione
   * qui sopra smette di trovare qualcosa — e tutti i controlli che seguono
   * passerebbero su un elenco vuoto, dichiarando tradotto un piano che nessuno ha
   * più guardato. Un test che non può fallire è peggio di nessun test.
   */
  it('trova le frasi nel sorgente', () => {
    expect(chiavi.length).toBeGreaterThan(150);
    // Due frasi che stanno agli estremi opposti dei due file: se ci sono queste,
    // l'estrazione ha attraversato tutto.
    expect(chiavi).toContain('Zero. Non è un obiettivo da migliorare gradualmente.');
    expect(chiavi).toContain('Niente in circolo');
  });

  it('ogni frase ha la sua voce inglese', () => {
    const mancanti = chiavi.filter((k) => !(k in INGLESE));
    // L'elenco intero nel messaggio, non il conteggio: chi legge il fallimento
    // deve poter copiare le chiavi mancanti dentro `traduzioni.ts`.
    expect(mancanti, `frasi senza traduzione:\n${mancanti.join('\n')}`).toEqual([]);
  });

  it('l’inglese porta gli stessi segnaposti dell’italiano', () => {
    const storte = chiavi
      .filter((k) => k in INGLESE)
      .map((k) => ({ it: k, en: INGLESE[k], a: segnapostiDi(k), b: segnapostiDi(INGLESE[k]) }))
      .filter((x) => x.a.join(',') !== x.b.join(','));
    expect(storte, `segnaposti diversi:\n${storte.map((x) => `${x.it}\n${x.en}`).join('\n\n')}`).toEqual([]);
  });

  /*
   * Nessuna frase con un numero dentro può essere una chiave "già composta".
   *
   * È il difetto che `frase()` è nata per chiudere: se qualcuno torna a scrivere
   * `t("Consumo " + rmv + " L/min")` la chiave cambia a ogni immersione e nel
   * dizionario non ci sarà mai. Un letterale con dentro `${` è la firma di quel
   * ritorno indietro, e si vede solo qui.
   */
  it('nessuna chiave si porta dentro un’interpolazione', () => {
    expect(chiavi.filter((k) => k.includes('${'))).toEqual([]);
  });
});

describe('frase() riempie i segnaposti', () => {
  const inglese = (s: string) => INGLESE[s] ?? s;

  it('sostituisce i valori in ordine', () => {
    expect(frase((s) => s, '{0} immersioni su {1} hanno un profilo campionato.', 14, 35)).toBe(
      '14 immersioni su 35 hanno un profilo campionato.',
    );
  });

  it('la traduzione può spostare i segnaposti, e i valori la seguono', () => {
    // Il punto di tradurre PRIMA e riempire DOPO: chi traduce può mettere i
    // numeri dove li vuole l'inglese, e non deve indovinare dove finiranno.
    const invertito = (s: string) => (s === 'da {0} a {1}' ? 'from {1} back to {0}' : s);
    expect(frase(invertito, 'da {0} a {1}', 'A', 'B')).toBe('from B back to A');
  });

  it('un segnaposto senza valore resta visibile invece di sparire', () => {
    // Uno spazio bianco in mezzo a una frase non lo segnala nessuno; un `{2}` a
    // schermo sì. Vedi il commento in `core/frase.ts`.
    expect(frase((s) => s, '{0} e {1} e {2}', 'uno', 'due')).toBe('uno e due e {2}');
  });

  it('una frase vera del piano esce in inglese con i suoi numeri', () => {
    // La prova che i tre pezzi — chiave, dizionario, riempimento — combaciano
    // davvero su una frase presa dal piano e non su un esempio inventato.
    const detto = frase(inglese, 'Manca un criterio: {0}.', 'consumo di superficie');
    expect(detto).toBe('One criterion missing: consumo di superficie.');
  });
});
