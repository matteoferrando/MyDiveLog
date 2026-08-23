/**
 * L'accesso con Apple dalla parte dell'app: la richiesta di autorizzazione e il
 * ritorno.
 *
 * SENZA PKCE, LO `STATE` È TUTTO QUELLO CHE RESTA. Con Google il codice è legato
 * a chi ha iniziato il giro da un verificatore che l'app tiene per sé; nel giro
 * web di Apple quel meccanismo non esiste. Quindi metà di questi test guardano
 * lo `state`, che qui non è una formalità: è l'unico legame fra il giro che
 * abbiamo iniziato noi e il codice che ci arriva da una porta — lo schema URL
 * su iPhone, l'ascoltatore locale sul Mac — a cui può bussare chiunque.
 *
 * Lo SCAMBIO del codice non si prova qui perché non avviene qui: sta sul Worker,
 * ed è provato in `tests/serverApple.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import { componiStato, iniziaAccessoApple, leggiRitornoApple } from '../src/sync/appleAccesso';
import {
  AMBITI_APPLE,
  indirizzoAutorizzazioneApple,
  leggiDestinazioneDalloStato,
} from '../server/appleScambio';

const RITORNO = 'https://mydivelog.site/accesso-apple/ritorno';
const DESTINAZIONE = 'http://127.0.0.1:51000/accesso';
const AVVIO = 'https://mydivelog.site/accesso-apple/vai';

describe('l’avvio dell’accesso con Apple, dalla parte dell’app', () => {
  it('apre un indirizzo NOSTRO, non quello di Apple', () => {
    /*
     * ► La prova che tiene in piedi l'accesso su iPhone. ◄
     *
     * Aprendo `appleid.apple.com` direttamente dall'app, su iOS il browser si
     * apre sulla propria pagina iniziale e l'accesso finisce lì: niente errore,
     * niente pagina bianca, niente in nessun registro. Lo stesso indirizzo
     * aperto a mano nello stesso browser va benissimo, e Google — stessa riga
     * di codice — pure: è il dominio di Apple che iOS si prende per sé.
     *
     * Se qualcuno un giorno «semplifica» rimettendo qui l'indirizzo di Apple,
     * il Mac continuerà a funzionare e l'iPhone smetterà, in silenzio.
     */
    const avvio = iniziaAccessoApple(AVVIO, DESTINAZIONE);
    const url = new URL(avvio.indirizzo);
    expect(url.origin + url.pathname).toBe(AVVIO);
    expect(url.hostname).not.toContain('apple.com');
  });

  it('lo state viaggia in coda, e torna leggibile', () => {
    const avvio = iniziaAccessoApple(AVVIO, DESTINAZIONE);
    const url = new URL(avvio.indirizzo);
    expect(url.searchParams.get('state')).toBe(avvio.state);
    expect(leggiDestinazioneDalloStato(avvio.state)).toBe(DESTINAZIONE);
  });

  it('dove aspetta l’app viaggia dentro lo state, non nell’indirizzo', () => {
    // Il punto di ritorno che Apple conosce è il Worker; la porta di questo
    // dispositivo la sa solo lo `state`, e il Worker la ricontrolla prima di
    // seguirla.
    const avvio = iniziaAccessoApple(AVVIO, DESTINAZIONE);
    expect(avvio.indirizzo).not.toContain('127.0.0.1');
    expect(avvio.state).toContain('.');
    // Sull'ULTIMO punto: il pezzo casuale può contenerne, la base64url no.
    expect(componiStato(avvio.state.slice(0, avvio.state.lastIndexOf('.')), DESTINAZIONE)).toBe(avvio.state);
  });

  it('il pezzo casuale può contenere PUNTI, e la destinazione si legge lo stesso', () => {
    /*
     * PRESO DALLA CI, NON DA QUI.
     *
     * `casuale()` pesca dall'alfabeto ammesso da PKCE, che il punto ce l'ha
     * dentro. Su 32 caratteri la probabilità che ne esca almeno uno è del 40%:
     * tagliando lo `state` sul PRIMO punto, due accessi su cinque leggevano una
     * destinazione troncata e venivano rifiutati — a caso, senza nessuna
     * regolarità che facesse sospettare la causa.
     */
    const conPunti = 'a.b..c...d';
    const stato = componiStato(conPunti, DESTINAZIONE);
    expect(leggiDestinazioneDalloStato(stato)).toBe(DESTINAZIONE);
    expect(stato.slice(0, stato.lastIndexOf('.'))).toBe(conPunti);
  });

  it('ogni accesso ha uno state diverso', () => {
    const a = iniziaAccessoApple(AVVIO, DESTINAZIONE);
    const b = iniziaAccessoApple(AVVIO, DESTINAZIONE);
    expect(a.state).not.toBe(b.state);
  });
});

