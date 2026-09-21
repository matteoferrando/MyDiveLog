// @vitest-environment jsdom
/**
 * «PDF SALVATO» SU UN FILE CHE NON C'ERA — E POI SU UN FILE CHE NESSUNO POTEVA
 * RAGGIUNGERE.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Due segnalazioni dalla stessa persona, a un giorno di distanza, da un Samsung.
 *
 * **15 settembre 2026.** *«premendo "Esporta PDF" compare "PDF salvato dove il
 * sistema mette i download", ma il file non compare né in Download né in
 * Recenti né cercando tutti i PDF.»*
 *
 * Il file non c'era. In cima a `ui/esporta.ts` il difetto è raccontato per
 * intero — dentro una WebView il click su `<a download>` **non scarica niente e
 * non lancia nessun errore**, quindi il `try` arriva in fondo e l'interfaccia
 * annuncia un file che non esiste — e lo raccontava **al passato**, perché era
 * stato chiuso. *Chiuso su iOS soltanto:* la condizione diceva
 * `inApp() && suIOS()`.
 *
 * **16 settembre 2026**, versione nuova, stessa persona:
 *
 *   *«Purtroppo il pdf non si genera ancora anche se è cambiato il messaggio.
 *    Forse perché si genera in una cartella che non risulta visibile se non da
 *    pc.»*
 *
 * Aveva ragione. Il file adesso veniva scritto davvero, ma in
 * `/storage/emulated/0/Android/data/<pacchetto>/files/Documents` — cioè quello
 * che `document_dir()` vale su Android — dove da Android 11 nessun gestore di
 * file può entrare e che la disinstallazione porta via. Avevamo smesso di
 * mentire senza ancora consegnare niente.
 *
 * ► COSA PROVA QUESTO FILE. ◄ Tre cose, e la terza è nata il 16 settembre:
 *
 *  1. che il criterio non è «quale sistema» ma **«c'è una finestra del browser
 *     che sa scaricare?»** — nel browser sì, dentro l'applicazione no, e sui due
 *     computer sì perché là la WebView è collegata al gestore di scarichi;
 *  2. che il tipo del file arriva fino al motore, perché su Android è quello che
 *     apre il selettore sulla cartella giusta;
 *  3. che **annullare non è né riuscire né fallire**, e che nessuno dei dieci
 *     punti che esportano un file può annunciare un successo quando il
 *     selettore si è chiuso senza una scelta.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const piattaforma = { inApp: false, suIOS: false, suAndroid: false };

vi.mock('../src/piattaforma', () => ({
  inApp: () => piattaforma.inApp,
  suIOS: () => piattaforma.suIOS,
  suAndroid: () => piattaforma.suAndroid,
  suComputer: () => piattaforma.inApp && !piattaforma.suIOS && !piattaforma.suAndroid,
}));

/** Le chiamate al motore Rust, e cosa risponde. */
const invocazioni: { comando: string; argomenti: Record<string, unknown> }[] = [];
type RispostaRust = { percorso?: string | null; nome?: string | null; annullato: boolean };
let rispostaRust: RispostaRust | Error = {
  percorso: '/percorso/finto/MyDiveLog.pdf',
  nome: 'MyDiveLog.pdf',
  annullato: false,
};

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (comando: string, argomenti: Record<string, unknown>) => {
    invocazioni.push({ comando, argomenti });
    return rispostaRust instanceof Error ? Promise.reject(rispostaRust) : Promise.resolve(rispostaRust);
  },
}));

import {
  esporta,
  frasePosizione,
  annullata,
  EsportazioneAnnullata,
  NON_SCELTO,
  DOVE_SU_IPHONE,
  DOVE_SCELTO_DA_TE,
  DOVE_NEI_DOWNLOAD,
  DESTINAZIONI,
} from '../src/ui/esporta';

/** Quanti `<a download>` sono stati cliccati: è la strada del browser. */
let click = 0;
let creaElemento: typeof document.createElement;

