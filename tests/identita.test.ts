/**
 * La verifica dei token di Apple e Google, provata con token VERI.
 *
 * «Veri» nel senso che conta: firmati davvero con RSA, da una coppia di chiavi
 * generata qui, e verificati dallo stesso codice che girerà sul Worker. Non c'è
 * nessuna finzione al posto della crittografia — se ci fosse, questo file
 * proverebbe la finzione.
 *
 * Ogni test che segue corrisponde a un modo di entrare nell'archivio di un
 * altro. Sono i casi da cui dipende tutto il resto del servizio.
 */

import { describe, expect, it, beforeAll } from 'vitest';
import { verificaTokenIdentita } from '../server/identita';

const ADESSO = 1_800_000_000;
const NOSTRO_ID = 'it.ferrando.mydivelog';

let privata: CryptoKey;
let pubblica: CryptoKey;
let altraPrivata: CryptoKey;

beforeAll(async () => {
  const coppia = (await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  privata = coppia.privateKey;
  pubblica = coppia.publicKey;

  const altra = (await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  altraPrivata = altra.privateKey;
});

const b64url = (b: Uint8Array | string) => {
  const byte = typeof b === 'string' ? new TextEncoder().encode(b) : b;
  let s = '';
  for (const x of byte) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

/** Costruisce un token firmato come lo farebbe il fornitore. */
async function tokenFirmato(
  corpo: Record<string, unknown>,
  chiave: CryptoKey = privata,
  intestazione: Record<string, unknown> = { alg: 'RS256', kid: 'k1' },
): Promise<string> {
  const testa = b64url(JSON.stringify(intestazione));
  const dati = b64url(JSON.stringify(corpo));
  const firma = await crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5' },
    chiave,
    new TextEncoder().encode(`${testa}.${dati}`),
  );
  return `${testa}.${dati}.${b64url(new Uint8Array(firma))}`;
}

const trovaChiave = async (kid: string) => (kid === 'k1' ? pubblica : null);
const opzioni = { provider: 'google' as const, pubblico: [NOSTRO_ID], trovaChiave, adesso: ADESSO };

const CORPO_BUONO = {
  iss: 'https://accounts.google.com',
  aud: NOSTRO_ID,
  sub: '109876543210987654321',
  exp: ADESSO + 300,
  email: 'tizio@example.com',
};

describe('token di identità: il caso buono', () => {
  it('un token firmato e coerente dà l’identità', async () => {
    const identita = await verificaTokenIdentita(await tokenFirmato(CORPO_BUONO), opzioni);
    expect(identita).toEqual({
      provider: 'google',
      sub: '109876543210987654321',
      email: 'tizio@example.com',
    });
  });

  it('accetta `aud` come elenco, non solo come stringa', async () => {
    // Entrambe le forme sono nello standard: accettarne una sola rifiuterebbe
    // token legittimi, e il sintomo sarebbe «l'accesso non funziona» senza altro.
    const token = await tokenFirmato({ ...CORPO_BUONO, aud: ['altro-servizio', NOSTRO_ID] });
    expect(await verificaTokenIdentita(token, opzioni)).not.toBeNull();
  });

  it('l’email è facoltativa: con Apple spesso non c’è', async () => {
    const { email: _via, ...senzaEmail } = CORPO_BUONO;
    const identita = await verificaTokenIdentita(await tokenFirmato(senzaEmail), opzioni);
    expect(identita?.sub).toBe(CORPO_BUONO.sub);
    expect(identita?.email).toBeUndefined();
  });
});

describe('token di identità: i rifiuti, che sono il vero test', () => {
  it('firmato con un’altra chiave → rifiutato', async () => {
    const token = await tokenFirmato(CORPO_BUONO, altraPrivata);
    expect(await verificaTokenIdentita(token, opzioni)).toBeNull();
  });

  it('`kid` sconosciuto → rifiutato, senza andare a cercare altrove', async () => {
    const token = await tokenFirmato(CORPO_BUONO, privata, { alg: 'RS256', kid: 'sconosciuto' });
    expect(await verificaTokenIdentita(token, opzioni)).toBeNull();
  });

  it('corpo modificato dopo la firma → rifiutato', async () => {
    const token = await tokenFirmato(CORPO_BUONO);
    const [testa, , firma] = token.split('.');
    const corpoFalso = b64url(JSON.stringify({ ...CORPO_BUONO, sub: 'un-altro-utente' }));
    expect(await verificaTokenIdentita(`${testa}.${corpoFalso}.${firma}`, opzioni)).toBeNull();
  });

  it('EMESSO PER UN’ALTRA APPLICAZIONE → rifiutato', async () => {
    /*
     * Il controllo che si dimentica più spesso, e il più grave da dimenticare.
     * Questo token è autentico: Google l'ha firmato davvero, per un'altra app.
     * Chi gestisce quell'app raccoglie i token dei propri utenti e li presenta
     * qui: senza il controllo su `aud`, entra come loro.
     */
    const token = await tokenFirmato({ ...CORPO_BUONO, aud: 'app-di-qualcun-altro' });
    expect(await verificaTokenIdentita(token, opzioni)).toBeNull();
  });

  it('emittente sbagliato → rifiutato, e il confronto è esatto', async () => {
    for (const iss of [
      'https://accounts.google.com.attaccante.example',
      'accounts.google.com.evil',
      'https://appleid.apple.com', // legittimo, ma non per il fornitore chiesto
      '',
    ]) {
      const token = await tokenFirmato({ ...CORPO_BUONO, iss });
      expect(await verificaTokenIdentita(token, opzioni), iss).toBeNull();
    }
  });

  it('scaduto → rifiutato', async () => {
    const token = await tokenFirmato({ ...CORPO_BUONO, exp: ADESSO - 1 });
    expect(await verificaTokenIdentita(token, opzioni)).toBeNull();
  });

  it('senza `sub` → rifiutato', async () => {
    const { sub: _via, ...senzaSub } = CORPO_BUONO;
    expect(await verificaTokenIdentita(await tokenFirmato(senzaSub), opzioni)).toBeNull();
  });

  it('«alg: none» senza firma → rifiutato', async () => {
    /*
     * L'algoritmo non viene mai letto dal token: arriva dalla chiave scaricata
     * dal fornitore. Questo test diventa rosso il giorno in cui qualcuno
     * «generalizza» il codice leggendo `alg` dall'intestazione.
     */
    const falso = `${b64url(JSON.stringify({ alg: 'none', kid: 'k1' }))}.${b64url(
      JSON.stringify(CORPO_BUONO),
    )}.`;
    expect(await verificaTokenIdentita(falso, opzioni)).toBeNull();
  });

  it('token malformati → rifiutati senza esplodere', async () => {
    for (const rifiuto of ['', 'a.b', 'a.b.c.d', '...', 'non-un-token']) {
      expect(await verificaTokenIdentita(rifiuto, opzioni)).toBeNull();
    }
  });

  it('Apple e Google non si accettano a vicenda', async () => {
    // Stesso token, stesso `aud`, ma emittente di Google chiesto come Apple.
    const token = await tokenFirmato(CORPO_BUONO);
    const comeApple = { ...opzioni, provider: 'apple' as const };
    expect(await verificaTokenIdentita(token, comeApple)).toBeNull();
  });
});

describe('due piattaforme, due identificativi', () => {
  /*
   * Google assegna un identificativo diverso per ogni tipo di client: la
   * registrazione «iOS» e quella «Desktop app» sono due cose distinte. Il token
   * emesso da ciascuna porta il PROPRIO identificativo in `aud`, quindi il
   * servizio deve accettarli entrambi — altrimenti l'accesso funziona
   * sull'iPhone e viene rifiutato sul Mac, con un 401 che non spiega niente.
   *
   * Il punto delicato è che accettarne due non deve diventare accettarne
   * qualunque: sono due valori nostri, non una porta aperta.
   */
  const IOS = '111-ios.apps.googleusercontent.com';
  const DESKTOP = '222-desktop.apps.googleusercontent.com';
  const dueClient = { ...opzioni, pubblico: [IOS, DESKTOP] };

  it('accetta il token dell’app iPhone', async () => {
    const token = await tokenFirmato({ ...CORPO_BUONO, aud: IOS });
    expect(await verificaTokenIdentita(token, dueClient)).not.toBeNull();
  });

  it('accetta il token dell’app desktop', async () => {
    const token = await tokenFirmato({ ...CORPO_BUONO, aud: DESKTOP });
    expect(await verificaTokenIdentita(token, dueClient)).not.toBeNull();
  });

  it('continua a rifiutare quello di un’app che non è nostra', async () => {
    const token = await tokenFirmato({ ...CORPO_BUONO, aud: '333-altrui.apps.googleusercontent.com' });
    expect(await verificaTokenIdentita(token, dueClient)).toBeNull();
  });

  it('la stessa persona sui due dispositivi è UN utente solo', async () => {
    /*
     * Conta più di quanto sembri: l'identità si ricava dal `sub`, che Google
     * tiene uguale per la stessa persona su tutte le sue app dello stesso
     * progetto. Se dipendesse da `aud`, lo stesso subacqueo avrebbe due archivi
     * — uno per il telefono e uno per il Mac — e non se ne accorgerebbe subito.
     */
    const daiPhone = await verificaTokenIdentita(await tokenFirmato({ ...CORPO_BUONO, aud: IOS }), dueClient);
    const daMac = await verificaTokenIdentita(
      await tokenFirmato({ ...CORPO_BUONO, aud: DESKTOP }),
      dueClient,
    );
    expect(daiPhone!.sub).toBe(daMac!.sub);
  });
});