describe('la pagina di Apple, composta dal Worker', () => {
  const SERVICES_PROVA = 'it.ferrando.mydivelog.accesso';

  it('porta tutto quello che serve, e `response_mode=form_post` è obbligatorio', () => {
    /*
     * Senza `form_post`, chiedendo `name` o `email`, Apple risponde
     * `invalid_request` e la pagina di accesso non si apre nemmeno.
     */
    const url = new URL(indirizzoAutorizzazioneApple(SERVICES_PROVA, RITORNO, 'stato-1'));
    expect(url.origin + url.pathname).toBe('https://appleid.apple.com/auth/authorize');
    expect(url.searchParams.get('client_id')).toBe(SERVICES_PROVA);
    expect(url.searchParams.get('redirect_uri')).toBe(RITORNO);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('response_mode')).toBe('form_post');
    expect(url.searchParams.get('scope')).toBe(AMBITI_APPLE);
    expect(url.searchParams.get('state')).toBe('stato-1');
  });

  it('il `client_id` è il SERVICES ID, non il bundle id', () => {
    /*
     * Sono due registrazioni distinte sul portale e si somigliano abbastanza da
     * scambiarle. Il giro con il browser accetta solo il Services ID, e con
     * l'altro risponde `invalid_client` prima ancora del campo della password.
     */
    const url = new URL(indirizzoAutorizzazioneApple(SERVICES_PROVA, RITORNO, 's'));
    expect(url.searchParams.get('client_id')).not.toBe('it.ferrando.mydivelog');
    expect(url.searchParams.get('client_id')).toContain('.accesso');
  });

  it('il punto di ritorno registrato è il WORKER, non l’app', () => {
    const url = new URL(indirizzoAutorizzazioneApple(SERVICES_PROVA, RITORNO, 's'));
    expect(url.searchParams.get('redirect_uri')).not.toContain('127.0.0.1');
    expect(url.searchParams.get('redirect_uri')).toBe(RITORNO);
  });

  it('si chiedono `name` ed `email`, e non si potrà chiederli dopo', () => {
    /*
     * Apple manda nome e indirizzo UNA VOLTA SOLA nella vita, alla primissima
     * autorizzazione. Se al primo giro non li avessimo chiesti, l'unico modo di
     * rimediare sarebbe far revocare a mano l'app dalle impostazioni dell'ID
     * Apple — cioè nessun modo, in pratica.
     */
    expect(AMBITI_APPLE.split(' ').sort()).toEqual(['email', 'name']);
  });
});

describe('il ritorno dell’accesso con Apple', () => {
  const stato = componiStato('casuale-1', DESTINAZIONE);

  it('con lo state giusto restituisce il codice', () => {
    expect(leggiRitornoApple(`${DESTINAZIONE}?code=abc123&state=${stato}`, stato)).toEqual({
      codice: 'abc123',
    });
  });

  it('CON LO STATE SBAGLIATO non guarda nemmeno il codice', () => {
    /*
     * L'attacco che questo controllo ferma: un altro programma bussa alla nostra
     * porta di ritorno con un codice ottenuto altrove — magari il proprio — e
     * senza il confronto l'app collegherebbe l'archivio di chi sta usando il
     * computer all'account di chi ha bussato. Senza PKCE, qui non c'è nient'altro
     * a fermarlo.
     */
    const esito = leggiRitornoApple(
      `${DESTINAZIONE}?code=codice-di-un-altro&state=${componiStato('casuale-2', DESTINAZIONE)}`,
      stato,
    );
    expect(esito).toEqual({ errore: expect.stringContaining('non corrisponde') });
  });

  it('senza state è rifiutato come se fosse sbagliato', () => {
    expect(leggiRitornoApple(`${DESTINAZIONE}?code=abc`, stato)).toHaveProperty('errore');
  });

  it('il campo `user` prosegue quando c’è, e non si inventa quando non c’è', () => {
    // C'è solo alla primissima autorizzazione, e da lì passa l'unica occasione
    // di sapere l'email: se non prosegue di qui non si riavrà mai più.
    const utente = JSON.stringify({ email: 'tizio@privaterelay.appleid.com' });
    expect(
      leggiRitornoApple(`${DESTINAZIONE}?code=abc&state=${stato}&user=${encodeURIComponent(utente)}`, stato),
    ).toEqual({ codice: 'abc', utente });
    expect(leggiRitornoApple(`${DESTINAZIONE}?code=abc&state=${stato}`, stato)).not.toHaveProperty('utente');
  });

  it('«ho annullato» non è un guasto e non si presenta come tale', () => {
    for (const negato of ['user_cancelled_authorize', 'access_denied']) {
      expect(leggiRitornoApple(`${DESTINAZIONE}?error=${negato}&state=${stato}`, stato)).toEqual({
        errore: 'Accesso annullato.',
      });
    }
  });

  it('un errore vero di Apple si riporta com’è', () => {
    const esito = leggiRitornoApple(`${DESTINAZIONE}?error=invalid_scope&state=${stato}`, stato);
    expect((esito as { errore: string }).errore).toContain('invalid_scope');
  });

  it('un indirizzo malformato non fa esplodere niente', () => {
    expect(leggiRitornoApple('non-un-indirizzo', stato)).toHaveProperty('errore');
  });
});

