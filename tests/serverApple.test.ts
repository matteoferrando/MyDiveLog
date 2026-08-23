/**
 * Sign in with Apple, lato servizio: il segreto che ci firmiamo da soli, lo
 * scambio del codice, e il rimbalzo che NON deve diventare un redirect aperto.
 *
 * PERCHÉ QUESTO FILE ESISTE. Di Apple non si può provare il giro vero senza
 * Apple: la pagina di accesso, il consenso, la POST di ritorno sono cose che
 * succedono su macchine altrui. Quello che si può provare — e che è dove si
 * sbaglia — è tutto quanto sta prima e dopo: che il segreto sia firmato come
 * Apple lo pretende, che un rifiuto non trapeli fino all'app, e soprattutto che
 * il Worker rimandi il browser **solo** dentro la nostra applicazione.
 *
 * La chiave usata qui è una P-256 generata al volo. Non serve quella vera, e
 * non deve stare in un repository: quello che si verifica è la FORMA della
 * firma e delle rivendicazioni, e per quello una coppia qualunque va bene —
 * anzi, va meglio, perché il test gira ovunque.
 */

import { describe, expect, it, beforeAll } from 'vitest';
import {
  destinazionePermessa,
  DURATA_SEGRETO_S,
  emailDalCampoUtente,
  leggiDestinazioneDalloStato,
  scambiaCodiceApple,
  segretoClientApple,
} from '../server/appleScambio';
import { componiStato } from '../src/sync/appleAccesso';

const TEAM = '73F4VR2CMU';
const KEY = '7MLL5X469B';
const SERVICES = 'it.ferrando.mydivelog.accesso';
const ADESSO = 1_800_000_000;

/** Il `.p8` finto: una P-256 vera, esportata in PKCS#8 e vestita da PEM. */
let chiaveP8: string;
let pubblica: CryptoKey;

beforeAll(async () => {
  const coppia = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  pubblica = coppia.publicKey;
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', coppia.privateKey));
  let grezzo = '';
  for (const b of pkcs8) grezzo += String.fromCharCode(b);
  const base64 = btoa(grezzo).replace(/(.{64})/g, '$1\n');
  chiaveP8 = `-----BEGIN PRIVATE KEY-----\n${base64}\n-----END PRIVATE KEY-----\n`;
});

const chiave = () => ({ servicesId: SERVICES, teamId: TEAM, keyId: KEY, chiaveP8 });

function pezzi(jwt: string) {
  const [testa, corpo] = jwt.split('.');
  const leggi = (p: string) => JSON.parse(new TextDecoder().decode(byte(p))) as Record<string, unknown>;
  return { testa: leggi(testa), corpo: leggi(corpo) };
}

function byte(base64url: string): Uint8Array<ArrayBuffer> {
  const pieno = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const grezzo = atob(pieno + '='.repeat((4 - (pieno.length % 4)) % 4));
  // `new ArrayBuffer(...)` esplicito, come in `identita.ts`: quello che
  // `crypto.subtle` accetta è il buffer non condivisibile fra thread.
  const out = new Uint8Array(new ArrayBuffer(grezzo.length));
  for (let i = 0; i < grezzo.length; i++) out[i] = grezzo.charCodeAt(i);
  return out;
}

