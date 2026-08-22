/**
 * Verificare il token che Apple o Google consegnano all'app.
 *
 * COS'È IL PROBLEMA. L'app riceve dal fornitore un token che dice «questa
 * persona è chi dice di essere». Quel token arriva a noi passando dall'app,
 * cioè da un pezzo di software che gira sul dispositivo di chi lo usa e che
 * quindi può mandarci qualunque cosa. **Fidarsi del contenuto senza verificare
 * la firma significa che chiunque può presentarsi come chiunque.**
 *
 * I CONTROLLI, e cosa succede se ne salti uno. Non sono formalità: ognuno di
 * questi, se manca, è un modo di entrare nell'archivio di un altro.
 *
 * 1. **La firma**, contro la chiave pubblica del fornitore scelta per `kid`.
 *    Senza, il token è un foglietto scritto a mano.
 * 2. **L'algoritmo lo decidiamo noi, non il token.** È la vulnerabilità classica
 *    dei JWT: chi attacca dichiara `alg: none` e toglie la firma, oppure
 *    dichiara HMAC e firma usando come segreto la chiave pubblica, che è
 *    pubblica. Qui l'algoritmo viene dalla chiave che abbiamo scaricato dal
 *    fornitore, e il campo `alg` del token non viene mai letto per decidere.
 * 3. **`iss`**, l'emittente, confrontato per uguaglianza esatta. Un confronto
 *    per «contiene» accetterebbe `https://appleid.apple.com.attaccante.example`.
 * 4. **`aud`**, il destinatario: deve essere la NOSTRA applicazione. È il
 *    controllo che si dimentica più spesso e il più grave da dimenticare. Un
 *    token di Google è valido e firmato benissimo anche quando è stato emesso
 *    per un'altra app: chi gestisce quell'altra app raccoglie i token dei propri
 *    utenti e li presenta qui, e senza questo controllo entra come loro.
 * 5. **`exp`**, la scadenza. Questi token durano minuti: uno scaduto che passa
 *    vuol dire che un token intercettato vale per sempre.
 * 6. **`sub`** presente e non vuoto: è l'unica cosa da cui ricaviamo l'identità.
 *
 * PERCHÉ LE CHIAVI ARRIVANO DA FUORI (`trovaChiave`). Perché scaricarle è
 * l'unica parte che tocca la rete, e tenerla fuori da qui rende la verifica una
 * funzione pura: i test firmano token veri con una coppia di chiavi vera e
 * provano ogni rifiuto, senza inventare finzioni e senza chiamare nessuno.
 */

export interface Identita {
  provider: 'apple' | 'google';
  sub: string;
  email?: string;
}

/** Da dove arrivano le chiavi pubbliche, e chi ha il diritto di emettere. */
export const FORNITORI = {
  apple: {
    jwks: 'https://appleid.apple.com/auth/keys',
    emittenti: ['https://appleid.apple.com'],
  },
  google: {
    jwks: 'https://www.googleapis.com/oauth2/v3/certs',
    // Google ne dichiara storicamente due, entrambi legittimi.
    emittenti: ['https://accounts.google.com', 'accounts.google.com'],
  },
} as const;

export interface OpzioniVerifica {
  provider: 'apple' | 'google';
  /** Gli identificativi della NOSTRA applicazione presso quel fornitore. */
  pubblico: string[];
  /** Restituisce la chiave pubblica per quel `kid`, o `null` se non la conosce. */
  trovaChiave: (kid: string) => Promise<CryptoKey | null>;
  adesso?: number;
}

function byteDaBase64url(testo: string): Uint8Array<ArrayBuffer> {
  const pieno = testo.replace(/-/g, '+').replace(/_/g, '/');
  const grezzo = atob(pieno + '='.repeat((4 - (pieno.length % 4)) % 4));
  // `new ArrayBuffer(...)` esplicito e non `new Uint8Array(n)`: il tipo che
  // `crypto.subtle` accetta è quello appoggiato a un ArrayBuffer vero, non a un
  // buffer che potrebbe essere condiviso fra thread.
  const out = new Uint8Array(new ArrayBuffer(grezzo.length));
  for (let i = 0; i < grezzo.length; i++) out[i] = grezzo.charCodeAt(i);
  return out;
}

/**
 * Verifica il token e restituisce l'identità, oppure `null`.
 *
 * Come per la sessione: un solo `null` per tutti i motivi di rifiuto. Chi chiama
 * non deve poter distinguere «firma sbagliata» da «destinatario sbagliato», e
 * chi prova a indovinare non deve ricevere indizi su quanto si sta avvicinando.
 */
