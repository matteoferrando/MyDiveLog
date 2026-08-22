/**
 * PKCE: come si fa un accesso OAuth da un'applicazione che non può tenere segreti.
 *
 * IL PROBLEMA CHE RISOLVE. Nel giro OAuth il browser torna all'applicazione con
 * un «codice», che poi va scambiato con il fornitore per ottenere il token vero.
 * Su un sito web quello scambio è protetto da un segreto che sta sul server. In
 * un'applicazione installata quel segreto non esiste: qualunque cosa scrivi
 * dentro il pacchetto la può leggere chiunque lo apra. E il ritorno passa da un
 * canale che non è nostro — uno schema URL su iPhone, una porta locale sul Mac —
 * dove un altro programma può mettersi in mezzo e intercettare il codice.
 *
 * LA CURA. Prima di cominciare, l'app genera un numero casuale (il
 * «verificatore»), se lo tiene, e manda al fornitore soltanto la sua impronta
 * SHA-256 (la «sfida»). Alla fine, per scambiare il codice, deve presentare il
 * verificatore originale: chi ha rubato il codice non ce l'ha, e dall'impronta
 * non lo può ricavare. Il codice diventa così inutile a chiunque non sia
 * l'applicazione che ha iniziato il giro.
 *
 * PERCHÉ S256 E NON `plain`. Lo standard ammette anche di mandare il
 * verificatore in chiaro come sfida, il che rende l'intero meccanismo
 * decorativo: chi intercetta la richiesta iniziale ha già tutto. Qui si usa solo
 * l'impronta, e il metodo si dichiara.
 */

/** Caratteri ammessi dallo standard per il verificatore: nient'altro. */
const AMMESSI = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';

function base64url(byte: Uint8Array): string {
  let s = '';
  for (const b of byte) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Un valore casuale che non è indovinabile.
 *
 * `crypto.getRandomValues` e non `Math.random()`: il secondo è un generatore
 * pensato per le simulazioni, prevedibile da chi ne osserva qualche uscita, e
 * qui produrrebbe un verificatore ricostruibile — cioè PKCE senza la parte che
 * serve. È lo stesso motivo per cui `state` non può essere un contatore.
 */
export function casuale(lunghezza = 64): string {
  const byte = new Uint8Array(lunghezza);
  crypto.getRandomValues(byte);
  let out = '';
  // Modulo su 64 caratteri con 256 valori possibili: la divisione è esatta,
  // quindi nessun carattere è più probabile di un altro.
  for (const b of byte) out += AMMESSI[b % AMMESSI.length];
  return out;
}

export interface Pkce {
  /** Resta nell'app e non viaggia mai, fino allo scambio finale. */
  verificatore: string;
  /** Viaggia subito, ed è l'impronta del verificatore. */
  sfida: string;
  metodo: 'S256';
}

export async function creaPkce(verificatore = casuale(64)): Promise<Pkce> {
  const impronta = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verificatore));
  return { verificatore, sfida: base64url(new Uint8Array(impronta)), metodo: 'S256' };
}
