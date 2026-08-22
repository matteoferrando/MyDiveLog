/**
 * Lo scambio del codice, lato servizio.
 *
 * PERCHÉ QUESTO FILE ESISTE. La prima versione scambiava il codice dentro
 * l'applicazione e su iPhone funzionava; sul Mac Google rispondeva
 * `client_secret is missing`, perché i client di tipo «Desktop app» il segreto
 * lo pretendono anche con PKCE. Un difetto che si presenta su una piattaforma
 * sola è il più caro da trovare, e questi test guardano proprio la differenza
 * fra le due: il segreto c'è quando serve, non c'è quando non serve.
 */

import { describe, expect, it } from 'vitest';
import { scambiaCodiceGoogle } from '../server/googleScambio';

const IOS = '883995552043-2khev71oqkm7go3nilogqc82tunbito7.apps.googleusercontent.com';
const DESKTOP = '883995552043-fcsjcnlb5o6ih7af686bk0j7pls9k5bi.apps.googleusercontent.com';

function rete(stato: number, dati: unknown) {
  const chiamate: Array<Record<string, string>> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    expect(String(url)).toBe('https://oauth2.googleapis.com/token');
    chiamate.push(Object.fromEntries(new URLSearchParams(String(init.body))));
    return { ok: stato >= 200 && stato < 300, status: stato, json: async () => dati } as Response;
  }) as unknown as typeof fetch;
  return { chiamate, fetchImpl };
}

const base = { codice: 'cod-1', verificatore: 'verif-1', ritorno: 'http://127.0.0.1:51000/accesso' };

describe('lo scambio del codice con Google', () => {
  it('col client desktop manda il segreto', async () => {
    const { chiamate, fetchImpl } = rete(200, { id_token: 'identita' });
    const token = await scambiaCodiceGoogle(
      { ...base, clientId: DESKTOP, clientSecret: 'segreto-del-desktop' },
      fetchImpl,
    );

    expect(token).toBe('identita');
    expect(chiamate[0].client_secret).toBe('segreto-del-desktop');
    expect(chiamate[0].code_verifier).toBe('verif-1');
    expect(chiamate[0].grant_type).toBe('authorization_code');
  });

  it('col client iOS NON manda nessun campo `client_secret`', async () => {
    /*
     * E non ne manda nemmeno uno vuoto: `client_secret=` presente e vuoto è
     * diverso da assente, e Google rifiuta il primo. È il tipo di sfumatura che
     * si scopre solo in produzione, se non c'è una riga come questa.
     */
    const { chiamate, fetchImpl } = rete(200, { id_token: 'identita' });
    await scambiaCodiceGoogle({ ...base, clientId: IOS }, fetchImpl);
    expect('client_secret' in chiamate[0]).toBe(false);
  });

  it('il verificatore PKCE viaggia sempre, con o senza segreto', async () => {
    // È quello che lega il codice all'applicazione che ha iniziato il giro:
    // senza, il segreto da solo non basterebbe a fidarsi.
    const { chiamate, fetchImpl } = rete(200, { id_token: 'x' });
    await scambiaCodiceGoogle({ ...base, clientId: IOS }, fetchImpl);
    await scambiaCodiceGoogle({ ...base, clientId: DESKTOP, clientSecret: 's' }, fetchImpl);
    expect(chiamate.every((c) => c.code_verifier === 'verif-1')).toBe(true);
  });

  it('il punto di ritorno è quello della prima richiesta', async () => {
    const { chiamate, fetchImpl } = rete(200, { id_token: 'x' });
    await scambiaCodiceGoogle({ ...base, clientId: IOS }, fetchImpl);
    expect(chiamate[0].redirect_uri).toBe('http://127.0.0.1:51000/accesso');
  });

  it('un rifiuto di Google diventa `null`, non un messaggio da rigirare', async () => {
    /*
     * «codice già usato», «verificatore sbagliato», «client che non combacia»
     * sono informazioni utili a chi sta provando a indovinare e inutili a chi ha
     * semplicemente aspettato troppo: fuori esce un solo esito.
     */
    const { fetchImpl } = rete(400, { error: 'invalid_grant' });
    expect(await scambiaCodiceGoogle({ ...base, clientId: IOS }, fetchImpl)).toBeNull();
  });

  it('una risposta senza token d’identità è `null`, non una stringa vuota', async () => {
    // Il token d'accesso, che Google manda insieme, non ci serve e non si tiene:
    // non chiamiamo nessuna API per conto della persona.
    const { fetchImpl } = rete(200, { access_token: 'solo-questo' });
    expect(await scambiaCodiceGoogle({ ...base, clientId: IOS }, fetchImpl)).toBeNull();
  });
});
