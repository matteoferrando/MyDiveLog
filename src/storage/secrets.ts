/**
 * Dove vivono le credenziali.
 *
 * IL PROBLEMA. Il token di sincronizzazione Turso e la chiave dell'API Anthropic
 * stavano nella tabella delle impostazioni, in chiaro, insieme all'obiettivo del
 * mese e al periodo scelto. Sono l'unica cosa in tutta l'applicazione che, se
 * letta da qualcun altro, fa danno FUORI dall'applicazione: il token apre il
 * database remoto con tutte le immersioni, la chiave API si spende a spese di chi
 * l'ha generata. E l'archivio SQLite è un file: finisce nei backup di sistema,
 * nelle copie su disco esterno, nelle cartelle sincronizzate, e in qualunque
 * copia che qualcuno faccia per sicurezza.
 *
 * LA SOLUZIONE, CON I SUOI LIMITI. Su macOS e iOS le credenziali passano al
 * portachiavi di sistema, che le cifra con le chiavi dell'utente e le rilascia
 * solo a questa applicazione. Non è inviolabile — niente lo è quando chi attacca
 * ha già la tua sessione aperta — ma sposta il segreto da «un file che chiunque
 * legge» a «un archivio che il sistema protegge».
 *
 * SUL WEB NON SI PUÒ. Un browser non ha un portachiavi che una pagina possa
 * usare, e ogni finto equivalente — cifrare con una chiave che sta nella stessa
 * pagina — è teatro: chi legge IndexedDB legge anche la chiave. Quindi lì il
 * segreto resta dov'era, e l'interfaccia lo DICE invece di lasciar credere il
 * contrario. Una promessa di sicurezza non mantenuta è peggio di nessuna
 * promessa, perché cambia il comportamento di chi ci crede.
 */

import { isTauri } from './index';

export type SecretKey = 'sync' | 'ai';

export type SecretPlace = 'keychain' | 'archive';

export interface SecretStore {
  /** Dove finiscono davvero i segreti, su QUESTO dispositivo. */
  place: SecretPlace;
  read<T>(key: SecretKey): Promise<T | undefined>;
  write<T>(key: SecretKey, value: T): Promise<void>;
  remove(key: SecretKey): Promise<void>;
}

/**
 * Chiama un comando del guscio nativo.
 *
 * L'import è dinamico perché `@tauri-apps/api` non esiste nel bundle web, e uno
 * statico lo trascinerebbe dentro rompendo la build del browser.
 */
async function invoke<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  const { invoke: call } = await import('@tauri-apps/api/core');
  return call<T>(cmd, args);
}

/**
 * Il portachiavi è utilizzabile qui?
 *
 * Non basta essere dentro Tauri: i comandi sono compilati solo su Apple, e su
 * un'ipotetica build Linux o Windows la chiamata fallirebbe. Si prova davvero a
 * leggere una chiave innocua invece di dedurlo dalla piattaforma — l'unica
 * verifica che non può mentire è quella che esegue.
 */
export async function keychainAvailable(): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    await invoke<string | null>('segreto_leggi', { chiave: 'prova' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Il negozio dei segreti adatto a questo dispositivo.
 *
 * `archiveStore` è quello che c'era prima, e resta come ripiego: il web non ha
 * alternative, e un guscio nativo che per qualunque ragione non risponde non
 * deve impedire di sincronizzare — deve solo dirlo.
 */
export async function openSecretStore(archive: {
  getSetting<T>(key: string): Promise<T | undefined>;
  setSetting<T>(key: string, value: T): Promise<void>;
}): Promise<SecretStore> {
  const archiveStore: SecretStore = {
    place: 'archive',
    read: (key) => archive.getSetting(key),
    write: (key, value) => archive.setSetting(key, value),
    remove: (key) => archive.setSetting(key, null),
  };

  if (!(await keychainAvailable())) return archiveStore;

  return {
    place: 'keychain',
    async read<T>(key: SecretKey): Promise<T | undefined> {
      const testo = await invoke<string | null>('segreto_leggi', { chiave: key });
      if (testo) {
        try {
          return JSON.parse(testo) as T;
        } catch {
          // Un valore illeggibile nel portachiavi è un valore da riscrivere, non
          // un motivo per non avviare l'applicazione.
          return undefined;
        }
      }
      /*
       * MIGRAZIONE, una volta sola e in silenzio.
       *
       * Chi usa l'app da prima ha il token in chiaro nell'archivio. Se il
       * portachiavi è vuoto ma l'archivio no, il valore si sposta: si scrive nel
       * portachiavi e si AZZERA nell'archivio. Chiedere all'utente di farlo a
       * mano significherebbe che non lo fa nessuno, e la credenziale resterebbe
       * in chiaro per sempre proprio sui dispositivi che la usano da più tempo.
       */
      const vecchio = await archive.getSetting<T>(key);
      if (vecchio) {
        await invoke('segreto_scrivi', { chiave: key, valore: JSON.stringify(vecchio) });
        await archive.setSetting(key, null);
        return vecchio;
      }
      return undefined;
    },
    async write<T>(key: SecretKey, value: T): Promise<void> {
      if (value === null || value === undefined) {
        await invoke('segreto_cancella', { chiave: key });
      } else {
        await invoke('segreto_scrivi', { chiave: key, valore: JSON.stringify(value) });
      }
      // L'archivio si azzera comunque: se una versione precedente ci aveva
      // scritto il segreto, lasciarlo lì vanificherebbe tutto il resto.
      await archive.setSetting(key, null);
    },
    async remove(key: SecretKey): Promise<void> {
      await invoke('segreto_cancella', { chiave: key });
      await archive.setSetting(key, null);
    },
  };
}

/** Come dirlo a chi legge, senza né allarmare né rassicurare a vuoto. */
export function describePlace(place: SecretPlace): string {
  return place === 'keychain'
    ? 'Nel portachiavi di sistema: cifrate dal sistema operativo e leggibili solo da questa applicazione. Non entrano nell’archivio né nei backup.'
    : 'Nell’archivio locale di questo dispositivo, in chiaro. Un browser non ha un portachiavi che una pagina possa usare, e cifrare con una chiave che sta nella stessa pagina sarebbe teatro. Sull’app desktop finiscono invece nel portachiavi di macOS.';
}
