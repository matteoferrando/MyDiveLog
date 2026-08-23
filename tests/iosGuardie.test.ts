/**
 * Le guardie di iOS: proprietà che si possono verificare leggendo le sorgenti.
 *
 * Esistono perché i difetti che questo file inchioda hanno tutti la stessa
 * forma — funzionano sul Mac, non fanno NIENTE su iPhone, e non lanciano
 * nessun errore. Un test che gira in Node non può aprire una WKWebView; può
 * però verificare che nel codice non rientri il costrutto che lì dentro non
 * funziona. È una rete grossolana, ed è l'unica che copra la distanza fra
 * «compila» e «serve a qualcosa su un telefono».
 *
 * Ogni regola qui nasce da un difetto vero, non da un sospetto.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../src', import.meta.url));

function sorgenti(dir = SRC, out: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) sorgenti(p, out);
    else if (/\.tsx?$/.test(nome)) out.push(p);
  }
  return out;
}

const FILE = sorgenti().map((p) => ({
  path: p,
  rel: p.slice(SRC.length + 1),
  testo: readFileSync(p, 'utf8'),
}));

describe('esportazione dei file', () => {
  /*
   * IL DIFETTO. Dentro la WKWebView di iOS un `<a download>` con un URL `blob:`
   * non scarica niente e non lancia: il lato JavaScript non ha modo di
   * accorgersene. C'erano tre copie dello stesso helper, in tre file diversi, e
   * tutte e tre finivano con l'interfaccia che dichiarava un successo mai
   * avvenuto — «Backup scritto: 104 immersioni», con zero file scritti.
   *
   * La cura è una funzione sola, `ui/esporta.ts`, che su iOS scrive nella
   * cartella dell'app e che LANCIA quando non ci riesce. Questa guardia serve a
   * impedire che ne rinasca una quarta copia: è successo tre volte, succederà
   * di nuovo, e il sintomo non si vede su nessun desktop.
   */
  it('esiste un solo posto che crea un elemento di download', () => {
    const colpevoli = FILE.filter((f) => f.rel !== 'ui/esporta.ts' && /\.download\s*=/.test(f.testo)).map(
      (f) => f.rel,
    );
    expect(colpevoli).toEqual([]);
  });

  it('quel posto restituisce dove è finito il file, invece di non poter fallire', () => {
    const esporta = FILE.find((f) => f.rel === 'ui/esporta.ts');
    expect(esporta, 'ui/esporta.ts non c’è più').toBeDefined();
    // Su iOS passa da un comando nativo: se questa riga sparisce, siamo tornati
    // al download del browser che lì dentro non fa niente.
    expect(esporta!.testo).toContain('esporta_nei_documenti');
    // E il tipo di ritorno dice dov'è il file: è la frase che l'utente legge.
    expect(esporta!.testo).toContain('EsitoEsportazione');
  });
});

describe('eventi del puntatore invece che del mouse', () => {
  /*
   * IL DIFETTO. iOS non consegna `mousemove` né `mouseenter`: un grafico che
   * legge la posizione del dito con gli eventi del mouse non risponde affatto,
   * e non c'è nessun errore da nessuna parte. È già costato una volta sui
   * tooltip dei grafici (`Charts.tsx`), e la stessa forma era rimasta nel
   * profilo di profondità e nella mappa dei siti — cioè nei due disegni che su
   * un telefono si guardano di più.
   *
   * `onMouseDown` e `onMouseUp` restano ammessi: iOS li sintetizza sugli
   * elementi che considera cliccabili, e nessuno di essi porta informazione che
   * altrimenti sparirebbe.
   */
  const VIETATI = ['onMouseMove', 'onMouseEnter', 'onMouseLeave', 'onMouseOver', 'onMouseOut'];

  it('nessun componente si affida a eventi che iOS non manda', () => {
    const colpevoli: string[] = [];
    for (const f of FILE) {
      for (const evento of VIETATI) {
        // Solo i gestori veri: `onMouseMove={`. I commenti che spiegano perché
        // NON si usano più devono poter continuare a nominarli.
        if (new RegExp(`${evento}\\s*=\\s*\\{`).test(f.testo)) colpevoli.push(`${f.rel}: ${evento}`);
      }
    }
    expect(colpevoli).toEqual([]);
  });

  it('la chiusura al tocco fuori ascolta il puntatore, non il mouse', () => {
    /*
     * `BottoneConferma` si disarma quando si tocca altrove. Ascoltava
     * `mousedown` sul documento: iOS lo sintetizza solo sugli elementi che
     * considera cliccabili, quindi toccare il testo di una carta spesso non
     * produceva niente e il pulsante rosso «Sì, cancella» restava armato — che
     * è proprio la condizione che quel componente esiste per evitare.
     */
    const conferma = FILE.find((f) => f.rel === 'ui/components/Conferma.tsx');
    expect(conferma).toBeDefined();
    expect(conferma!.testo).toContain("addEventListener('pointerdown'");
    expect(conferma!.testo).not.toContain("addEventListener('mousedown'");
  });
});

