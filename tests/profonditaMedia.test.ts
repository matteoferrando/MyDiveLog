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

describe('► un lettore solo per campo, e la guardia che lo pretende ◄', () => {
  /*
   * ════════════════════════════════════════════════════════════════════════
   * ► PERCHÉ LA GUARDIA COPRE DUE CAMPI E QUATTRO CARTELLE. ◄
   *
   * Perché il difetto ha una **forma**, e la forma vale per ogni campo che
   * esista sia dichiarato sull'immersione sia calcolato in `metrics`. I campi
   * con questa forma sono esattamente due — contati confrontando `Dive` e
   * `DiveMetrics`, non a memoria — e tutti e due hanno già avuto il loro
   * difetto: `minTempC` il 22 agosto, `avgDepth` il 14 settembre.
   *
   * ► E LA SECONDA VOLTA HA INSEGNATO PIÙ DELLA PRIMA. ◄ Cercando i lettori di
   * `avgDepth` sono saltati fuori **quattro lettori di `minTempC` ancora
   * sbagliati**, tre settimane dopo che quel difetto era stato «chiuso»: le
   * statistiche delle mute, che scartavano l'immersione invece di leggerla
   * altrove, e il PDF del libretto. *Una correzione che converte i lettori che
   * si trovano lascia in piedi quelli che non si cercano.* Da qui la guardia:
   * non fidarsi di aver convertito tutto, pretenderlo.
   *
   * Le cartelle sono quattro perché il difetto si è manifestato in tutte e
   * quattro: l'interfaccia (l'elenco), le esportazioni (il libretto, l'UDDF),
   * l'analisi (le mute, il rapporto medio/massima) e il contesto per l'analisi
   * con Claude.
   */
  const RADICI = ['src/ui', 'src/core/export', 'src/core/analysis', 'src/ai'];

  /**
   * Chi il valore lo CALCOLA, e quindi il campo dichiarato deve leggerlo.
   */
  const CHI_LO_CALCOLA = ['src/core/analysis/metrics.ts'];

  /**
   * ► LE ECCEZIONI, CON IL MOTIVO SCRITTO ACCANTO. ◄
   *
   * Sono punti dove il nome del campo compare su un oggetto che **non è
   * un'immersione**: la ricerca è testuale e non può saperlo. Scriverle qui,
   * una per una e con la ragione, è meglio che allargare l'espressione
   * regolare finché smette di lamentarsi — *una guardia che si taglia su misura
   * dei suoi falsi allarmi finisce per non vedere più nemmeno quelli veri.*
   *
   * La prova sotto pretende che ogni eccezione corrisponda ancora a
   * un'occorrenza vera: un'eccezione che non serve più è una porta lasciata
   * aperta per un motivo che non esiste.
   */
  const ECCEZIONI: Record<string, string> = {
    'src/ui/components/NewDive.tsx':
      'la bozza del modulo a mano, dove i campi sono stringhe da tastiera e non numeri di un’immersione',
    'src/ui/pages/Stats.tsx':
      'le righe aggregate della tabella delle mute, che sono riepiloghi di gruppi e non immersioni',
  };

  const CAMPI = [
    { campo: 'avgDepth', funzione: 'profonditaMedia' },
    { campo: 'minTempC', funzione: 'temperaturaMinimaC' },
  ];

  function tuttiISorgenti(radice: string): string[] {
    const fuori: string[] = [];
    for (const voce of readdirSync(radice)) {
      const p = join(radice, voce);
      if (statSync(p).isDirectory()) fuori.push(...tuttiISorgenti(p));
      else if (/\.(ts|tsx)$/.test(p)) fuori.push(p);
    }
    return fuori;
  }

  const tutti = RADICI.flatMap(tuttiISorgenti);
  const sorgenti = tutti.filter((p) => !CHI_LO_CALCOLA.includes(p) && !(p in ECCEZIONI));

  it('la guardia sta guardando qualcosa: i file ci sono', () => {
    /*
     * ► LA GUARDIA DELLA GUARDIA. ◄ Una cartella rinominata, un'estensione
     * nuova, e la ricerca qui sotto scorrerebbe un elenco vuoto passando per
     * sempre — che è il modo più silenzioso di perdere un controllo. È lo
     * stesso motivo per cui `avanzamentoTradotto.test.ts` pretende «almeno
     * due» etichette dal sorgente Rust.
     */
    expect(sorgenti.length).toBeGreaterThan(30);
    for (const radice of RADICI) expect(tuttiISorgenti(radice).length).toBeGreaterThan(0);
  });

  it.each(CAMPI)('nessuno legge `.$campo` per conto suo', ({ campo, funzione }) => {
    /*
     * `avgDepthM` del modulo di inserimento a mano non è questo campo — è il
     * testo di una casella — e il confine di parola lo lascia fuori da solo.
     */
    const cerca = new RegExp(`\\.${campo}\\b`);
    const colpevoli = sorgenti.filter((p) => cerca.test(readFileSync(p, 'utf8')));
    expect(
      colpevoli,
      `leggono \`.${campo}\` invece di \`${funzione}(dive)\`: ${colpevoli.join(' | ')}\n` +
        'Quel campo è solo quello DICHIARATO dalla sorgente, e può essere vuoto:\n' +
        'la funzione sa che i campi sono due e prende il valore da dove c’è.',
    ).toEqual([]);
  });

  it('ogni eccezione serve ancora a qualcosa', () => {
    /*
     * ► LA GUARDIA DELL'ELENCO DELLE ECCEZIONI. ◄ Il giorno in cui la tabella
     * delle mute smette di avere una colonna di temperatura, la sua eccezione
     * resta lì e copre in silenzio qualunque lettura sbagliata che qualcuno
     * scriva in quel file. Quindi si pretende che serva: se il campo lì dentro
     * non compare più, l'eccezione va tolta.
     */
    const cerca = new RegExp(CAMPI.map((c) => `\\.${c.campo}\\b`).join('|'));
    for (const [file, motivo] of Object.entries(ECCEZIONI)) {
      expect(tutti, `l’eccezione «${file}» punta a un file che non c’è più`).toContain(file);
      expect(
        cerca.test(readFileSync(file, 'utf8')),
        `l’eccezione «${file}» (${motivo}) non serve più: toglila`,
      ).toBe(true);
    }
  });

  it.each(CAMPI)('e `$funzione` è davvero quella che usano', ({ funzione }) => {
    /*
     * Il rovescio del controllo sopra: senza questa riga, cancellare ogni
     * profondità media dall'interfaccia farebbe passare la guardia a pieni
     * voti. *Una guardia che passa anche quando la cosa che protegge non
     * esiste più non protegge niente.*
     */
    const cerca = new RegExp(`${funzione}\\(`);
    const quanti = sorgenti.filter((p) => cerca.test(readFileSync(p, 'utf8')));
    expect(quanti.length, `${funzione} non è usata da nessuna parte`).toBeGreaterThanOrEqual(5);
  });

  it('e i campi con questa forma sono ancora due, non tre', () => {
    /*
     * ► LA RIGA CHE FA SCATTARE LA GUARDIA SU UN CAMPO CHE NON ESISTE ANCORA. ◄
     * `CAMPI` qui sopra è un elenco scritto a mano, e un elenco scritto a mano
     * invecchia: il giorno in cui qualcuno aggiunge a `DiveMetrics` un terzo
     * campo che esiste anche su `Dive`, nascerebbe un terzo difetto di questa
     * famiglia e nessuna prova se ne accorgerebbe.
     *
     * Quindi i due tipi si confrontano davvero, leggendo il modello. Se questa
     * riga diventa rossa non è un guasto: è il progetto che chiede di decidere
     * chi vince fra il dichiarato e il calcolato, e di scriverlo in una
     * funzione come le altre due.
     */
    const modello = readFileSync('src/core/model.ts', 'utf8');
    const campiDi = (nome: string) => {
      const i = modello.indexOf(`export interface ${nome} {`);
      expect(i, `interfaccia ${nome} non trovata`).toBeGreaterThan(0);
      const corpo = modello.slice(i, modello.indexOf('\n}', i));
      return new Set([...corpo.matchAll(/^ {2}(\w+)\??:/gm)].map((m) => m[1]));
    };
    const metriche = campiDi('DiveMetrics');
    const doppi = [...campiDi('Dive')].filter((c) => metriche.has(c)).sort();
    expect(doppi, 'un campo nuovo esiste sia su Dive sia su DiveMetrics: chi vince?').toEqual(
      CAMPI.map((c) => c.campo).sort(),
    );
  });
});
