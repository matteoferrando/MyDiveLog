/**
 * Il banco di prova sulla strada dei driver di casa.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ► PERCHÉ QUESTO FILE È NATO UNA SERA, DOPO UNA PROVA DI CINQUE MINUTI. ◄
 *
 * La registrazione completa dello scambio era stata scritta nel guscio Rust,
 * dove passa libdivecomputer. L'11 settembre 2026, la sera prima di vedere un
 * Mares Puck 4 di persona, il proprietario ha fatto quello che gli avevo
 * chiesto: provarla su un computer che aveva in casa. **Non è successo
 * niente** — perché il suo Aladin non passa da libdivecomputer, passa dai
 * driver scritti in casa, che vivono in TypeScript e non toccano quel guscio.
 *
 * *La spunta c'era, il pulsante no, e nessuno se ne sarebbe accorto fino al
 * giorno dopo davanti all'unico Puck della giornata.* È la prova che vale più
 * di tutte quelle automatiche: cinque minuti su un apparecchio che funziona,
 * fatti prima e non dopo.
 *
 * ► COSA REGISTRA, E COSA NO. ◄ Questo è un involucro attorno al collegamento,
 * quindi vede **la conversazione come la vede il driver**: cosa ha scritto e
 * cosa ha letto. Non vede i confini delle notifiche quando il driver chiede
 * byte invece di pacchetti, perché a quel punto i confini li ha già sciolti il
 * collegamento. Per il flusso grezzo c'è il registratore del guscio Rust, che
 * sta un piano più sotto.
 *
 * *Dirlo qui è metà del valore del file:* chi leggerà una registrazione fra sei
 * mesi deve sapere da quale altezza è stata presa, o ne ricaverà conclusioni
 * sbagliate sui tempi.
 */

import type { BleLink } from './types';

/** Byte in esadecimale, **tutti**: un'anteprima qui rovinerebbe il file. */
function esadecimale(dati: Uint8Array): string {
  return Array.from(dati, (b) => b.toString(16).padStart(2, '0')).join(' ');
}

/**
 * Lo stesso collegamento, che però scrive su un quaderno tutto quello che passa.
 *
 * Formato identico a quello del guscio Rust — `<secondi> <segno> <corpo>` —
 * perché gli strumenti che leggeranno questi file (il rigioco, il confronto con
 * la traccia dell'app ufficiale) devono poterne leggere uno solo. *Due formati
 * per la stessa cosa vuol dire due analizzatori, e il secondo non si scrive
 * mai.*
 */
export function conRegistrazione(link: BleLink, righe: string[]): BleLink {
  const inizio = Date.now();
  const incidi = (segno: string, corpo: string) => {
    const quando = ((Date.now() - inizio) / 1000).toFixed(3).padStart(8);
    righe.push(`${quando} ${segno} ${corpo}`);
  };

  let scritture = 0;
  let letture = 0;

  const registrata: BleLink = {
    get mtu() {
      return link.mtu;
    },
    get mtuMisurato() {
      return link.mtuMisurato;
    },
    async write(dati) {
      scritture += 1;
      incidi('>', `n.${scritture} ${dati.length} byte [${esadecimale(dati)}]`);
      return link.write(dati);
    },
    async writeFrame(dati) {
      scritture += 1;
      incidi('>', `n.${scritture} ${dati.length} byte [${esadecimale(dati)}] (pacchetto intero)`);
      return link.writeFrame(dati);
    },
    async read(n, timeoutMs, signal) {
      const dati = await link.read(n, timeoutMs, signal);
      letture += 1;
      incidi('<', `n.${letture} ${dati.length} byte [${esadecimale(dati)}]`);
      return dati;
    },
    async readFrame(timeoutMs, signal) {
      const dati = await link.readFrame(timeoutMs, signal);
      letture += 1;
      incidi('<', `n.${letture} ${dati.length} byte [${esadecimale(dati)}] (pacchetto intero)`);
      return dati;
    },
    drain() {
      const dati = link.drain();
      // Lo svuotamento si annota solo se ha preso qualcosa: una riga «0 byte»
      // per ogni giro a vuoto seppellirebbe il file sotto il rumore.
      if (dati.length > 0) incidi('<', `svuotato ${dati.length} byte [${esadecimale(dati)}]`);
      return dati;
    },
    describe: link.describe ? () => link.describe!() : undefined,
    async close() {
      incidi('!', 'collegamento chiuso');
      return link.close();
    },
  };
  return registrata;
}