describe('la stampa non si offre dove non può funzionare', () => {
  /*
   * IL DIFETTO. Stampare apre una finestra nuova col foglio impaginato e passa
   * la parola alla finestra di stampa del sistema. Dentro la WKWebView di iOS
   * non esiste né l'una né l'altra: `window.open` restituisce null e
   * `window.print()` non fa niente. I due pulsanti restavano lì, identici a
   * tutti gli altri, e premendoli compariva un avviso che dava la colpa al
   * blocco dei popup — cioè mandava a cercare un'impostazione che su iPhone non
   * esiste, per un problema che non era quello.
   *
   * Un pulsante che non può funzionare è peggio della sua assenza: promette una
   * funzione e poi mente sul perché non c'è.
   */
  it('ogni pulsante di stampa sta dietro a un controllo sulla piattaforma', () => {
    for (const rel of ['ui/pages/DiveDetail.tsx', 'ui/pages/Planner.tsx']) {
      const f = FILE.find((x) => x.rel === rel);
      expect(f, `${rel} non c’è più`).toBeDefined();
      // Il file apre davvero una finestra: se questa riga sparisce il test va
      // riscritto, non cancellato.
      expect(f!.testo, `${rel} non stampa più: rivedere questa guardia`).toContain(
        "window.open('', '_blank')",
      );
      expect(f!.testo, `${rel}: la stampa non è nascosta su iOS`).toContain('!suIOS()');
    }
  });
});

describe('scorrere la pagina non apre riquadri', () => {
  /*
   * IL DIFETTO, visto su un iPhone vero. Scorrendo le statistiche col dito che
   * passava sopra le barre di «Fasce di profondità», il riquadro con i numeri si
   * apriva da solo e restava lì per tre secondi e mezzo. Chi guarda non ha
   * toccato niente: ha scorso, ed è comparsa una scritta sopra il grafico.
   *
   * `pointercancel` è il momento esatto in cui iOS dichiara che quel dito non
   * sta toccando un elemento ma sta trascinando la pagina, e da lì in poi su
   * quell'elemento non arriva più nessun evento — nemmeno `pointerleave`. Senza
   * gestirlo, tutto ciò che si è aperto al `pointerdown` resta aperto fino allo
   * scadere del timer. Ogni grafico che apre qualcosa col dito deve chiuderlo
   * qui.
   */
  const CON_PUNTATORE = [
    'ui/components/Charts.tsx',
    'ui/components/DepthProfile.tsx',
    'ui/pages/Planner.tsx',
    'ui/pages/Stats.tsx',
  ];

  it('ogni file che apre un riquadro col dito gestisce anche l’annullamento', () => {
    for (const rel of CON_PUNTATORE) {
      const f = FILE.find((x) => x.rel === rel);
      expect(f, `${rel} non c’è più`).toBeDefined();
      expect(f!.testo, `${rel} apre col puntatore ma non gestisce pointercancel`).toMatch(/onPointerCancel/);
    }
  });
});

/*
 * Il pacchetto per Apple: due dichiarazioni che, se mancano, si scoprono tardi
 * e per posta.
 *
 * Nessuna delle due si vede provando l'app: si vedono al caricamento su App
 * Store Connect, dopo una build e un invio, con un messaggio in codice.
 */
