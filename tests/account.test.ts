/**
 * L'account visto dall'app: la sessione, la chiave che scade, il rinnovo.
 *
 * Sono i tre comportamenti che decidono se l'accesso è una comodità o una
 * seccatura quotidiana. Uno sbaglio qui non si manifesta come errore: si
 * manifesta come «ogni tanto devo rifare l'accesso» oppure «la
 * sincronizzazione fallisce dopo un paio d'ore di app aperta».
 */

import { describe, expect, it } from 'vitest';
import {
  accedi,
  cancellaAccount,
  ChiaviDelDatabase,
  MARGINE_RINNOVO_S,
  leggiAccountSalvato,
  rinnovaChiave,
  SessioneScaduta,
} from '../src/sync/account';

const ADESSO = 1_800_000_000;

function rete(risposte: Array<{ stato: number; dati: unknown }>) {
  const chiamate: Array<{ url: string; metodo: string; autorizzazione?: string; corpo?: unknown }> = [];
  let i = 0;
  const fetchImpl = (async (url: string, init: RequestInit = {}) => {
    const h = (init.headers ?? {}) as Record<string, string>;
    chiamate.push({
      url: String(url),
      metodo: init.method ?? 'GET',
      autorizzazione: h.Authorization,
      corpo: init.body ? JSON.parse(String(init.body)) : undefined,
    });
    const r = risposte[Math.min(i++, risposte.length - 1)];
    return { ok: r.stato >= 200 && r.stato < 300, status: r.stato, json: async () => r.dati } as Response;
  }) as unknown as typeof fetch;
  return { chiamate, fetchImpl };
}

const opz = (fetchImpl: typeof fetch, adessoS = () => ADESSO) => ({
  servizio: 'https://accesso.example',
  fetchImpl,
  adessoS,
});

const RITORNO = {
  clientId: '883995552043-fcsjcnlb5o6ih7af686bk0j7pls9k5bi.apps.googleusercontent.com',
  codice: 'codice-a-uso-singolo',
  verificatore: 'verificatore-pkce',
  ritorno: 'http://127.0.0.1:51000/accesso',
};

const CHIAVE_BUONA = {
  url: 'libsql://mdl-abc.turso.io',
  chiave: 'token-di-due-ore',
  scadeIlS: ADESSO + 7200,
};

describe('accesso', () => {
  it('consegna il token del fornitore e riceve sessione e chiave', async () => {
    const { chiamate, fetchImpl } = rete([{ stato: 200, dati: { sessione: 'sess-1', ...CHIAVE_BUONA } }]);
    const esito = await accedi(opz(fetchImpl), 'google', RITORNO);

    expect(esito.sessione).toBe('sess-1');
    expect(esito.chiave.url).toBe('libsql://mdl-abc.turso.io');
    expect(esito.chiave.authToken).toBe('token-di-due-ore');
    /*
     * Quello che esce dal dispositivo è un CODICE a uso singolo, mai un token.
     * Se un giorno qui ricomparisse un `idToken`, vorrebbe dire che lo scambio
     * è tornato dentro l'app — e con lui il segreto del client desktop.
     */
    expect(chiamate[0].corpo).toEqual({ provider: 'google', ...RITORNO });
  });

  it('l’email arriva dal servizio e si porta fino all’interfaccia', async () => {
    const { fetchImpl } = rete([
      { stato: 200, dati: { sessione: 'sess-1', email: 'tizio@example.com', ...CHIAVE_BUONA } },
    ]);
    const esito = await accedi(opz(fetchImpl), 'google', RITORNO);
    expect(esito.email).toBe('tizio@example.com');
  });

  it('senza email l’accesso riesce lo stesso', async () => {
    /*
     * Apple manda l'indirizzo solo la prima volta, e chi ha scelto «nascondi la
     * mia email» ne manda uno diverso. Un accesso che fallisse per un campo che
     * serve a scrivere una frase sarebbe un accesso rotto per niente.
     */
    const { fetchImpl } = rete([{ stato: 200, dati: { sessione: 'sess-1', ...CHIAVE_BUONA } }]);
    const esito = await accedi(opz(fetchImpl), 'apple', RITORNO);
    expect(esito.email).toBeNull();
    expect(esito.sessione).toBe('sess-1');
  });

  it('una risposta senza sessione è un errore, non una sessione vuota', async () => {
    const { fetchImpl } = rete([{ stato: 200, dati: { ...CHIAVE_BUONA } }]);
    await expect(accedi(opz(fetchImpl), 'apple', RITORNO)).rejects.toThrow(/non ha restituito una sessione/);
  });

  it('una risposta di forma sconosciuta non diventa una chiave finta', async () => {
    // Se il servizio cambiasse i nomi dei campi, l'app deve fermarsi qui e non
    // partire con `undefined` come token — che poi fallirebbe molto più tardi,
    // dentro la sincronizzazione, con un errore che non nomina l'accesso.
    const { fetchImpl } = rete([{ stato: 200, dati: { sessione: 's', url: 'libsql://x' } }]);
    await expect(accedi(opz(fetchImpl), 'apple', RITORNO)).rejects.toThrow(/non conosciamo/);
  });
});

