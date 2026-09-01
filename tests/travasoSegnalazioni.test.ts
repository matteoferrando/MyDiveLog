/**
 * ► IL TRAVASO: L'INDIRIZZO CHE SEMBRA GIUSTO E LA RISPOSTA CHE NON SI LEGGE ◄
 *
 * Queste prove nascono da un travaso vero andato storto. Il comando è partito,
 * ha letto l'archivio, ha detto «da travasare: 1», ha chiamato Google e ha
 * risposto così:
 *
 *   ✗ 2026-08-26T09:37:37.044Z — …  →  401 «<!DOCTYPE html>… <title>Pagina non
 *   trovata</title>… (e altre novecento righe di HTML)
 *
 * Due guasti, e nessuno dei due era il travaso:
 *
 *  1. l'indirizzo finiva per `/dev` invece che per `/exec`. È l'indirizzo che
 *     l'editor di Apps Script tiene sotto mano, e risponde solo al proprietario
 *     dentro un browser collegato. Da uno script non risponde mai;
 *  2. la riga di errore riversava nel terminale la pagina HTML intera, che
 *     scorrendo cancellava tutto il resto. La cosa che spiegava il guasto —
 *     quattro parole dentro un `<title>` — era l'unica invisibile.
 *
 * Il secondo guasto è quello che è costato di più, ed è il tema che in questo
 * progetto è già tornato tre volte: **quello che nessuno riesce a leggere è
 * spento.** Un avviso in mezzo a quattordici non c'è, un messaggio sotto
 * duecento righe di `act(...)` non c'è, e una diagnosi dentro una pagina HTML
 * non c'è.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// @ts-expect-error — è uno script .mjs senza tipi, e va bene così: qui si prova
// il comportamento, non la firma.
import { accorcia, perchePeggioDiExec } from '../scripts/travasa-segnalazioni.mjs';

const SORGENTE = readFileSync(join(process.cwd(), 'scripts/travasa-segnalazioni.mjs'), 'utf8');

describe('► l’indirizzo si controlla prima di chiamare, non dopo ◄', () => {
  it('rifiuta l’indirizzo /dev, che è quello sbagliato davvero capitato', () => {
    const male = perchePeggioDiExec('https://script.google.com/macros/s/AKfycb0000/dev');
    expect(male).toBeTruthy();
    // Non basta che rifiuti: deve DIRE «/dev» ed «/exec», perché il messaggio è
    // tutto il valore del controllo. Un «indirizzo non valido» rimanderebbe a
    // cercare nel posto sbagliato esattamente come faceva il 401.
    expect(male).toContain('/dev');
    expect(male).toContain('/exec');
  });

  it('accetta l’indirizzo /exec, con e senza barra finale', () => {
    expect(perchePeggioDiExec('https://script.google.com/macros/s/AKfycb0000/exec')).toBeNull();
    expect(perchePeggioDiExec('https://script.google.com/macros/s/AKfycb0000/exec/')).toBeNull();
  });

  it('rifiuta un indirizzo che non finisce né per l’uno né per l’altro', () => {
    expect(perchePeggioDiExec('https://script.google.com/macros/s/AKfycb0000')).toBeTruthy();
  });

  it('rifiuta http in chiaro: di lì passano le segnalazioni della gente', () => {
    expect(perchePeggioDiExec('http://script.google.com/macros/s/AKfycb0000/exec')).toBeTruthy();
  });

  it('il controllo è davvero nel percorso della scrittura, non solo esportato', () => {
    // Una funzione giusta che nessuno chiama è una funzione che non esiste. Qui
    // si guarda che `main()` la usi, e che la usi PRIMA del ciclo che chiama
    // `fetch` — dopo servirebbe a niente.
    const doveControlla = SORGENTE.indexOf('perchePeggioDiExec(INDIRIZZO)');
    const doveChiama = SORGENTE.indexOf('await fetch(INDIRIZZO');
    expect(doveControlla).toBeGreaterThan(0);
    expect(doveChiama).toBeGreaterThan(0);
    expect(doveControlla).toBeLessThan(doveChiama);
  });
});

describe('► la risposta si riassume: una riga, non una pagina ◄', () => {
  it('di una pagina HTML tiene il titolo e butta il resto', () => {
    const pagina = `<!DOCTYPE html><html><head><style>${'a{}'.repeat(400)}</style>
      <title>Pagina non trovata</title></head><body>${'<div></div>'.repeat(400)}</body></html>`;
    const riassunto = accorcia(pagina);
    expect(riassunto).toContain('Pagina non trovata');
    // La misura che conta non è «contiene il titolo»: è **quanto è corta**. Una
    // riga che contiene il titolo e poi novecento righe di HTML avrebbe passato
    // la prima verifica e sarebbe stata illeggibile lo stesso.
    expect(riassunto.length).toBeLessThan(120);
    expect(riassunto).not.toContain('<div>');
    expect(riassunto).not.toContain('<style>');
  });

  it('una pagina HTML senza titolo lo dice, invece di stampare la pagina', () => {
    const riassunto = accorcia(`<!DOCTYPE html><html><body>${'x'.repeat(5000)}</body></html>`);
    expect(riassunto.length).toBeLessThan(120);
    expect(riassunto).toContain('HTML');
  });

  it('una risposta corta passa intera: accorciare qui toglierebbe informazione', () => {
    expect(accorcia('gettone sbagliato')).toBe('gettone sbagliato');
    expect(accorcia('ok')).toBe('ok');
  });

  it('un testo lungo ma non HTML si taglia e dice quanto era', () => {
    const riassunto = accorcia('z'.repeat(900));
    expect(riassunto.length).toBeLessThan(260);
    expect(riassunto).toContain('900');
  });

  it('la riga di errore usa il riassunto e non il corpo grezzo', () => {
    // La prova che è servita davvero: prima, qui c'era `«${detto}»`.
    const riga = SORGENTE.split('\n').find((l) => l.includes('✗ ${riassunto}'));
    expect(riga).toBeDefined();
    expect(riga).toContain('accorcia(detto)');
    expect(riga).not.toMatch(/«\$\{detto\}»/);
  });
});

describe('► importare lo script non deve parlare con Cloudflare ◄', () => {
  it('main() parte solo se il file è stato lanciato', () => {
    // Se questa prova esiste ed è verde, l'import in cima a questo file non ha
    // lanciato `wrangler`. Ma vale la pena guardare anche il codice: il giorno
    // che qualcuno rimette `await main()` in fondo, questo file diventa un
    // travaso vero lanciato da `npm test`.
    expect(SORGENTE).toMatch(/if \(process\.argv\[1\][\s\S]{0,200}await main\(\);/);
    expect(SORGENTE).not.toMatch(/^await main\(\);/m);
  });
});
