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
