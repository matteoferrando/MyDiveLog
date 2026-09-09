/**
 * Il metodo di collegamento che ha funzionato, per ogni computer.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ► COS'È UN «METODO», E PERCHÉ CE N'È PIÙ D'UNO. ◄
 *
 * Per parlare con un computer subacqueo via Bluetooth l'applicazione fa cinque
 * scelte: a quale servizio parlare, su quale caratteristica scrivere, quale
 * ascoltare, se scrivere con o senza conferma, e se le notifiche vanno rimesse
 * insieme o consegnate una per volta. Su un modello mai visto, indovinarle
 * tutte e cinque al primo colpo è fortuna.
 *
 * Il guscio Rust le elenca in ordine di probabilità e le prova una alla volta:
 * quando una funziona, la sua **chiave** finisce qui, e dallo scarico dopo si
 * riparte da quella invece che dal primo tentativo. È la differenza fra due
 * tocchi ogni volta e due tocchi una volta sola.
 *
 * ► NESSUNA DI QUESTE CINQUE SCELTE CAMBIA COME I DATI VENGONO LETTI. ◄
 * Cambiano se i byte arrivano, non cosa significano: sbagliarle produce
 * silenzio o un errore, mai un'immersione con dentro numeri sbagliati. Il
 * modello scelto dall'elenco — quello sì che decide il parser — resta una
 * scelta della persona e non entra nel giro.
 *
 * La chiave è opaca di proposito: la compone il Rust
 * (`servizio|scrittura|notifica|modalità|riassemblaggio`) e la confronta il
 * Rust. Qui si controlla solo che abbia la forma giusta, perché una chiave a
 * metà non deve tornare indietro come se fosse buona.
 */

import { dimentica, ricorda, ricordo } from './memoriaComputer';

/** Il prefisso delle chiavi. Cambiarlo dimentica tutti i metodi conservati. */
const PREFISSO = 'mydivelog.metodo.';

/**
 * La forma valida: cinque pezzi separati da una barra verticale, nessuno vuoto.
 *
 * Non si controlla altro — non gli UUID, non i nomi delle modalità — perché il
 * significato dei pezzi lo conosce il guscio Rust, ed è lui a dover dire «non
 * lo riconosco». Controllare qui vorrebbe dire tenere in due posti una regola
 * che cambia in uno solo.
 */
function valido(v: string): boolean {
  const pezzi = v.split('|');
  return pezzi.length === 5 && pezzi.every((p) => p.trim().length > 0);
}

/** Il metodo conservato per questo dispositivo, se c'è ed è leggibile. */
export function metodoConservato(dispositivo: string, dato?: Storage): string | undefined {
  return ricordo(PREFISSO, dispositivo, valido, dato);
}

/** Conserva il metodo che ha appena funzionato. */
export function salvaMetodo(dispositivo: string, chiave: string, dato?: Storage): void {
  ricorda(PREFISSO, dispositivo, chiave, valido, dato);
}

/**
 * Dimentica il metodo conservato.
 *
 * Si chiama quando uno scarico fallisce **con un metodo conservato in mano**:
 * quel metodo ha funzionato una volta e adesso no, quindi la cosa giusta è
 * ricominciare il giro dal primo invece di riprovare all'infinito quello che
 * ha appena fallito. Il costo, se il guasto era un altro, è un tocco in più.
 */
export function dimenticaMetodo(dispositivo: string, dato?: Storage): void {
  dimentica(PREFISSO, dispositivo, dato);
}