describe('il segreto del client, che ci firmiamo da soli', () => {
  it('ha tre parti, come qualunque JWT', async () => {
    const segreto = await segretoClientApple(chiave(), ADESSO);
    expect(segreto.split('.')).toHaveLength(3);
  });

  it('porta le rivendicazioni che Apple pretende, e ognuna la sua', async () => {
    /*
     * Sono quattro campi e ciascuno sbaglia in silenzio: scambiare `iss` e `sub`
     * — Team ID e Services ID si somigliano abbastanza da confonderli — dà un
     * `invalid_client` che non dice quale dei due è girato.
     */
    const { testa, corpo } = pezzi(await segretoClientApple(chiave(), ADESSO));
    expect(testa.alg).toBe('ES256');
    // Il `kid` sta nell'INTESTAZIONE, non nel corpo: è così che Apple sa quale
    // chiave del team usare per verificare.
    expect(testa.kid).toBe(KEY);
    expect(corpo.iss).toBe(TEAM);
    expect(corpo.sub).toBe(SERVICES);
    expect(corpo.aud).toBe('https://appleid.apple.com');
  });

  it('SCADE FRA CINQUE MINUTI, ed è tutto il punto dell’esercizio', async () => {
    /*
     * Apple consente fino a sei mesi. Firmarne uno da sei mesi vorrebbe dire
     * mettersi in calendario di rifarlo, e il giorno che quel promemoria viene
     * rimandato l'accesso si spegne per tutti. Firmandolo al volo la scadenza
     * sparisce dal calendario: questo test è quello che tiene ferma la scelta.
     */
    const { corpo } = pezzi(await segretoClientApple(chiave(), ADESSO));
    expect(corpo.iat).toBe(ADESSO);
    expect(corpo.exp).toBe(ADESSO + DURATA_SEGRETO_S);
    expect(DURATA_SEGRETO_S).toBeLessThanOrEqual(600);
  });

  it('la firma è r‖s GREZZI, 64 byte, e si verifica davvero', async () => {
    /*
     * L'errore che costa un pomeriggio: convertire la firma da DER, perché così
     * fanno le librerie del mondo OpenSSL. `crypto.subtle` per ECDSA restituisce
     * già r‖s concatenati, che è esattamente quello che ES256 vuole. Una firma
     * DER sarebbe di lunghezza variabile — 70, 71, 72 byte — e Apple
     * risponderebbe `invalid_client` senza spiegare niente.
     */
    const segreto = await segretoClientApple(chiave(), ADESSO);
    const [testa, corpo, firma] = segreto.split('.');
    expect(byte(firma)).toHaveLength(64);
    expect(
      await crypto.subtle.verify(
        { name: 'ECDSA', hash: 'SHA-256' },
        pubblica,
        byte(firma),
        new TextEncoder().encode(`${testa}.${corpo}`),
      ),
    ).toBe(true);
  });

  it('un `.p8` incollato senza le righe BEGIN/END funziona lo stesso', async () => {
    // Perché è come esce dal pannello dei segreti di chi copia solo il mezzo, e
    // un a-capo in più è indistinguibile a occhio da uno pulito.
    const nudo = chiaveP8.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '');
    const segreto = await segretoClientApple({ ...chiave(), chiaveP8: `  ${nudo}  ` }, ADESSO);
    expect(pezzi(segreto).corpo.sub).toBe(SERVICES);
  });
});

function rete(stato: number, dati: unknown) {
  const chiamate: Array<Record<string, string>> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    expect(String(url)).toBe('https://appleid.apple.com/auth/token');
    chiamate.push(Object.fromEntries(new URLSearchParams(String(init.body))));
    return { ok: stato >= 200 && stato < 300, status: stato, json: async () => dati } as Response;
  }) as unknown as typeof fetch;
  return { chiamate, fetchImpl };
}

const scambio = {
  clientId: SERVICES,
  segreto: 'un.segreto.firmato',
  codice: 'cod-1',
  ritorno: 'https://mydivelog.site/accesso-apple/ritorno',
};

describe('lo scambio del codice con Apple', () => {
  it('riuscito, restituisce il solo token d’identità', async () => {
    const { chiamate, fetchImpl } = rete(200, { id_token: 'identita', refresh_token: 'non-serve' });
    expect(await scambiaCodiceApple(scambio, fetchImpl)).toBe('identita');
    expect(chiamate[0].client_id).toBe(SERVICES);
    expect(chiamate[0].client_secret).toBe('un.segreto.firmato');
    expect(chiamate[0].grant_type).toBe('authorization_code');
    // Il punto di ritorno è quello REGISTRATO — il Worker — non la destinazione
    // dentro l'app: Apple lo riconfronta e rifiuta se differisce.
    expect(chiamate[0].redirect_uri).toBe('https://mydivelog.site/accesso-apple/ritorno');
  });

  it('NON manda nessun `code_verifier`: PKCE nel giro web di Apple non c’è', async () => {
    // Non è una dimenticanza. Va scritto qui perché chi legge il codice
    // accanto a quello di Google si chiede subito dove sia finito.
    const { chiamate, fetchImpl } = rete(200, { id_token: 'x' });
    await scambiaCodiceApple(scambio, fetchImpl);
    expect('code_verifier' in chiamate[0]).toBe(false);
  });

  it('un rifiuto di Apple diventa `null`, senza portarsi dietro il dettaglio', async () => {
    /*
     * `invalid_grant`, `invalid_client`, `expired_token` sono informazioni utili
     * a chi sta provando a indovinare e inutili a chi ha semplicemente aspettato
     * troppo. Il dettaglio resta nel registro del Worker.
     */
    const { fetchImpl } = rete(400, { error: 'invalid_grant' });
    const esito = await scambiaCodiceApple(scambio, fetchImpl);
    expect(esito).toBeNull();
    expect(JSON.stringify(esito)).not.toContain('invalid_grant');
  });

  it('una risposta senza token d’identità è `null`', async () => {
    const { fetchImpl } = rete(200, { refresh_token: 'solo-questo' });
    expect(await scambiaCodiceApple(scambio, fetchImpl)).toBeNull();
  });
});

