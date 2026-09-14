/**
 * LA PROFONDITÀ MEDIA, E IL FATTO CHE I CAMPI SIANO DUE.
 *
 * ► PERCHÉ ESISTE QUESTO FILE. ◄ Il 14 settembre 2026, su un archivio di 110
 * immersioni scaricate da uno Shearwater via Bluetooth: **la scheda
 * dell'immersione scriveva «media 29.4 m» e l'elenco, sulla stessa identica
 * immersione, scriveva «—»**.
 *
 * Nessuna prova poteva accorgersene, e non per mancanza di prove: *ognuno dei
 * due lettori era corretto rispetto al campo che leggeva.* La scheda chiedeva
 * `metrics.avgDepth`, che è la media **misurata sul profilo**; l'elenco
 * chiedeva `dive.avgDepth`, che è quella **dichiarata dal computer** — e da uno
 * Shearwater non arriva mai, perché il parser di libdivecomputer non implementa
 * `DC_FIELD_AVGDEPTH` affatto.
 *
 * Il difetto non stava in una riga: stava nel fatto che le righe fossero due.
 * Quindi metà di questo file prova il comportamento, e metà pretende che di
 * lettori ce ne sia **uno solo** — perché correggere i quattro lettori
 * sbagliati di oggi non impedisce a nessuno di scriverne un quinto domani.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { computeMetrics } from '../src/core/analysis/metrics';
import { profonditaMedia } from '../src/core/profondita';
import { immersioneDaLdc, type ImmersioneLdc } from '../src/core/ble/esterni';
import { AIR, type Dive } from '../src/core/model';

const IMPORTATA = '2026-09-14T09:00:00.000Z';
const CONTESTO = { marca: 'Shearwater', modello: 'Perdix', importedAt: IMPORTATA };

/**
 * Un'immersione come la manda il guscio Rust **da uno Shearwater**: con il
 * profilo, e senza `avgDepth` — che è il caso reale, non uno costruito apposta.
 */
function daShearwater(sovrascrivi: Partial<ImmersioneLdc> = {}): ImmersioneLdc {
  return {
    startMs: Date.parse('2026-09-13T09:51:00.000Z'),
    durationS: 3420,
    maxDepth: 40.6,
    gas: [{ o2: 0.28, he: 0 }],
    samples: [
      { t: 0, depth: 0 },
      { t: 300, depth: 40.6 },
      { t: 1200, depth: 38 },
      { t: 2400, depth: 12 },
      { t: 3000, depth: 6 },
      { t: 3420, depth: 0 },
    ],
    ...sovrascrivi,
  };
}

describe('un’immersione scaricata da uno Shearwater', () => {
  it('ha una profondità media, anche se il computer non la dichiara', () => {
    const imm = daShearwater();
    expect(imm.avgDepth, 'il caso da provare è proprio quello senza').toBeUndefined();

    const dive = immersioneDaLdc(imm, CONTESTO)!;
    expect(dive).toBeDefined();

    /*
     * ► È LA RIGA CHE RIPRODUCE LA SEGNALAZIONE. ◄ Prima del 14 settembre
     * questa asserzione sarebbe fallita, e con lei l'elenco, il PDF della
     * scheda, il grafico «consumo e profondità media» e l'esportazione UDDF —
     * mentre la scheda dell'immersione mostrava il numero giusto.
     */
    expect(profonditaMedia(dive)).toBeDefined();
    expect(profonditaMedia(dive)!).toBeGreaterThan(0);
    expect(profonditaMedia(dive)!).toBeLessThanOrEqual(imm.maxDepth);
  });

  it('se la porta anche sull’immersione, non solo nelle metriche', () => {
    /*
     * `dive.avgDepth` non serve soltanto a chi legge: entra nella deduplica,
     * nel profilo quadro della catena dei tessuti e nell'archivio salvato.
     * Lasciarlo vuoto quando il numero ce l'abbiamo significa buttarlo — ed è
     * la riga che **tutti** gli altri importatori avevano e il ponte di
     * libdivecomputer no.
     */
    const dive = immersioneDaLdc(daShearwater(), CONTESTO)!;
    expect(dive.avgDepth).toBeDefined();
    expect(dive.avgDepth).toBe(dive.metrics!.avgDepth);
  });

  it('e il dichiarato, quando c’è, non sostituisce il misurato', () => {
    /*
     * Stessa regola della miscela analizzata e del consumo scritto a mano: il
     * numero sull'etichetta non scavalca quello letto dallo strumento. Qui il
     * computer dichiara 99 m su un profilo che non passa i 40,6: se vincesse il
     * dichiarato, il logbook scriverebbe una media più profonda del massimo.
     */
    const dive = immersioneDaLdc(daShearwater({ avgDepth: 99 }), CONTESTO)!;
    expect(profonditaMedia(dive)).not.toBe(99);
    expect(profonditaMedia(dive)!).toBeLessThanOrEqual(40.6);
  });
});

