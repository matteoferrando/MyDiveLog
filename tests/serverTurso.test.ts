/**
 * La Platform API vista dal nostro lato, con una rete finta ma le regole vere.
 *
 * Quello che conta qui non è che le chiamate partano: è che i casi storti —
 * database che esiste già, database che non c'è più — finiscano dove devono. Il
 * primo capita a ogni accesso dopo il primo, cioè quasi sempre; il secondo
 * capita quando si cancella un account due volte.
 */

import { describe, expect, it } from 'vitest';
import {
  assicuraDatabase,
  cancellaDatabase,
  nomeDatabase,
  tokenDatabase,
  type ConfigurazioneTurso,
} from '../server/turso';

interface Chiamata {
  metodo: string;
  url: string;
  autorizzazione: string | null;
  corpo: unknown;
}

/** Una rete finta che registra cosa è stato chiesto e risponde come si vuole. */
function rete(risposte: Array<{ stato: number; dati: unknown }>) {
  const chiamate: Chiamata[] = [];
  let i = 0;
  const fetchImpl = (async (url: string, opzioni: RequestInit = {}) => {
    const intestazioni = (opzioni.headers ?? {}) as Record<string, string>;
    chiamate.push({
      metodo: opzioni.method ?? 'GET',
      url: String(url),
      autorizzazione: intestazioni.Authorization ?? null,
      corpo: opzioni.body ? JSON.parse(String(opzioni.body)) : undefined,
    });
    const r = risposte[Math.min(i++, risposte.length - 1)];
    return {
      ok: r.stato >= 200 && r.stato < 300,
      status: r.stato,
      json: async () => r.dati,
    } as Response;
  }) as unknown as typeof fetch;
  return { chiamate, fetchImpl };
}

const cfg = (fetchImpl: typeof fetch): ConfigurazioneTurso => ({
  organizzazione: 'org-di-prova',
  gruppo: 'default',
  apiToken: 'token-organizzazione-segretissimo',
  fetchImpl,
});

describe('nome del database', () => {
  it('sta nelle regole di Turso e non racconta chi c’è dentro', () => {
    const nome = nomeDatabase('AbC-123_xyz');
    expect(nome).toMatch(/^[a-z0-9-]+$/);
    expect(nome.length).toBeLessThanOrEqual(64);
  });

  it('un identificativo lungo viene tagliato, non rifiutato', () => {
    expect(nomeDatabase('x'.repeat(200)).length).toBe(64);
  });
});

describe('assicurare il database', () => {
  it('lo crea e restituisce l’indirizzo libsql', async () => {
    const { chiamate, fetchImpl } = rete([
      { stato: 200, dati: { database: { Hostname: 'mdl-abc-org.turso.io', Name: 'mdl-abc' } } },
    ]);
    const db = await assicuraDatabase(cfg(fetchImpl), 'abc');
    expect(db.url).toBe('libsql://mdl-abc-org.turso.io');
    expect(chiamate[0].metodo).toBe('POST');
    expect(chiamate[0].corpo).toEqual({ name: 'mdl-abc', group: 'default' });
    expect(chiamate[0].autorizzazione).toBe('Bearer token-organizzazione-segretissimo');
  });

  it('SE ESISTE GIÀ non è un errore: è il risultato voluto', async () => {
    /*
     * Il caso normale di ogni accesso dopo il primo. Trattare il conflitto come
     * guasto vorrebbe dire dire «non è stato possibile accedere» a chi ha tutto
     * a posto — e succederebbe a tutti, tutti i giorni, tranne il primo.
     */
    const { chiamate, fetchImpl } = rete([
      { stato: 409, dati: { error: 'database already exists' } },
      { stato: 200, dati: { database: { Hostname: 'mdl-abc-org.turso.io' } } },
    ]);
    const db = await assicuraDatabase(cfg(fetchImpl), 'abc');
    expect(db.url).toBe('libsql://mdl-abc-org.turso.io');
    expect(chiamate.map((c) => c.metodo)).toEqual(['POST', 'GET']);
  });

  it('se non si riesce a sapere l’indirizzo, lancia senza svelare la risposta', async () => {
    const { fetchImpl } = rete([{ stato: 500, dati: { error: 'org token abc123 non valido' } }]);
    await expect(assicuraDatabase(cfg(fetchImpl), 'abc')).rejects.toThrow(/HTTP 500/);
    // Il messaggio non deve portarsi dietro il corpo della risposta: là dentro
    // possono esserci nomi dell'organizzazione e frammenti di token.
    await expect(assicuraDatabase(cfg(fetchImpl), 'abc')).rejects.not.toThrow(/abc123/);
  });
});