describe('quello che resta nel portachiavi', () => {
  it('la forma nuova si rilegge intera', () => {
    expect(leggiAccountSalvato({ sessione: 's-1', email: 'a@b.it' })).toEqual({
      sessione: 's-1',
      email: 'a@b.it',
    });
  });

  it('LA FORMA VECCHIA — la sola sessione come stringa — non disconnette nessuno', () => {
    /*
     * Chi ha fatto l'accesso prima che salvassimo anche l'email ha una stringa
     * nel portachiavi. Se questa riga smettesse di funzionare, un
     * aggiornamento dell'app rimanderebbe al browser gente che era già entrata.
     */
    expect(leggiAccountSalvato('solo-la-sessione')).toEqual({
      sessione: 'solo-la-sessione',
      email: null,
    });
  });

  it('niente, o qualcosa senza sessione dentro, vale «non sei entrato»', () => {
    expect(leggiAccountSalvato(null)).toBeNull();
    expect(leggiAccountSalvato(undefined)).toBeNull();
    expect(leggiAccountSalvato('')).toBeNull();
    expect(leggiAccountSalvato({ sessione: '', email: 'a@b.it' })).toBeNull();
  });
});

describe('sessione scaduta', () => {
  it('il 401 diventa un tipo suo, non un messaggio da leggere', async () => {
    /*
     * È l'unico caso in cui l'interfaccia deve fare qualcosa di diverso da
     * «riprova»: deve riportare al pulsante di accesso. Distinguerlo dal testo
     * del messaggio sarebbe fragile — i messaggi si riscrivono — mentre un tipo
     * regge.
     */
    const { fetchImpl } = rete([{ stato: 401, dati: { errore: 'sessione non valida' } }]);
    await expect(rinnovaChiave(opz(fetchImpl), 'sess-vecchia')).rejects.toBeInstanceOf(SessioneScaduta);
  });

  it('la rete assente NON è una sessione scaduta', async () => {
    /*
     * La distinzione che protegge chi è in barca senza campo: trattare
     * l'assenza di rete come sessione scaduta gli farebbe perdere la sessione
     * che ha, e dovrebbe riaccedere una volta tornato a terra.
     */
    const fetchImpl = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    const errore = await rinnovaChiave(opz(fetchImpl), 'sess').catch((e) => e);
    expect(errore).not.toBeInstanceOf(SessioneScaduta);
    expect(String(errore)).toMatch(/non raggiungibile/);
  });
});

