/**
 * L'accesso con Google: PKCE, il ritorno dal browser, lo scambio del codice.
 *
 * Il punto di ritorno è **una porta aperta**: su iPhone è uno schema URL che
 * qualunque altra applicazione può rivendicare, sul Mac è una porta locale a cui
 * qualunque programma può bussare. Metà di questi test sono lì per quello.
 *
 * Lo SCAMBIO del codice non si prova qui perché non avviene più qui: sta sul
 * Worker, in `server/googleScambio.ts`, ed è provato in `tests/serverGoogle.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import { casuale, creaPkce } from '../src/sync/pkce';
import { AMBITI, iniziaAccesso, leggiRitorno } from '../src/sync/googleAccesso';

const CLIENT = '883995552043-2khev71oqkm7go3nilogqc82tunbito7.apps.googleusercontent.com';
const RITORNO = 'http://127.0.0.1:51000/accesso';

describe('PKCE', () => {
  it('la sfida è l’impronta del verificatore, non il verificatore', async () => {
    // Se fossero uguali — il metodo `plain` dello standard — chi intercetta la
    // prima richiesta avrebbe già tutto, e PKCE sarebbe decorazione.
    const p = await creaPkce();
    expect(p.sfida).not.toBe(p.verificatore);
    expect(p.metodo).toBe('S256');
  });

  it('la stessa entrata dà sempre la stessa impronta', async () => {
    const a = await creaPkce('verificatore-fisso-per-il-test-abcdefghijklmnop');
    const b = await creaPkce('verificatore-fisso-per-il-test-abcdefghijklmnop');
    expect(a.sfida).toBe(b.sfida);
  });

  it('il verificatore sta nelle regole dello standard', async () => {
    const p = await creaPkce();
    expect(p.verificatore.length).toBeGreaterThanOrEqual(43);
    expect(p.verificatore.length).toBeLessThanOrEqual(128);
    expect(p.verificatore).toMatch(/^[A-Za-z0-9\-._~]+$/);
  });

  it('due valori casuali non si somigliano', () => {
    // Il controllo grossolano che si accorgerebbe di un generatore rotto o
    // sostituito con qualcosa di prevedibile.
    const molti = new Set(Array.from({ length: 200 }, () => casuale(32)));
    expect(molti.size).toBe(200);
  });
});

describe('la richiesta di autorizzazione', () => {
  it('porta tutto quello che serve e niente di più', async () => {
    const avvio = await iniziaAccesso(CLIENT, RITORNO);
    const url = new URL(avvio.indirizzo);
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('client_id')).toBe(CLIENT);
    expect(url.searchParams.get('redirect_uri')).toBe(RITORNO);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('scope')).toBe(AMBITI);
    // Gli ambiti chiesti sono due: ogni ambito in più è un permesso che la
    // persona legge e che dovremmo saper giustificare.
    expect(AMBITI.split(' ').length).toBe(2);
  });

  it('il verificatore NON viaggia nella richiesta', async () => {
    /*
     * È l'invariante che regge tutto PKCE: nella prima richiesta va solo
     * l'impronta. Se il verificatore finisse nell'indirizzo, chi lo intercetta
     * potrebbe scambiare il codice al posto nostro.
     */
    const avvio = await iniziaAccesso(CLIENT, RITORNO);
    expect(avvio.indirizzo).not.toContain(avvio.verificatore);
  });

  it('ogni accesso ha uno state diverso', async () => {
    const a = await iniziaAccesso(CLIENT, RITORNO);
    const b = await iniziaAccesso(CLIENT, RITORNO);
    expect(a.state).not.toBe(b.state);
    expect(a.verificatore).not.toBe(b.verificatore);
  });
});

describe('il ritorno dal browser', () => {
  it('con lo state giusto restituisce il codice', () => {
    const esito = leggiRitorno(`${RITORNO}?code=abc123&state=stato-1`, 'stato-1');
    expect(esito).toEqual({ codice: 'abc123' });
  });

  it('CON LO STATE SBAGLIATO non guarda nemmeno il codice', () => {
    /*
     * L'attacco che questo controllo ferma: un altro programma bussa alla nostra
     * porta di ritorno con un codice ottenuto altrove — magari il proprio — e
     * senza il confronto sullo `state` l'app collegherebbe l'archivio di chi sta
     * usando il computer all'account di chi ha bussato.
     */
    const esito = leggiRitorno(`${RITORNO}?code=codice-di-un-altro&state=stato-falso`, 'stato-1');
    expect(esito).toEqual({ errore: expect.stringContaining('non corrisponde') });
  });

  it('senza state è rifiutato come se fosse sbagliato', () => {
    expect(leggiRitorno(`${RITORNO}?code=abc`, 'stato-1')).toHaveProperty('errore');
  });

  it('«ho annullato» non è un guasto e non si presenta come tale', () => {
    const esito = leggiRitorno(`${RITORNO}?error=access_denied&state=stato-1`, 'stato-1');
    expect(esito).toEqual({ errore: 'Accesso annullato.' });
  });

  it('un errore vero di Google si riporta com’è', () => {
    const esito = leggiRitorno(`${RITORNO}?error=invalid_scope&state=stato-1`, 'stato-1');
    expect((esito as { errore: string }).errore).toContain('invalid_scope');
  });

  it('un indirizzo malformato non fa esplodere niente', () => {
    expect(leggiRitorno('non-un-indirizzo', 'stato-1')).toHaveProperty('errore');
  });
});
