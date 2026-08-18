/**
 * Indipendenza dal fuso orario della macchina.
 *
 * Questo file esiste per un bug vero: i test passavano in UTC nel container e
 * fallivano sul Mac dell'utente, in Europe/Rome. La causa era
 * `new Date('2026-06-14T10:38:00')`, che interpreta una data-ora senza fuso
 * usando il fuso del COMPUTER. Conseguenze concrete:
 *
 *  - lo stesso file Subsurface importato a Genova e a Londra dava due istanti
 *    diversi, quindi due identificativi diversi per la stessa immersione — e con
 *    il database condiviso significa duplicarla fra i dispositivi;
 *  - la deduplica non riconosceva più la stessa immersione arrivata da due
 *    computer, perché gli istanti differivano di ore.
 *
 * Il fuso di prova viene forzato con `process.env.TZ` prima di chiamare i parser.
 * Non è elegantissimo, ed è il solo modo di verificare davvero la proprietà che
 * conta: **lo stesso file deve dare lo stesso istante su qualunque macchina.**
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { wallClockToIso, isoFromParts } from '../src/core/units';
import { subsurfaceParser } from '../src/core/parsers/subsurface';
import { uddfParser } from '../src/core/parsers/uddf';
import { shearwaterParser } from '../src/core/parsers/shearwater';
import { csvParser } from '../src/core/parsers/csv';
import { synthesise, toCsv, toShearwaterXml, toSubsurface, toUddf } from './fixtures';
import { dateShort, timeShort } from '../src/ui/format';
import { aggregate } from '../src/core/analysis/aggregate';
import type { Dive } from '../src/core/model';

/** Un'immersione minima con una data: basta per i secchi temporali. */
const dive = (startTime: string): Dive => ({
  id: startTime,
  startTime,
  durationS: 2400,
  maxDepth: 20,
  mode: 'oc',
  cylinders: [],
  source: { format: 'uddf', file: 'x', importedAt: 'x' },
  tags: [],
});

const ZONES = ['UTC', 'Europe/Rome', 'America/New_York', 'Australia/Sydney', 'Asia/Kolkata'];
const original = process.env.TZ;
afterAll(() => {
  process.env.TZ = original;
});
beforeEach(() => {
  process.env.TZ = original;
});

describe('letture d’orologio senza fuso', () => {
  it('fissa su UTC una data-ora senza fuso', () => {
    expect(wallClockToIso('2026-06-14T10:38:00')).toBe('2026-06-14T10:38:00.000Z');
    expect(wallClockToIso('2026-06-14 10:38')).toBe('2026-06-14T10:38:00.000Z');
    expect(wallClockToIso('2026-06-14')).toBe('2026-06-14T00:00:00.000Z');
  });

  it('rispetta il fuso quando è scritto nel file', () => {
    expect(wallClockToIso('2026-06-14T10:38:00+02:00')).toBe('2026-06-14T08:38:00.000Z');
    expect(wallClockToIso('2026-06-14T10:38:00Z')).toBe('2026-06-14T10:38:00.000Z');
  });

  it('rifiuta una data impossibile invece di normalizzarla', () => {
    // `Date.UTC(2026, 12, 40)` non fallisce: scivola nel mese dopo. Un file con
    // una data assurda non deve diventare un'immersione con una data plausibile.
    expect(isoFromParts(2026, 13, 1)).toBeUndefined();
    expect(isoFromParts(2026, 2, 30)).toBeUndefined();
    expect(isoFromParts(2026, 6, 14, 10, 38)).toBe('2026-06-14T10:38:00.000Z');
  });

  it('non dipende dal fuso della macchina', () => {
    const results = ZONES.map((tz) => {
      process.env.TZ = tz;
      return wallClockToIso('2026-06-14T10:38:00');
    });
    expect(new Set(results).size).toBe(1);
  });
});

