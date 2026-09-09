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

/** Conserva il codice appena rilasciato dal computer. */
export function salvaCodiceAccoppiamento(dispositivo: string, hex: string, dato?: Storage): void {
  ricorda(PREFISSO, dispositivo, hex.trim().toLowerCase(), valido, dato);
}

/**
 * Dimentica il codice di un dispositivo.
 *
 * Serve al caso in cui il computer venga azzerato o accoppiato altrove: da
 * quel momento il codice conservato non vale più, e con una chiave in mano
 * `pelagic_i330r_init` **salta del tutto il ramo del PIN** e fallisce subito.
 * Senza questa via d'uscita lo scarico morirebbe identico a ogni tentativo.
 */
export function dimenticaAccoppiamento(dispositivo: string, dato?: Storage): void {
  dimentica(PREFISSO, dispositivo, dato);
}
