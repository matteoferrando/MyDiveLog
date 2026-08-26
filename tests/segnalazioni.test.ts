/**
 * La rotta che raccoglie le segnalazioni dal sito, e la copia nel foglio.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ► QUESTA ROTTA NON AVEVA NESSUNA PROVA, ED È COME È FINITA. ◄
 *
 * `serverWorker.test.ts` guarda il perimetro di `/accesso`, perché quella è la
 * porta che parla con Google e crea database. `/segnalazione` non la guardava
 * nessuno: scrive in un archivio e risponde `ok`, cosa vuoi che vada storto.
 *
 * È andato storto che la copia verso il foglio di Google non esisteva, che la
 * configurazione rimandava a una rotta mai scritta per leggerle, e che per
 * settimane le segnalazioni sono entrate senza che uscisse niente. Nessun
 * controllo poteva accorgersene perché non c'era niente di malformato: c'era
 * qualcosa di **assente**.
 *
 * ► LA PROVA CHE CONTA PIÙ DELLE ALTRE ◄ è quella sul foglio che risponde 200
 * senza dire `ok`. Un Apps Script risponde SEMPRE 200: il rifiuto è testo nel
 * corpo, non uno stato. Fidarsi dello stato marcherebbe ogni segnalazione come
 * copiata lasciando il foglio vuoto — cioè fallirebbe **somigliando in tutto al
 * successo**, che è esattamente il difetto da cui nasce questo file.
 */
import { afterEach, describe, expect, it } from 'vitest';

import worker, { type Ambiente, type ArchivioChiaveValore } from '../server/worker';
import type { EsitoLimite, SpazioLimiti } from '../server/limite';

/** Un archivio finto che tiene tutto in memoria e si lascia guardare dentro. */
function archivio(): ArchivioChiaveValore & { tutto: () => Record<string, string> } {
  const dentro: Record<string, string> = {};
  return {
    put: async (k, v) => void (dentro[k] = v),
    get: async (k) => dentro[k] ?? null,
    list: async () => ({ keys: Object.keys(dentro).map((name) => ({ name })) }),
    tutto: () => ({ ...dentro }),
  };
}

const limitiAperti: SpazioLimiti = {
  idFromName: (n) => n,
  get: () => ({
    fetch: async () => {
      const esito: EsitoLimite = { consentito: true, riprovaFraS: 0 };
      return new Response(JSON.stringify(esito));
    },
  }),
};

const fetchVero = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = fetchVero;
});

/** Sostituisce la rete e annota cosa è stato mandato al foglio. */
function foglioFinto(risposta: () => Response | Promise<Response>) {
  const chiamate: { indirizzo: string; corpo: Record<string, unknown> }[] = [];
  globalThis.fetch = (async (indirizzo: unknown, opzioni: { body?: string } = {}) => {
    chiamate.push({ indirizzo: String(indirizzo), corpo: JSON.parse(opzioni.body ?? '{}') });
    return risposta();
  }) as unknown as typeof fetch;
  return chiamate;
}

function ambiente(extra: Partial<Ambiente> = {}) {
  const kv = archivio();
  const env = {
    SEGNALAZIONI: kv,
    LIMITI: limitiAperti,
    SESSION_KEY: 'chiave-di-prova-lunga-abbastanza',
    TURSO_API_TOKEN: 't',
    TURSO_ORG: 'o',
    TURSO_GROUP: 'g',
    APPLE_CLIENT_ID: 'a',
    APPLE_SERVICES_ID: 'a',
    APPLE_TEAM_ID: 'a',
    APPLE_KEY_ID: 'a',
    APPLE_RITORNO: 'https://esempio.example/r',
    APPLE_CHIAVE_P8: 'non-una-chiave',
    GOOGLE_CLIENT_ID: 'g',
    GOOGLE_CLIENT_DESKTOP: 'g',
    GOOGLE_SEGRETO_DESKTOP: 'g',
    ...extra,
  } as unknown as Ambiente;
  return { env, kv };
}

const invio = (corpo: unknown) =>
  new Request('https://servizio.example/segnalazione', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.9' },
    body: JSON.stringify(corpo),
  });

const UNA = { testo: 'il grafico non si disegna', tipo: 'difetto', dove: 'Mac 1.7.0' };

