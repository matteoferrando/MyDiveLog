/**
 * Verifica una firma minisign — quella con cui Tauri firma gli aggiornamenti.
 *
 * ► PERCHÉ ESISTE QUESTO FILE. ◄ Il manifesto `latest.json` pubblicato a ogni
 * uscita contiene, per ogni piattaforma, l'indirizzo di un pacchetto e la firma
 * di quel pacchetto. L'applicazione installata scarica il manifesto, scarica il
 * pacchetto, **verifica la firma con la chiave pubblica murata dentro il
 * binario** e solo allora aggiorna. Se la firma non combacia l'aggiornamento non
 * avviene: non con un errore in faccia a chi lo usa, ma in silenzio, dentro un
 * controllo che nessuno guarda.
 *
 * *È il guasto peggiore di questa famiglia: non si vede da nessuna parte.* Il
 * sito continua a servire il download giusto, la release su GitHub è completa,
 * le impronte dichiarate combaciano — e intanto nessuno degli installati si
 * aggiorna più, per settimane, finché qualcuno non apre l'applicazione e nota
 * che il numero di versione è fermo. Firmare il file sbagliato, firmare con la
 * chiave di prova, ricostruire il pacchetto DOPO averlo firmato: tre modi
 * diversi di arrivarci, e nessuno dei tre accende una spia.
 *
 * La firma si può verificare da fuori con la sola chiave pubblica, che sta in
 * chiaro in `tauri.conf.json`. Quindi si verifica: si scarica il manifesto
 * pubblicato, si scaricano i pacchetti a cui punta, e si rifà esattamente il
 * conto che farà l'applicazione di chi aggiorna. *La chiave privata non serve e
 * non entra mai qui dentro.*
 *
 * ► IL FORMATO, PER CHI LO INCONTRA FRA UN ANNO. ◄ Un file di chiave pubblica
 * minisign ha due righe: un commento e una base64. La base64 sono 42 byte — due
 * di sigla dell'algoritmo, otto di identificativo della chiave, trentadue di
 * chiave Ed25519 vera.
 *
 * Un file di firma ne ha quattro: commento, base64 della firma (due di sigla,
 * otto di identificativo, sessantaquattro di firma Ed25519), commento
 * «fidato», e base64 della firma globale che copre la firma più il commento
 * fidato — è quel quarto pezzo a rendere il commento fidato davvero fidato,
 * altrimenti sarebbe testo che chiunque può riscrivere.
 *
 * La sigla dice **su cosa** è stata fatta la firma: `Ed` sul contenuto del file
 * così com'è, `ED` sul suo BLAKE2b-512. Tauri usa `ED`, ma qui sono gestite
 * tutte e due, perché una guardia scritta contro la versione di oggi dello
 * strumento che sorveglia non protegge da quella di domani.
 */

import { createHash, createPublicKey, verify, type KeyObject } from 'node:crypto';

/** Il prefisso DER che trasforma 32 byte di Ed25519 in una chiave SPKI leggibile da Node. */
const PREFISSO_SPKI = Buffer.from('302a300506032b6570032100', 'hex');

export interface ChiaveMinisign {
  sigla: string;
  identificativo: string;
  chiave: KeyObject;
}

export interface FirmaMinisign {
  sigla: string;
  identificativo: string;
  firma: Buffer;
  commentoFidato: string;
  firmaGlobale?: Buffer;
}

export interface EsitoVerifica {
  valido: boolean;
  motivo: string;
  commentoFidato?: string;
  sigla?: string;
}

/**
 * Scompone il file di chiave pubblica (quello che in `tauri.conf.json` è
 * base64-ato una seconda volta, tutto intero, commento compreso).
 */