describe('la chiave si rinnova quando serve, e non prima', () => {
  it('la prima volta la chiede, la seconda la riusa', async () => {
    const { chiamate, fetchImpl } = rete([{ stato: 200, dati: CHIAVE_BUONA }]);
    const chiavi = new ChiaviDelDatabase(opz(fetchImpl), 'sess-1');

    expect((await chiavi.valida()).authToken).toBe('token-di-due-ore');
    expect((await chiavi.valida()).authToken).toBe('token-di-due-ore');
    expect(chiamate.length, 'ha chiesto due volte la stessa chiave').toBe(1);
  });

  it('la rinnova PRIMA della scadenza, non allo scadere', async () => {
    /*
     * Il margine esiste perché uno scarico Bluetooth seguito da un allineamento
     * dura minuti: una chiave rinnovata all'ultimo istante scade a metà
     * dell'operazione, che è il momento peggiore in cui possa succedere.
     */
    let adesso = ADESSO;
    const { chiamate, fetchImpl } = rete([
      { stato: 200, dati: CHIAVE_BUONA },
      { stato: 200, dati: { ...CHIAVE_BUONA, chiave: 'token-nuovo', scadeIlS: ADESSO + 20000 } },
    ]);
    const chiavi = new ChiaviDelDatabase(
      opz(fetchImpl, () => adesso),
      'sess-1',
    );

    await chiavi.valida();
    // Un istante prima del margine: ancora buona.
    adesso = CHIAVE_BUONA.scadeIlS - MARGINE_RINNOVO_S - 1;
    expect((await chiavi.valida()).authToken).toBe('token-di-due-ore');
    expect(chiamate.length).toBe(1);

    // Dentro il margine: se ne chiede una nuova anche se questa vale ancora.
    adesso = CHIAVE_BUONA.scadeIlS - MARGINE_RINNOVO_S + 1;
    expect((await chiavi.valida()).authToken).toBe('token-nuovo');
    expect(chiamate.length).toBe(2);
  });

  it('dieci richieste insieme fanno una chiamata sola', async () => {
    /*
     * All'avvio la sincronizzazione e la pagina delle impostazioni chiedono la
     * chiave nello stesso istante. Senza la promessa condivisa partirebbero due
     * richieste e il servizio emetterebbe due token, di cui uno resterebbe in
     * giro inutilizzato fino alla scadenza.
     */
    const { chiamate, fetchImpl } = rete([{ stato: 200, dati: CHIAVE_BUONA }]);
    const chiavi = new ChiaviDelDatabase(opz(fetchImpl), 'sess-1');

    const tutte = await Promise.all(Array.from({ length: 10 }, () => chiavi.valida()));
    expect(new Set(tutte.map((c) => c.authToken)).size).toBe(1);
    expect(chiamate.length).toBe(1);
  });

  it('scartare una chiave rifiutata ne fa chiedere un’altra', async () => {
    // Serve perché le due scadenze non sono d'accordo per forza: l'orologio del
    // dispositivo può essere avanti, o il token può essere stato revocato.
    const { chiamate, fetchImpl } = rete([
      { stato: 200, dati: CHIAVE_BUONA },
      { stato: 200, dati: { ...CHIAVE_BUONA, chiave: 'token-nuovo' } },
    ]);
    const chiavi = new ChiaviDelDatabase(opz(fetchImpl), 'sess-1');

    await chiavi.valida();
    chiavi.scarta();
    expect((await chiavi.valida()).authToken).toBe('token-nuovo');
    expect(chiamate.length).toBe(2);
  });

  it('dopo un fallimento si può riprovare', async () => {
    // La promessa condivisa non deve restare appesa: se resta, un singolo
    // errore di rete blocca i rinnovi per sempre e l'unica via d'uscita è
    // riavviare l'app.
    const { fetchImpl } = rete([
      { stato: 500, dati: {} },
      { stato: 200, dati: CHIAVE_BUONA },
    ]);
    const chiavi = new ChiaviDelDatabase(opz(fetchImpl), 'sess-1');

    await expect(chiavi.valida()).rejects.toThrow();
    expect((await chiavi.valida()).authToken).toBe('token-di-due-ore');
  });
});

describe('cancellazione dell’account', () => {
  it('passa dalla sessione e non tocca l’archivio locale', async () => {
    const { chiamate, fetchImpl } = rete([{ stato: 200, dati: { cancellato: true } }]);
    await cancellaAccount(opz(fetchImpl), 'sess-1');
    expect(chiamate[0].metodo).toBe('DELETE');
    expect(chiamate[0].autorizzazione).toBe('Bearer sess-1');
  });
});

describe('la pagina delle impostazioni, letta nelle sorgenti', () => {
  /*
   * Due guardie sulla FORMA della pagina, non sul suo aspetto.
   *
   * Sono scritte leggendo il sorgente perché montare `SyncPage` vorrebbe dire
   * montare l'archivio, il negozio dei segreti e mezzo stato dell'applicazione:
   * un test che costa venti volte tanto per dire la stessa cosa. La regola vale
   * finché quello che si vuole inchiodare è una struttura, non un
   * comportamento.
   */
  async function sorgente(): Promise<string> {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    return readFileSync(fileURLToPath(new URL('../src/ui/pages/SyncPage.tsx', import.meta.url)), 'utf8');
  }

  it('il campo del token sta DENTRO «Avanzate», non accanto all’accesso', async () => {
    /*
     * Da quando c'è l'account, incollare indirizzo e token è la strada di pochi.
     * Se un giorno quel campo tornasse in cima, la pagina ricomincerebbe a
     * suggerire una scelta che non c'è: la strada normale è una sola.
     */
    const testo = await sorgente();
    const apre = testo.indexOf('<details className="card">');
    const campo = testo.indexOf('placeholder="libsql://');
    const chiude = testo.indexOf('</details>');
    expect(apre).toBeGreaterThan(-1);
    expect(campo).toBeGreaterThan(apre);
    expect(campo).toBeLessThan(chiude);
  });

  it('«Sincronizza» NON dipende dalle credenziali scritte a mano', async () => {
    /*
     * Il difetto che questa riga ferma: chi entra con Google non ha nessun
     * indirizzo né token salvato, e con la vecchia condizione (`!configured`) si
     * troverebbe il pulsante spento subito dopo un accesso riuscito — cioè la
     * funzione appena aggiunta sembrerebbe non fare niente.
     */
    const testo = await sorgente();
    expect(testo).toContain('const pronto = accountAttivo || configured;');
    expect(testo).toContain('disabled={busy || !pronto || (!accountAttivo && dirty)}');
    expect(testo).not.toContain('disabled={busy || !configured || dirty}');
  });
});