/** Le segnalazioni salvate, lette dall'archivio finto. */
const salvate = (kv: ReturnType<typeof archivio>): Record<string, unknown>[] =>
  Object.entries(kv.tutto())
    .filter(([k]) => k.startsWith('s:'))
    .map(([chiave, v]) => ({ chiave, ...(JSON.parse(v) as Record<string, unknown>) }));

describe('la segnalazione si salva', () => {
  it('finisce nell’archivio e la risposta è ok', async () => {
    const { env, kv } = ambiente();
    const r = await worker.fetch(invio(UNA), env);
    expect(r.status).toBe(200);
    const righe = salvate(kv);
    expect(righe).toHaveLength(1);
    expect(righe[0].testo).toBe(UNA.testo);
  });

  it('una senza testo non scrive niente', async () => {
    const { env, kv } = ambiente();
    const r = await worker.fetch(invio({ testo: '   ' }), env);
    expect(r.status).toBe(400);
    expect(salvate(kv)).toHaveLength(0);
  });

  it('senza archivio configurato lo dice, invece di far finta', async () => {
    const { env } = ambiente({ SEGNALAZIONI: undefined });
    expect((await worker.fetch(invio(UNA), env)).status).toBe(503);
  });
});

describe('la copia nel foglio', () => {
  const CONFIG = {
    FOGLIO_SEGNALAZIONI: 'https://script.google.example/exec',
    FOGLIO_GETTONE: 'parola-d-ordine',
  };

  it('manda la segnalazione col gettone e la marca come copiata', async () => {
    const { env, kv } = ambiente(CONFIG);
    const chiamate = foglioFinto(() => new Response('ok'));
    await worker.fetch(invio(UNA), env);

    expect(chiamate).toHaveLength(1);
    expect(chiamate[0].indirizzo).toBe(CONFIG.FOGLIO_SEGNALAZIONI);
    expect(chiamate[0].corpo.gettone).toBe(CONFIG.FOGLIO_GETTONE);
    expect(chiamate[0].corpo.testo).toBe(UNA.testo);
    expect(salvate(kv)[0].foglio).toBe(true);
  });

  it('► un 200 che NON dice «ok» non è una copia riuscita ◄', async () => {
    /*
      Il caso vero: gettone sbagliato. Apps Script risponde 200 con «rifiutata»
      nel corpo. Se ci si fidasse dello stato, ogni segnalazione risulterebbe
      copiata e il foglio resterebbe vuoto — e nessuno lo saprebbe mai, perché
      non ci sarebbe niente in coda da riprovare.
    */
    const { env, kv } = ambiente(CONFIG);
    foglioFinto(() => new Response('rifiutata'));
    const r = await worker.fetch(invio(UNA), env);

    expect(r.status).toBe(200); // la segnalazione è salvata: questo resta vero
    expect(salvate(kv)[0].foglio).toBe(false);
  });

  it('se il foglio è irraggiungibile la segnalazione resta salvata e in coda', async () => {
    const { env, kv } = ambiente(CONFIG);
    foglioFinto(() => Promise.reject(new Error('rete giù')));
    const r = await worker.fetch(invio(UNA), env);

    expect(r.status).toBe(200);
    const riga = salvate(kv)[0];
    expect(riga.testo).toBe(UNA.testo);
    expect(riga.foglio).toBe(false);
  });

  it('senza il foglio configurato non chiama nessuno, e non finge di averlo copiato', async () => {
    const { env, kv } = ambiente();
    const chiamate = foglioFinto(() => new Response('ok'));
    await worker.fetch(invio(UNA), env);

    expect(chiamate).toHaveLength(0);
    expect(salvate(kv)[0].foglio).toBe(false);
  });

  it('la data che va nel foglio è quella della segnalazione, non quella della copia', async () => {
    // Una segnalazione ripresa dalla coda mesi dopo deve arrivare nel foglio con
    // la data in cui qualcuno ha premuto «invia». Una data falsa ma credibile è
    // peggio di una data mancante.
    const { env, kv } = ambiente(CONFIG);
    const chiamate = foglioFinto(() => new Response('ok'));
    await worker.fetch(invio(UNA), env);
    expect(chiamate[0].corpo.quando).toBe(salvate(kv)[0].quando);
  });
});
