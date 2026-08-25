/**
 * Due chiavi che si leggono uguali sono una chiave e una trappola.
 *
 * ► IL DIFETTO CHE QUESTO FILE RENDE VISIBILE. ◄ In questo progetto la chiave del
 * dizionario è **la frase italiana intera** (vedi `ui/lingua.tsx`), e il
 * confronto è quello di JavaScript: carattere per carattere. L'apostrofo dritto
 * `'` e quello tipografico `’` sono due caratteri diversi, quindi
 * `File SQLite nella cartella dati dell'app` e
 * `File SQLite nella cartella dati dell’app` sono due chiavi distinte che
 * nessun occhio distingue rileggendo. Una delle due corrisponde a ciò che il
 * sorgente scrive davvero e funziona; l'altra non verrà interrogata mai.
 *
 * Il guasto è silenzioso da entrambi i lati. Chi lavora in italiano non vede
 * niente, perché in italiano il dizionario non si apre. Chi lavora in inglese
 * legge una frase italiana in mezzo alle altre e la scambia per una frase che
 * nessuno ha ancora tradotto — mentre la traduzione c'è, è lì, due righe più su,
 * scritta con l'apostrofo sbagliato. È il motivo per cui una gemella può restare
 * in casa per mesi: assomiglia in tutto a un lavoro da fare, e invece è un
 * lavoro fatto due volte di cui una metà è irraggiungibile.
 *
 * ► PERCHÉ UN TEST E NON UNA RILETTURA. ◄ Perché la differenza fra i due
 * caratteri non si vede a schermo, e perché le voci nuove si aggiungono
 * copiando la frase dal sorgente: prettier e l'editor normalizzano gli apostrofi
 * in modi diversi a seconda di come la frase è arrivata negli appunti, e il
 * doppione nasce dal gesto più naturale che c'è. Una regola che si può violare
 * senza accorgersene va controllata da una macchina.
 *
 * ► COS'È `GEMELLE_NOTE`. ◄ È un DEBITO, non un permesso: le coppie che il
 * dizionario ha addosso oggi. Sta qui perché toglierle è una decisione su quale
 * delle due frasi italiane sia quella giusta — cioè un lavoro su `traduzioni.ts`
 * e sui file che quelle frasi le scrivono — e non una pulizia da fare di
 * straforo dentro un test. L'elenco deve corrispondere ESATTAMENTE alle coppie
 * presenti: una coppia in più fa fallire il test perché è una regressione, una
 * coppia in meno lo fa fallire perché il debito è stato pagato e la riga qui
 * sotto va tolta. Un elenco di deroghe che nessuno aggiorna torna a essere
 * silenzio nel giro di un anno.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { chiaviDi } from './chiaviDelSorgente';
import { INGLESE } from '../src/ui/traduzioni';

/**
 * La forma in cui due chiavi «si leggono uguali».
 *
 * Solo i caratteri che l'occhio confonde e che la tastiera produce al posto
 * l'uno dell'altro: apostrofi e virgolette, dritti contro tipografici. NON si
 * normalizzano maiuscole, spazi o punteggiatura — «Salva» e «salva» sono due
 * frasi diverse per chi legge, e due voci separate sono legittime.
 */
const comeSiLegge = (s: string): string => s.replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"');

/**
 * Le coppie che il dizionario ha già addosso, ognuna nella sua forma
 * normalizzata. Vedi il commento in testa al file: si tolgono quando si decide
 * quale delle due frasi resta.
 */
const GEMELLE_NOTE: string[] = [];
/*
  ► L'ELENCO È VUOTO, E IL DEBITO È STATO PAGATO IL GIORNO STESSO. ◄

  Ci sono state due coppie, e valeva la pena guardarle da vicino perché erano
  due guasti diversi con lo stesso aspetto.

  «File SQLite nella cartella dati dell'app» era una gemella MORTA: il sorgente
  (`storage/sqlite.ts`) scrive l'apostrofo tipografico, quindi la voce con
  quello dritto non sarebbe stata interrogata mai. Tolta dal dizionario.

  «{0} giorni dall'ultima immersione» era peggio, perché erano vive tutte e
  due: `coaching.ts` scriveva l'apostrofo dritto e `nextDive.ts` quello
  tipografico, per la stessa identica frase. Il difetto non stava nel
  dizionario — stava nei due moduli che scrivevano la stessa frase in due modi.
  Uniformato il sorgente, la seconda chiave è diventata inutile ed è sparita.

  Le due storie insieme dicono a cosa serve questo file: una gemella non è un
  doppione da deduplicare, è la spia che due pezzi di codice non sono
  d'accordo su come si scrive una frase.
*/

describe('il dizionario non ha chiavi gemelle', () => {
  const gruppi = new Map<string, string[]>();
  for (const chiave of Object.keys(INGLESE)) {
    const forma = comeSiLegge(chiave);
    if (!gruppi.has(forma)) gruppi.set(forma, []);
    gruppi.get(forma)!.push(chiave);
  }
  const gemelle = [...gruppi.entries()].filter(([, chiavi]) => chiavi.length > 1);

  /*
   * La rete sotto la rete, come in `pianoTradotto.test.ts`: se un giorno
   * `INGLESE` cambia forma o arriva vuoto, tutti i controlli qui sotto
   * passerebbero su un insieme vuoto dichiarando sano un dizionario che nessuno
   * ha più guardato.
   */
  it('legge davvero il dizionario', () => {
    expect(Object.keys(INGLESE).length).toBeGreaterThan(1000);
  });

  it('nessuna coppia nuova di chiavi che differiscono solo per apostrofi o virgolette', () => {
    const nuove = gemelle.filter(([forma]) => !GEMELLE_NOTE.includes(forma));
    const dettaglio = nuove
      .map(([, chiavi]) => chiavi.map((c) => JSON.stringify(c)).join('\n  '))
      .join('\n\n');
    expect(
      nuove.map(([forma]) => forma),
      `chiavi che si leggono uguali ma non lo sono — una delle due non verrà mai trovata:\n  ${dettaglio}`,
    ).toEqual([]);
  });

  it('l’elenco delle gemelle note non contiene coppie già risolte', () => {
    const forme = gemelle.map(([forma]) => forma);
    const risolte = GEMELLE_NOTE.filter((forma) => !forme.includes(forma));
    expect(
      risolte,
      `queste coppie non esistono più: toglile da GEMELLE_NOTE, il debito è pagato.\n${risolte.join('\n')}`,
    ).toEqual([]);
  });
});

