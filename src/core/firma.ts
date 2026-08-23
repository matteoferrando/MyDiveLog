/**
 * La firma della guida, lettera o) del libretto delle immersioni.
 *
 * ► PERCHÉ ESISTE. ◄ L'art. 12, comma 8 della legge 7 maggio 2026, n. 70 chiede
 * tredici dati. Dodici sono testo e numeri, e un'applicazione li tiene meglio di
 * un quaderno. Il tredicesimo è **la firma dell'istruttore o della guida**, e
 * finché quella si poteva raccogliere solo con una penna, il libretto digitale
 * restava incompleto: si stampava, si faceva firmare, si archiviava un foglio.
 * Con la firma sullo schermo il libretto si chiude in digitale — che è
 * esattamente ciò che il testo di legge ammette.
 *
 * ► PERCHÉ TRATTI E NON UN'IMMAGINE. ◄ La strada breve era un PNG dentro un
 * `data:` URL. Costa in tre modi, e nessuno si vede il primo giorno:
 *
 *  - **il peso.** Una firma in PNG sta fra i 10 e i 40 kB; gli stessi tratti in
 *    numeri stanno in due o tre. Su un archivio di duemila immersioni sono
 *    decine di megabyte dentro il documento JSON di ogni record — che poi passa
 *    dalla sincronizzazione, ogni volta.
 *  - **la nitidezza.** Un'immagine catturata a 320 px stampata su carta è una
 *    firma sfocata. I tratti sono coordinate: si ridisegnano alla risoluzione
 *    della stampante, e su un documento che qualcuno controlla la differenza si
 *    vede.
 *  - **la sicurezza.** Un `data:` URL è una stringa che arriva da fuori e che
 *    finisce dentro l'HTML della stampa. Qui dentro ci sono solo NUMERI, e un
 *    numero non ha modo di diventare markup.
 *
 * ► COSA NON È. ◄ Non è una firma elettronica qualificata e non pretende di
 * esserlo: è il segno di una persona, raccolto su un dispositivo, con la data e
 * il nome accanto. È l'equivalente digitale della penna sul foglio, che è quello
 * che la lettera o) chiede — il testo dice «la firma», non «la firma
 * elettronica avanzata». Se un giorno servisse valore probatorio pieno, quella è
 * un'altra cosa e va costruita con altri mezzi.
 */

import { comeSta, type Traduci } from './traduci';

/** Un tratto: la sequenza di punti fra quando il dito appoggia e quando si stacca. */
export type Tratto = { x: number; y: number }[];

export interface FirmaGuida {
  /** I tratti, nello spazio di cattura descritto da `larghezza` e `altezza`. */
  tratti: Tratto[];
  /** Lo spazio in cui i punti sono stati presi: serve a riscalare senza deformare. */
  larghezza: number;
  altezza: number;
  /** Quando è stata raccolta, ISO 8601. */
  quando: string;
  /** Chi ha firmato. Di norma è la guida dell'immersione, e si propone quella. */
  nome?: string;
}

/**
 * Arrotonda a un decimo di pixel e butta i punti che non aggiungono niente.
 *
 * Un dito che si muove su uno schermo produce centinaia di punti al secondo, e
 * la maggior parte distano fra loro meno di quanto qualunque schermo sappia
 * mostrare. Tenerli tutti gonfia il record e non cambia il disegno: si tiene un
 * punto ogni volta che ci si è spostati di almeno mezzo pixel, più sempre
 * l'ultimo, che è quello che chiude il tratto dove la penna si è fermata.
 */
export function semplifica(tratto: Tratto, sogliaPx = 0.5): Tratto {
  if (tratto.length <= 2) return tratto.map(arrotonda);
  const fuori: Tratto = [arrotonda(tratto[0])];
  for (let i = 1; i < tratto.length - 1; i++) {
    const ultimo = fuori[fuori.length - 1];
    const dx = tratto[i].x - ultimo.x;
    const dy = tratto[i].y - ultimo.y;
    if (Math.hypot(dx, dy) >= sogliaPx) fuori.push(arrotonda(tratto[i]));
  }
  fuori.push(arrotonda(tratto[tratto.length - 1]));
  return fuori;
}

function arrotonda(p: { x: number; y: number }): { x: number; y: number } {
  return { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 };
}

/** Vero quando non c'è niente di disegnato: un tocco solo non è una firma. */
export function firmaVuota(firma: FirmaGuida | undefined): boolean {
  if (!firma) return true;
  const punti = firma.tratti.reduce((n, t) => n + t.length, 0);
  return punti < 4;
}

/**
 * I tratti come attributo `d` di una `path` SVG, riscalati nello spazio chiesto.
 *
 * Una `path` sola per tutti i tratti: `M` comincia, `L` continua, e ogni nuovo
 * tratto ricomincia con un altro `M`. Alzare la penna e riappoggiarla è
 * esattamente questo.
 *
 * I numeri escono con `toFixed(1)`: senza, un `x` come 0.30000000000000004
 * finirebbe intero dentro il documento stampato, moltiplicato per ogni punto.
 */
export function firmaPath(firma: FirmaGuida, larghezza: number, altezza: number): string {
  const kx = firma.larghezza > 0 ? larghezza / firma.larghezza : 1;
  const ky = firma.altezza > 0 ? altezza / firma.altezza : 1;
  // Una scala sola per non deformare la grafia: si usa la più stretta delle due.
  const k = Math.min(kx, ky);
  return firma.tratti
    .filter((t) => t.length > 0)
    .map((t) =>
      t.map((p, i) => `${i === 0 ? 'M' : 'L'}${(p.x * k).toFixed(1)},${(p.y * k).toFixed(1)}`).join(' '),
    )
    .join(' ');
}

/**
 * La riga che accompagna la firma: chi e quando.
 *
 * Non sostituisce il disegno — starebbe scritta accanto, come su un foglio si
 * scrive il nome in stampatello sotto la firma. Da sola non varrebbe niente, ed
 * è per questo che chi la mostra deve mostrare anche i tratti.
 */
export function descriviFirma(firma: FirmaGuida, t: Traduci = comeSta): string {
  const quando = new Date(firma.quando);
  const data = Number.isNaN(quando.getTime())
    ? ''
    : `${String(quando.getDate()).padStart(2, '0')}/${String(quando.getMonth() + 1).padStart(2, '0')}/${quando.getFullYear()}`;
  const chi = firma.nome?.trim();
  if (chi && data) return `${t('firmato da')} ${chi} ${t('il')} ${data}`;
  if (chi) return `${t('firmato da')} ${chi}`;
  if (data) return `${t('firmato il')} ${data}`;
  return t('firmato');
}
