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

/** Il prefisso delle chiavi. Cambiarlo dimentica tutti i codici conservati. */
const PREFISSO = 'mydivelog.accoppiamento.';

/**
 * L'archivio dove finiscono i codici. Iniettabile per le prove.
 *
 * `Storage` è l'interfaccia del `localStorage`, e passarne uno finto è l'unico
 * modo di provare questo file senza un browser. Il valore per difetto si legge
 * al momento della chiamata e non all'importazione: in un ambiente senza
 * `localStorage` — il guscio di una prova, un vecchio browser in modalità
 * privata — leggerlo all'importazione farebbe fallire il caricamento del
 * modulo, cioè romperebbe l'applicazione intera per una comodità.
 */
function archivio(dato?: Storage): Storage | undefined {
  if (dato) return dato;
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    // Alcuni browser lanciano al solo accesso quando i dati dei siti sono
    // bloccati. Nessun codice conservato, e nessun guasto.
    return undefined;
  }
}

/** La forma valida: coppie di cifre esadecimali, e niente altro. */
const ESADECIMALE = /^[0-9a-f]+$/;

/**
 * Il codice conservato per questo dispositivo, se c'è ed è leggibile.
 *
 * Un valore malformato vale come assente: si riparte dal PIN, che funziona
 * sempre. Restituirlo a metà darebbe al computer una chiave inventata, e il
 * computer chiuderebbe il collegamento senza dire perché.
 */
export function codiceAccoppiamento(dispositivo: string, dato?: Storage): string | undefined {
  const dove = archivio(dato);
  if (!dove || dispositivo === '') return undefined;
  let grezzo: string | null = null;
  try {
    grezzo = dove.getItem(PREFISSO + dispositivo);
  } catch {
    return undefined;
  }
  if (grezzo === null) return undefined;
  const pulito = grezzo.trim().toLowerCase();
  if (pulito.length === 0 || pulito.length % 2 !== 0 || !ESADECIMALE.test(pulito)) {
    return undefined;
  }
  return pulito;
}

/**
 * Conserva il codice appena rilasciato dal computer.
 *
 * Un guasto della scrittura — spazio finito, dati dei siti bloccati — non si
 * racconta a nessuno: la conseguenza è che al prossimo scarico verrà chiesto
 * di nuovo il PIN, che è un fastidio e non un guasto, e un riquadro rosso a
 * scarico riuscito costerebbe più della verità che nasconde.
 */
export function salvaCodiceAccoppiamento(dispositivo: string, hex: string, dato?: Storage): void {
  const dove = archivio(dato);
  const pulito = hex.trim().toLowerCase();
  if (!dove || dispositivo === '') return;
  if (pulito.length === 0 || pulito.length % 2 !== 0 || !ESADECIMALE.test(pulito)) return;
  // Tutti zeri è ciò che libdivecomputer legge come «non c'è»: conservarlo
  // vorrebbe dire ripresentarlo per poi vederselo rifiutare, ogni volta.
  if (/^0+$/.test(pulito)) return;
  try {
    dove.setItem(PREFISSO + dispositivo, pulito);
  } catch {
    // Vedi sopra.
  }
}

/**
 * Dimentica il codice di un dispositivo.
 *
 * Serve al caso in cui il computer venga azzerato o accoppiato altrove: da
 * quel momento il codice conservato non vale più, e il sintomo — un
 * collegamento che si chiude senza spiegazioni — non si può distinguere da un
 * guasto. È la via d'uscita, e per ora la usa solo chi ripara.
 */
export function dimenticaAccoppiamento(dispositivo: string, dato?: Storage): void {
  const dove = archivio(dato);
  if (!dove || dispositivo === '') return;
  try {
    dove.removeItem(PREFISSO + dispositivo);
  } catch {
    // Vedi sopra.
  }
}
