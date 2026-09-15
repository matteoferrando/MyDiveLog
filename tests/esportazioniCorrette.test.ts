/**
 * DIFETTI DELLE ESPORTAZIONI, E LE GUARDIE CHE LI TENGONO CHIUSI.
 *
 * ► LA FAMIGLIA. ◄ Hanno tutti la stessa forma di quelli dei lettori: **il file
 * esce e non dà nessun errore**. Una bombola a zero bar per tutta l'immersione,
 * due siti diversi diventati lo stesso sito, un giorno sbagliato nel foglio di
 * calcolo, una stage sparita dal foglio che consegni a chi te lo chiede. Niente
 * di tutto questo si vede dal file: si vede sei mesi dopo, aprendolo.
 *
 * ► PERCHÉ LE PROVE NON CERCANO LE FRASI. ◄ Una prova che cerca il testo di un
 * avviso resta verde anche quando la frase è vera e il dato è sbagliato, e
 * diventa rossa quando qualcuno riscrive la frase senza toccare niente: è una
 * guardia finta in tutte e due le direzioni. Qui si guarda il difetto — il
 * valore che torna indietro, l'identificativo duplicato, il testo che non sta
 * nel foglio — e le dichiarazioni si controllano attraverso `perdite`, che porta
 * il CAMPO e non la frase.
 */

import { describe, expect, it } from 'vitest';

import { exportUddf } from '../src/core/export/uddf';
import { esportaCsv } from '../src/core/export/csv';
import { esportaKml } from '../src/core/export/kml';
import { schedePdf, larghezzaTesto } from '../src/core/export/pdf';
import { csvParser } from '../src/core/parsers/csv';
import { parseFile } from '../src/core/parsers';
import { computeMetrics } from '../src/core/analysis/metrics';
import { libretto } from '../src/core/libretto';
import { AIR, type Dive, type Sample } from '../src/core/model';

const EAN50 = { o2: 0.5, he: 0 };

function campioni(quanti = 9, sopra: Partial<Sample> = {}): Sample[] {
  return Array.from({ length: quanti }, (_, i) => ({
    t: i * 300,
    depth: 20,
    tempC: 18,
    ...sopra,
  }));
}

function immersione(sopra: Partial<Dive> = {}): Dive {
  const base: Dive = {
    id: 'a1',
    startTime: '2026-06-14T10:00:00.000Z',
    durationS: 2400,
    maxDepth: 20,
    mode: 'oc',
    salinity: 'salt',
    cylinders: [{ mix: AIR, sizeL: 12, startBar: 200, endBar: 80 }],
    source: { format: 'uddf', file: 'x.uddf', importedAt: '2026-06-14T12:00:00.000Z' },
    tags: [],
    samples: campioni(),
    ...sopra,
  };
  return { ...base, metrics: computeMetrics(base) };
}

/** Il giro completo: esporta, rileggi col nostro parser, guarda cosa è tornato. */
async function giro(dives: Dive[]): Promise<Dive[]> {
  const { xml } = exportUddf(dives, { now: '2026-09-15T00:00:00Z' });
  return (await parseFile({ fileName: 'giro.uddf', text: xml })).dives;
}

/**
 * Quello che l'archivio restituisce davvero, non quello che abbiamo in mano.
 *
 * I campioni vengono salvati con `JSON.stringify` (`storage/sqlite.ts`), e quel
 * passaggio non è neutro: dentro un array `undefined` e i buchi diventano
 * `null`. Costruire la scheda a mano in una prova salta proprio il passaggio in
 * cui nasce il difetto, quindi qui lo si rifà per intero.
 */
const comeDallArchivio = (d: Dive): Dive => JSON.parse(JSON.stringify(d)) as Dive;

