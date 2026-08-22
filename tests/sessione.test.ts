/**
 * Il token di sessione, provato dove si rompe.
 *
 * Un modulo di autenticazione non si verifica mostrando che il caso buono
 * funziona: quello funziona sempre. Si verifica sui rifiuti, perché ogni rifiuto
 * mancato è un modo di entrare senza credenziali.
 */

import { describe, expect, it } from 'vitest';
import { DURATA_SESSIONE_S, firmaSessione, idUtente, verificaSessione } from '../server/sessione';

const SEGRETO = 'segreto-di-prova-lungo-abbastanza-da-essere-realistico';
const ADESSO = 1_800_000_000;

describe('firma e verifica della sessione', () => {
  it('un token appena firmato si verifica e porta l’utente', async () => {
    const token = await firmaSessione('utente-1', SEGRETO, ADESSO);
    const sessione = await verificaSessione(token, SEGRETO, ADESSO + 10);
    expect(sessione?.utente).toBe('utente-1');
    expect(sessione?.exp).toBe(ADESSO + DURATA_SESSIONE_S);
  });

  it('un token scaduto viene rifiutato', async () => {
    const token = await firmaSessione('utente-1', SEGRETO, ADESSO, 60);
    // Un secondo dopo la scadenza: il confronto è stretto, non «circa».
    expect(await verificaSessione(token, SEGRETO, ADESSO + 61)).toBeNull();
    // E un secondo prima vale ancora, altrimenti la scadenza sarebbe più corta
    // di quella dichiarata.
    expect(await verificaSessione(token, SEGRETO, ADESSO + 59)).not.toBeNull();
  });

  it('un token firmato con un altro segreto viene rifiutato', async () => {
    const token = await firmaSessione('utente-1', 'un-altro-segreto', ADESSO);
    expect(await verificaSessione(token, SEGRETO, ADESSO)).toBeNull();
  });

  it('cambiare il corpo invalida la firma', async () => {
    /*
     * È l'attacco ovvio: prendo il MIO token e ci scrivo dentro l'utente di un
     * altro. Se passasse, chiunque abbia un account leggerebbe l'archivio di
     * chiunque altro — che è il difetto peggiore che questo servizio possa
     * avere.
     */
    const token = await firmaSessione('utente-1', SEGRETO, ADESSO);
    const [intestazione, , firma] = token.split('.');
    const corpoFalso = btoa(JSON.stringify({ sub: 'utente-2', exp: ADESSO + 9999 }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(await verificaSessione(`${intestazione}.${corpoFalso}.${firma}`, SEGRETO, ADESSO)).toBeNull();
  });

  it('«alg: none» non basta a farsi credere', async () => {
    /*
     * La vulnerabilità classica dei JWT: si dichiara `alg: none`, si toglie la
     * firma, e un verificatore ingenuo si fida dell'intestazione. Qui l'algoritmo
     * non viene MAI letto dal token — è sempre HMAC-SHA256 — quindi il colpo non
     * ha nessun effetto. Il test esiste perché il giorno in cui qualcuno
     * «generalizzasse» il codice leggendo `alg`, deve diventare rosso.
     */
    const b64 = (o: unknown) =>
      btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const falso = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: 'chiunque', exp: ADESSO + 9999 })}.`;
    expect(await verificaSessione(falso, SEGRETO, ADESSO)).toBeNull();
  });

  it('i token malformati non fanno esplodere niente', async () => {
    for (const rifiuto of ['', '.', 'a.b', 'a.b.c.d', 'non-un-token', '..', 'a..c']) {
      expect(await verificaSessione(rifiuto, SEGRETO, ADESSO)).toBeNull();
    }
  });

  it('un token senza utente viene rifiutato anche se la firma è valida', async () => {
    // Firmato da noi, ma con un corpo che non nomina nessuno: non deve valere
    // come «utente vuoto», che finirebbe in un nome di database.
    const token = await firmaSessione('', SEGRETO, ADESSO);
    expect(await verificaSessione(token, SEGRETO, ADESSO)).toBeNull();
  });
});

describe('identificativo interno dell’utente', () => {
  it('è stabile per lo stesso fornitore e lo stesso sub', async () => {
    expect(await idUtente('apple', '000123.abc')).toBe(await idUtente('apple', '000123.abc'));
  });

  it('lo stesso sub su fornitori diversi dà utenti diversi', async () => {
    /*
     * Non è un dettaglio: se due fornitori assegnassero lo stesso `sub` a due
     * persone diverse — cosa che nessuno garantisce non accada — senza il
     * prefisso si troverebbero nello stesso database.
     */
    expect(await idUtente('apple', 'x')).not.toBe(await idUtente('google', 'x'));
  });

  it('non contiene il sub in chiaro', async () => {
    // L'identificativo finisce nel nome del database: non deve raccontare chi
    // c'è dentro.
    const id = await idUtente('google', '109876543210987654321');
    expect(id).not.toContain('109876543210987654321');
    expect(id).toMatch(/^[A-Za-z0-9_-]{24}$/);
  });
});