export function leggiChiave(pubkeyBase64: string): ChiaveMinisign {
  const testo = Buffer.from(pubkeyBase64, 'base64').toString('utf8').trim();
  const righe = testo.split('\n');
  const blob = Buffer.from((righe[righe.length - 1] ?? '').trim(), 'base64');
  if (blob.length !== 42) throw new Error(`chiave pubblica di ${blob.length} byte invece di 42`);
  return {
    sigla: blob.subarray(0, 2).toString('utf8'),
    identificativo: blob.subarray(2, 10).toString('hex'),
    chiave: createPublicKey({
      key: Buffer.concat([PREFISSO_SPKI, blob.subarray(10)]),
      format: 'der',
      type: 'spki',
    }),
  };
}

/** Scompone il file di firma (che nel manifesto è base64-ato tutto intero). */
export function leggiFirma(firmaBase64: string): FirmaMinisign {
  const testo = Buffer.from(firmaBase64, 'base64').toString('utf8').trim();
  const righe = testo.split('\n');
  if (righe.length < 2) throw new Error('file di firma senza la riga della firma');
  const blob = Buffer.from((righe[1] ?? '').trim(), 'base64');
  if (blob.length !== 74) throw new Error(`firma di ${blob.length} byte invece di 74`);
  const commentoFidato = (righe[2] ?? '').replace(/^trusted comment:\s?/, '');
  const quarta = righe[3]?.trim();
  return {
    sigla: blob.subarray(0, 2).toString('utf8'),
    identificativo: blob.subarray(2, 10).toString('hex'),
    firma: blob.subarray(10),
    commentoFidato,
    // Può mancare nei file scritti a mano; quando c'è, si verifica.
    ...(quarta ? { firmaGlobale: Buffer.from(quarta, 'base64') } : {}),
  };
}

/**
 * Il nome del file citato nel commento fidato, se c'è.
 *
 * Tauri ci scrive `timestamp:… file:NOME`. Serve a prendere il caso in cui la
 * firma è validissima **ma è la firma di un altro pacchetto**: capita quando si
 * rigenera un artefatto e si riusa il manifesto vecchio, e non lo vedrebbe
 * nessun controllo crittografico, perché crittograficamente non c'è niente di
 * storto.
 */
export function fileNelCommento(commentoFidato: string | undefined): string | undefined {
  return /(?:^|\s)file:(\S+)/.exec(commentoFidato ?? '')?.[1];
}

/**
 * Verifica la firma di `contenuto`. Non lancia sui casi previsti: torna sempre
 * un esito con il motivo scritto in italiano, perché chi legge l'uscita dello
 * script deve capire *quale* dei modi di sbagliare è successo, non solo che è
 * successo.
 */
export function verificaFirma({
  pubkey,
  firma: firmaBase64,
  contenuto,
}: {
  pubkey: string;
  firma: string;
  contenuto: Buffer;
}): EsitoVerifica {
  const k = leggiChiave(pubkey);
  const f = leggiFirma(firmaBase64);

  if (f.identificativo !== k.identificativo) {
    return {
      valido: false,
      motivo: `firmato con un'altra chiave: ${f.identificativo} invece di ${k.identificativo}`,
    };
  }

  // `ED` = firma sul BLAKE2b-512 del file; `Ed` = firma sul file così com'è.
  let messaggio: Buffer;
  if (f.sigla === 'ED') messaggio = createHash('blake2b512').update(contenuto).digest();
  else if (f.sigla === 'Ed') messaggio = contenuto;
  else return { valido: false, motivo: `sigla di algoritmo sconosciuta «${f.sigla}»` };

  if (!verify(null, messaggio, k.chiave, f.firma)) {
    return { valido: false, motivo: 'la firma non corrisponde al contenuto del file' };
  }

  if (f.firmaGlobale) {
    const globale = Buffer.concat([f.firma, Buffer.from(f.commentoFidato, 'utf8')]);
    if (!verify(null, globale, k.chiave, f.firmaGlobale)) {
      return { valido: false, motivo: 'il commento fidato non è coperto dalla firma globale' };
    }
  }

  return { valido: true, motivo: 'firma valida', commentoFidato: f.commentoFidato, sigla: f.sigla };
}
