/**
 * Portare un file fuori dall'applicazione.
 *
 * IL DIFETTO CHE QUESTO FILE CHIUDE. Ogni esportazione — backup JSON, UDDF,
 * byte grezzi del computer subacqueo, foglio del piano — aveva la sua copia
 * privata dello stesso helper: crea un `Blob`, crea un `<a download>`, clicca,
 * revoca l'URL. Sul desktop funziona. Dentro la WKWebView di iOS quel click
 * **non scarica niente e non lancia nessun errore**: non c'è modo, dal lato
 * JavaScript, di accorgersi che è andata male.
 *
 * La conseguenza non era un file mancante, era una BUGIA: `download()` non può
 * fallire, quindi il `try` che lo avvolgeva arrivava sempre in fondo e
 * l'interfaccia scriveva «Backup scritto: 104 immersioni». Su una funzione che
 * esiste per rimettere in piedi l'archivio dopo un disastro, una falsa conferma
 * è il difetto peggiore che ci possa essere: costruisce fiducia in una copia
 * che non esiste.
 *
 * COSA FA ADESSO. Una funzione sola, che RESTITUISCE dove è finito il file
 * oppure lancia. Su iOS scrive nella cartella Documenti dell'applicazione, che
 * grazie a `UIFileSharingEnabled` e `LSSupportsOpeningDocumentsInPlace`
 * (`src-tauri/Info.ios.plist`) compare nell'app File sotto «Sul mio iPhone →
 * MyDiveLog»: da lì il file si sposta, si condivide, si manda per email. Altrove
 * resta il download del browser, che è la strada giusta e funziona.
 *
 * Il valore di ritorno serve al chiamante per dire dov'è finito il file, che su
 * iPhone non è ovvio: senza quella frase l'utente cerca in Download e non trova
 * niente.
 */

import { inApp, suIOS } from '../piattaforma';

export interface EsitoEsportazione {
  /** Frase pronta da mostrare: «nell'app File, cartella MyDiveLog» o «nei Download». */
  dove: string;
  /** Percorso completo, quando esiste. Solo per il diario tecnico. */
  percorso?: string;
}

/**
 * Scrive un file di testo fuori dall'applicazione.
 *
 * @throws se la scrittura fallisce. È il punto di tutto: prima non poteva
 * fallire, e quindi non poteva nemmeno riuscire in modo verificabile.
 */
export async function esporta(
  nome: string,
  contenuto: string,
  tipo = 'application/xml;charset=utf-8',
): Promise<EsitoEsportazione> {
  if (inApp() && suIOS()) {
    const { invoke } = await import('@tauri-apps/api/core');
    const percorso = await invoke<string>('esporta_nei_documenti', { nome, contenuto });
    return { dove: 'nell’app File, in «Sul mio iPhone → MyDiveLog»', percorso };
  }

  const blob = new Blob([contenuto], { type: tipo });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { dove: 'dove il sistema mette i download' };
}