export async function verificaTokenIdentita(
  token: string,
  opzioni: OpzioniVerifica,
): Promise<Identita | null> {
  const adesso = opzioni.adesso ?? Math.floor(Date.now() / 1000);
  const pezzi = token.split('.');
  if (pezzi.length !== 3) return null;
  const [intestazione, corpo, firma] = pezzi;

  let kid: string;
  try {
    const testa = JSON.parse(new TextDecoder().decode(byteDaBase64url(intestazione))) as {
      kid?: unknown;
    };
    if (typeof testa.kid !== 'string' || !testa.kid) return null;
    kid = testa.kid;
  } catch {
    return null;
  }

  const chiave = await opzioni.trovaChiave(kid);
  if (!chiave) return null;

  /*
   * L'algoritmo viene dalla chiave scaricata dal fornitore, non dal token. Vedi
   * il punto 2 in testa al file: è la differenza fra una verifica e un teatro.
   */
  let valida = false;
  try {
    valida = await crypto.subtle.verify(
      { name: 'RSASSA-PKCS1-v1_5' },
      chiave,
      byteDaBase64url(firma),
      new TextEncoder().encode(`${intestazione}.${corpo}`),
    );
  } catch {
    return null;
  }
  if (!valida) return null;

  try {
    const dati = JSON.parse(new TextDecoder().decode(byteDaBase64url(corpo))) as {
      iss?: unknown;
      aud?: unknown;
      sub?: unknown;
      exp?: unknown;
      email?: unknown;
    };

    const emittenti: readonly string[] = FORNITORI[opzioni.provider].emittenti;
    if (typeof dati.iss !== 'string' || !emittenti.includes(dati.iss)) return null;

    // `aud` può essere una stringa o un elenco: entrambe le forme sono nello
    // standard, e accettarne una sola significa rifiutare token legittimi.
    const destinatari = Array.isArray(dati.aud) ? dati.aud : [dati.aud];
    if (!destinatari.some((a) => typeof a === 'string' && opzioni.pubblico.includes(a))) return null;

    if (typeof dati.exp !== 'number' || dati.exp <= adesso) return null;
    if (typeof dati.sub !== 'string' || !dati.sub) return null;

    return {
      provider: opzioni.provider,
      sub: dati.sub,
      email: typeof dati.email === 'string' ? dati.email : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Le chiavi pubbliche del fornitore, con una cache in memoria.
 *
 * La cache non è un'ottimizzazione: senza, ogni accesso è una chiamata in più
 * verso Apple o Google, e quelle chiamate hanno limiti. Un'ora è il compromesso
 * consueto — i fornitori ruotano le chiavi molto più lentamente, e un `kid` che
 * non si trova in cache viene comunque riletto subito, quindi una rotazione
 * improvvisa non blocca nessuno.
 */
export function creaArchivioChiavi(fetchImpl: typeof fetch = fetch, durataCacheMs = 3600_000) {
  const cache = new Map<string, { chiavi: Map<string, CryptoKey>; scade: number }>();

  return async function trovaChiave(
    provider: 'apple' | 'google',
    kid: string,
    adesso = Date.now(),
  ): Promise<CryptoKey | null> {
    const salvate = cache.get(provider);
    if (salvate && salvate.scade > adesso && salvate.chiavi.has(kid)) {
      return salvate.chiavi.get(kid)!;
    }

    const risposta = await fetchImpl(FORNITORI[provider].jwks);
    if (!risposta.ok) return null;
    const { keys } = (await risposta.json()) as { keys?: unknown[] };
    if (!Array.isArray(keys)) return null;

    const chiavi = new Map<string, CryptoKey>();
    for (const jwk of keys as Record<string, unknown>[]) {
      if (jwk.kty !== 'RSA' || typeof jwk.kid !== 'string') continue;
      try {
        chiavi.set(
          jwk.kid,
          await crypto.subtle.importKey(
            'jwk',
            { kty: 'RSA', n: jwk.n as string, e: jwk.e as string, alg: 'RS256', ext: true },
            { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
            false,
            ['verify'],
          ),
        );
      } catch {
        // Una chiave che non si importa non deve buttare via le altre.
      }
    }
    cache.set(provider, { chiavi, scade: adesso + durataCacheMs });
    return chiavi.get(kid) ?? null;
  };
}
