/**
 * Dove stanno i brevetti, e cosa fanno le schede quando si aprono.
 *
 * ► PERCHÉ UN TEST CHE LEGGE IL SORGENTE. ◄ Le tre cose inchiodate qui non
 * hanno un valore di ritorno da confrontare: sono decisioni di POSTO. Un
 * brevetto che torna in Attrezzatura, una tabella che ricomincia a scorrere di
 * lato sul telefono, una scheda che si apre due schermate più giù senza portarci
 * nessuno — tutte e tre compilano, passano il controllo dei tipi e non rompono
 * nessun altro test. L'unico modo di accorgersene è aprire l'applicazione su un
 * telefono, cioè mai durante il lavoro. Questo file guarda al posto nostro.
 *
 * È lo stesso mestiere di `gestoriPerPiattaforma.test.ts`: quello che manca è
 * codice CORRETTO, e nessun compilatore sa dire che manca.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const leggi = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const GEAR = leggi('src/ui/pages/Gear.tsx');
const BREVETTI = leggi('src/ui/components/Brevetti.tsx');
const IMPOSTAZIONI = leggi('src/ui/pages/SyncPage.tsx');

describe('i brevetti stanno nelle Impostazioni, sotto il libretto', () => {
  it('la scheda Attrezzatura non ne parla più', () => {
    for (const traccia of ['SchedaBrevetto', 'certifications', 'highestLevel', 'CERT_LEVEL_LABEL']) {
      expect(GEAR, `Attrezzatura nomina ancora ${traccia}`).not.toContain(traccia);
    }
  });

  it('le Impostazioni li mostrano subito dopo la carta del libretto', () => {
    const libretto = IMPOSTAZIONI.indexOf('<LibrettoCard />');
    const brevetti = IMPOSTAZIONI.indexOf('<Brevetti />');
    expect(libretto).toBeGreaterThan(-1);
    expect(brevetti).toBeGreaterThan(libretto);
    // Fra le due non c'è un'altra carta: «sotto al paragrafo», alla lettera.
    expect(IMPOSTAZIONI.slice(libretto, brevetti)).not.toContain('<div className="card">');
  });

  it('la carta si chiama «Dati per il LogBook» e passa dal dizionario', () => {
    expect(IMPOSTAZIONI).toContain("t('Dati per il LogBook')");
    expect(IMPOSTAZIONI).not.toContain("t('Il tuo libretto')");
  });

  /*
   * Il campo del libretto era testo libero, e l'applicazione teneva due verità
   * sullo stesso fatto: quello che scrivevi qui e i brevetti registrati. Ora è
   * una tendina che pesca dall'elenco — è il senso di «deve essere uno di quelli
   * che carico».
   */
  it('il brevetto del libretto si sceglie fra quelli registrati, non si digita', () => {
    /*
     * Il ritaglio arriva alla PARENTESI CHE CHIUDE la funzione, non a un numero
     * fisso di caratteri. Prima erano 4000, e la carta li ha superati appena le
     * è stato aggiunto un commento: il test è diventato rosso senza che
     * l'applicazione avesse niente che non andasse. Una guardia che si accende
     * per la lunghezza di un commento insegna solo a non fidarsi di lei.
     */
    const inizio = IMPOSTAZIONI.indexOf('function LibrettoCard()');
    const carta = IMPOSTAZIONI.slice(inizio, IMPOSTAZIONI.indexOf('\n}\n', inizio));
    expect(carta).toContain('sortCertifications');
    expect(carta).toContain('<select');
    expect(carta).toContain('etichettaBrevetto');
    // E la tendina pesca dal catalogo, non più dalle sole etichette di livello.
    expect(IMPOSTAZIONI).toContain('didatticaId');
  });
});

describe('sul telefono le tabelle non scorrono di lato', () => {
  it('Attrezzatura usa il contenitore adattivo, non quello che scorre', () => {
    expect(GEAR).not.toContain('table-scroll');
    expect(GEAR).toContain('className="tabella-adattiva"');
    expect(BREVETTI).toContain('className="tabella-adattiva"');
  });

  /*
   * L'etichetta accanto al valore viene da `data-eti`, non da `thead`: il foglio
   * di stile non sa contare le colonne. Una cella senza etichetta, sul telefono,
   * è un valore senza nome — e sono proprio i valori che si somigliano (due date,
   * due numeri) a restare senza.
   */
  it('ogni cella di dati porta la sua etichetta', () => {
    for (const [nome, sorgente] of [
      ['Attrezzatura', GEAR],
      ['Brevetti', BREVETTI],
    ] as const) {
      for (const tabella of sorgente.split('className="tabella-adattiva"').slice(1)) {
        const corpo = tabella.slice(tabella.indexOf('<tbody>'), tabella.indexOf('</tbody>'));
        const celle = corpo.match(/<td\b[^>]*>/g) ?? [];
        expect(celle.length, `${nome}: nessuna cella trovata`).toBeGreaterThan(0);
        for (const cella of celle) {
          const nominata =
            cella.includes('data-eti=') || cella.includes('cella-titolo') || cella.includes('cella-azione');
          expect(nominata, `${nome}: cella senza nome → ${cella}`).toBe(true);
        }
      }
    }
  });
});

describe('aprire qualcosa da modificare porta dove si scrive', () => {
  it('le schede si agganciano a usePortaInVista', () => {
    for (const [nome, sorgente] of [
      ['Attrezzatura', GEAR],
      ['Brevetti', BREVETTI],
    ] as const) {
      expect(sorgente, `${nome}: manca l’aggancio`).toContain("from '../scorri'");
      expect(sorgente, `${nome}: il riferimento non è sulla carta`).toContain('className="card" ref={rif}');
    }
  });

  /*
   * `key` sull'id NON è decorativa: senza, React riusa lo stesso componente e
   * l'effetto di `usePortaInVista` — che vive sul montaggio — non riparte. La
   * scheda cambierebbe contenuto restando dov'è, cioè fuori schermo.
   */
  it('la scheda rinasce a ogni riga aperta', () => {
    expect(GEAR).toContain('key={bozzaAttrezzo.id}');
    expect(BREVETTI).toContain('key={bozza.id}');
  });
});
