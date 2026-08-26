/**
 * Le rotte nominate nella configurazione del Worker esistono davvero nel Worker.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ► IL DIFETTO CHE HA FATTO NASCERE QUESTO FILE. ◄
 *
 * `server/wrangler.toml`, sopra l'archivio delle segnalazioni, portava scritto:
 * «Il foglio si riempie da lì, ed è un problema separato: vedi la rotta
 * `/segnalazioni.csv` in worker.ts».
 *
 * Quella rotta non è mai esistita. Il Worker ne ha quattro e non era una di
 * quelle. Per settimane le segnalazioni dal sito sono entrate nell'archivio e
 * non è uscito niente — un cassetto senza maniglia — e da fuori la cosa era
 * **indistinguibile da un modulo rotto**: chi guardava il foglio di Google lo
 * trovava vuoto e concludeva, ragionevolmente, che il sito non funzionasse.
 *
 * ► PERCHÉ NESSUN CONTROLLO POTEVA PRENDERLO. ◄ Un commento non lo compila
 * nessuno. `tsc` non guarda dentro i commenti, `eslint` nemmeno, e un file
 * `.toml` non è codice per nessuno dei due. E la rotta mancante non produceva un
 * errore: produceva **un'assenza**, che è la cosa che questo progetto ha già
 * imparato tre volte a non aspettarsi che qualcuno segnali da solo — il gestore
 * Rust registrato per due piattaforme su quattro, il file mancante dalla lista
 * dei sorgenti, il numero sbagliato dentro un commento.
 *
 * ► LA CONVENZIONE CHE QUESTO TEST IMPONE. ◄ In `wrangler.toml`, un percorso
 * **fra apici inversi** — `` `/segnalazione` `` — è un rimando a codice che deve
 * esistere. Un percorso scritto in prosa, dentro le virgolette basse, è una
 * citazione: serve a raccontare cosa c'era scritto prima, e non promette niente.
 * È una distinzione che si legge a occhio e che qui si controlla.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const leggi = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');

const CONFIGURAZIONE = leggi('../server/wrangler.toml');
const SORGENTE = leggi('../server/worker.ts');

/** I percorsi che `worker.ts` serve davvero, letti dai suoi confronti. */
function rotteDelWorker(): string[] {
  return [...SORGENTE.matchAll(/percorso === '([^']+)'/g)].map((m) => m[1]);
}

/** I percorsi che la configurazione nomina come codice, cioè fra apici inversi. */
function rotteDichiarate(): string[] {
  return [...CONFIGURAZIONE.matchAll(/`(\/[A-Za-z0-9._/-]*)`/g)].map((m) => m[1]);
}

describe('le rotte nominate nella configurazione esistono', () => {
  /*
   * La rete sotto la rete. Se un giorno le rotte si scrivessero in un altro modo
   * — una tabella, uno `switch`, un router — questa estrazione non troverebbe
   * più niente, e il controllo qui sotto passerebbe confrontando due elenchi
   * vuoti. Un test che non può fallire è peggio di nessun test: è successo
   * stanotte, su un'altra guardia, e si è visto solo provandola a rovescio.
   */
  it('trova le rotte in tutti e due i file', () => {
    expect(rotteDelWorker().length).toBeGreaterThanOrEqual(4);
    expect(rotteDichiarate().length).toBeGreaterThan(0);
  });

  it('ogni rotta nominata fra apici inversi è servita dal Worker', () => {
    const vere = new Set(rotteDelWorker());
    const inventate = rotteDichiarate().filter((r) => !vere.has(r));
    expect(
      inventate,
      `wrangler.toml rimanda a rotte che worker.ts non serve: ${inventate.join(', ')}\n` +
        `quelle che esistono sono: ${[...vere].join(', ')}`,
    ).toEqual([]);
  });

  it('la rotta delle segnalazioni c’è, e la configurazione la nomina', () => {
    // Le due metà del difetto originale, inchiodate una per una: la rotta deve
    // esistere, e il file che la descrive deve parlare di quella e non di
    // un'altra.
    expect(rotteDelWorker()).toContain('/segnalazione');
    expect(rotteDichiarate()).toContain('/segnalazione');
  });
});