describe('UDDF: una bombola senza trasmettitore', () => {
  /*
   * MISURATO. Due bombole, il trasmettitore solo sulla stage: `pressureBar` è
   * `[undefined, 180]`, che dopo il giro dall'archivio diventa `[null, 180]`.
   * Con `if (bar === undefined) continue` il `null` passava, `barToPascal(null)`
   * faceva 0, e sul file finiva `<tankpressure>0</tankpressure>` su tutti e
   * nove i campioni: chi apre quel file vede la bombola principale a zero bar
   * dall'inizio alla fine.
   */
  const conUnSoloTrasmettitore = () =>
    comeDallArchivio(
      immersione({
        cylinders: [
          { mix: AIR, sizeL: 15, startBar: 200, endBar: 70 },
          { mix: EAN50, sizeL: 7, startBar: 200, endBar: 150 },
        ],
        samples: campioni(9).map((s, i) => ({ ...s, pressureBar: [undefined, 180 - i] })),
      }),
    );

  it('non esce a zero bar: la pressione che manca non si scrive', () => {
    const { xml } = exportUddf([conUnSoloTrasmettitore()]);
    const scritte = [...xml.matchAll(/<tankpressure ref="[^"]+">(\d+)<\/tankpressure>/g)].map((m) => m[1]);
    // Nove campioni, una sola bombola strumentata: nove pressioni, nessuna a zero.
    expect(scritte).toHaveLength(9);
    expect(scritte.filter((v) => v === '0')).toEqual([]);
  });

  it('e rileggendo il file la principale resta senza pressione, non a zero', async () => {
    const [d] = await giro([conUnSoloTrasmettitore()]);
    const principale = (d.samples ?? []).map((s) => s.pressureBar?.[0]);
    const stage = (d.samples ?? []).map((s) => s.pressureBar?.[1]);
    expect(principale.every((v) => v === undefined || v === null)).toBe(true);
    expect(stage[0]).toBeCloseTo(180, 0);
    expect(stage[8]).toBeCloseTo(172, 0);
  });
});

describe('UDDF: due siti diversi restano due siti', () => {
  const aSito = (nome: string, id: string, giorno: string, lat?: number, lon?: number): Dive =>
    immersione({
      id,
      startTime: `${giorno}T10:00:00.000Z`,
      site: { name: nome, lat, lon },
    });

  it('«Grotta Azzurra (Capri)» e «Grotta Azzurra Capri» non si fondono', async () => {
    /*
     * La vecchia `idOf` cancellava le parentesi invece di codificarle: i due
     * nomi davano lo stesso identificativo, nel file restava un `<site>` solo e
     * la seconda immersione si prendeva le coordinate della prima — cioè finiva
     * a Capri un'immersione fatta da un'altra parte.
     */
    const dopo = await giro([
      aSito('Grotta Azzurra (Capri)', 'a', '2026-06-14', 40.55, 14.2),
      aSito('Grotta Azzurra Capri', 'b', '2026-06-15', 44.31, 9.14),
    ]);
    const perNome = new Map(dopo.map((d) => [d.site?.name, d.site]));
    expect(perNome.size).toBe(2);
    expect(perNome.get('Grotta Azzurra (Capri)')?.lat).toBeCloseTo(40.55, 3);
    expect(perNome.get('Grotta Azzurra Capri')?.lat).toBeCloseTo(44.31, 3);
  });

  it('e nemmeno due nomi senza una lettera latina, che prima diventavano tutti «site-»', async () => {
    const dopo = await giro([
      aSito('Голубая дыра', 'a', '2026-06-14', 26.5, 33.9),
      aSito('青の洞窟', 'b', '2026-06-15', 35.1, 139.6),
    ]);
    expect(new Set(dopo.map((d) => d.site?.name)).size).toBe(2);
    expect(dopo.find((d) => d.site?.name === '青の洞窟')?.site?.lat).toBeCloseTo(35.1, 3);
  });

  it('lo stesso nome resta un sito solo', () => {
    const { xml } = exportUddf([
      aSito('Punta Chiappa', 'a', '2026-06-14', 44.3167, 9.15),
      aSito('Punta Chiappa', 'b', '2026-06-15', 44.3167, 9.15),
      aSito(' Punta Chiappa ', 'c', '2026-06-16', 44.3167, 9.15),
    ]);
    expect(xml.match(/<site id=/g)).toHaveLength(1);
  });

  it('e su cinquecento nomi costruiti apposta per collidere, nessuno collide', () => {
    /*
     * La proprietà, non il caso singolo: l'identificativo CODIFICA il nome
     * invece di cancellarne i pezzi, quindi da nomi diversi escono per
     * costruzione identificativi diversi. I mattoni sono proprio quelli che la
     * vecchia regola buttava via — spazi, parentesi, trattini bassi, accenti,
     * alfabeti non latini — più le coppie che differiscono solo per uno di
     * quelli.
     */
    const pezzi = ['a', ' ', '(', ')', '_', '-', 'à', 'Я', '洞', '🐙', '.', ':'];
    const nomi = new Set<string>();
    // La lettera in testa e in coda serve a una cosa sola: il nome del sito
    // viene ripulito dagli spazi ai bordi prima di diventare chiave, quindi due
    // nomi che differiscono SOLO per uno spazio iniziale sono davvero lo stesso
    // sito e non sarebbero una collisione. Qui si misurano le collisioni vere.
    for (const x of pezzi) for (const y of pezzi) for (const z of pezzi) nomi.add(`s${x}${y}${z}e`);
    const scelti = [...nomi].slice(0, 500);
    expect(scelti.length).toBe(500);

    const dives = scelti.map((nome, i) =>
      aSito(nome, `d${i}`, `2026-06-${String((i % 28) + 1).padStart(2, '0')}`),
    );
    const { xml } = exportUddf(dives);
    const ids = [...xml.matchAll(/<site id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids).toHaveLength(500);
    expect(new Set(ids).size).toBe(500);
  });
});

describe('UDDF: le coordinate di un sito si prendono da tutte le immersioni', () => {
  /*
   * La prima immersione al Relitto Haven è inserita a mano e non ha il GPS; la
   * seconda arriva dal computer e ce l'ha. Fissando il sito alla prima
   * occorrenza il `<site>` usciva senza `<geography>`: le coordinate non erano
   * nel file e non erano nemmeno fra le perdite dichiarate.
   */
  const senzaGps = immersione({ id: 'a', site: { name: 'Relitto Haven' } });
  const conGps = immersione({
    id: 'b',
    startTime: '2026-06-15T10:00:00.000Z',
    site: { name: 'Relitto Haven', lat: 44.4, lon: 8.75 },
  });

  it('le scrive nel file anche se la prima immersione lì non le aveva', async () => {
    const dopo = await giro([senzaGps, conGps]);
    expect(dopo).toHaveLength(2);
    for (const d of dopo) {
      expect(d.site?.name).toBe('Relitto Haven');
      expect(d.site?.lat).toBeCloseTo(44.4, 3);
      expect(d.site?.lon).toBeCloseTo(8.75, 3);
    }
  });

  it('e non dà una risposta diversa da quella del KML sugli stessi dati', () => {
    // Era il guasto vero: due esportazioni della stessa applicazione che
    // contavano i siti in modo diverso. Il KML quelle coordinate le scriveva.
    const { siti, senzaCoordinate } = esportaKml([senzaGps, conGps]);
    const { xml } = exportUddf([senzaGps, conGps]);
    expect(siti).toBe(1);
    expect(senzaCoordinate).toEqual([]);
    expect(xml.match(/<site id=/g)).toHaveLength(1);
    expect(xml.match(/<geography>/g)).toHaveLength(1);
  });
});

describe('UDDF: gli identificativi dentro il documento', () => {
  it('sono unici, perché in XML un ID è unico nel documento', () => {
    /*
     * `id="cyl-0"` ripartiva da zero a ogni immersione: tre immersioni, tre
     * `cyl-0`. Un validatore rifiuta il file, e un lettore che risolva i
     * riferimenti sul documento intero attacca la pressione di un'immersione
     * alla bombola di un'altra.
     */
    const dueBombole = [
      { mix: AIR, sizeL: 15, startBar: 200, endBar: 70 },
      { mix: EAN50, sizeL: 7, startBar: 200, endBar: 150 },
    ];
    const { xml } = exportUddf([
      immersione({ id: 'a', cylinders: dueBombole }),
      immersione({ id: 'b', startTime: '2026-06-15T10:00:00.000Z', cylinders: dueBombole }),
      immersione({ id: 'c', startTime: '2026-06-16T10:00:00.000Z', cylinders: dueBombole }),
    ]);
    const ids = [...xml.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    const doppi = ids.filter((v, i) => ids.indexOf(v) !== i);
    expect(doppi).toEqual([]);
    // Sei bombole in tre immersioni: se fossero ancora `cyl-0..1` sarebbero due.
    expect(ids.filter((v) => v.includes('-cyl-'))).toHaveLength(6);
  });

  it('e ogni riferimento del profilo punta a una bombola che nel file esiste', () => {
    const { xml } = exportUddf([
      immersione({
        cylinders: [
          { mix: AIR, sizeL: 15, startBar: 200, endBar: 70 },
          { mix: EAN50, sizeL: 7, startBar: 200, endBar: 150 },
        ],
        samples: campioni(9).map((s, i) => ({ ...s, pressureBar: [190 - i, 180 - i] })),
      }),
    ]);
    const dichiarati = new Set([...xml.matchAll(/<tankdata id="([^"]+)"/g)].map((m) => m[1]));
    const riferiti = [...xml.matchAll(/<tankpressure ref="([^"]+)"/g)].map((m) => m[1]);
    expect(riferiti.length).toBeGreaterThan(0);
    expect(riferiti.filter((r) => !dichiarati.has(r))).toEqual([]);
  });
});

describe('UDDF: due bombole dello stesso gas', () => {
  /*
   * Due D12 ad aria in sidemount. `<switchmix ref="…">` riferisce il GAS, non la
   * bombola: rileggendo il file, la mappa da miscela a bombola teneva
   * l'ULTIMA `tankdata` che la collegava, quindi un `gasIndex` 0 tornava
   * indietro come 1 — sempre, anche senza aver mai cambiato bombola.
   */
  const sidemount = (gasIndex: number) =>
    immersione({
      cylinders: [
        { mix: AIR, sizeL: 12, startBar: 200, endBar: 80 },
        { mix: AIR, sizeL: 12, startBar: 200, endBar: 90 },
      ],
      samples: campioni(9).map((s) => ({ ...s, gasIndex })),
    });

  it('la prima resta la prima dopo il giro', async () => {
    const [d] = await giro([sidemount(0)]);
    expect((d.samples ?? []).map((s) => s.gasIndex)).toEqual(Array(9).fill(0));
  });

  it('e quando il file non può dire quale fosse, l’esportazione lo dichiara', () => {
    // Respirando la SECONDA, il formato non ha dove scriverlo: la perdita si
    // dichiara invece di lasciar credere che il giro sia fedele.
    const { perdite } = exportUddf([sidemount(1)]);
    expect(perdite.flatMap((p) => p.campi)).toContain('samples.gasIndex');
  });

  it('ma non lo dichiara quando non c’è niente da perdere', () => {
    // Stesso archivio, gas diversi: la bombola si ricava dal gas e la riga non
    // deve comparire.
    const { perdite } = exportUddf([
      immersione({
        cylinders: [
          { mix: AIR, sizeL: 12, startBar: 200, endBar: 80 },
          { mix: EAN50, sizeL: 7, startBar: 200, endBar: 150 },
        ],
        samples: campioni(9).map((s) => ({ ...s, gasIndex: 1 })),
      }),
    ]);
    expect(perdite.flatMap((p) => p.campi)).not.toContain('samples.gasIndex');
  });
});

describe('UDDF: quello che l’elenco delle perdite dice e quello che tace', () => {
  it('non annuncia il tipo di circuito a chi si immerge solo a circuito aperto', () => {
    /*
     * `mode` è obbligatorio nel modello, quindi `d.mode !== undefined` era vero
     * sempre: cento immersioni ad ARA e l'utente leggeva «un rebreather torna a
     * circuito aperto» senza avere un rebreather.
     */
    const cento = Array.from({ length: 100 }, (_, i) =>
      immersione({
        id: `oc${i}`,
        startTime: `2026-06-${String((i % 28) + 1).padStart(2, '0')}T10:00:00.000Z`,
      }),
    );
    expect(exportUddf(cento).perdite.flatMap((p) => p.campi)).not.toContain('mode');
  });

  it('e lo annuncia a chi il rebreather ce l’ha davvero', () => {
    const { perdite } = exportUddf([immersione({ mode: 'ccr' })]);
    expect(perdite.flatMap((p) => p.campi)).toContain('mode');
  });

  it('dichiara il secondo profilo anche quando non gli è stato dato', () => {
    /*
     * `exportArchive` passa i riepiloghi delle immersioni con i soli campioni
     * del profilo principale: `altSamples` lì dentro non c'è, quindi la
     * condizione `d.altSamples?.length` era falsa SEMPRE e l'avviso taceva
     * proprio nel caso normale. Da dentro l'esportazione «non ce l'ha» e «non
     * me l'hanno dato» sono lo stesso `undefined`: si dichiara il dubbio.
     */
    const riepilogo = immersione();
    delete riepilogo.altSamples;
    expect(exportUddf([riepilogo]).perdite.flatMap((p) => p.campi)).toContain('altSamples');
  });

  it('ma tace su un archivio che ha davvero risposto «nessun secondo profilo»', () => {
    const { perdite } = exportUddf([immersione({ altSamples: [] })]);
    expect(perdite.flatMap((p) => p.campi)).not.toContain('altSamples');
  });
});

describe('UDDF: la sigla della bombola non si inventa al reimport', () => {
  it('«D12 lungo» non torna indietro come «Aria»', async () => {
    /*
     * `description` è l'etichetta scritta dall'utente e UDDF non ha un posto per
     * lei: l'esportazione lo dichiara. Riempirla col nome della MISCELA non
     * recuperava niente e faceva peggio — sul file tornava un'etichetta che
     * nessuno aveva scritto, e con un 31.5% analizzato diceva «EAN32» mentre
     * `o2` valeva 0.315.
     */
    const [d] = await giro([
      immersione({
        cylinders: [{ mix: AIR, sizeL: 12, startBar: 200, endBar: 80, description: 'D12 lungo' }],
      }),
    ]);
    expect(d.cylinders[0].description).toBeUndefined();
  });

  it('e nemmeno leggendo un file scritto da altri', async () => {
    const xml = `<?xml version="1.0"?>
<uddf version="3.2.0"><gasdefinitions>
  <mix id="m1"><name>EAN32</name><o2>0.315</o2><he>0</he></mix>
</gasdefinitions>
<profiledata><repetitiongroup><dive>
  <informationbeforedive><datetime>2026-06-14T10:00:00</datetime></informationbeforedive>
  <tankdata id="t1"><link ref="m1"/><tankvolume>0.015</tankvolume></tankdata>
  <samples><waypoint><divetime>0</divetime><depth>0</depth></waypoint>
  <waypoint><divetime>1200</divetime><depth>18</depth></waypoint></samples>
  <informationafterdive><greatestdepth>18</greatestdepth><diveduration>1200</diveduration></informationafterdive>
</dive></repetitiongroup></profiledata></uddf>`;
    const { dives } = await parseFile({ fileName: 'sigla.uddf', text: xml });
    // La sigla direbbe 32 mentre il gas ne ha 31.5: due numeri per la stessa bombola.
    expect(dives[0].cylinders[0].description).toBeUndefined();
    expect(dives[0].cylinders[0].mix.o2).toBeCloseTo(0.315, 3);
  });
});

describe('CSV: la data e l’ora sono quelle del sito', () => {
  /*
   * MISURATO. Un'immersione delle 08:00 a UTC+14 usciva nel foglio come
   * «2026-03-14 18:00» mentre il logbook, il PDF e il libretto della stessa
   * immersione dicevano «15/03/2026 08:00»: non un'ora diversa, un GIORNO
   * diverso.
   */
  const aUtcPiu14 = immersione({
    startTime: '2026-03-14T18:00:00.000Z',
    utcOffsetMinutes: 840,
    site: { name: 'Kiritimati' },
  });

  const colonne = (csv: string) => {
    const righe = csv.replace(/^﻿/, '').split('\r\n');
    const intestazione = righe[1].split(';');
    const dati = righe[2].split(';');
    return (nome: string) => dati[intestazione.indexOf(nome)];
  };

  it('il giorno del foglio è il giorno dell’immersione, non quello di Greenwich', () => {
    const leggi = colonne(esportaCsv([aUtcPiu14]).csv);
    expect(leggi('Data')).toBe('2026-03-15');
    expect(leggi('Ora')).toBe('08:00');
  });

  it('e dice la stessa cosa del libretto, che è l’altro documento della stessa immersione', () => {
    // Il confronto è fra due strade dell'applicazione sullo stesso dato: è
    // quello che il difetto rompeva, e resta vero anche riscrivendo i formati.
    const leggi = colonne(esportaCsv([aUtcPiu14]).csv);
    const voci = libretto(aUtcPiu14);
    const [anno, mese, giorno] = leggi('Data').split('-');
    expect(voci.find((v) => v.lettera === 'c')?.valore).toBe(`${giorno}/${mese}/${anno}`);
    expect(voci.find((v) => v.lettera === 'e')?.valore).toBe(leggi('Ora'));
  });

  it('senza fuso dichiarato resta su UTC, come dichiara il resto dell’app', () => {
    const leggi = colonne(esportaCsv([immersione({ startTime: '2026-03-14T18:00:00.000Z' })]).csv);
    expect(leggi('Data')).toBe('2026-03-14');
    expect(leggi('Ora')).toBe('18:00');
  });
});

describe('CSV in ingresso: le unità dichiarate nell’intestazione', () => {
  const RIGA = '2026-09-13,09:51,57,30,14,30';
  const conUnita = `Date,Time,Duration,Max Depth (ft),Weight (lbs),Visibility (ft)\n${RIGA}`;
  const senzaUnita = `Date,Time,Duration,Max Depth,Weight,Visibility\n${RIGA}`;

  const leggi = (testo: string): Dive => csvParser.parse({ fileName: 'a.csv', text: testo }).dives[0];

  it('libbre e piedi vengono convertiti, non copiati', () => {
    /*
     * MISURATO. L'applicazione DICHIARA all'utente «unità dichiarate
     * nell'intestazione e applicate a tutta la colonna», poi `weightKg` e
     * `visibilityM` passavano da `parseNumber`, che l'unità non la guarda: 14
     * libbre entravano come 14 chili e 30 piedi come 30 metri. Una promessa
     * scritta a schermo e non mantenuta è peggio di nessuna promessa.
     */
    const d = leggi(conUnita);
    expect(d.weightKg).toBeCloseTo(6.4, 1);
    expect(d.visibilityM).toBeCloseTo(9.1, 1);
  });

  it('e lo stesso numero senza unità resta quello che è', () => {
    // È il confronto che dimostra la conversione: stessi numeri, intestazioni
    // diverse, valori diversi. Senza la conversione i due sarebbero identici.
    const d = leggi(senzaUnita);
    expect(d.weightKg).toBe(14);
    expect(d.visibilityM).toBe(30);
  });

  it('la frase detta all’utente elenca le colonne che vengono davvero convertite', () => {
    /*
     * Le libbre non erano fra le unità riconosciute, quindi quella colonna non
     * finiva nemmeno nell'elenco dell'avviso: l'utente non aveva modo di
     * accorgersi che non era stata convertita. Qui si controlla che ogni
     * colonna NOMINATA nell'avviso cambi davvero valore rispetto alla stessa
     * colonna senza unità — la frase e il fatto, insieme.
     */
    const { warnings } = csvParser.parse({ fileName: 'a.csv', text: conUnita });
    const avviso = warnings.find((w) => w.includes('Weight (lbs)'));
    expect(avviso).toBeDefined();
    expect(avviso).toContain('Visibility (ft)');
    expect(avviso).toContain('Max Depth (ft)');

    const con = leggi(conUnita);
    const senza = leggi(senzaUnita);
    expect(con.weightKg).not.toBe(senza.weightKg);
    expect(con.visibilityM).not.toBe(senza.visibilityM);
    expect(con.maxDepth).not.toBe(senza.maxDepth);
  });

  it('e una cella che porta la sua unità vince sull’intestazione', () => {
    const d = leggi(`Date,Time,Duration,Max Depth,Weight (lbs)\n2026-09-13,09:51,57,30,7 kg`);
    expect(d.weightKg).toBe(7);
  });
});

/**
 * Il testo scritto sulla pagina PDF, con la sua posizione e il suo corpo.
 *
 * Il formato scrive `BT /FB 7.5 Tf 1 0 0 1 x y Tm (testo) Tj ET`: leggendolo si
 * ha quello che un lettore di PDF disegnerebbe, che è l'unico modo di
 * controllare se un dato è finito sul foglio e se ci sta dentro.
 */
function testiDelPdf(pdf: string): { testo: string; x: number; y: number; corpo: number }[] {
  const re = /\/F[RB] ([\d.]+) Tf\n1 0 0 1 ([\d.-]+) ([\d.-]+) Tm\n\((.*)\) Tj/g;
  return [...pdf.matchAll(re)].map((m) => ({
    corpo: Number(m[1]),
    x: Number(m[2]),
    y: Number(m[3]),
    testo: m[4],
  }));
}

/**
 * La larghezza di un testo già sfuggito, stimata PER ECCESSO.
 *
 * Gli accenti e i simboli sul foglio sono sequenze ottali (`\267` per il punto
 * mediano): per misurarli servirebbe la tabella inversa. Si contano invece come
 * il carattere più largo che esista nella tabella — se la riga sta nel foglio
 * con questa stima, ci sta anche davvero. Una stima per difetto lascerebbe
 * passare proprio il caso che questa prova esiste per prendere.
 */
function larghezzaAlMassimo(sfuggito: string, corpo: number): number {
  const steso = sfuggito.replace(/\\\d{3}/g, '—').replace(/\\(.)/g, '$1');
  return larghezzaTesto(steso, corpo);
}

describe('PDF: la seconda bombola e il gas analizzato stanno sul foglio', () => {
  const CAMPIONI: Sample[] = Array.from({ length: 40 }, (_, i) => ({
    t: i * 60,
    depth: i < 20 ? i * 1.5 : (40 - i) * 1.5,
  }));

  const conDueBombole = (extra: Partial<Dive> = {}): Dive =>
    immersione({
      id: 'x1',
      site: { name: 'Camogli Gonzatti', region: 'Liguria', country: 'Italia' },
      cylinders: [
        {
          mix: { o2: 0.32, he: 0 },
          sizeL: 15,
          startBar: 210,
          endBar: 60,
          analisi: { o2: 0.32, quando: '2026-07-11T07:00:00Z' },
        },
        { mix: EAN50, sizeL: 7, startBar: 200, endBar: 150 },
      ],
      ...extra,
    });

  const foglio = (d: Dive) => schedePdf([d], new Map([[d.id, CAMPIONI]]), { now: '2026-08-23T10:00:00Z' });

  it('la stage non sparisce dietro i tre puntini', () => {
    /*
     * MISURATO. `accorcia(valore, 24)` su «15 L da 210 a 60 bar (32%
     * analizzato) · 7 L da 200 a 150 bar» — sessanta caratteri — lasciava sul
     * foglio «15 L da 210 a 60 bar…»: sparivano la stage E l'analisi del gas,
     * che è il dato per cui un centro o un istruttore chiede il foglio.
     */
    const pdf = foglio(conDueBombole());
    expect(pdf).toContain('7 L da 200 a 150 bar');
    expect(pdf).toContain('32% analizzato');
  });

  it('e ci sta dentro davvero: nessuna riga esce dal margine destro', () => {
    /*
     * La metà che rende la prova una guardia. Allargare il troncamento a
     * sessanta caratteri farebbe passare il controllo qui sopra e scriverebbe
     * la riga OLTRE il bordo del foglio, dove un lettore di PDF semplicemente
     * non la disegna: il dato tornerebbe a sparire, in un altro modo.
     */
    const pdf = foglio(conDueBombole());
    const fuori = testiDelPdf(pdf).filter((t) => t.x + larghezzaAlMassimo(t.testo, t.corpo) > 595 - 48);
    expect(fuori.map((t) => t.testo)).toEqual([]);
  });

  it('va a capo quando le bombole sono quattro, invece di tagliare', () => {
    const quattro = conDueBombole({
      cylinders: [
        { mix: AIR, sizeL: 15, startBar: 210, endBar: 60, analisi: { o2: 0.21 } },
        { mix: EAN50, sizeL: 7, startBar: 200, endBar: 150, analisi: { o2: 0.5 } },
        { mix: { o2: 1, he: 0 }, sizeL: 7, startBar: 200, endBar: 180, analisi: { o2: 1 } },
        { mix: { o2: 0.18, he: 0.45 }, sizeL: 12, startBar: 230, endBar: 90 },
      ],
    });
    const pdf = foglio(quattro);
    expect(pdf).toContain('12 L da 230 a 90 bar');
    const fuori = testiDelPdf(pdf).filter((t) => t.x + larghezzaAlMassimo(t.testo, t.corpo) > 595 - 48);
    expect(fuori.map((t) => t.testo)).toEqual([]);
  });

  it('e la nota non finisce mai dentro la firma dell’istruttore', () => {
    /*
     * Le firme stanno a un'altezza FISSA in fondo alla pagina, apposta. Il
     * limite delle note era di sei righe fisse e reggeva per diciassette punti:
     * una riga in più nel blocco delle bombole ci sarebbe passata sopra, su un
     * foglio che serve proprio a farsi firmare.
     */
    // Sei bombole: un CCR con diluente, ossigeno, due bailout e due deco. È il
    // caso che fa crescere di tre righe il blocco qui sopra, cioè quello che con
    // sei righe di nota fisse finiva dentro il riquadro della firma.
    const pdf = foglio(
      conDueBombole({
        cylinders: [
          { mix: AIR, sizeL: 15, startBar: 210, endBar: 60, analisi: { o2: 0.21 } },
          { mix: EAN50, sizeL: 7, startBar: 200, endBar: 150, analisi: { o2: 0.5 } },
          { mix: { o2: 1, he: 0 }, sizeL: 7, startBar: 200, endBar: 180, analisi: { o2: 1 } },
          { mix: { o2: 0.18, he: 0.45 }, sizeL: 12, startBar: 230, endBar: 90 },
          { mix: { o2: 0.32, he: 0 }, sizeL: 11, startBar: 200, endBar: 100, analisi: { o2: 0.32 } },
          {
            mix: { o2: 0.18, he: 0.45 },
            sizeL: 11,
            startBar: 200,
            endBar: 120,
            analisi: { o2: 0.18, he: 0.45 },
          },
        ],
        notes: Array.from({ length: 300 }, () => 'NOTA').join(' '),
      }),
    );
    // 48 + 64 + 4 + 40: la cima del riquadro in cui si ridisegna il tratto.
    const cimaDelleFirme = 156;
    const dentroLaFirma = testiDelPdf(pdf).filter((t) => t.testo.includes('NOTA') && t.y <= cimaDelleFirme);
    expect(dentroLaFirma).toEqual([]);
  });
});
