/**
 * Quello che viene davvero mandato al modello.
 *
 * È l'unica parte dell'applicazione che nessuno leggeva prima di spedirla: il
 * contesto si costruisce in memoria, finisce in una richiesta HTTP, e quello che
 * si vede è solo la risposta. Un campo con il nome sbagliato, un'unità mancante,
 * una promessa nelle istruzioni che il contesto non mantiene — nessuna di queste
 * cose produce un errore. Producono un'analisi peggiore, che ha esattamente lo
 * stesso aspetto di una buona.
 *
 * Il test più importante di questo file è l'ULTIMO: le istruzioni di sistema
 * nominano dei campi per nome, e quei nomi devono esistere. È un contratto fra
 * due file che nessun compilatore controlla, perché da una parte è codice e
 * dall'altra è una stringa in italiano.
 */

import { describe, expect, it } from 'vitest';
import { archiveContext, compactJson, diveContext } from '../src/ai/context';
import { SYSTEM } from '../src/ai/prompts';
import { aggregate } from '../src/core/analysis/aggregate';
import { computeMetrics } from '../src/core/analysis/metrics';
import type { Dive, Sample } from '../src/core/model';
import { synthesise } from './fixtures';

// ------------------------------------------------------------ serializzatore

describe('JSON compatto', () => {
  it('resta JSON valido, che è il requisito che viene prima di tutti', () => {
    // Un serializzatore scritto a mano che produce quasi-JSON è peggio di uno
    // sprecone: il modello lo legge come testo e perde la struttura.
    const v = {
      a: [1, 2, 3],
      b: { c: 'x', d: null },
      e: [
        [1, 'due', null],
        [2, 'tre', 4],
      ],
      f: [],
      g: {},
      h: 'virgolette " e \\ barre',
    };
    expect(JSON.parse(compactJson(v))).toEqual(v);
  });

  it('mette una riga di valori su una riga sola', () => {
    /*
     * È il difetto che costava metà del contesto. `JSON.stringify(x, null, 1)`
     * mette ogni numero su una riga sua: un profilo di 104 campioni da otto
     * colonne diventava quasi novecento righe di una cifra e una virgola.
     * Misurato: il contesto di un'immersione è passato da 3400 a 1700 token.
     *
     * E non è solo il costo: una tabella scritta un numero per riga non si
     * LEGGE come una tabella — la riga «colonne» che dice come interpretare i
     * punti non aggancia più niente.
     */
    expect(compactJson({ punti: [[0, 12.4, 21]] })).toContain('[0, 12.4, 21]');
    expect(compactJson([1, 2, 3])).toBe('[1, 2, 3]');
  });

  it('gli oggetti restano leggibili su più righe', () => {
    const s = compactJson({ a: 1, b: 2 });
    expect(s.split('\n').length).toBeGreaterThan(2);
  });

  it('undefined diventa null, non sparisce', () => {
    // Una chiave che sparisce è indistinguibile da una chiave che non è mai
    // esistita, e tutto il contesto è costruito sulla differenza fra «assente»
    // e «zero».
    expect(compactJson([1, undefined, 3])).toBe('[1, null, 3]');
  });
});

// ------------------------------------------------------------------ immersioni

function immersione(over: Partial<Dive> = {}, samples?: Sample[]): Dive {
  const s = synthesise({ startTime: new Date('2026-06-14T09:00:00Z') });
  const base: Dive = {
    id: 'x',
    startTime: '2026-06-14T09:00:00Z',
    durationS: s.spec.durationS,
    maxDepth: Math.max(...s.samples.map((w) => w.depth)),
    mode: 'oc',
    cylinders: [{ mix: { o2: 0.32, he: 0 }, sizeL: 12, startBar: 200, endBar: 60 }],
    source: { format: 'uddf', file: 'x', importedAt: 'x' },
    tags: [],
    samples: samples ?? s.samples.map((w) => ({ t: w.t, depth: w.depth, tempC: 18 })),
    ...over,
  };
  return { ...base, metrics: computeMetrics(base) };
}

