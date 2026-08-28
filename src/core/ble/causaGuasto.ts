/**
 * Perché una ricerca Bluetooth è fallita, letto dal messaggio d'errore.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ► IL DIFETTO CHE HA FATTO NASCERE QUESTO FILE, E CHI L'HA TROVATO. ◄
 *
 * Il 28 agosto 2026, il PRIMO utente esterno di MyDiveLog ha installato l'app
 * sull'iPhone, ha premuto «Cerca il computer», e ha letto questo:
 *
 *     La ricerca non è partita: Btleplug error: Permission denied
 *
 * Due cose sbagliate in una riga sola, e la seconda è peggio della prima.
 *
 * ► LA PRIMA: il nome di una libreria in faccia a una persona. ◄ «Btleplug» non
 * vuol dire niente per nessuno tranne noi, ed è in inglese dentro un'app
 * italiana. Chi legge non ha imparato niente e non sa cosa fare: sembra che
 * l'applicazione si sia rotta. Il guscio del messaggio esisteva già — «La
 * ricerca non è partita: » — e ci appendeva l'errore grezzo, che è il modo più
 * economico di scrivere un errore e il più caro da leggere.
 *
 * ► LA SECONDA: il codice affermava che questo errore non potesse esistere. ◄
 * Sopra `available()` in `storage/ble.ts`, e sopra il riquadro dei dodici
 * secondi in `BleDownload.tsx`, c'era scritto — dedotto leggendo il sorgente
 * del plugin, e per la sua parte è vero — che `checkPermissions` su Apple non
 * controlla niente e che l'enum dell'adattatore non ha un valore «non
 * autorizzato». Da lì si era concluso che **chi tocca «Non consentire» non
 * riceve nessun errore**, e su quella conclusione è stato costruito il ripiego
 * dei dodici secondi: non potendo distinguere, si elencano le cause possibili.
 *
 * La conclusione era falsa. Il permesso negato NON è silenzioso: non lo dicono
 * né `getAdapterState` né `checkPermissions`, lo dice `scan()`, che lancia. Il
 * ragionamento guardava i due posti dove l'informazione non c'era e non il
 * terzo dove c'era — e nessuno poteva accorgersene, perché per vederlo serve un
 * iPhone su cui QUALCUNO ABBIA DETTO DI NO, e su tutti i telefoni di casa era
 * stato detto di sì una volta per sempre.
 *
 * *È il difetto che nessun test poteva prendere e nessuna rilettura poteva
 * vedere: per trovarlo serviva una persona che non sapeva cosa stava per fare.*
 *
 * ────────────────────────────────────────────────────────────────────────────
 * PERCHÉ SI LEGGE UNA STRINGA, che è una cosa fragile e va detto.
 *
 * Classificare un errore dal testo del suo messaggio è una tecnica che si rompe
 * quando la libreria a monte cambia una parola. L'alternativa — un errore
 * tipizzato che arrivi dal Rust — vorrebbe dire modificare il plugin, cioè
 * dipendere da un fork. Il compromesso è questo, e regge perché il caso che
 * conta è UNO solo e le sue parole sono quelle del sistema operativo, non del
 * plugin: `Permission denied` viene da CoreBluetooth.
 *
 * Il giorno che si rompe, il modo in cui si rompe è benigno: si ricade su
 * `unsupported`, cioè sul comportamento di prima. Non si perde niente che non
 * fosse già perso.
 */
import type { BleUnavailable } from './types';

/**
 * I nomi che non devono comparire DENTRO UN MESSAGGIO D'ERRORE.
 *
 * Non è «la lista delle dipendenze», ed è importante che non lo sia — la prima
 * versione lo era, e un test pretendeva che coprisse tutto `package.json`.
 * Sbagliato per due motivi che si sono visti subito:
 *
 *  - **alcune dipendenze si chiamano come cose vere.** `@garmin/fitsdk` porta
 *    dentro «garmin», che nel nostro catalogo è una MARCA di computer subacquei
 *    e deve poter comparire a schermo. Una lista derivata dalle dipendenze
 *    avrebbe imposto di nascondere il nome di un prodotto che nominiamo apposta;
 *  - **alcuni nomi sono troppo corti per cercarli dentro le parole.** «rust»
 *    c'era, e faceva scattare l'allarme su *thrust* dentro una frase inglese del
 *    piano di miglioramento. Una guardia che si accende per niente insegna a non
 *    fidarsi di lei.
 *
 * Quindi la lista è quella dei **livelli sotto l'interfaccia**, i soli i cui
 * errori risalgono fin qui: il plugin Bluetooth, il guscio nativo, i due motori
 * d'archivio, la libreria dei computer subacquei. Chi legge uno di questi nomi
 * in un errore non impara niente e non sa cosa fare.
 *
 * *Nota che `libdivecomputer` e `sqlite` sono in elenco per gli ERRORI, e nel
 * dizionario compaiono lo stesso di proposito: uno nell'attribuzione LGPL e
 * nell'etichetta «mai provato su questo modello», l'altro nella riga che dice
 * dove stanno i dati. Sono scelte, e un test le difende come tali.*
 */
