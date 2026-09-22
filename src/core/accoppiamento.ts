/**
 * Il codice di accoppiamento dei computer che chiedono un PIN.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ► CHE COS'È, E PERCHÉ NON È UNA PASSWORD. ◄
 *
 * La famiglia Pelagic (Aqualung i330R, Apeks DSX) non si fa leggere da un
 * apparecchio che non conosce: al primo comando accende sul proprio schermo un
 * numero di sei cifre e vuole che gli venga ripetuto. In cambio rilascia un
 * **codice di accesso** di sedici byte, che vale da lì in avanti: chi lo
 * ripresenta non deve più digitare niente.
 *
 * È una chiave fra QUESTA installazione e QUEL computer — la stessa idea di un
 * legame Bluetooth — e non un segreto della persona. Per questo sta qui e non
 * nel portachiavi di sistema: il portachiavi custodisce cose che valgono
 * altrove (la parola d'accesso di un servizio), questo vale solo davanti a un
 * apparecchio che si ha in mano. Chi copia l'archivio su un altro computer si
 * ritrova a digitare il PIN una volta, ed è la conseguenza giusta.
 *
 * Non si mostra e non entra nel diario tecnico: il diario si allega alle
 * segnalazioni, e una chiave di accoppiamento in un allegato pubblico è una
 * cosa che nessuno si aspetta di aver mandato.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ► PERCHÉ LA CHIAVE È L'IDENTIFICATIVO DI SISTEMA, CHE È INSTABILE. ◄
 *
 * Il numero di serie sarebbe più stabile, ma **arriva dopo**: si legge dal
 * protocollo, e il protocollo non parte finché il codice non è stato dato. Qui
 * l'unica cosa che si conosce prima di collegarsi è l'identificativo che dà il
 * sistema operativo — su Apple un UUID che vale per questa macchina e questa
 * installazione. Se cambia, il codice conservato non si trova più e il PIN
 * viene chiesto un'altra volta: è il comportamento peggiore possibile, ed è
 * comunque un fastidio da sei cifre. L'alternativa sarebbe non conservare
 * niente, che è lo stesso fastidio a ogni scarico.
 */

import { dimentica, ricorda, ricordo } from './memoriaComputer';

/** Il prefisso delle chiavi. Cambiarlo dimentica tutti i codici conservati. */
const PREFISSO = 'mydivelog.accoppiamento.';

/** Il prefisso del conto dei rifiuti. Vedi `contaRifiutoDellaChiave`. */
const PREFISSO_RIFIUTI = 'mydivelog.accoppiamento-rifiuti.';

/**
 * La forma valida: coppie di cifre esadecimali minuscole, e niente altro.
 *
 * Tutti zeri **non** è valido: è esattamente ciò che `pelagic_i330r_init`
 * legge come «non c'è», quindi conservarlo vorrebbe dire ripresentarlo a ogni
 * scarico per poi vederselo scartare.
 */
function valido(v: string): boolean {
  const pulito = v.toLowerCase();
  return pulito.length > 0 && pulito.length % 2 === 0 && /^[0-9a-f]+$/.test(pulito) && !/^0+$/.test(pulito);
}

/**
 * Il codice conservato per questo dispositivo, se c'è ed è leggibile.
 *
 * Un valore malformato vale come assente: si riparte dal PIN, che funziona
 * sempre. Restituirlo a metà darebbe al computer una chiave inventata, e il
 * computer chiuderebbe il collegamento senza dire perché.
 */
export function codiceAccoppiamento(dispositivo: string, dato?: Storage): string | undefined {
  return ricordo(PREFISSO, dispositivo, valido, dato)?.toLowerCase();
}

/**
 * Conserva il codice appena rilasciato dal computer.
 *
 * Una chiave nuova azzera il conto dei rifiuti della vecchia: vedi
 * `contaRifiutoDellaChiave`.
 */
export function salvaCodiceAccoppiamento(dispositivo: string, hex: string, dato?: Storage): void {
  ricorda(PREFISSO, dispositivo, hex.trim().toLowerCase(), valido, dato);
  dimentica(PREFISSO_RIFIUTI, dispositivo, dato);
}

/**
 * Dimentica il codice di un dispositivo.
 *
 * Serve al caso in cui il computer venga azzerato o accoppiato altrove: da
 * quel momento il codice conservato non vale più. Con libdivecomputer 0.9.0 una
 * chiave in mano faceva **saltare del tutto il ramo del PIN**, e lo scarico
 * moriva identico a ogni tentativo; dal ramo principale della libreria (22
 * settembre 2026) un codice rifiutato con la risposta prevista riporta da sé al
 * PIN. Resta il caso di un computer che il codice lo rifiuta in un altro modo —
 * chiudendo, tacendo — ed è per quello che esiste questa via d'uscita. Chi
 * decide quando usarla è `contaRifiutoDellaChiave`, qui sotto.
 */
export function dimenticaAccoppiamento(dispositivo: string, dato?: Storage): void {
  dimentica(PREFISSO, dispositivo, dato);
  dimentica(PREFISSO_RIFIUTI, dispositivo, dato);
}

/** Quante volte di fila una chiave deve non aprire il computer prima di buttarla. */
export const RIFIUTI_PER_DIMENTICARE = 2;

const unNumero = (v: string) => /^[1-9][0-9]?$/.test(v);

/**
 * Conta una volta in cui la chiave conservata è stata presentata e il computer
 * non si è aperto, e dice quante sono di fila.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ► PERCHÉ NON SI BUTTA AL PRIMO RIFIUTO. ◄
 *
 * Il segnale che arriva dal guscio Rust — `chiaveNonAccettata` — è preciso su
 * quello che è successo e muto sul perché: la chiave era stata presentata, il
 * computer non ne ha data una nuova, e non si è aperto. Può voler dire che la
 * chiave non vale più; può voler dire che il collegamento è caduto proprio
 * mentre il computer la stava guardando — ed è successo davvero, all'i330R del
 * 22 settembre 2026, due volte in una sera.
 *
 * Buttarla al primo costa sei cifre a ogni collegamento che perde colpi;
 * tenerla sempre costa, nel caso raro di un computer che la rifiuta in modo
 * imprevisto, un computer che non si scarica più. Due di fila separano i due
 * casi abbastanza bene: una chiave che non vale più non aprirà mai, mentre un
 * collegamento che perde colpi prima o poi passa.
 */
export function contaRifiutoDellaChiave(dispositivo: string, dato?: Storage): number {
  const prima = Number(ricordo(PREFISSO_RIFIUTI, dispositivo, unNumero, dato) ?? '0');
  const adesso = Math.min(prima + 1, 99);
  ricorda(PREFISSO_RIFIUTI, dispositivo, String(adesso), unNumero, dato);
  return adesso;
}

/**
 * La chiave ha aperto il computer, o ne è arrivata una nuova: i rifiuti di
 * prima non erano di fila, e si ricomincia a contare da zero.
 */
export function azzeraRifiutiDellaChiave(dispositivo: string, dato?: Storage): void {
  dimentica(PREFISSO_RIFIUTI, dispositivo, dato);
}
