/**
 * Il pacchetto Linux: le due cose che si possono rompere in silenzio.
 *
 * ► L'AGGIORNATORE SI SPEGNE CON DUE INTERRUTTORI, E VANNO MOSSI INSIEME. ◄
 *
 * Su Linux l'aggiornatore di Tauri funziona con l'AppImage, non col `.deb`.
 * Lasciandolo acceso il pulsante «cerca aggiornamenti» risponde
 * «None of the fallback platforms ["linux-x86_64"] were found in the response
 * `platforms` object» — **misurato facendo girare l'applicazione, non
 * supposto**. Sono due difetti in una riga: un pulsante che non fa niente (già
 * chiuso una volta, per il Mac App Store) e **il messaggio grezzo di una
 * libreria dato a una persona**, che è la stessa specie di guasto che il primo
 * utente esterno ha incontrato col Bluetooth il 28 agosto.
 *
 * I due interruttori: la feature Rust `senza-aggiornamenti`, che toglie il
 * plugin dalla compilazione, e `createUpdaterArtifacts: false` in
 * `tauri.linux.conf.json`, che toglie l'artefatto dal confezionamento. *Muoverne
 * uno solo non dà un pacchetto sbagliato: non dà nessun pacchetto* — ed è una
 * fortuna, ma vale solo finché sono tutti e due dove devono stare.
 *
 * ► E IL PACCHETTO È UN `.deb`, NON UN AppImage. ◄ È quello che la gente si
 * aspetta di scaricare, e senza aggiornatore l'AppImage non porterebbe nessun
 * vantaggio in cambio del suo peso. Se un giorno l'aggiornatore su Linux si
 * volesse davvero, il formato dovrebbe cambiare **prima**.
 *
 * Perché prove di testo e non di disegno: quello che si rompe qui — un
 * interruttore mosso, un formato cambiato, un nome di file che perde la sua
 * stabilità — sta tutto scritto in due file, e una guardia che gira in
 * millisecondi vale più di una che vuole un runner Ubuntu. **La build vera è
 * stata fatta e l'applicazione fatta partire** il 31 agosto 2026: finestra
 * disegnata, click che rispondono, archivio SQLite con le sue quattro tabelle,
 * `dc_custom_open` dentro il binario. Il Bluetooth no: vuole un adattatore.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const RADICE = fileURLToPath(new URL('..', import.meta.url));
const leggi = (p: string) => readFileSync(RADICE + p, 'utf8');

describe('la configurazione Linux', () => {
  const conf = JSON.parse(leggi('src-tauri/tauri.linux.conf.json')) as {
    bundle?: { targets?: string[]; createUpdaterArtifacts?: boolean };
  };

  it('non produce gli artefatti dell’aggiornamento', () => {
    expect(
      conf.bundle?.createUpdaterArtifacts,
      'con questo acceso la build muore, o peggio esce un aggiornatore che non può funzionare',
    ).toBe(false);
  });

  it('confeziona un .deb e nient’altro', () => {
    expect(conf.bundle?.targets).toEqual(['deb']);
  });
});

describe('il lavoro Linux del workflow', () => {
  const tutto = leggi('.github/workflows/altre-piattaforme.yml');
  const inizio = tutto.indexOf('\n  linux:\n');
  const wf = inizio < 0 ? '' : tutto.slice(inizio);

  it('esiste, ed è il lavoro Linux e non un altro', () => {
    expect(inizio, 'il lavoro `linux:` non c’è più nel workflow').toBeGreaterThan(-1);
    expect(wf).toContain('tauri build --features senza-aggiornamenti');
    expect(wf, 'il ritaglio si è portato dietro un altro lavoro').not.toContain('shell: pwsh');
  });

  it('spegne l’aggiornatore anche dal lato del programma', () => {
    // L'altro interruttore. Senza, il plugin resta compilato dentro.
    expect(wf).toContain('VITE_SENZA_AGGIORNAMENTI');
    expect(wf).toContain('--features senza-aggiornamenti');
  });

  it('guarda dentro il pacchetto invece di fidarsi del verde', () => {
    expect(wf).toMatch(/name: L'aggiornatore è davvero fuori\?/);
    // Le due cose che cerca: che l'indirizzo dell'aggiornatore NON ci sia, e che
    // libdivecomputer invece ci sia — senza, il catalogo si ridurrebbe ai due
    // driver di casa e nessuno se ne accorgerebbe dal peso del file.
    expect(wf).toContain('releases/latest/download/latest.json');
    expect(wf).toContain('dc_custom_open');
  });

  it('il pacchetto esce col nome stabile che il sito può collegare', () => {
    // Col numero di versione dentro, il collegamento del sito andrebbe
    // cambiato a ogni pubblicazione — o resterebbe a puntare alla versione
    // vecchia senza che nessuno se ne accorga.
    expect(wf).toContain('consegna/MyDiveLog-Linux-amd64.deb');
    expect(wf).toMatch(/name: MyDiveLog-\$\{\{ inputs\.versione \}\}-Linux/);
  });
});