describe('la configurazione pubblica di Apple', () => {
  it('lo schema dell’app nel plist di iOS combacia con quello del codice', async () => {
    /*
     * DUE STRINGHE CHE DEVONO COMBACIARE E STANNO IN DUE FILE DIVERSI, come già
     * succede per Google. `Info.ios.plist` dichiara al sistema lo schema con cui
     * si rientra; il codice ne costruisce la destinazione. Se divergono,
     * l'accesso si completa nel browser e poi **non torna mai** — senza nessun
     * errore, da nessuna parte.
     */
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { SCHEMA_APP } = await import('../src/sync/configurazione');
    const plist = readFileSync(
      fileURLToPath(new URL('../src-tauri/Info.ios.plist', import.meta.url)),
      'utf8',
    );
    expect(plist).toContain(`<string>${SCHEMA_APP}</string>`);
  });

  it('quello che l’app produce, il Worker lo accetta: le due metà combaciano', async () => {
    /*
     * Il giro completo del contratto fra app e Worker, senza rete: l'app
     * costruisce una destinazione, il Worker la ricontrolla. Sono i due lati di
     * `destinazionePermessa`, e se uno dei due cambia idea sullo schema o sulla
     * forma della porta, questo test cade prima di un telefono.
     */
    const { destinazioneApple } = await import('../src/sync/configurazione');
    const { destinazionePermessa } = await import('../server/appleScambio');
    // Sul Mac: la porta effimera dell'ascoltatore.
    expect(destinazionePermessa('http://127.0.0.1:51000/accesso')).toBe(true);
    // Su questa piattaforma di prova `suIOS()` è falso, quindi esce il loopback.
    expect(destinazionePermessa(destinazioneApple(51000))).toBe(true);
  });

  it('l’avvio dell’app e il Return URL del Worker stanno sullo stesso servizio', async () => {
    /*
     * Stringhe copiate a mano da un pannello, e ciascuna sbaglia in silenzio.
     * Il Return URL in particolare deve combaciare CARATTERE PER CARATTERE con
     * quello del portale di Apple: una barra finale di differenza e Apple
     * rifiuta.
     *
     * Da quando la pagina di Apple la compone il Worker, l'app conosce un
     * indirizzo solo — quello da cui parte il giro — e qui si verifica che
     * quello e il Return URL siano due rotte dello stesso servizio: se
     * divergessero, l'app manderebbe la gente su un dominio e Apple
     * risponderebbe a un altro.
     */
    const { APPLE_AVVIO } = await import('../src/sync/configurazione');
    expect(APPLE_AVVIO).toBe('https://mydivelog.site/accesso-apple/vai');

    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const toml = readFileSync(fileURLToPath(new URL('../server/wrangler.toml', import.meta.url)), 'utf8');

    const ritornoDelToml = /APPLE_RITORNO = "([^"]+)"/.exec(toml)?.[1];
    expect(ritornoDelToml).toBe('https://mydivelog.site/accesso-apple/ritorno');
    expect(new URL(ritornoDelToml!).origin).toBe(new URL(APPLE_AVVIO).origin);

    // Il Services ID dev'essere fra gli `aud` accettati, o il token che Apple
    // emette viene rifiutato da noi stessi con un 401.
    const services = /APPLE_SERVICES_ID = "([^"]+)"/.exec(toml)?.[1];
    expect(services).toBe('it.ferrando.mydivelog.accesso');
    expect(toml).toMatch(new RegExp(`APPLE_CLIENT_ID = "[^"]*${services}`));

    // E la rotta che l'app apre dev'essere coperta dalla regola di
    // instradamento del Worker: senza, quell'indirizzo lo serve il sito e
    // risponde con una pagina, non con un salto verso Apple.
    expect(toml).toContain('pattern = "mydivelog.site/accesso-apple/*"');
  });
});