describe('i parser danno lo stesso istante in ogni fuso', () => {
  const synth = synthesise();
  const files = [
    ['Subsurface', () => subsurfaceParser.parse({ fileName: 'a.ssrf', text: toSubsurface(synth) })],
    ['UDDF', () => uddfParser.parse({ fileName: 'a.uddf', text: toUddf(synth) })],
    ['Shearwater XML', () => shearwaterParser.parse({ fileName: 'a.xml', text: toShearwaterXml(synth) })],
    ['CSV', () => csvParser.parse({ fileName: 'a.csv', text: toCsv([synth]) })],
  ] as const;

  for (const [name, parse] of files) {
    it(name, () => {
      const times = ZONES.map((tz) => {
        process.env.TZ = tz;
        return parse().dives[0]?.startTime;
      });
      expect(new Set(times).size).toBe(1);
      // E l'istante è quello scritto nel file, non uno spostato.
      expect(times[0]).toBe(synth.spec.startTime.toISOString());
    });
  }

  it('e lo stesso identificativo, che è ciò da cui dipende il database condiviso', () => {
    const ids = ZONES.map((tz) => {
      process.env.TZ = tz;
      return subsurfaceParser.parse({ fileName: 'a.ssrf', text: toSubsurface(synth) }).dives[0].id;
    });
    expect(new Set(ids).size).toBe(1);
  });
});

/**
 * La seconda metà del problema, scoperta molto dopo la prima.
 *
 * I parser erano stati resi indipendenti dal fuso, e i test lo verificavano. Ma
 * la VISUALIZZAZIONE no: `wallClockToIso` fissa deliberatamente l'orario
 * dell'orologio su UTC, e la formattazione lo rileggeva nel fuso di chi guarda,
 * annullando la scelta. Per un utente italiano ogni immersione compariva un'ora o
 * due avanti, e un'immersione del 31 dicembre alle 23:30 finiva contata nell'anno
 * dopo. Trecento test verdi non lo vedevano, perché il container gira in UTC.
 */
describe('quello che si LEGGE non dipende dal fuso della macchina', () => {
  const iso = '2026-06-14T10:38:00.000Z';

  it('l’ora mostrata è quella che segnava il computer, ovunque tu la guardi', () => {
    for (const zone of ZONES) {
      process.env.TZ = zone;
      expect(timeShort(iso), zone).toBe('10:38');
      expect(dateShort(iso), zone).toBe('14/06/26');
    }
  });

  it('un’immersione di fine anno resta nel suo anno', () => {
    const capodanno = '2025-12-31T23:30:00.000Z';
    for (const zone of ZONES) {
      process.env.TZ = zone;
      expect(dateShort(capodanno), zone).toBe('31/12/25');
      const buckets = aggregate([dive(capodanno)]).byYear;
      expect(
        buckets.map((b) => b.label),
        zone,
      ).toEqual(['2025']);
    }
  });

  it('i secchi mensili non slittano', () => {
    // Primo e ultimo istante di un mese: in un fuso spostato finirebbero nei mesi
    // adiacenti, e la colonna dell'attività mese per mese conterebbe sbagliato.
    const primo = '2026-03-01T00:30:00.000Z';
    const ultimo = '2026-03-31T23:30:00.000Z';
    for (const zone of ZONES) {
      process.env.TZ = zone;
      const a = aggregate([dive(primo), dive(ultimo)], Date.parse('2026-08-17T12:00:00Z'));
      const marzo = a.byMonth.find((b) => b.key === '2026-03');
      expect(marzo?.value, zone).toBe(2);
    }
  });

  it('quando il fuso del luogo è noto, si mostra QUELLO, non il proprio', () => {
    // Immersione alle 9 del mattino in Mar Rosso: chi la guarda dall'Italia deve
    // leggere 9, non 8.
    for (const zone of ZONES) {
      process.env.TZ = zone;
      expect(timeShort('2026-06-14T06:00:00.000Z', 180), zone).toBe('09:00');
    }
  });
});
