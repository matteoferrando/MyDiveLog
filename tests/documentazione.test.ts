/**
 * Il README deve raccontare il programma che c'è, non quello che c'era.
 *
 * ► I DUE GUASTI CHE HANNO FATTO NASCERE QUESTO FILE. ◄
 *
 * 1. Il README diceva «**non c'è un pacchetto per Mac Intel né per Linux**»
 *    mentre la CI costruiva un `.deb`, il sito lo linkava fra i pulsanti e
 *    `docs/stato-progetto.md` scriveva che le piattaforme erano cinque. Due
 *    documenti dello stesso repository che si contraddicono, e quello che la
 *    gente legge per primo era quello che negava.
 *
 * 2. L'accesso «Accedi con Apple» — 155 righe nell'app, 441 nel Worker, 531 di
 *    prove — non era nominato **da nessuna parte** nella documentazione
 *    principale. La sezione si chiamava «Accesso con Google, facoltativo» e
 *    l'albero dei file elencava `googleAccesso.ts` e non `appleAccesso.ts`. Chi
 *    l'ha cercata su GitHub non l'ha trovata: era documentata solo in
 *    `server/README.md`, che è un file dentro una sottocartella.
 *
 * Nessuno dei due era un difetto del programma: erano difetti del racconto. E
 * un racconto sbagliato costa quanto un difetto — chi legge decide se scaricare
 * in base a quello.
 *
 * ► PERCHÉ LA PROVA GUARDA I FATTI E NON LE PAROLE. ◄ Non chiede «il README
 * dica Linux». Chiede: *per ogni pacchetto che i workflow costruiscono davvero,
 * il README lo nomina; per ogni fornitore d'accesso che il servizio implementa
 * davvero, il README lo nomina.* Così vale anche per la piattaforma e per il
 * fornitore che verranno dopo, senza che nessuno si ricordi di aggiungere una
 * riga qui.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const RADICE = fileURLToPath(new URL('..', import.meta.url));
const leggi = (p: string) => readFileSync(join(RADICE, p), 'utf8');
const README = leggi('README.md');

describe('la documentazione racconta il programma che c’è', () => {
  it('il README nomina ogni pacchetto che i workflow costruiscono', () => {
    const cartella = join(RADICE, '.github/workflows');
    const workflow = readdirSync(cartella)
      .map((f) => readFileSync(join(cartella, f), 'utf8'))
      .join('\n');
    // I nomi veri dei file di release, presi dai workflow e non da un elenco
    // scritto a mano qui: un elenco a mano invecchia come il README.
    const pacchetti = [
      ...new Set(
        [...workflow.matchAll(/MyDiveLog-[A-Za-z0-9][\w.-]*\.(?:exe|apk|deb|dmg|aab)/g)].map((m) => m[0]),
      ),
    ];
    expect(
      pacchetti.length,
      'nessun pacchetto trovato nei workflow: la prova non misura niente',
    ).toBeGreaterThan(2);
    for (const p of pacchetti) {
      expect(README.includes(p), `i workflow costruiscono \`${p}\` e il README non lo nomina`).toBe(true);
    }
  });

  it('il README non nega una piattaforma che il progetto costruisce', () => {
    // La forma del guasto vero: una frase che dice «non c'è un pacchetto per X»
    // mentre X si costruisce. Si guardano le configurazioni di piattaforma di
    // Tauri, che sono il posto in cui una piattaforma comincia a esistere.
    const piattaforme = readdirSync(join(RADICE, 'src-tauri'))
      .map((f) => /^tauri\.([a-z]+)\.conf\.json$/.exec(f)?.[1])
      .filter((x): x is string => Boolean(x));
    expect(piattaforme).toContain('linux');
    for (const p of piattaforme) {
      const negazione = new RegExp(`non c'è un pacchetto[^.]*\\b${p}\\b`, 'i');
      expect(negazione.test(README), `il README nega \`${p}\`, che invece si costruisce`).toBe(false);
    }
  });

  it('il README nomina ogni fornitore d’accesso che il servizio implementa', () => {
    const fornitori = readdirSync(join(RADICE, 'server'))
      .map((f) => /^([a-z]+)Scambio\.ts$/.exec(f)?.[1])
      .filter((x): x is string => Boolean(x));
    expect(fornitori.sort()).toEqual(['apple', 'google']);

    const titolo = /^## Accesso[^\n]*/m.exec(README)?.[0] ?? '';
    expect(titolo, 'non c’è più una sezione «Accesso» nel README').not.toBe('');
    for (const f of fornitori) {
      const nome = f[0].toUpperCase() + f.slice(1);
      // Nel TITOLO, non solo da qualche parte nel testo: chi scorre l'indice
      // deve vedere che il suo modo di accedere c'è. È esattamente il punto in
      // cui Apple si era persa.
      expect(
        titolo.includes(nome),
        `il servizio implementa l’accesso con ${nome}, e il titolo della sezione dice «${titolo.trim()}»`,
      ).toBe(true);
    }
  });

  it('l’albero dei file nel README non dimentica i moduli d’accesso', () => {
    // L'albero è la mappa che uno legge prima di aprire il codice: un modulo che
    // non c'è nella mappa è un modulo che non si va a cercare.
    for (const f of readdirSync(join(RADICE, 'src/sync'))) {
      if (!/Accesso\.ts$/.test(f)) continue;
      expect(README.includes(f), `\`src/sync/${f}\` non compare nell’albero del README`).toBe(true);
    }
    for (const f of readdirSync(join(RADICE, 'server'))) {
      if (!/Scambio\.ts$/.test(f)) continue;
      expect(README.includes(f), `\`server/${f}\` non compare nell’albero del README`).toBe(true);
    }
  });

  it('i due documenti di stato non si contraddicono sul numero di piattaforme', () => {
    // `docs/stato-progetto.md` diceva «le piattaforme sono cinque» mentre il
    // README ne negava una. Qui si controlla solo che il README nomini tutte
    // quelle che l'altro documento dichiara.
    const stato = leggi('docs/stato-progetto.md');
    for (const nome of ['macOS', 'iOS', 'Windows', 'Android', 'Linux']) {
      if (!stato.includes(nome)) continue;
      expect(README.includes(nome), `\`docs/stato-progetto.md\` parla di ${nome} e il README no`).toBe(true);
    }
  });
});
