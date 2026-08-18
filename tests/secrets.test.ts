/**
 * Dove finiscono le credenziali.
 *
 * Il portachiavi vero non si può provare qui — è il sistema operativo — ma tutto
 * quello che sta INTORNO sì, ed è dove stanno gli errori che contano: la
 * migrazione di un token già in chiaro, l'azzeramento dell'archivio dopo averlo
 * spostato, e il ripiego quando il guscio nativo non risponde. Un ripiego che
 * fallisce in silenzio lascerebbe l'utente convinto di avere il segreto al
 * sicuro mentre è dove era prima, che è il modo peggiore di sbagliare qui.
 */

// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

/** Archivio finto: solo `getSetting`/`setSetting`, come il vero `DiveStore`. */
function fakeArchive(iniziale: Record<string, unknown> = {}) {
  const dati = { ...iniziale };
  return {
    dati,
    getSetting: async <T>(key: string) => dati[key] as T | undefined,
    setSetting: async <T>(key: string, value: T) => {
      dati[key] = value;
    },
  };
}

/**
 * Un finto portachiavi dietro un finto `invoke`.
 *
 * `openSecretStore` importa `@tauri-apps/api/core` in modo dinamico, quindi si
 * intercetta il modulo. È l'unico punto in cui questo test finge qualcosa: tutto
 * il resto — migrazione, azzeramento, ripiego — è il codice vero.
 */
function montaPortachiavi(
  opts: { disponibile: boolean; iniziale?: Record<string, string> } = { disponibile: true },
) {
  const chiavi: Record<string, string> = { ...(opts.iniziale ?? {}) };
  const invoke = vi.fn(async (cmd: string, args: Record<string, string>) => {
    if (!opts.disponibile) throw new Error('comando non registrato');
    if (cmd === 'segreto_leggi') return chiavi[args.chiave] ?? null;
    if (cmd === 'segreto_scrivi') {
      chiavi[args.chiave] = args.valore;
      return null;
    }
    if (cmd === 'segreto_cancella') {
      delete chiavi[args.chiave];
      return null;
    }
    throw new Error(`comando sconosciuto: ${cmd}`);
  });
  vi.doMock('@tauri-apps/api/core', () => ({ invoke }));
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  return { chiavi, invoke };
}

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
});

describe('fuori da Tauri', () => {
  it('ripiega sull’archivio e lo dichiara', async () => {
    // Nessun `__TAURI_INTERNALS__`: siamo in un browser. Un browser non ha un
    // portachiavi che una pagina possa usare, e fingere il contrario sarebbe la
    // bugia più dannosa di tutte perché cambia il comportamento di chi ci crede.
    const { openSecretStore, describePlace } = await import('../src/storage/secrets');
    const archivio = fakeArchive({ sync: { url: 'libsql://x', authToken: 't' } });
    const store = await openSecretStore(archivio);
    expect(store.place).toBe('archive');
    expect(await store.read('sync')).toEqual({ url: 'libsql://x', authToken: 't' });
    expect(describePlace('archive')).toMatch(/in chiaro/i);
    expect(describePlace('keychain')).toMatch(/portachiavi/i);
  });

  it('scrive e cancella nell’archivio', async () => {
    const { openSecretStore } = await import('../src/storage/secrets');
    const archivio = fakeArchive();
    const store = await openSecretStore(archivio);
    await store.write('ai', { apiKey: 'k' });
    expect(archivio.dati.ai).toEqual({ apiKey: 'k' });
    await store.remove('ai');
    expect(archivio.dati.ai).toBeNull();
  });
});