describe('quello che il pacchetto iOS deve dichiarare ad Apple', () => {
  const radice = fileURLToPath(new URL('..', import.meta.url));
  const leggi = (relativo: string) => readFileSync(join(radice, relativo), 'utf8');

  it('l’esenzione sulla crittografia è nel plist, o la domanda torna a ogni caricamento', () => {
    /*
     * Senza questa chiave App Store Connect chiede a OGNI build se l'app usa
     * crittografia, e finché non si risponde la build non va in revisione.
     * `false` non vuol dire che non ne usiamo: vuol dire che quella che usiamo
     * — HTTPS e portachiavi di sistema — rientra nelle esenzioni.
     */
    const plist = leggi('src-tauri/Info.ios.plist');
    expect(plist).toContain('<key>ITSAppUsesNonExemptEncryption</key>');
    expect(plist).toMatch(/<key>ITSAppUsesNonExemptEncryption<\/key>\s*\n\s*<false \/>/);
  });

  it('il manifesto della privacy esiste e dichiara lo spazio su disco', () => {
    /*
     * Misurato, non supposto: `nm -u` sul binario compilato trova `statfs`, che
     * sta nella categoria «spazio su disco». Non lo chiamiamo noi, lo chiama
     * SQLite prima di scrivere. Senza dichiarazione, Apple risponde ITMS-91053
     * e la lavorazione si ferma.
     */
    const manifesto = leggi('src-tauri/PrivacyInfo.xcprivacy');
    expect(manifesto).toContain('NSPrivacyAccessedAPICategoryDiskSpace');
    expect(manifesto).toContain('E174.1');
    // E non si dichiara più di quello che si usa: sarebbe una promessa in più
    // da mantenere, non una prudenza.
    expect(manifesto).not.toContain('NSPrivacyAccessedAPICategoryUserDefaults');
  });

  it('ogni script iOS copia il manifesto PRIMA di generare il progetto', () => {
    /*
     * ► La riga che tiene in piedi tutto il resto. ◄
     *
     * `gen/apple/` è generata: un file lasciato là dentro sparisce al primo
     * `tauri ios init` su un'altra macchina, e sparisce in silenzio. Il
     * manifesto vive in `src-tauri/` e viene copiato dentro il progetto PRIMA
     * che XcodeGen lo generi — dopo sarebbe inutile, perché il progetto è già
     * stato scritto e il file non risulterebbe fra le risorse.
     */
    const pacchetto = JSON.parse(leggi('package.json')) as { scripts: Record<string, string> };
    const script = Object.entries(pacchetto.scripts).filter(([nome]) => nome.startsWith('ios:'));
    expect(script.length).toBeGreaterThan(0);

    for (const [nome, riga] of script) {
      const copia = riga.indexOf('PrivacyInfo.xcprivacy');
      const init = riga.indexOf('tauri ios init');
      expect(copia, nome).toBeGreaterThanOrEqual(0);
      expect(init, nome).toBeGreaterThanOrEqual(0);
      expect(copia, nome).toBeLessThan(init);
    }
  });

  it('ogni script iOS BUTTA VIA project.yml prima di generare', () => {
    /*
     * `tauri ios init` NON riscrive un file che trova già lì, e lo dice
     * comunque «Project generated successfully». Quindi un `project.yml`
     * vecchio sopravvive a qualunque cambiamento di `tauri.conf.json`, e il
     * cambiamento non arriva mai nel progetto: succede in silenzio.
     *
     * Pagato il 23 agosto 2026: alzato il minimo da iOS 14 a iOS 15 in
     * `tauri.conf.json`, il pacchetto continuava a dichiarare 14. Il file è
     * generato e non contiene niente di nostro — le nostre modifiche stanno in
     * `Info.ios.plist` e in `pulisci-progetto-ios.mjs` — quindi buttarlo via
     * prima di rigenerare non perde niente e rende `tauri.conf.json` l'unica
     * verità.
     */
    const pacchetto = JSON.parse(leggi('package.json')) as { scripts: Record<string, string> };
    for (const [nome, riga] of Object.entries(pacchetto.scripts).filter(([n]) => n.startsWith('ios:'))) {
      const via = riga.indexOf('rm -f src-tauri/gen/apple/project.yml');
      const init = riga.indexOf('tauri ios init');
      expect(via, nome).toBeGreaterThanOrEqual(0);
      expect(via, nome).toBeLessThan(init);
    }
  });
});