beforeEach(() => {
  invocazioni.length = 0;
  click = 0;
  rispostaRust = {
    percorso: '/percorso/finto/MyDiveLog.pdf',
    nome: 'MyDiveLog.pdf',
    annullato: false,
  };
  piattaforma.inApp = false;
  piattaforma.suIOS = false;
  piattaforma.suAndroid = false;

  creaElemento = document.createElement.bind(document);
  vi.stubGlobal('URL', { createObjectURL: () => 'blob:finto', revokeObjectURL: () => {} });
  vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    const el = creaElemento(tag) as HTMLElement;
    if (tag === 'a') (el as HTMLAnchorElement).click = () => void click++;
    return el;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('dentro l’applicazione il file si SCRIVE, non si scarica', () => {
  it('su Android passa dal motore Rust e non clicca nessun download', async () => {
    /*
     * ► IL CUORE. ◄ Prima della correzione del 15 settembre, Android cadeva nel
     * ramo del browser: zero invocazioni, un click che non scarica niente, e la
     * frase «PDF salvato dove il sistema mette i download».
     */
    piattaforma.inApp = true;
    piattaforma.suAndroid = true;
    rispostaRust = { percorso: null, nome: 'MyDiveLog.pdf', annullato: false };

    const esito = await esporta('MyDiveLog.pdf', '%PDF-1.4', 'application/pdf');

    expect(invocazioni).toHaveLength(1);
    expect(invocazioni[0]!.comando).toBe('esporta_nei_documenti');
    expect(click, 'nessun click: il download del browser qui non funziona').toBe(0);
    expect(esito.dove).toBe(DOVE_SCELTO_DA_TE);
    expect(esito.dove).not.toBe(DOVE_NEI_DOWNLOAD);
  });

  it('e il TIPO arriva al motore, perché è quello che apre il selettore giusto', () => {
    /*
     * Su Android il tipo non è cosmetico: `ACTION_CREATE_DOCUMENT` lo usa per
     * decidere da che cartella partire e con che estensione salvare. Senza, un
     * PDF finisce come `application/octet-stream` e l'elenco dei PDF del
     * telefono non lo trova — di nuovo un file che c'è e non si vede.
     */
    piattaforma.inApp = true;
    piattaforma.suAndroid = true;
    return esporta('MyDiveLog.pdf', '%PDF-1.4', 'application/pdf').then(() => {
      expect(invocazioni[0]!.argomenti).toMatchObject({
        nome: 'MyDiveLog.pdf',
        tipo: 'application/pdf',
      });
    });
  });

  it('su iPhone passa dallo stesso motore, e il percorso NON si mostra', async () => {
    piattaforma.inApp = true;
    piattaforma.suIOS = true;

    const esito = await esporta('MyDiveLog.pdf', '%PDF-1.4', 'application/pdf');

    expect(invocazioni).toHaveLength(1);
    expect(click).toBe(0);
    expect(esito.dove).toBe(DOVE_SU_IPHONE);
    expect(esito.percorso).toBe('/percorso/finto/MyDiveLog.pdf');
    // `/var/mobile/Containers/Data/Application/…` non aiuta a trovare niente e
    // sembra un errore: là la destinazione ha già un nome che si può seguire.
    expect(frasePosizione(esito, (x) => x)).toBe(DOVE_SU_IPHONE);
  });

  it('e se il motore fallisce, LANCIA invece di annunciare un file', async () => {
    // È il punto di tutto il file: prima non poteva fallire, quindi non poteva
    // nemmeno riuscire in modo verificabile.
    piattaforma.inApp = true;
    piattaforma.suAndroid = true;
    rispostaRust = new Error('scrittura incompleta: sul disco ci sono 0 byte invece di 8');

    await expect(esporta('MyDiveLog.pdf', '%PDF-1.4')).rejects.toThrow('scrittura incompleta');
  });
});

describe('il selettore chiuso senza scegliere', () => {
  it('non restituisce un esito: lancia, e con un tipo suo', async () => {
    /*
     * ► PERCHÉ NON PUÒ RESTITUIRE UN ESITO. ◄ Perché i dieci chiamanti scrivono
     * «PDF salvato {dove}» sul valore di ritorno, senza guardarci dentro.
     * Qualunque esito restituito qui diventa un annuncio di successo: l'unico
     * modo perché la frase non compaia è che il flusso non ci arrivi.
     */
    piattaforma.inApp = true;
    piattaforma.suAndroid = true;
    rispostaRust = { percorso: null, nome: null, annullato: true };

    await expect(esporta('MyDiveLog.pdf', '%PDF-1.4', 'application/pdf')).rejects.toBeInstanceOf(
      EsportazioneAnnullata,
    );
  });

  it('si riconosce con `annullata`, e un guasto vero no', async () => {
    // La metà che impedisce di «semplificare» trattando ogni errore come
    // un'annullata: uno spazio disco esaurito deve restare un guasto.
    expect(annullata(new EsportazioneAnnullata())).toBe(true);
    expect(annullata(new Error('scrittura fallita: No space left on device'))).toBe(false);
    expect(annullata(undefined)).toBe(false);
  });

  it('e sui computer non può capitare: là non c’è nessun selettore', async () => {
    const esito = await esporta('MyDiveLog.pdf', '%PDF-1.4', 'application/pdf');
    expect(esito.dove).toBe(DOVE_NEI_DOWNLOAD);
  });
});

/*
 * ════════════════════════════════════════════════════════════════════════════
 * ► LA GUARDIA CHE GUARDA I CHIAMANTI, E NON SÉ STESSA. ◄
 *
 * `esporta` lancia `EsportazioneAnnullata`, ma un `catch` che non la distingue
 * la mostra come un guasto: «Il PDF non è stato salvato: controlla lo spazio
 * libero e riprova» a chi ha semplicemente cambiato idea. Non è una bugia
 * grossa come annunciare un file che non c'è — è la stessa specie, più
 * piccola: manda a cercare una causa che non esiste.
 *
 * Questa prova legge i file che chiamano `esporta` e pretende che ognuno
 * nomini `annullata`. È una guardia grossolana — non sa se il ramo è messo nel
 * punto giusto — ma prende l'unico errore che si fa davvero: aggiungere
 * un'esportazione nuova e dimenticarsi che il selettore si può chiudere.
 */
describe('nessun chiamante scambia un’annullata per un guasto', () => {
  const RADICE = join(__dirname, '..', 'src');

  function* tuttiIFile(dir: string): Generator<string> {
    for (const voce of readdirSync(dir, { withFileTypes: true })) {
      const percorso = join(dir, voce.name);
      if (voce.isDirectory()) yield* tuttiIFile(percorso);
      else if (/\.tsx?$/.test(voce.name)) yield percorso;
    }
  }

  it('ogni file che esporta sa anche riconoscere l’annullata', () => {
    const senza: string[] = [];
    for (const percorso of tuttiIFile(RADICE)) {
      if (percorso.endsWith(join('ui', 'esporta.ts'))) continue;
      const testo = readFileSync(percorso, 'utf8');
      if (!/\bfrom '[^']*esporta'/.test(testo)) continue;
      if (!/\bannullata\(/.test(testo)) senza.push(percorso.slice(RADICE.length + 1));
    }
    expect(senza, `chiamano «esporta» ma non guardano l’annullata:\n  ${senza.join('\n  ')}`).toEqual([]);
  });
});

describe('fuori dall’applicazione, e sui computer, resta il download', () => {
  it('nel browser si clicca, e nessuno chiama il motore', async () => {
    const esito = await esporta('MyDiveLog.pdf', '%PDF-1.4', 'application/pdf');
    expect(invocazioni).toHaveLength(0);
    expect(click).toBe(1);
    expect(esito.dove).toBe(DOVE_NEI_DOWNLOAD);
  });

  it('e sul Mac o su Windows pure: là la WebView sa scaricare davvero', async () => {
    // La metà che impedisce di «correggere» mandando tutti al motore Rust: sui
    // computer quel comando non è nemmeno registrato, e la risposta sarebbe
    // «comando sconosciuto».
    piattaforma.inApp = true;
    const esito = await esporta('MyDiveLog.pdf', '%PDF-1.4', 'application/pdf');
    expect(invocazioni).toHaveLength(0);
    expect(click).toBe(1);
    expect(esito.dove).toBe(DOVE_NEI_DOWNLOAD);
  });
});

describe('le destinazioni', () => {
  it('sono tutte nell’elenco che la prova del dizionario scorre', () => {
    // Senza, una frase nuova resta in italiano con l'applicazione in inglese, e
    // nessuno se ne accorge finché non la legge un inglese.
    for (const d of [DOVE_SU_IPHONE, DOVE_NEI_DOWNLOAD, DOVE_SCELTO_DA_TE]) {
      expect(DESTINAZIONI).toContain(d);
    }
  });

  it('e la frase dell’annullata è una costante, non una stringa sparsa', () => {
    // Dieci punti la mostrano: se ognuno la scrivesse per conto suo, nove
    // resterebbero in italiano il giorno che la decima viene tradotta.
    expect(NON_SCELTO).toMatch(/non è stato scritto niente/);
    expect(new EsportazioneAnnullata().message).toBe(NON_SCELTO);
  });
});

/*
 * ════════════════════════════════════════════════════════════════════════════
 * ► LA CARTELLA IN CUI NON SI SCRIVE PIÙ. ◄
 *
 * La correzione del 15 settembre mandava Android in `document_dir()`, che là
 * vale `getExternalFilesDir(DIRECTORY_DOCUMENTS)`: dentro
 * `Android/data/<pacchetto>`, dove da Android 11 nessun gestore di file può
 * entrare e che la disinstallazione porta via. Il file c'era e non era
 * raggiungibile — lo ha scoperto chi usa il programma, non queste prove.
 *
 * È esattamente la specie di correzione che si rimette in piedi per sbaglio: il
 * codice per farlo è più corto, non chiede niente a nessuno, e sembra
 * funzionare finché non si va a cercare il file. Questa prova legge il sorgente
 * Rust e pretende che il ramo di Android non ci torni.
 *
 * *Una prova grossolana su una regola che si dimentica vale più di una prova
 * fine su una regola che nessuno violerebbe.*
 */
describe('il motore, letto dal sorgente', () => {
  const LIB = readFileSync(join(__dirname, '..', 'src-tauri', 'src', 'lib.rs'), 'utf8');

  /** Il corpo di una funzione `#[cfg]`-ata per una piattaforma. */
  function corpoPer(os: string): string {
    const inizio = LIB.indexOf(`#[cfg(target_os = "${os}")]\nasync fn scrivi_fuori(`);
    expect(inizio, `manca «scrivi_fuori» per ${os}`).toBeGreaterThan(-1);
    const dopo = LIB.slice(inizio);
    // Fino alla prossima dichiarazione in colonna zero: le funzioni di questo
    // file non sono annidate, quindi la prima `\n}` chiude questa.
    const fine = dopo.indexOf('\n}\n');
    return dopo.slice(0, fine);
  }

  it('su Android il file NON finisce nella cartella privata dell’app', () => {
    const android = corpoPer('android');
    expect(
      android,
      'document_dir() su Android è Android/data: invisibile e cancellata alla disinstallazione',
    ).not.toContain('document_dir');
    // E la strada che deve esserci: si chiede dove.
    expect(android).toContain('save_file');
  });

  it('su iPhone invece sì, perché là quella cartella si vede nell’app File', () => {
    // La metà che impedisce di «uniformare» i due rami: su iOS
    // `UIFileSharingEnabled` rende quella cartella un posto vero, e un
    // selettore in più sarebbe un tocco in più per niente.
    expect(corpoPer('ios')).toContain('document_dir');
  });

  it('e chi annulla non ottiene un file di ripiego', () => {
    /*
     * Il ripiego sarebbe la trappola: «l'utente ha annullato, allora lo salvo
     * nella cartella dell'app». Cioè scrivere dove non guarda dopo che ha detto
     * di no — il difetto di partenza rimesso in piedi con un'altra scusa.
     */
    const android = corpoPer('android');
    const annullato = android.slice(android.indexOf('let Some(destinazione)'));
    expect(annullato.slice(0, 200)).toContain('annullato: true');
    expect(android.indexOf('annullato: true')).toBeLessThan(android.indexOf('write_all'));
  });
});

/*
 * ► I DUE PLUGIN RESTANO SU ANDROID. ◄
 *
 * `dialog` sul desktop si porta dietro `rfd` e le finestre native di sistema;
 * `fs`, se fosse raggiungibile dall'interfaccia, sarebbe un accesso al
 * filesystem aperto dalla pagina. Nessuno dei due ha ragione di stare nel
 * binario di un computer o di un iPhone, dove il problema che risolvono non
 * esiste. Dichiararli per bersaglio è quello che li tiene fuori.
 */
describe('le dipendenze del selettore', () => {
  const CARGO = readFileSync(join(__dirname, '..', 'src-tauri', 'Cargo.toml'), 'utf8');

  it('sono dichiarate solo per Android', () => {
    const sezioni = CARGO.split(/^\[/m);
    for (const crate of ['tauri-plugin-dialog', 'tauri-plugin-fs']) {
      const dove = sezioni.filter((s) => new RegExp(`^${crate}\\s*=`, 'm').test(s));
      expect(dove, `«${crate}» dichiarata in ${dove.length} sezioni`).toHaveLength(1);
      expect(dove[0]!.split('\n')[0]).toContain('target_os = "android"');
    }
  });
});
