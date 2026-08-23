/**
 * L'aggiornamento dell'applicazione del Mac.
 *
 * ► PERCHÉ ESISTE. ◄ Fino a ieri una versione nuova voleva dire: accorgersene,
 * andare sul sito, scaricare un `.dmg`, trascinare l'applicazione, sostituire
 * quella vecchia. Cinque passaggi che nessuno fa, e il risultato è che la gente
 * resta ferma alla versione con cui ha cominciato — comprese le correzioni che
 * riguardano proprio lei. Su iPhone il problema non si pone: là c'è l'App
 * Store, e un'applicazione che si aggiornasse da sé verrebbe rifiutata alla
 * revisione.
 *
 * ► COSA NON FA, ed è una scelta. ◄ Non scarica niente da solo. Cerca — che è
 * una richiesta di rete piccola e senza conseguenze — e se trova qualcosa lo
 * DICE. Scaricare e installare parte da un pulsante, come la sincronizzazione:
 * in questo programma non parte niente che non sia stato chiesto. Un
 * aggiornamento che si installa da sé, per giunta, sostituisce il programma
 * sotto le mani di chi lo sta usando.
 *
 * ► SU COSA POGGIA LA SICUREZZA. ◄ Su una firma. Ogni pacchetto è firmato con
 * una chiave privata che vive solo sul Mac di chi pubblica, e nell'applicazione
 * finisce solo la metà pubblica (in `tauri.conf.json`). Senza quella firma il
 * plugin rifiuta l'archivio e non lo installa: chi riuscisse a mettersi in mezzo
 * fra l'app e GitHub potrebbe al massimo far fallire il controllo, non far
 * installare un programma suo. È la ragione per cui l'aggiornamento automatico
 * o si fa così o non si fa.
 *
 * Questo file NON importa il plugin in cima: lo carica con `import()` solo
 * quando serve. Nel browser e su iPhone quel modulo non esiste, e importarlo in
 * cima farebbe fallire il caricamento della pagina invece di mancare una
 * funzione.
 */

import { comeSta, type Traduci } from '../core/traduci';
import { inApp, suIOS } from '../piattaforma';

/** Vero solo dentro l'applicazione del Mac: l'unico posto dove ha senso. */
export function suMac(): boolean {
  return inApp() && !suIOS();
}

/**
 * Dove siamo nel giro. Uno stato solo, esplicito, invece di tre booleani che
 * possono contraddirsi.
 */
export type StatoAggiornamento =
  | { fase: 'fermo' }
  | { fase: 'cerco' }
  | { fase: 'nessuno' }
  | { fase: 'trovato'; versione: string; note?: string }
  | { fase: 'scarico'; fatti: number; totali?: number }
  | { fase: 'installato' }
  | { fase: 'errore'; messaggio: string };

/**
 * La percentuale scaricata, quando si può saperla.
 *
 * `undefined` e non zero quando la lunghezza totale manca: GitHub non sempre
 * manda `Content-Length`, e una barra ferma sullo zero mentre il file arriva
 * racconta una bugia. Meglio dire «sto scaricando» senza numero.
 */
export function percentualeScaricata(fatti: number, totali?: number): number | undefined {
  if (!totali || totali <= 0) return undefined;
  return Math.min(100, Math.round((fatti / totali) * 100));
}

/** La frase da mostrare mentre scarica, con o senza percentuale. */
export function descriviScaricamento(
  fatti: number,
  totali: number | undefined,
  t: Traduci = comeSta,
): string {
  const p = percentualeScaricata(fatti, totali);
  return p === undefined ? t('Scarico l’aggiornamento…') : `${t('Scarico l’aggiornamento…')} ${p}%`;
}

/**
 * Cerca una versione nuova.
 *
 * Restituisce `null` quando non c'è niente — e anche quando non siamo sul Mac,
 * perché chiedere non avrebbe senso. Gli errori NON vengono nascosti: chi
 * chiede esplicitamente «cerca aggiornamenti» ha diritto di sapere che la rete
 * non c'era, invece di leggere «sei aggiornato» e crederci.
 */
export async function cercaAggiornamento(): Promise<{ versione: string; note?: string } | null> {
  if (!suMac()) return null;
  const { check } = await import('@tauri-apps/plugin-updater');
  const trovato = await check();
  if (!trovato) return null;
  return { versione: trovato.version, note: trovato.body };
}

/**
 * Scarica, installa e riavvia.
 *
 * Il riavvio è parte dell'operazione, non un consiglio: a metà strada
 * l'applicazione sul disco è già quella nuova mentre in memoria gira ancora la
 * vecchia, e lasciarla lì è il modo migliore per farsi raccontare difetti che
 * non esistono più.
 *
 * `avanzamento` viene chiamato con i byte scaricati e, quando si sa, il totale.
 */
export async function installaAggiornamento(
  avanzamento: (fatti: number, totali?: number) => void,
): Promise<void> {
  if (!suMac()) throw new Error('Gli aggiornamenti automatici esistono solo nell’applicazione del Mac.');

  const { check } = await import('@tauri-apps/plugin-updater');
  const trovato = await check();
  if (!trovato) return;

  let fatti = 0;
  let totali: number | undefined;

  await trovato.downloadAndInstall((evento) => {
    if (evento.event === 'Started') {
      totali = evento.data.contentLength;
      fatti = 0;
      avanzamento(0, totali);
    } else if (evento.event === 'Progress') {
      fatti += evento.data.chunkLength;
      avanzamento(fatti, totali);
    } else if (evento.event === 'Finished') {
      avanzamento(totali ?? fatti, totali);
    }
  });

  const { relaunch } = await import('@tauri-apps/plugin-process');
  await relaunch();
}