describe('lo `state`, che è dove viaggia la destinazione', () => {
  it('quello che l’app compone, il Worker lo rilegge uguale', () => {
    /*
     * DUE METÀ IN DUE FILE che non si possono importare a vicenda — una finisce
     * nel pacchetto dell'app, l'altra gira su Cloudflare. Questo è il test che
     * le tiene d'accordo: se qualcuno cambia il separatore da una parte sola,
     * cade qui e non in produzione.
     */
    for (const destinazione of ['mydivelog://accesso', 'http://127.0.0.1:51000/accesso']) {
      const stato = componiStato('casuale-abcdef', destinazione);
      expect(leggiDestinazioneDalloStato(stato)).toBe(destinazione);
    }
  });

  it('uno `state` senza destinazione non ne inventa una', () => {
    expect(leggiDestinazioneDalloStato('')).toBeNull();
    expect(leggiDestinazioneDalloStato('solo-casuale')).toBeNull();
    expect(leggiDestinazioneDalloStato('.')).toBeNull();
    expect(leggiDestinazioneDalloStato('casuale.')).toBeNull();
  });
});

describe('il rimbalzo verso l’app: le sole due destinazioni ammesse', () => {
  it('lo schema dell’app e l’ascoltatore locale passano', () => {
    expect(destinazionePermessa('mydivelog://accesso')).toBe(true);
    expect(destinazionePermessa('mydivelog://accesso?x=1')).toBe(true);
    expect(destinazionePermessa('http://127.0.0.1:51000/accesso')).toBe(true);
  });

  it('UN SITO QUALUNQUE NO: è la riga che impedisce un redirect aperto', () => {
    /*
     * L'attacco: si costruisce un indirizzo che comincia con `mydivelog.site` —
     * un dominio nostro, credibile, con il lucchetto — e chi lo apre atterra sul
     * sito di qualcun altro, con in coda un codice di autorizzazione.
     */
    expect(destinazionePermessa('https://attaccante.example')).toBe(false);
    expect(destinazionePermessa('https://attaccante.example/accesso')).toBe(false);
    expect(destinazionePermessa('http://attaccante.example:51000/accesso')).toBe(false);
  });

  it('e nemmeno i travestimenti da loopback', () => {
    /*
     * Perché il controllo analizza l'indirizzo invece di guardarne l'inizio:
     * `startsWith('http://127.0.0.1')` accetterebbe il primo di questi, che il
     * browser legge come l'host `attaccante.example` con `127.0.0.1` come nome
     * utente. È l'esempio da manuale, e funziona finché qualcuno lo prova.
     */
    expect(destinazionePermessa('http://127.0.0.1@attaccante.example/')).toBe(false);
    expect(destinazionePermessa('http://127.0.0.1.attaccante.example/accesso')).toBe(false);
    // Senza porta non è il nostro ascoltatore: quella la apre il guscio Rust ed
    // è sempre effimera.
    expect(destinazionePermessa('http://127.0.0.1/accesso')).toBe(false);
    // Schemi che non sono indirizzi.
    expect(destinazionePermessa('javascript:alert(1)')).toBe(false);
    expect(destinazionePermessa('non-un-indirizzo')).toBe(false);
    expect(destinazionePermessa('')).toBe(false);
  });
});

describe('l’email che Apple manda una volta sola nella vita', () => {
  it('si pesca dal campo `user`', () => {
    const utente = JSON.stringify({
      name: { firstName: 'Tizio', lastName: 'Caio' },
      email: 'tizio@example.com',
    });
    expect(emailDalCampoUtente(utente)).toBe('tizio@example.com');
  });

  it('un indirizzo `@privaterelay.appleid.com` è legittimo e si accetta', () => {
    // È l'inoltro che Apple crea per chi sceglie «Nascondi la mia email».
    // Trattarlo diversamente vorrebbe dire punire chi usa una funzione che
    // Apple offre apposta.
    const utente = JSON.stringify({ email: 'abc123@privaterelay.appleid.com' });
    expect(emailDalCampoUtente(utente)).toBe('abc123@privaterelay.appleid.com');
  });

  it('quando non c’è — cioè da ogni accesso dopo il primo — è `null`', () => {
    expect(emailDalCampoUtente(undefined)).toBeNull();
    expect(emailDalCampoUtente('')).toBeNull();
    expect(emailDalCampoUtente('{non json')).toBeNull();
    expect(emailDalCampoUtente(JSON.stringify({ name: { firstName: 'Tizio' } }))).toBeNull();
  });
});
