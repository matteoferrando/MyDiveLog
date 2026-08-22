/**
 * Il token di sessione: quello che l'app tiene fra un accesso e l'altro.
 *
 * COSA NON È. Non è il token del database. Quello dura poche ore, vale per un
 * database solo, e se sfugge il danno è limitato nel tempo. Questo invece dura
 * settimane e vale per l'identità: è la cosa che va custodita nel portachiavi
 * del dispositivo e mai scritta in un file.
 *
 * PERCHÉ HMAC E NON UNA COPPIA DI CHIAVI. Un JWT firmato con RSA serve quando
 * chi verifica è diverso da chi firma — è il caso dei token di Apple e Google,
 * che verifichiamo noi con le loro chiavi pubbliche. Qui firma e verifica le fa
 * lo stesso servizio, quindi un segreto condiviso con sé stesso basta, non c'è
 * nessuna chiave da distribuire, e la verifica costa un'operazione invece di
 * una moltiplicazione modulare.
 *
 * PERCHÉ NON UNA LIBRERIA. Tutto quello che serve sta in `crypto.subtle`, che
 * su un Worker c'è. Una dipendenza npm qui significherebbe un `package.json`,
 * un lockfile e un aggiornamento da seguire per centoventi righe di codice che
 * non cambieranno mai.
 *
 * LA REVOCA, dichiarata perché è un limite vero. Un token emesso resta valido
 * fino alla scadenza: non c'è modo di spegnerlo prima. Le due vie d'uscita sono
 * cambiare `SESSION_KEY`, che invalida le sessioni di TUTTI, e cancellare
 * l'account, che porta via il database e quindi rende inutile qualunque token
 * ancora in giro. Per un servizio con questi numeri basta; se un giorno non
 * bastasse, la strada è un contatore per utente da confrontare a ogni uso —
 * che costa una lettura in più per ogni chiamata, ed è la ragione per cui non
 * c'è adesso.
 */

/** Quanto dura una sessione. Trenta giorni: abbastanza da non chiedere l'accesso
 *  ogni settimana, poco da limitare il danno di un dispositivo perso. */
export const DURATA_SESSIONE_S = 30 * 24 * 3600;

export interface Sessione {
  /** L'identificativo interno dell'utente, che non è quello di Apple o Google. */
  utente: string;
  /** Scadenza, in secondi dall'epoca. */
  exp: number;
}

function base64urlDaByte(byte: Uint8Array): string {
  let s = '';
  for (const b of byte) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
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

const testoInByte = (s: string) => new TextEncoder().encode(s);
const byteInTesto = (b: Uint8Array) => new TextDecoder().decode(b);

async function chiave(segreto: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', testoInByte(segreto), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
}

/**
 * Firma una sessione.
 *
 * `adesso` è un parametro e non `Date.now()` per una ragione sola: i test
 * devono poter costruire un token scaduto senza aspettare trenta giorni.
 */
export async function firmaSessione(
  utente: string,
  segreto: string,
  adesso = Math.floor(Date.now() / 1000),
  durataS = DURATA_SESSIONE_S,
): Promise<string> {
  const intestazione = base64urlDaByte(testoInByte(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const corpo = base64urlDaByte(
    testoInByte(JSON.stringify({ sub: utente, exp: adesso + durataS, iat: adesso })),
  );
  const daFirmare = `${intestazione}.${corpo}`;
  const firma = await crypto.subtle.sign('HMAC', await chiave(segreto), testoInByte(daFirmare));
  return `${daFirmare}.${base64urlDaByte(new Uint8Array(firma))}`;
}

/**
 * Verifica una sessione. Restituisce `null` per QUALUNQUE motivo di rifiuto.
 *
 * Un solo `null` e non un errore per caso: chi chiama non deve poter
 * distinguere «firma sbagliata» da «scaduto» da «malformato», perché quella
 * distinzione, restituita a un client, dice a chi prova a indovinare quanto si
 * sta avvicinando. Il registro del Worker può dire di più; la risposta HTTP no.
 */
export async function verificaSessione(
  token: string,
  segreto: string,
  adesso = Math.floor(Date.now() / 1000),
): Promise<Sessione | null> {
  const pezzi = token.split('.');
  if (pezzi.length !== 3) return null;
  const [intestazione, corpo, firma] = pezzi;

  let valida = false;
  try {
    valida = await crypto.subtle.verify(
      'HMAC',
      await chiave(segreto),
      byteDaBase64url(firma),
      testoInByte(`${intestazione}.${corpo}`),
    );
  } catch {
    // Base64 malformato: è un rifiuto come gli altri.
    return null;
  }
  if (!valida) return null;

  try {
    const dati = JSON.parse(byteInTesto(byteDaBase64url(corpo))) as {
      sub?: unknown;
      exp?: unknown;
    };
    if (typeof dati.sub !== 'string' || !dati.sub) return null;
    if (typeof dati.exp !== 'number' || dati.exp <= adesso) return null;
    return { utente: dati.sub, exp: dati.exp };
  } catch {
    return null;
  }
}

/**
 * L'identificativo interno dell'utente, ricavato da provider e identificativo
 * del provider.
 *
 * PERCHÉ NON SI USA L'EMAIL. Perché cambia, e perché con «Nascondi la mia
 * email» di Apple non è nemmeno quella vera. L'unica cosa stabile che i due
 * fornitori garantiscono è il loro `sub`, che è per sempre e per una sola
 * applicazione. Chi accede con Apple e poi con Google è, correttamente, due
 * utenti diversi con due archivi diversi: unirli richiederebbe di credere che
 * due email uguali siano la stessa persona, che è esattamente il modo in cui si
 * regala l'archivio di qualcun altro.
 *
 * Il risultato è un'impronta e non il `sub` in chiaro: finisce nel nome del
 * database, e il nome di un database non deve raccontare chi ci sta dentro.
 */
export async function idUtente(provider: 'apple' | 'google', sub: string): Promise<string> {
  const impronta = await crypto.subtle.digest('SHA-256', testoInByte(`${provider}:${sub}`));
  return base64urlDaByte(new Uint8Array(impronta)).slice(0, 24);
}