describe('il profilo nel contesto', () => {
  it('toglie le colonne vuote su TUTTI i campioni, e dice quali', () => {
    /*
     * Solo gli Shearwater scrivono tetto, NDL, TTS e CNS a ogni campione. Su
     * un'immersione dell'Aladin quelle colonne sono nulle cento volte di
     * seguito: costano token e, peggio, dichiarare un dato che poi è sempre
     * vuoto è un invito a commentarne l'assenza cento volte invece che una.
     */
    const c = diveContext(immersione());
    const j = JSON.parse(c);
    expect(j.profilo.colonne).toBe('tempo(s), profondità(m), temperatura(°C)');
    expect(j.profilo.nota).toMatch(/non registra .*tetto\(m\)/);
    expect(j.profilo.nota).toMatch(/non perché i valori fossero zero/);
    for (const p of j.profilo.punti) expect(p).toHaveLength(3);
  });

  it('tiene una colonna che ha almeno un valore', () => {
    /*
     * Il tetto sull'ultimo quarto del profilo, non su un campione solo.
     *
     * Il criterio guarda i campioni SOTTOCAMPIONATI, non gli originali, ed è
     * giusto così: se il tetto compare su un unico campione che il
     * sottocampionamento poi scarta, la colonna che arriverebbe al modello
     * sarebbe comunque tutta nulla, e mandarla non aggiungerebbe niente. La
     * decompressione vera dura minuti e sopravvive a qualunque riduzione.
     */
    const s = synthesise({ startTime: new Date('2026-06-14T09:00:00Z') });
    const soglia = Math.floor(s.samples.length * 0.75);
    const conTetto = s.samples.map((w, i) => ({
      t: w.t,
      depth: w.depth,
      tempC: 18,
      ceiling: i >= soglia ? 6 : undefined,
    }));
    const j = JSON.parse(diveContext(immersione({}, conTetto)));
    expect(j.profilo.colonne).toContain('tetto(m)');
    expect(j.profilo.nota).not.toMatch(/non registra .*tetto/);
  });

  it('tempo e profondità non si tolgono mai', () => {
    // Una profondità costante a zero è un dato — un'immersione che non è mai
    // scesa — e va distinta da una colonna che il computer non scrive.
    const piatta = [0, 60, 120].map((t) => ({ t, depth: 0 }));
    const j = JSON.parse(diveContext(immersione({ maxDepth: 0 }, piatta)));
    expect(j.profilo.colonne.startsWith('tempo(s), profondità(m)')).toBe(true);
  });
});

describe('i gradient factor del computer', () => {
  it('con il solo GF basso NON scrive «40/undefined»', () => {
    /*
     * Parecchi computer scrivono solo il GF basso. La stringa `40/undefined` in
     * mezzo a un contesto fatto di numeri è il genere di cosa che un modello
     * prova a interpretare — e le istruzioni gli dicono espressamente di stare
     * attento ai cambi di GF nel tempo, quindi ci guarda.
     *
     * Lo stesso difetto era già stato trovato e corretto nell'interfaccia; qui
     * era rimasto, ed è la ragione per cui questo file esiste.
     */
    const j = JSON.parse(diveContext(immersione({ computer: { model: 'X', gfLow: 40 } })));
    expect(JSON.stringify(j)).not.toContain('undefined');
    /*
     * La metà che manca è un punto interrogativo, non un `null` sull'intera
     * coppia: buttare via anche il GF basso, che l'app POSSIEDE, era la
     * correzione fatta larga. Parecchi computer scrivono solo quello, e i
     * lettori Shearwater leggono `gfMin` e `gfMax` indipendentemente.
     */
    expect(j.computer[0].gfImpostati).toBe('40/?');
  });

  it('e con il solo GF alto scrive l’altra metà', () => {
    const j = JSON.parse(diveContext(immersione({ computer: { model: 'X', gfHigh: 85 } })));
    expect(j.computer[0].gfImpostati).toBe('?/85');
  });

  it('senza nessuno dei due resta nullo', () => {
    const j = JSON.parse(diveContext(immersione({ computer: { model: 'X' } })));
    expect(j.computer[0].gfImpostati).toBeNull();
  });

  it('con entrambi li scrive', () => {
    const j = JSON.parse(diveContext(immersione({ computer: { model: 'X', gfLow: 40, gfHigh: 85 } })));
    expect(j.computer[0].gfImpostati).toBe('40/85');
  });
});

