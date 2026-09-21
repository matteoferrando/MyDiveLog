/**
 * I CANALI DI TESTO CHE LA GUARDIA DEL DIZIONARIO NON PUÒ VEDERE.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ► LA FORMA, PER LA QUINTA VOLTA IN UNA SETTIMANA. ◄
 *
 * `tests/dizionario.test.ts` scorre il sorgente e pretende una voce per ogni
 * frase passata a `t()` o a `frase()` — ma `chiaviDi` vuole un **apice subito
 * dopo la parentesi**, cioè una stringa letterale. Tutto ciò che arriva a `t()`
 * come variabile le è invisibile.
 *
 * Ci sono passati: le novantuno frasi del piano di miglioramento, le righe
 * dell'avanzamento dello scarico, le dieci avvertenze delle metriche, e adesso
 * questi tre — la destinazione di ogni esportazione, i nomi dei mesi sugli assi
 * dei grafici, e le sette istruzioni «da dove si esporta».
 *
 * *La cura è sempre la stessa, ed è l'unica che funziona: costanti esportate che
 * una prova possa scorrere tutte.*
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DESTINAZIONI } from '../src/ui/esporta';
import { MESI_ABBREVIATI } from '../src/core/analysis/aggregate';
import { etichettaMese } from '../src/ui/format';
import { INGLESE as EN } from '../src/ui/traduzioni';
import { TESTI_DELLINSERIMENTO_A_MANO } from '../src/core/manual';
import { ETICHETTE_DI_CONFIGURAZIONE, N_BOMBOLE, configurationRows } from '../src/core/analysis/gear';
import { frase } from '../src/core/frase';
import type { Dive } from '../src/core/model';
import { TESTI_DELLO_SCARICO } from '../src/core/ble/download';
import { MOTIVI_DI_SCARTO } from '../src/core/ble/esterni';

const segnaposti = (s: string) => (s.match(/\{(\d+)\}/g) ?? []).sort();
const inglese = (s: string) => EN[s] ?? s;

describe('le destinazioni di un’esportazione', () => {
  it.each(DESTINAZIONI)('«%s» ha la sua voce in inglese', (d) => {
    expect(EN[d], `manca la traduzione di «${d}»`).toBeDefined();
  });

  /*
   * ═════════════════════════════════════════════════════════════════════════════
   * ► LA GUARDIA CHE C'ERA QUI CERCAVA UNA FORMULAZIONE, E TROVAVA SE STESSA. ◄
   *
   * Cercava la forma storica del difetto — `${esito.dove}` dentro un apice
   * inverso — in un elenco di cinque file scritto a mano, sotto un titolo che
   * ne annunciava sei. Misurato: cambiando `{t(exported.dove)}` in
   * `{exported.dove}` dentro il JSX di `SyncPage`, **la guardia restava verde**;
   * e restava verde anche solo rinominando la variabile, perché i tre nomi
   * ammessi erano scritti nell'espressione regolare.
   *
   * Una prova sulle traduzioni non deve cercare come il difetto è stato scritto
   * l'ultima volta: deve cercare **il difetto**. Qui il difetto è uno solo e si
   * dice in una riga — *la destinazione arriva a schermo senza passare dal
   * dizionario* — quindi si guardano TUTTE le letture di `.dove`, in tutto
   * `src/`, e si pretende che ognuna sia avvolta in `t()`.
   *
   * L'unica eccezione è il TRASPORTO: `dove: dove.dove` non mostra niente, mette
   * da parte la destinazione perché qualcun altro la disegni più tardi — ed è
   * quel qualcun altro a dover tradurre, cosa che questa stessa prova verifica
   * perché anche la sua è una lettura.
   */
  const LETTURA_DOVE = /[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\.dove\b/g;

  /** Ogni lettura di `.dove` nel sorgente, con il verdetto su come è usata. */
  const letture = (() => {
    const radice = fileURLToPath(new URL('../src/', import.meta.url));
    const fuori: { punto: string; file: string; stato: 'tradotta' | 'trasporto' | 'nuda' }[] = [];
    for (const voce of readdirSync(radice, { recursive: true, withFileTypes: true })) {
      if (!voce.isFile() || !/\.tsx?$/.test(voce.name)) continue;
      const percorso = join(voce.parentPath, voce.name);
      // `ui/esporta.ts` è il posto in cui la destinazione si legge di mestiere:
      // è lui che la traduce e le attacca il percorso.
      if (percorso.endsWith('ui/esporta.ts')) continue;
      const sorgente = readFileSync(percorso, 'utf8');
      for (const m of sorgente.matchAll(LETTURA_DOVE)) {
        const prima = sorgente.slice(Math.max(0, m.index - 40), m.index);
        const riga = sorgente.slice(0, m.index).split('\n').length;
        fuori.push({
          punto: `${percorso.slice(radice.length)}:${riga} → ${m[0]}`,
          file: percorso,
          // `t(qualcosa.dove)` traduce; `dove: qualcosa.dove` è solo un passaggio
          // di mano; tutto il resto finisce a schermo così com'è.
          stato: /\bt\(\s*$/.test(prima) ? 'tradotta' : /\bdove:\s*$/.test(prima) ? 'trasporto' : 'nuda',
        });
      }
    }
    return fuori;
  })();

  /**
   * I punti che compongono la frase della destinazione passando da
   * `frasePosizione`.
   *
   * ► PERCHÉ IL CONTEGGIO SI È SPOSTATO QUI. ◄ Fino al 16 settembre 2026 gli
   * otto punti facevano `t(esito.dove)` ognuno per conto suo, e questa prova
   * contava quelle letture. Poi la segnalazione dal Samsung ha aggiunto un
   * secondo pezzo alla frase — il percorso, che su Android è l'unica risposta
   * utile — e otto copie da aggiornare a mano sono otto occasioni di
   * dimenticarne una. Adesso la frase la compone una funzione sola.
   *
   * La guardia resta la stessa domanda, posta al posto nuovo: *chi mostra la
   * destinazione la fa passare dal dizionario?*
   */
  const composizioni = (() => {
    const radice = fileURLToPath(new URL('../src/', import.meta.url));
    const fuori: string[] = [];
    for (const voce of readdirSync(radice, { recursive: true, withFileTypes: true })) {
      if (!voce.isFile() || !/\.tsx?$/.test(voce.name)) continue;
      const percorso = join(voce.parentPath, voce.name);
      if (percorso.endsWith('ui/esporta.ts')) continue;
      const sorgente = readFileSync(percorso, 'utf8');
      for (const m of sorgente.matchAll(/frasePosizione\s*\(/g)) {
        const riga = sorgente.slice(0, m.index).split('\n').length;
        fuori.push(`${percorso.slice(radice.length)}:${riga}`);
      }
    }
    return fuori;
  })();

  it('sono otto punti, o questa prova sta guardando un nome che non esiste più', () => {
    /*
     * ► LA GUARDIA DELLA GUARDIA. ◄ Tutto quello che sta qui sotto poggia su
     * due nomi: il campo `dove` e la funzione `frasePosizione`. Rinominato uno
     * dei due, l'estrazione non aggancerebbe più niente e ogni controllo
     * passerebbe su un insieme vuoto — che è il modo più silenzioso di perdere
     * una guardia, ed è esattamente ciò che faceva la versione precedente di
     * questa prova.
     */
    expect(composizioni.length, 'nessuna chiamata a «frasePosizione» trovata').toBeGreaterThanOrEqual(8);
    // E qui sotto si pretende che sia ZERO: il conteggio della guardia della
    // guardia è quello delle chiamate, non delle letture.
    expect(letture.length).toBe(0);
  });

  it('e la funzione che compone la frase traduce davvero', () => {
    // Il punto unico in cui la destinazione diventa testo: se qui sparisse
    // `t()`, tutte e otto le frasi uscirebbero in italiano insieme.
    const sorgente = readFileSync('src/ui/esporta.ts', 'utf8');
    const corpo = /export function frasePosizione\([\s\S]*?\n\}/.exec(sorgente);
    expect(corpo, 'la funzione che compone la frase non c’è più').not.toBeNull();
    expect(corpo![0]).toMatch(/\bt\(\s*esito\.dove\s*\)/);
  });

  it('nessuno legge la destinazione grezza fuori dal file che la compone', () => {
    /*
     * ► LA REGOLA ADESSO È UNA RIGA. ◄ `EsitoEsportazione.dove` è una chiave
     * del dizionario, non una frase: chi la legge deve tradurla **e** deve
     * aggiungere il percorso dove serve. Tutte e due le cose le fa
     * `frasePosizione`, quindi fuori da `ui/esporta.ts` quel campo non si legge
     * proprio.
     *
     * Senza questa riga, un nono punto scritto a mano come `t(esito.dove)`
     * sarebbe tradotto correttamente e **perderebbe il percorso in silenzio** —
     * cioè tornerebbe esattamente alla frase inutile della segnalazione dal
     * Samsung: «PDF salvato nella cartella dei documenti dell'app», senza dire
     * quale.
     *
     * Il campo `posizione` di `SyncPage` si chiama così apposta: lì dentro c'è
     * la frase GIÀ composta, ed è un'altra cosa. *Un nome per ogni significato,
     * o una guardia che cerca un nome non sa più cosa sta guardando.*
     */
    const fuori = letture.map((l) => l.punto);
    expect(
      fuori,
      `leggono la destinazione grezza invece di chiamare frasePosizione:\n  ${fuori.join('\n  ')}`,
    ).toEqual([]);
  });

  it('nessuna mostra la destinazione senza passare dal dizionario', () => {
    /*
     * Interpolata dentro un'altra frase — «PDF salvato {dove}» — senza `t()`
     * attorno, con l'applicazione in inglese si leggeva *«PDF saved dove il
     * sistema mette i download»*. Si controlla sul sorgente e non montando i
     * componenti perché i punti sono sparsi in sei file, e montarli tutti
     * costerebbe cento volte tanto coprendo meno.
     *
     * Vale ancora, e adesso copre soprattutto le letture NUOVE: chi aggiungesse
     * un nono punto scrivendo `t(esito.dove)` a mano invece di chiamare
     * `frasePosizione` non sbaglierebbe la traduzione ma perderebbe il
     * percorso, che su Android è l'unica risposta utile.
     */
    const nude = letture.filter((l) => l.stato === 'nuda').map((l) => l.punto);
    expect(nude, `mostrano la destinazione senza tradurla:\n  ${nude.join('\n  ')}`).toEqual([]);
  });

  it('e chi la mette da parte per dopo la fa tradurre a chi la disegna', () => {
    /*
     * `SyncPage` raccoglie la destinazione in uno stato (`dove: dove.dove`) e la
     * disegna molto più in basso. Il trasporto in sé è legittimo — non mostra
     * niente — ma lo è solo se in quello stesso file c'è anche chi traduce:
     * altrimenti la destinazione è stata messa da parte per finire a schermo
     * nuda, e la deroga diventerebbe il nascondiglio del difetto.
     */
    const traducono = new Set(letture.filter((l) => l.stato === 'tradotta').map((l) => l.file));
    const orfani = letture
      .filter((l) => l.stato === 'trasporto' && !traducono.has(l.file))
      .map((l) => l.punto);
    expect(
      orfani,
      `mettono da parte la destinazione e nessuno la traduce:\n  ${orfani.join('\n  ')}`,
    ).toEqual([]);
  });
});

describe('i nomi dei mesi', () => {
  it('sono dodici, o questa prova sta guardando un elenco che si è svuotato', () => {
    expect(MESI_ABBREVIATI).toHaveLength(12);
  });

  it.each(MESI_ABBREVIATI)('«%s» ha la sua voce in inglese', (m) => {
    expect(EN[m], `manca la traduzione del mese «${m}»`).toBeDefined();
  });

  it('e l’etichetta composta traduce il mese lasciando stare l’anno', () => {
    /*
     * ► FINIVANO ANCHE NELLA DESCRIZIONE PER GLI SCREEN READER. ◄ Non solo
     * sull'asse X: con l'applicazione in inglese si leggeva *«Max ott 25 on 3
     * dives»*. L'anno è un numero e non si traduce; il mese è una parola.
     */
    expect(etichettaMese('ott 25', inglese)).toBe('Oct 25');
    expect(etichettaMese('gen 26', inglese)).toBe('Jan 26');
    // E un'etichetta che non è un mese non si rompe.
    expect(etichettaMese('0–12 m', inglese)).toBe('0–12 m');
  });
});

describe('le istruzioni «da dove si esporta»', () => {
  it('hanno tutte la loro voce in inglese', () => {
    /*
     * Sono sette righe lette dal sorgente, come `avanzamentoTradotto.test.ts`
     * fa con le etichette del ponte Rust: è l'unico modo di raggiungere un
     * oggetto costruito dentro un componente.
     */
    const sorgente = readFileSync('src/ui/pages/ImportPage.tsx', 'utf8');
    const blocco = /const HOWTO: Record<string, string> = \{([\s\S]*?)\n\};/.exec(sorgente);
    expect(
      blocco,
      'l’elenco HOWTO non si trova più: questa prova sta guardando il posto sbagliato',
    ).not.toBeNull();
    const voci = [...blocco![1]!.matchAll(/:\s*'([^']+)'/g)].map((m) => m[1]!);
    expect(voci.length, 'nessuna voce trovata: la ricerca non aggancia più niente').toBeGreaterThanOrEqual(7);
    const senzaVoce = voci.filter((v) => EN[v] === undefined);
    expect(senzaVoce, `istruzioni senza traduzione: ${senzaVoce.join(' | ')}`).toEqual([]);
  });
});

describe('► e i segnaposti non si perdono per strada ◄', () => {
  it('ogni voce inglese porta gli stessi {0} dell’italiana', () => {
    /*
     * Una traduzione che perde un `{0}` non sembra rotta: la frase resta
     * grammaticale e sparisce soltanto il numero. Questa riga guarda il
     * dizionario **intero**, non solo i canali di questo file.
     */
    const rotte = Object.entries(EN).filter(([it, en]) => segnaposti(it).join() !== segnaposti(en).join());
    expect(
      rotte.map(([it]) => it),
      'voci in cui i segnaposti non combaciano',
    ).toEqual([]);
  });
});

/**
 * ► IL CANALE DELL'INSERIMENTO A MANO. ◄
 *
 * `NewDive.tsx` disegna gli errori e gli avvisi di `core/manual.ts` con `t(e)` e
 * `t(w)` — su una VARIABILE. A schermo funziona; per `chiaviDi` quelle undici
 * frasi non esistono, e `dizionario.test.ts` non poteva dire se una voce
 * mancasse. Ne mancava una, «Senza la profondità media i tessuti si stimano su
 * un profilo quadro.», e usciva in italiano in mezzo a due righe inglesi.
 *
 * Correggere la sola voce non sarebbe servito a niente: la dodicesima frase che
 * qualcuno aggiungerà avrebbe fatto la stessa fine. Qui si controlla il canale,
 * non la frase.
 */
describe('gli errori e gli avvisi dell’inserimento a mano', () => {
  const SORGENTE = readFileSync('src/core/manual.ts', 'utf8');

  it('sono undici, o questa prova sta guardando un elenco che si è svuotato', () => {
    // ► LA GUARDIA DELLA GUARDIA. ◄ `it.each` su un elenco vuoto chiude verde.
    expect(TESTI_DELLINSERIMENTO_A_MANO.length).toBeGreaterThanOrEqual(11);
  });

  it.each(TESTI_DELLINSERIMENTO_A_MANO)('«%s» ha la sua voce in inglese', (frase) => {
    expect(EN[frase], `manca la traduzione di «${frase}»`).toBeDefined();
  });

  it('nessuna frase viene spinta nell’elenco senza passare da una costante', () => {
    /*
     * La metà che chiude il buco per DAVVERO. Le costanti esportate si possono
     * scorrere; una `warnings.push('…')` scritta sul posto no — e sarebbe
     * esattamente il difetto di partenza, rientrato dalla porta da cui è uscito.
     */
    const nude = [...SORGENTE.matchAll(/\b(?:errors|warnings)\.push\(\s*(['"`])/g)].map((m) => m[0]);
    expect(nude, 'frasi scritte sul posto invece che come costante esportata').toEqual([]);
  });

  it('e ogni costante di testo del modulo è nell’elenco che la prova scorre', () => {
    /*
     * L'altra metà: una costante nuova che nessuno aggiunge a
     * `TESTI_DELLINSERIMENTO_A_MANO` sfuggirebbe alla guardia restando
     * perfettamente ordinata a vedersi. Si confronta il sorgente con l'elenco,
     * così il dimenticarsene fa rumore.
     */
    const dichiarate = [
      ...SORGENTE.matchAll(/^export const [A-Z_]+ =\s*(?:\n\s*)?'((?:[^'\\]|\\.)*)'/gm),
    ].map((m) => m[1]!.replace(/\\(.)/g, '$1'));
    expect(
      dichiarate.length,
      'nessuna costante trovata: la ricerca non aggancia più niente',
    ).toBeGreaterThanOrEqual(11);
    const fuori = dichiarate.filter((s) => !(TESTI_DELLINSERIMENTO_A_MANO as readonly string[]).includes(s));
    expect(fuori, `costanti che nessuna prova scorre: ${fuori.join(' | ')}`).toEqual([]);
  });
});

/**
 * ► IL CANALE DELLE CONFIGURAZIONI DI ATTREZZATURA. ◄
 *
 * `Gear.tsx` disegna la tabella «Configurazione» con le etichette che nascono in
 * `core/analysis/gear.ts`. Le fisse — «Una bombola», «Rebreather a circuito
 * chiuso» — passavano da `t(c.label)`, cioè da una variabile: invisibili a
 * `chiaviDi`. Quella col numero dentro non passava affatto, ed era scritto sul
 * posto che «una chiave per ogni numero non è una traduzione»: vero, ma la
 * conclusione era lasciare «3 bombole» e «4 bombole» in italiano in mezzo a
 * righe inglesi, invece di usare il modello coi segnaposti che tutto il resto
 * del progetto usa.
 */
describe('le etichette delle configurazioni di attrezzatura', () => {
  it('sono sei, o questa prova sta guardando un elenco che si è svuotato', () => {
    expect(ETICHETTE_DI_CONFIGURAZIONE.length).toBeGreaterThanOrEqual(6);
  });

  it.each(ETICHETTE_DI_CONFIGURAZIONE)('«%s» ha la sua voce in inglese', (etichetta) => {
    expect(EN[etichetta], `manca la traduzione di «${etichetta}»`).toBeDefined();
  });

  it('e quella col numero tiene gli stessi segnaposti', () => {
    expect(segnaposti(EN[N_BOMBOLE] ?? '')).toEqual(segnaposti(N_BOMBOLE));
  });

  it('le righe portano il MODELLO e i numeri a parte, non il numero già dentro', () => {
    /*
     * ► IL CUORE DELLA CORREZIONE. ◄ Se l'etichetta tornasse a essere «4
     * bombole» già composta, la chiave cambierebbe a ogni numero e nel
     * dizionario non ci sarebbe mai — che è il difetto di partenza. Qui si
     * guarda proprio quello: il numero NON deve stare nell'etichetta.
     */
    const con = (n: number): Dive => ({
      id: `c${n}`,
      startTime: '2026-05-01T10:00:00Z',
      durationS: 2400,
      maxDepth: 30,
      mode: 'oc',
      cylinders: Array.from({ length: n }, () => ({ mix: { o2: 0.21, he: 0 } })),
      tags: [],
      source: { format: 'uddf', file: 'x', importedAt: '2026-05-01T12:00:00Z' },
    });
    const righe = configurationRows([con(4), con(4), con(3), con(1)]);
    const quattro = righe.find((r) => r.valori?.[0] === 4)!;
    expect(quattro.label).toBe(N_BOMBOLE);
    // Un numero fuori da un segnaposto sarebbe il numero già entrato nella chiave.
    expect(quattro.label.replace(/\{\d+\}/g, '')).not.toMatch(/\d/);
    expect(quattro.dives).toBe(2);
    // Tre e quattro bombole condividono il modello: devono restare due righe.
    expect(righe.filter((r) => r.label === N_BOMBOLE)).toHaveLength(2);
    expect(righe.find((r) => r.valori?.[0] === 3)!.dives).toBe(1);
  });

  it('e composte in inglese escono in inglese, col numero al suo posto', () => {
    expect(frase(inglese, N_BOMBOLE, 4)).toBe('4 cylinders');
    expect(frase(inglese, N_BOMBOLE, 4)).not.toMatch(/bombole/);
  });
});

/**
 * ► IL CANALE DEGLI AVVISI DELLO SCARICO BLUETOOTH. ◄
 *
 * Finito lo scarico, sotto la riga verde, c'è l'elenco che spiega **perché
 * mancano delle immersioni**. Le frasi nascono in `core` e arrivano al
 * dizionario come variabili: `chiaviDi` non ne vede nessuna. Uscivano in
 * italiano sotto un riepilogo inglese.
 */
describe('gli avvisi dello scarico Bluetooth', () => {
  const TUTTI = [...TESTI_DELLO_SCARICO, ...MOTIVI_DI_SCARTO];

  it('sono sei, o questa prova sta guardando un elenco che si è svuotato', () => {
    expect(TUTTI.length).toBeGreaterThanOrEqual(6);
  });

  it.each(TUTTI)('«%s» ha la sua voce in inglese', (modello) => {
    expect(EN[modello], `manca la traduzione di «${modello}»`).toBeDefined();
  });

  it.each(TUTTI)('«%s» tiene gli stessi segnaposti', (modello) => {
    /*
     * Una traduzione che perde un `{0}` non sembra rotta: la frase resta
     * grammaticale e sparisce soltanto il numero — «dives could not be read».
     * È il genere di difetto che si trova con una riga di prova e non si trova
     * mai rileggendo.
     */
    const en = EN[modello];
    if (!en) return; // lo dice già la prova sopra
    expect(segnaposti(en), `segnaposti diversi in «${en}»`).toEqual(segnaposti(modello));
  });

  it('le forme singolari non portano nessun numero, o non sarebbero forme singolari', () => {
    // «1 immersioni non si sono potute leggere» è il difetto che le coppie
    // singolare/plurale esistono per non far tornare.
    for (const uno of [TESTI_DELLO_SCARICO[0], ...MOTIVI_DI_SCARTO]) {
      expect(segnaposti(uno), `«${uno}» porta un numero`).toEqual([]);
    }
  });
});