describe('dentro Tauri, col portachiavi', () => {
  it('usa il portachiavi e lo dichiara', async () => {
    montaPortachiavi({ disponibile: true });
    const { openSecretStore } = await import('../src/storage/secrets');
    const store = await openSecretStore(fakeArchive());
    expect(store.place).toBe('keychain');
  });

  it('scrive nel portachiavi e NON nell’archivio', async () => {
    const { chiavi } = montaPortachiavi({ disponibile: true });
    const { openSecretStore } = await import('../src/storage/secrets');
    const archivio = fakeArchive();
    const store = await openSecretStore(archivio);
    await store.write('sync', { url: 'libsql://x', authToken: 'SEGRETO' });
    expect(chiavi.sync).toContain('SEGRETO');
    // L'archivio deve restare pulito, altrimenti tutto il resto non serve.
    expect(JSON.stringify(archivio.dati)).not.toContain('SEGRETO');
  });

  it('migra da sola la credenziale rimasta in chiaro, e la toglie dall’archivio', async () => {
    // È il caso di chi usa l'app da prima di questa modifica. Chiedergli di
    // spostarla a mano significherebbe che non lo fa nessuno, e il token
    // resterebbe in chiaro proprio sui dispositivi che lo usano da più tempo.
    const { chiavi } = montaPortachiavi({ disponibile: true });
    const { openSecretStore } = await import('../src/storage/secrets');
    const archivio = fakeArchive({ sync: { url: 'libsql://vecchio', authToken: 'DAMIGRARE' } });
    const store = await openSecretStore(archivio);

    const letto = await store.read<{ url: string; authToken: string }>('sync');
    expect(letto?.authToken).toBe('DAMIGRARE');
    expect(chiavi.sync).toContain('DAMIGRARE');
    expect(archivio.dati.sync).toBeNull();

    // E la seconda lettura viene dal portachiavi, non ripete la migrazione.
    expect(await store.read('sync')).toEqual(letto);
  });

  it('se l’azzeramento dell’archivio fallisce, si riprova alla lettura dopo', async () => {
    /*
     * La migrazione sono DUE scritture su due sistemi che non condividono una
     * transazione. Se la seconda cade — archivio in sola lettura, quota
     * esaurita, app che si sta spegnendo — il token è nel portachiavi ma è
     * ancora in chiaro nel file, e la lettura successiva trovava il portachiavi
     * pieno e usciva subito: la copia in chiaro restava lì PER SEMPRE, mentre
     * l'interfaccia dichiarava «nel portachiavi di sistema». È la peggiore
     * combinazione possibile — il segreto è esposto e l'utente è convinto del
     * contrario.
     */
    const { chiavi } = montaPortachiavi({ disponibile: true });
    const { openSecretStore } = await import('../src/storage/secrets');
    const archivio = fakeArchive({ sync: { url: 'libsql://x', authToken: 'DAMIGRARE' } });

    // Prima lettura: la scrittura sul portachiavi passa, l'azzeramento no.
    let rompi = true;
    const setVero = archivio.setSetting;
    archivio.setSetting = async <T>(key: string, value: T) => {
      if (rompi) throw new Error('archivio in sola lettura');
      await setVero(key, value);
    };

    const store = await openSecretStore(archivio);
    expect(await store.read('sync')).toMatchObject({ authToken: 'DAMIGRARE' });
    // Il portachiavi ce l'ha…
    expect(chiavi.sync).toContain('DAMIGRARE');
    // …ma l'archivio anche, ed è esattamente la situazione da recuperare.
    expect(JSON.stringify(archivio.dati)).toContain('DAMIGRARE');

    // Seconda lettura, con l'archivio di nuovo scrivibile: deve ripulire.
    rompi = false;
    expect(await store.read('sync')).toMatchObject({ authToken: 'DAMIGRARE' });
    expect(archivio.dati.sync).toBeNull();
  });

  it('una voce che non c’è è «non salvata», non un errore', async () => {
    montaPortachiavi({ disponibile: true });
    const { openSecretStore } = await import('../src/storage/secrets');
    const store = await openSecretStore(fakeArchive());
    expect(await store.read('ai')).toBeUndefined();
  });

  it('un valore illeggibile nel portachiavi non impedisce l’avvio', async () => {
    montaPortachiavi({ disponibile: true, iniziale: { ai: 'questo non è JSON' } });
    const { openSecretStore } = await import('../src/storage/secrets');
    const store = await openSecretStore(fakeArchive());
    expect(await store.read('ai')).toBeUndefined();
  });

  it('cancellare toglie da entrambi i posti', async () => {
    const { chiavi } = montaPortachiavi({ disponibile: true, iniziale: { ai: '{"apiKey":"k"}' } });
    const { openSecretStore } = await import('../src/storage/secrets');
    const archivio = fakeArchive({ ai: { apiKey: 'k' } });
    const store = await openSecretStore(archivio);
    await store.remove('ai');
    expect(chiavi.ai).toBeUndefined();
    expect(archivio.dati.ai).toBeNull();
  });
});

describe('dentro Tauri, senza il comando', () => {
  it('ripiega sull’archivio invece di cadere', async () => {
    // Succede su una build per una piattaforma dove il modulo del portachiavi
    // non è compilato. L'app deve continuare a funzionare e a dirlo: un errore
    // qui impedirebbe di sincronizzare per un motivo che non c'entra niente.
    montaPortachiavi({ disponibile: false });
    const { openSecretStore } = await import('../src/storage/secrets');
    const archivio = fakeArchive({ sync: { url: 'libsql://x', authToken: 't' } });
    const store = await openSecretStore(archivio);
    expect(store.place).toBe('archive');
    expect(await store.read('sync')).toEqual({ url: 'libsql://x', authToken: 't' });
  });
});