describe('token del database', () => {
  it('chiede un token che scade e vale per quel database soltanto', async () => {
    const { chiamate, fetchImpl } = rete([{ stato: 200, dati: { jwt: 'token-breve' } }]);
    const token = await tokenDatabase(cfg(fetchImpl), 'mdl-abc');
    expect(token).toBe('token-breve');
    // La scadenza è la differenza fra questo servizio e un token eterno
    // incollato a mano: se sparisse dalla richiesta, non se ne accorgerebbe
    // nessuno finché non sfugge un token.
    expect(chiamate[0].url).toContain('/databases/mdl-abc/auth/tokens');
    expect(chiamate[0].url).toContain('expiration=2h');
    expect(chiamate[0].url).toContain('authorization=full-access');
  });

  it('una risposta senza jwt è un errore, non un token vuoto', async () => {
    const { fetchImpl } = rete([{ stato: 200, dati: {} }]);
    await expect(tokenDatabase(cfg(fetchImpl), 'mdl-abc')).rejects.toThrow(/token non emesso/);
  });
});

describe('cancellazione dell’account', () => {
  it('cancella il database', async () => {
    const { chiamate, fetchImpl } = rete([{ stato: 200, dati: { database: 'mdl-abc' } }]);
    await cancellaDatabase(cfg(fetchImpl), 'mdl-abc');
    expect(chiamate[0].metodo).toBe('DELETE');
  });

  it('un database che non c’è più conta come cancellato', async () => {
    // La richiesta era «fai che non ci sia». Se non c'è, è fatta. Trattare il
    // 404 come guasto lascerebbe un account che non si riesce a chiudere.
    const { fetchImpl } = rete([{ stato: 404, dati: { error: 'record not found' } }]);
    await expect(cancellaDatabase(cfg(fetchImpl), 'mdl-abc')).resolves.toBeUndefined();
  });

  it('un guasto vero invece si vede', async () => {
    const { fetchImpl } = rete([{ stato: 500, dati: {} }]);
    await expect(cancellaDatabase(cfg(fetchImpl), 'mdl-abc')).rejects.toThrow(/HTTP 500/);
  });
});

describe('le due forme della durata non devono divergere', () => {
  it('«2h» e 7200 secondi dicono la stessa cosa', async () => {
    const { DURATA_TOKEN_DB, DURATA_TOKEN_DB_S } = await import('../server/turso');
    /*
     * Se qualcuno allungasse la durata scritta per Turso senza toccare i
     * secondi, l'app crederebbe di avere meno tempo e rinnoverebbe troppo
     * spesso — fastidioso ma innocuo. Al contrario — secondi più lunghi della
     * durata vera — l'app si ritroverebbe un token scaduto a metà
     * sincronizzazione, e il sintomo sarebbe un errore che compare solo dopo due
     * ore di applicazione aperta.
     */
    const unita: Record<string, number> = { h: 3600, m: 60, d: 86400 };
    const m = /^(\d+)([hmd])$/.exec(DURATA_TOKEN_DB);
    expect(m, 'formato della durata non riconosciuto').not.toBeNull();
    expect(Number(m![1]) * unita[m![2]]).toBe(DURATA_TOKEN_DB_S);
  });
});
