// @vitest-environment jsdom
/**
 * «PDF SALVATO» SU UN FILE CHE NON C'ERA — LA SEGNALAZIONE DEL 15 SETTEMBRE.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Arrivata dal modulo di segnalazione, da un Samsung Android:
 *
 *   *«premendo "Esporta PDF" compare "PDF salvato dove il sistema mette i
 *    download", ma il file non compare né in Download né in Recenti né
 *    cercando tutti i PDF.»*
 *
 * Il file non c'era. In cima a `ui/esporta.ts` il difetto è raccontato per
 * intero — dentro una WebView il click su `<a download>` **non scarica niente e
 * non lancia nessun errore**, quindi il `try` arriva in fondo e l'interfaccia
 * annuncia un file che non esiste — e lo racconta **al passato**, perché era
 * stato chiuso. *Chiuso su iOS soltanto:* la condizione diceva
 * `inApp() && suIOS()`.
 *
 * Una falsa conferma su un'esportazione è il difetto peggiore che ci sia: non
 * perde un file, costruisce fiducia in un file che non esiste.
 *
 * ► COSA PROVA QUESTO FILE. ◄ Che il criterio non è più «quale sistema» ma
 * **«c'è una finestra del browser che sa scaricare?»** — nel browser sì, dentro
 * l'applicazione no, e sui due computer sì perché là la WebView è collegata al
 * gestore di scarichi del sistema.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const piattaforma = { inApp: false, suIOS: false, suAndroid: false };

vi.mock('../src/piattaforma', () => ({
  inApp: () => piattaforma.inApp,
  suIOS: () => piattaforma.suIOS,
  suAndroid: () => piattaforma.suAndroid,
  suComputer: () => piattaforma.inApp && !piattaforma.suIOS && !piattaforma.suAndroid,
}));

/** Le chiamate al motore Rust, e cosa risponde. */
const invocazioni: { comando: string; argomenti: unknown }[] = [];
let rispostaRust: string | Error = '/percorso/finto/MyDiveLog.pdf';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (comando: string, argomenti: unknown) => {
    invocazioni.push({ comando, argomenti });
    return rispostaRust instanceof Error ? Promise.reject(rispostaRust) : Promise.resolve(rispostaRust);
  },
}));

import {
  esporta,
  frasePosizione,
  DOVE_SU_IPHONE,
  DOVE_SU_ANDROID,
  DOVE_NEI_DOWNLOAD,
  DESTINAZIONI,
} from '../src/ui/esporta';

/** Quanti `<a download>` sono stati cliccati: è la strada del browser. */
let click = 0;
let creaElemento: typeof document.createElement;

beforeEach(() => {
  invocazioni.length = 0;
  click = 0;
  rispostaRust = '/percorso/finto/MyDiveLog.pdf';
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
     * ► IL CUORE. ◄ Prima di questa correzione, Android cadeva nel ramo del
     * browser: zero invocazioni, un click che non scarica niente, e la frase
     * «PDF salvato dove il sistema mette i download».
     */
    piattaforma.inApp = true;
    piattaforma.suAndroid = true;

    const esito = await esporta('MyDiveLog.pdf', '%PDF-1.4', 'application/pdf');

    expect(invocazioni).toHaveLength(1);
    expect(invocazioni[0].comando).toBe('esporta_nei_documenti');
    expect(click, 'nessun click: il download del browser qui non funziona').toBe(0);
    expect(esito.dove).toBe(DOVE_SU_ANDROID);
    expect(esito.dove).not.toBe(DOVE_NEI_DOWNLOAD);
    expect(esito.percorso).toBe('/percorso/finto/MyDiveLog.pdf');
  });

  it('e il percorso si DICE, perché su Android è l’unica risposta utile', () => {
    // La cartella dell'app non ha un nome che una persona possa seguire, e
    // «Download» è proprio il posto sbagliato in cui l'utente ha già cercato.
    const frase = frasePosizione(
      { dove: DOVE_SU_ANDROID, percorso: '/storage/emulated/0/x/MyDiveLog.pdf', mostraPercorso: true },
      (x) => x,
    );
    expect(frase).toContain('/storage/emulated/0/x/MyDiveLog.pdf');
  });

  it('su iPhone passa dallo stesso motore, e il percorso NON si mostra', async () => {
    piattaforma.inApp = true;
    piattaforma.suIOS = true;

    const esito = await esporta('MyDiveLog.pdf', '%PDF-1.4', 'application/pdf');

    expect(invocazioni).toHaveLength(1);
    expect(click).toBe(0);
    expect(esito.dove).toBe(DOVE_SU_IPHONE);
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
    for (const d of [DOVE_SU_IPHONE, DOVE_NEI_DOWNLOAD, DOVE_SU_ANDROID]) {
      expect(DESTINAZIONI).toContain(d);
    }
  });
});
