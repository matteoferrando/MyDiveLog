/**
 * Normalizzare da UN LATO SOLO di un confronto.
 *
 * ► PERCHÉ QUESTO FILE ESISTE. ◄ Un campo di testo si salva ripulito —
 * `token.trim()`, `nome.trim() || undefined` — perché uno spazio in coda non è
 * un dato, è un residuo del copia-e-incolla. Poi, per sapere se c'è qualcosa da
 * salvare, lo si confronta con l'archivio; e in due punti di `SyncPage.tsx` il
 * confronto guardava il valore GREZZO contro quello già ripulito. Basta uno
 * spazio — cioè il caso normale quando un token si incolla — perché i due non
 * coincidano mai:
 *
 *  - «Sincronizza» restava disabilitato per sempre, senza nessuna spiegazione a
 *    schermo, perché le credenziali risultavano eternamente «non salvate»;
 *  - il pulsante «Salva» del nome sul libretto non spariva più dopo il
 *    salvataggio, perché il nome risultava eternamente «modificato».
 *
 * Due sintomi diversi, un difetto solo. È il genere di errore che non fa
 * fallire niente e non lascia traccia: il codice è corretto in ogni sua riga,
 * sbaglia solo a mettere insieme due valori che non sono nella stessa forma.
 *
 * ► PERCHÉ SI PROVA UNA FUNZIONE E POI SI RILEGGE IL SORGENTE. ◄ Perché sono
 * due garanzie diverse. La funzione prova che la REGOLA è giusta; la rilettura
 * del sorgente prova che le due pagine la USANO — che è esattamente la parte che
 * era rotta, e che nessun test sulla funzione da sola potrebbe accorgersi se
 * domani qualcuno riscrivesse il confronto a mano. `SyncPage.tsx` non si può
 * montare in un test: vuole l'archivio, la provveditura della lingua e mezzo
 * albero dell'applicazione. Il suo testo, invece, si legge sempre — ed è lo
 * stesso mestiere che fa già `pianoTradotto.test.ts`.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { campoModificato, ripulisci } from '../src/ui/modificato';

/** Un token vero è lungo e opaco: gli spazi in coda non si vedono. */
const TOKEN = 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJpZCI6ImRiLXRlc3QifQ';

describe('campoModificato', () => {
  it('non chiama «modifica» uno spazio che il salvataggio toglierebbe', () => {
    // Il caso che teneva «Sincronizza» spento per sempre: incollato con uno
    // spazio in coda, salvato senza.
    expect(campoModificato(`${TOKEN} `, TOKEN)).toBe(false);
    expect(campoModificato(` ${TOKEN}`, TOKEN)).toBe(false);
    expect(campoModificato(`\n${TOKEN}\t`, TOKEN)).toBe(false);
    // E il caso del nome sul libretto, che teneva acceso «Salva».
    expect(campoModificato('Matteo Ferrando ', 'Matteo Ferrando')).toBe(false);
  });

  it('vede le modifiche vere, spazi o non spazi', () => {
    expect(campoModificato(`${TOKEN}x`, TOKEN)).toBe(true);
    expect(campoModificato('Matteo Ferrando', 'Matteo Ferrandi')).toBe(true);
    // Lo spazio IN MEZZO è un dato e resta: «Mario Rossi» e «MarioRossi» sono
    // due nomi diversi, e ripulire i bordi non deve toccarlo.
    expect(campoModificato('Mario Rossi', 'MarioRossi')).toBe(true);
  });

  it('tratta «vuoto» e «assente» come lo stesso stato', () => {
    // Chi salva scrive `nome.trim() || undefined`: svuotare il campo riporta
    // `undefined`, e confrontarlo con la stringa vuota direbbe «modificato» su
    // un campo che nessuno ha più toccato.
    expect(campoModificato('', undefined)).toBe(false);
    expect(campoModificato('   ', undefined)).toBe(false);
    expect(campoModificato('', null)).toBe(false);
    expect(campoModificato('  ', '')).toBe(false);
    expect(campoModificato('qualcosa', undefined)).toBe(true);
  });

  it('è simmetrico: la normalizzazione vale per tutti e due i lati', () => {
    // La proprietà che il difetto violava, detta come proprietà e non come
    // esempio: se un lato può arrivare sporco, può arrivare sporco anche
    // l'altro — un valore salvato da una versione precedente, per dire.
    expect(campoModificato(TOKEN, `${TOKEN} `)).toBe(false);
    expect(campoModificato(` ${TOKEN} `, `\t${TOKEN}\n`)).toBe(false);
    expect(ripulisci(` ${TOKEN} `)).toBe(ripulisci(TOKEN));
  });
});

/**
 * Il sorgente della pagina, letto come testo.
 *
 * Il percorso è relativo a QUESTO file e non alla cartella da cui si lancia
 * vitest: `import.meta.url` è l'unica cosa che resta vera comunque lo si lanci.
 */
const SYNC_PAGE = readFileSync(
  fileURLToPath(new URL('../src/ui/pages/SyncPage.tsx', import.meta.url)),
  'utf8',
);

/** Il corpo di una dichiarazione `const nome = …;`, punto e virgola escluso. */
function dichiarazione(sorgente: string, nome: string): string {
  const m = new RegExp(`\\bconst ${nome} =([\\s\\S]*?);\\n`).exec(sorgente);
  if (!m) throw new Error(`in SyncPage.tsx non c'è più una const «${nome}»`);
  return m[1];
}

describe('SyncPage confronta il digitato col salvato passando dalla regola', () => {
  it('le credenziali: il token non si confronta più grezzo', () => {
    const corpo = dichiarazione(SYNC_PAGE, 'dirty');
    expect(corpo).toContain('campoModificato');
    // Nessun confronto scritto a mano: è la forma che aveva il difetto.
    expect(corpo).not.toMatch(/!==/);
  });

  it('il nome sul libretto: stessa regola, stessa funzione', () => {
    const corpo = dichiarazione(SYNC_PAGE, 'nomeSporco');
    expect(corpo).toContain('campoModificato');
    expect(corpo).not.toMatch(/!==/);
  });
});