/**
 * ► LA SECONDA DOMANDA: C'È QUALCOSA CHE PASSA DA `t()` E NEL DIZIONARIO NON C'È? ◄
 *
 * La prima parte di questo file guarda il dizionario e cerca doppioni. Questa
 * guarda il verso opposto, che è quello da cui i buchi sono sempre arrivati:
 * ogni frase che il codice passa a `t()` o a `frase()` deve avere la sua voce.
 *
 * PERCHÉ SERVIVA. La rete che c'era — `pianoTradotto.test.ts` — copre due file,
 * `coaching.ts` e `nextDive.ts`, perché è nata insieme alla loro conversione.
 * Tutto il resto dell'applicazione era scoperto, e si è visto: le tredici
 * etichette del libretto di legge, i tre tipi di autorespiratore e un avviso
 * dei parser Shearwater passavano da `t()` senza avere una chiave, e restavano
 * in italiano anche con l'interfaccia in inglese. Nessuno se n'era accorto
 * perché il ripiego di `t()` è la chiave stessa: **una frase non tradotta è una
 * frase corretta in italiano**, mai una frase rotta. È la proprietà che rende
 * questo dizionario robusto, ed è la stessa che rende i suoi buchi invisibili.
 * L'unico modo di vederli è contarli.
 *
 * PERCHÉ LEGGE IL SORGENTE invece di provare i componenti: le frasi sono sparse
 * in centotrenta file e molte compaiono solo in rami che un test non
 * attraversa mai — il messaggio di un errore Bluetooth, l'avviso di un formato
 * che non si sa leggere. Montare tutto per scoprirlo costerebbe cento volte
 * tanto e coprirebbe meno.
 */
describe('tutto quello che passa da t() ha la sua voce', () => {
  /*
    L'unico file escluso, e non è una deroga: `core/frase.ts` è la funzione
    stessa, e la sola chiamata che contiene è l'ESEMPIO scritto nella sua
    documentazione — «Consumo medio {0} L/min su {1} immersioni.», una frase
    che non compare a schermo da nessuna parte. Metterla nel dizionario per
    far tacere questo controllo sarebbe scrivere una traduzione per una frase
    che nessuno leggerà mai.
  */
  const ESCLUSI = ['src/core/frase.ts', 'src/ui/traduzioni.ts'];

  const radice = fileURLToPath(new URL('..', import.meta.url));
  const files: string[] = [];
  for (const cartella of ['src', 'scripts']) {
    for (const voce of readdirSync(join(radice, cartella), {
      recursive: true,
      withFileTypes: true,
    })) {
      if (!voce.isFile() || !/\.tsx?$/.test(voce.name)) continue;
      const relativo = join(voce.parentPath, voce.name).slice(radice.length);
      if (!ESCLUSI.includes(relativo)) files.push(join(voce.parentPath, voce.name));
    }
  }

  const trovate = new Map<string, string>();
  for (const f of files) {
    for (const chiave of chiaviDi(readFileSync(f, 'utf8'))) {
      // Una chiave costruita con un'interpolazione non è una chiave: è un
      // difetto a parte, e lo prende il controllo qui sotto.
      if (chiave && !chiave.includes('${') && !trovate.has(chiave)) {
        trovate.set(chiave, f.slice(radice.length));
      }
    }
  }

  /*
   * La rete sotto la rete, di nuovo: se `t()` cambia nome o forma, l'estrazione
   * smette di trovare qualcosa e ogni controllo qui sotto passerebbe su un
   * insieme vuoto, dichiarando tradotta un'applicazione che nessuno ha guardato.
   */
  it('legge davvero il sorgente', () => {
    expect(files.length).toBeGreaterThan(100);
    expect(trovate.size).toBeGreaterThan(1000);
  });

  it('nessuna frase passa da t() senza avere una voce nel dizionario', () => {
    const mancanti = [...trovate].filter(([chiave]) => !(chiave in INGLESE));
    const dettaglio = mancanti.map(([c, f]) => `  ${f} → ${JSON.stringify(c)}`).join('\n');
    expect(
      mancanti.map(([c]) => c),
      `queste frasi restano in italiano anche con l’applicazione in inglese:\n${dettaglio}`,
    ).toEqual([]);
  });

  it('nessuna chiave è costruita interpolando un valore', () => {
    /*
      `t(`Consumo ${x} L/min`)` è il difetto che ha tenuto novantuno frasi fuori
      dal dizionario per mesi: la chiave cambia a ogni chiamata e non ci sarà
      mai. La cura è `frase()` con i segnaposti, e questa riga impedisce che
      l'errore rientri dalla porta da cui è uscito.
    */
    const interpolate: string[] = [];
    for (const f of files) {
      for (const chiave of chiaviDi(readFileSync(f, 'utf8'))) {
        if (chiave.includes('${')) interpolate.push(`${f.slice(radice.length)} → ${chiave}`);
      }
    }
    expect(interpolate).toEqual([]);
  });
});