describe('la configurazione pubblica dell’accesso', () => {
  /*
   * Sono tre stringhe copiate a mano da una console, e ciascuna sbaglia in
   * silenzio: un client id sbagliato dà 401, uno schema di ritorno sbagliato
   * lascia l'accesso appeso dopo averlo completato, un indirizzo assente dalla
   * CSP fa sembrare rotto il servizio. Nessuno dei tre si vede compilando.
   */
  it('lo schema di ritorno dell’iPhone si RICAVA dal client id, non si trascrive', async () => {
    const { GOOGLE_CLIENT_IOS, schemaRitornoIOS } = await import('../src/sync/configurazione');
    // È il difetto che questo test esiste per impedire: due stringhe che devono
    // combaciare e si scrivono a mano prima o poi non combaciano più.
    expect(schemaRitornoIOS()).toBe(
      `com.googleusercontent.apps.${GOOGLE_CLIENT_IOS.replace('.apps.googleusercontent.com', '')}`,
    );
  });

  it('i due client di Google sono diversi fra loro e ben formati', async () => {
    const { GOOGLE_CLIENT_IOS, GOOGLE_CLIENT_DESKTOP } = await import('../src/sync/configurazione');
    expect(GOOGLE_CLIENT_IOS).not.toBe(GOOGLE_CLIENT_DESKTOP);
    for (const id of [GOOGLE_CLIENT_IOS, GOOGLE_CLIENT_DESKTOP]) {
      expect(id, 'un client id incompleto dà un 401 che non spiega niente').toMatch(
        /^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/,
      );
    }
  });

  it('lo schema URL nel plist di iOS combacia con quello ricavato', async () => {
    /*
     * DUE STRINGHE CHE DEVONO COMBACIARE E STANNO IN DUE FILE DIVERSI.
     *
     * `Info.ios.plist` dichiara al sistema lo schema con cui il browser
     * riconsegna all'app; il codice ne ricava uno dal client id. Se divergono,
     * l'accesso si completa nel browser e poi **non torna mai** — senza nessun
     * errore, da nessuna parte. È il difetto più silenzioso di tutta questa
     * funzione, e l'unico modo di accorgersene è provarlo su un telefono.
     */
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { schemaRitornoIOS } = await import('../src/sync/configurazione');
    const plist = readFileSync(
      fileURLToPath(new URL('../src-tauri/Info.ios.plist', import.meta.url)),
      'utf8',
    );
    expect(plist).toContain(`<string>${schemaRitornoIOS()}</string>`);
  });

  it('l’indirizzo del servizio è dentro la CSP dell’applicazione', async () => {
    /*
     * LA RIGA CHE È GIÀ COSTATA UNA SERATA. `connect-src` è l'elenco dei posti a
     * cui la webview può parlare: un servizio che non è elencato viene bloccato
     * prima che la chiamata parta, e il sintomo non è un errore di rete — è
     * «l'accesso non funziona». Non si vede sviluppando, perché nel browser
     * quella CSP non esiste.
     */
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { SERVIZIO_ACCESSO } = await import('../src/sync/configurazione');
    const conf = JSON.parse(
      readFileSync(fileURLToPath(new URL('../src-tauri/tauri.conf.json', import.meta.url)), 'utf8'),
    ) as { app: { security: { csp: string } } };
    expect(conf.app.security.csp).toContain(SERVIZIO_ACCESSO);
    /*
     * E Google NON dev'esserci. Lo scambio del codice è passato sul Worker
     * perché il client desktop pretende un segreto, e da allora la webview con
     * `oauth2.googleapis.com` non parla più. Lasciare aperto un permesso che non
     * serve è il modo in cui una CSP smette lentamente di voler dire qualcosa.
     */
    expect(conf.app.security.csp).not.toContain('oauth2.googleapis.com');
  });
});