describe('quando il profilo non c’è', () => {
  const senzaProfilo = (extra: Partial<Dive> = {}): Dive => ({
    id: 'x',
    startTime: '2026-06-14T10:38:00.000Z',
    durationS: 2400,
    maxDepth: 30,
    mode: 'oc',
    cylinders: [{ mix: AIR }],
    source: { format: 'csv', file: 'a mano', importedAt: IMPORTATA },
    tags: [],
    samples: [],
    ...extra,
  });

  it('vale il dichiarato, che è l’unica cosa che si ha', () => {
    const dive = senzaProfilo({ avgDepth: 17.2 });
    dive.metrics = computeMetrics(dive);
    expect(profonditaMedia(dive)).toBe(17.2);
  });

  it('e senza nemmeno quello resta ignota, non zero', () => {
    /*
     * Uno zero qui entrerebbe nelle medie dell'archivio e le tirerebbe giù
     * senza fare rumore. «Non lo so» si dice non rispondendo.
     */
    const dive = senzaProfilo();
    dive.metrics = computeMetrics(dive);
    expect(profonditaMedia(dive)).toBeUndefined();
  });
});

describe('► un lettore solo, e la guardia che lo pretende ◄', () => {
  const RADICI = ['src/ui', 'src/core/export'];

  function tuttiISorgenti(radice: string): string[] {
    const fuori: string[] = [];
    for (const voce of readdirSync(radice)) {
      const p = join(radice, voce);
      if (statSync(p).isDirectory()) fuori.push(...tuttiISorgenti(p));
      else if (/\.(ts|tsx)$/.test(p)) fuori.push(p);
    }
    return fuori;
  }

  const sorgenti = RADICI.flatMap(tuttiISorgenti);

  it('la guardia sta guardando qualcosa: i file ci sono', () => {
    /*
     * ► LA GUARDIA DELLA GUARDIA. ◄ Una cartella rinominata, un'estensione
     * nuova, e la ricerca qui sotto scorrerebbe un elenco vuoto passando per
     * sempre — che è il modo più silenzioso di perdere un controllo. È lo
     * stesso motivo per cui `avanzamentoTradotto.test.ts` pretende «almeno
     * due» etichette dal sorgente Rust.
     */
    expect(sorgenti.length).toBeGreaterThan(20);
  });

  it('nessuno legge `.avgDepth` per conto suo', () => {
    /*
     * `avgDepthM` del modulo di inserimento a mano non è questo campo — è il
     * testo di una casella — e il confine di parola lo lascia fuori da solo.
     */
    const colpevoli = sorgenti.filter((p) => /\.avgDepth\b/.test(readFileSync(p, 'utf8')));
    expect(
      colpevoli,
      `leggono il campo invece della funzione: ${colpevoli.join(' | ')}\n` +
        'La profondità media si chiede a `profonditaMedia(dive)`, che sa che i campi sono due.',
    ).toEqual([]);
  });

  it('e la funzione è davvero quella che usano', () => {
    /*
     * Il rovescio del controllo sopra: senza questa riga, cancellare ogni
     * profondità media dall'interfaccia farebbe passare la guardia a pieni
     * voti. *Una guardia che passa anche quando la cosa che protegge non
     * esiste più non protegge niente.*
     */
    const quanti = sorgenti.filter((p) => /profonditaMedia\(/.test(readFileSync(p, 'utf8')));
    expect(quanti.length, 'la funzione non è usata da nessuna parte').toBeGreaterThanOrEqual(6);
  });
});