export const NOMI_INTERNI = [
  'btleplug',
  'blec',
  'tauri',
  'libsql',
  'libdivecomputer',
  'sqlite',
  'wry',
  'serde',
] as const;

/**
 * Che cosa è andato storto, in una delle tre categorie che hanno risposte
 * diverse. Chi non rientra in nessuna resta `unsupported`, che è il caso
 * «non lo so», non un caso a sé.
 */
export function causaDelGuasto(err: unknown): BleUnavailable['reason'] {
  const testo = (err instanceof Error ? err.message : String(err)).toLowerCase();
  // Le parole sono quelle di CoreBluetooth e di Android, non del plugin.
  if (/permission denied|not authori[sz]ed|unauthori[sz]ed|denied/.test(testo)) return 'denied';
  if (/powered ?off|adapter (is )?off|bluetooth is off|turned off/.test(testo)) return 'off';
  return 'unsupported';
}

/**
 * Il dettaglio tecnico ripulito, oppure NIENTE.
 *
 * Restituire la stringa vuota è deliberato, ed è la parte che decide: quando il
 * dettaglio non si può ripulire, l'interfaccia mostra solo la frase umana
 * invece di mostrarla seguita da qualcosa di incomprensibile. **Meglio dire una
 * cosa sola e chiara che due, di cui una spaventa.**
 *
 * Il prefisso che si toglie è la forma con cui le librerie Rust presentano i
 * propri errori — «Btleplug error: …», «Sql error: …» — e sotto c'è quasi
 * sempre il messaggio vero del sistema operativo, che invece serve.
 */
export function dettaglioLeggibile(err: unknown): string {
  const grezzo = (err instanceof Error ? err.message : String(err)).trim();
  const senzaPrefisso = grezzo.replace(/^[A-Za-z][\w-]* error:\s*/i, '').trim();
  if (senzaPrefisso === '') return '';
  const minuscolo = senzaPrefisso.toLowerCase();
  return NOMI_INTERNI.some((nome) => minuscolo.includes(nome)) ? '' : senzaPrefisso;
}

/**
 * La frase umana, e il dettaglio tecnico SOLO SE si può leggere.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ► PERCHÉ QUESTA FUNZIONE È NATA DOPO, E DA UN CONTEGGIO. ◄
 *
 * `causaDelGuasto` e `dettaglioLeggibile` esistevano dal 28 agosto 2026 e
 * facevano metà del lavoro bene. Il guaio era l'altra metà: **avevano un solo
 * chiamante**. Il difetto del primo utente esterno era stato letto come «una
 * riga sbagliata in `BleDownload`», e corretto lì. Rileggendo l'applicazione
 * con l'occhio giusto, di quella riga ce n'erano dodici — l'archivio che non si
 * apre, il PDF che non si scrive, il servizio di accesso irraggiungibile,
 * l'import che fallisce, il file di Shearwater Cloud illeggibile. Tutte con la
 * stessa forma: un guscio italiano e in coda `err.message`.
 *
 * ► LA FORMA È QUELLA DI `describeSyncError`, che ce l'aveva già giusta. ◄ In
 * `sync/turso.ts` il consiglio viene prima e il tecnico dopo, fra parentesi:
 * chi ha fretta legge la prima metà e sa cosa fare, chi deve segnalare un
 * guasto copia la seconda. L'ordine inverso — quello che l'app faceva quasi
 * ovunque — obbliga tutti a leggere una riga in inglese prima di arrivare
 * all'unica utile.
 *
 * ► ED È UNA FUNZIONE E NON UN'ABITUDINE. ◄ Il ternario
 * `dettaglio === '' ? frase : frase + dettaglio` era da scrivere dodici volte,
 * e dodici volte è una volta di troppo perché qualcuno lo dimentichi. Chi
 * chiama non deve ricordarsi né di ripulire né di controllare se è rimasto
 * qualcosa: passa la frase che ha scritto per una persona, e riceve indietro
 * l'unica cosa che si può mostrare.
 *
 * Le parentesi sono il segnale che quello che c'è dentro non è per tutti: si
 * possono saltare senza perdere niente di azionabile, perché tutto ciò che si
 * può fare sta già nella frase davanti.
 */
export function conDettaglio(frase: string, err: unknown): string {
  const dettaglio = dettaglioLeggibile(err);
  return dettaglio === '' ? frase : `${frase} (${dettaglio})`;
}