describe('la tabella dell’archivio', () => {
  const archivio = () => {
    const dives = [
      immersione({ id: 'a', startTime: '2026-06-14T09:00:00Z' }),
      immersione({ id: 'b', startTime: '2026-06-15T09:00:00Z', site: { name: 'Secca' } }),
    ];
    return JSON.parse(archiveContext(dives, aggregate(dives), 'tutto'));
  };

  it('mantiene la promessa che fa: assente è null, mai stringa vuota', () => {
    /*
     * La nota sotto la tabella dice «un campo nullo significa dato assente, non
     * zero». Tre colonne però scrivevano `''`: sito, gradient factor e miscela.
     * Una stringa vuota in mezzo a stringhe piene non si legge come assenza —
     * si legge come un sito che si chiama così.
     */
    const j = archivio();
    for (const riga of j.immersioni.righe) {
      expect(riga).not.toContain('');
    }
    expect(j.immersioni.righe[0][1]).toBeNull();
    expect(j.immersioni.righe[1][1]).toBe('Secca');
  });

  it('ogni riga ha tante celle quante sono le colonne dichiarate', () => {
    // Se le due cose divergono, il modello legge ogni valore sotto
    // l'intestazione sbagliata e ogni numero che cita è di un'altra grandezza.
    // È il modo peggiore di sbagliare: nessun sintomo, tutte le cifre plausibili.
    const j = archivio();
    const n = j.immersioni.colonne.split(',').length;
    for (const riga of j.immersioni.righe) expect(riga).toHaveLength(n);
  });
});

// ------------------------------------------------- il contratto con le istruzioni

describe('le istruzioni non promettono campi che non esistono', () => {
  /*
   * IL TEST CHE CONTA PIÙ DI TUTTI.
   *
   * Le istruzioni di sistema nominano dei campi con il loro identificativo
   * esatto — `gf99SenzaResiduoPct`, `azotoResiduoIngressoBar` — e spiegano al
   * modello come usarli. Se uno di quei nomi cambia nel contesto, o sparisce,
   * niente si rompe: le istruzioni continuano a parlare di un campo che non
   * arriva più, e il modello o lo ignora o si inventa a cosa corrispondesse.
   *
   * È un contratto fra due file che nessun compilatore può controllare, perché
   * da una parte è codice e dall'altra è una stringa in italiano. Qui si
   * estraggono i nomi dalle istruzioni e si verifica che il contesto li
   * contenga davvero.
   */
  /*
   * Gli apici inversi nelle istruzioni significano UNA cosa sola: il nome esatto
   * di un campo del contesto. È una convenzione, e questo test è ciò che la
   * rende una convenzione invece di un'abitudine — se qualcuno scrive fra apici
   * una parola generica, il test fallisce e lo obbliga a scegliere: o è un campo
   * e deve esistere, o è una parola e va scritta senza apici.
   */
  const nomiCitati = [...SYSTEM.matchAll(/`([A-Za-z][A-Za-z0-9_.]*)`/g)].map((m) => m[1]);

  it('trova dei nomi da controllare (se no il test non prova niente)', () => {
    expect(nomiCitati.length).toBeGreaterThan(3);
  });

  it('ogni campo citato esiste in almeno uno dei contesti', () => {
    /*
     * In ALMENO UNO, non in tutti: le istruzioni di sistema sono le stesse per
     * le cinque analisi, e alcuni campi vivono solo in uno dei contesti — il
     * riscontro fra i due GF99 ha senso sull'archivio, non su una immersione
     * sola. Il contratto da verificare è che ogni nome citato arrivi da qualche
     * parte, non che arrivi ovunque.
     */
    const completa = immersione({
      computer: { model: 'Peregrine', gfLow: 40, gfHigh: 85 },
      reported: { gf99End: 71 },
    });
    const j = {
      immersione: JSON.parse(diveContext(completa)),
      archivio: JSON.parse(archiveContext([completa], aggregate([completa]), 'tutto')),
    };

    /** Cerca una chiave ovunque nell'albero: le istruzioni citano i nomi nudi. */
    const esiste = (obj: unknown, chiave: string): boolean => {
      if (obj === null || typeof obj !== 'object') return false;
      if (Array.isArray(obj)) return obj.some((v) => esiste(v, chiave));
      const rec = obj as Record<string, unknown>;
      return chiave in rec || Object.values(rec).some((v) => esiste(v, chiave));
    };

    for (const nome of nomiCitati) {
      // I nomi puntati (`calcolatoDallApp.gf99AllUscitaPct`) si seguono come
      // percorso; quelli nudi si cercano dove capita, perché è così che il
      // modello li troverà.
      const trovato = nome.includes('.')
        ? Object.values(j).some(
            (ctx) =>
              nome.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], ctx) !==
              undefined,
          )
        : esiste(j, nome);
      expect(trovato, `le istruzioni citano \`${nome}\` ma il contesto non lo contiene`).toBe(true);
    }
  });
});
