/**
 * I siti d'immersione su una mappa vera.
 *
 * PERCHÉ NON BASTA LA PAGINA DELLE STATISTICHE. Il grafico dei siti in
 * `Stats.tsx` dichiara di non essere una mappa: sotto non c'è cartografia, sono
 * bolle disposte secondo latitudine e longitudine. Va benissimo per vedere che
 * ci si immerge in tre zone e non in dieci, e non risponde alla domanda
 * successiva — *dov'è esattamente quel punto, e cosa c'è intorno*. Per quella
 * serve una mappa, e una mappa non la si scrive: si esporta verso chi le fa.
 *
 * KML e non GeoJSON perché KML lo aprono con un doppio clic Google Earth, Google
 * My Maps, Gaia, Marine Traffic e la maggior parte dei plotter: è il formato che
 * porta il dato dove serve senza chiedere niente a nessuno. GeoJSON è più pulito
 * e richiede un programma che qualcuno deve già avere.
 *
 * UN SEGNAPOSTO PER SITO, NON PER IMMERSIONE. Trentadue immersioni a Moregallo
 * darebbero trentadue segnaposti sovrapposti nello stesso punto: una macchia
 * illeggibile che nasconde gli altri siti. Un segnaposto per sito, con dentro
 * quante immersioni ci hai fatto e quando, è l'unica forma che risponde alla
 * domanda «dove mi immergo».
 *
 * LE COORDINATE ARRIVANO DA POCHI FORMATI. Shearwater Cloud le ha, l'UDDF a
 * volte, gli altri quasi mai. I siti senza coordinate non si inventano e non si
 * scartano in silenzio: escono nel conteggio `senzaCoordinate`, così chi esporta
 * sa perché la mappa ha meno posti del suo logbook.
 */

import type { Dive } from '../model';

export interface RisultatoKml {
  kml: string;
  /** Segnaposti scritti: uno per sito con coordinate. */
  siti: number;
  /** Siti scartati perché nessuna delle loro immersioni porta le coordinate. */
  senzaCoordinate: string[];
}

/** Escape XML. I nomi dei siti contengono di tutto, ampersand compresi. */
function esc(v: string): string {
  return v
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

interface Sito {
  nome: string;
  zona?: string;
  paese?: string;
  lat: number;
  lon: number;
  immersioni: number;
  prima: string;
  ultima: string;
  profonditaMax: number;
}

/**
 * Raggruppa per NOME del sito, non per coordinata.
 *
 * Due immersioni allo stesso posto arrivate da computer diversi hanno spesso
 * coordinate leggermente diverse — il GPS le prende in superficie, e la barca
 * si sposta. Raggruppare per coordinata darebbe due segnaposti a dieci metri
 * l'uno dall'altro con lo stesso nome, che è esattamente il disordine che
 * questo file esiste per evitare. Vince la PRIMA coordinata vista: le altre
 * sono lo stesso posto con un errore di misura, e sceglierne una vale quanto
 * fare una media che nessuno può verificare.
 */
function raggruppa(dives: Dive[]): { siti: Sito[]; senzaCoordinate: string[] } {
  const perNome = new Map<string, Sito>();
  const senza = new Map<string, true>();

  for (const d of dives) {
    const nome = d.site?.name?.trim();
    if (!nome) continue;
    const { lat, lon } = d.site ?? {};
    if (lat === undefined || lon === undefined || !Number.isFinite(lat) || !Number.isFinite(lon)) {
      if (!perNome.has(nome)) senza.set(nome, true);
      continue;
    }
    const giorno = d.startTime.slice(0, 10);
    const esistente = perNome.get(nome);
    if (esistente) {
      esistente.immersioni += 1;
      if (giorno < esistente.prima) esistente.prima = giorno;
      if (giorno > esistente.ultima) esistente.ultima = giorno;
      esistente.profonditaMax = Math.max(esistente.profonditaMax, d.maxDepth);
    } else {
      perNome.set(nome, {
        nome,
        zona: d.site?.region,
        paese: d.site?.country,
        lat,
        lon,
        immersioni: 1,
        prima: giorno,
        ultima: giorno,
        profonditaMax: d.maxDepth,
      });
      // Un sito che prima compariva senza coordinate e adesso ne ha: non è più
      // un buco, e va tolto dall'elenco di quelli scartati.
      senza.delete(nome);
    }
  }

  const siti = [...perNome.values()].sort((a, b) => b.immersioni - a.immersioni);
  return { siti, senzaCoordinate: [...senza.keys()].sort() };
}

/**
 * Tre stili invece di uno: la dimensione dice quanto ci vai.
 *
 * Un segnaposto identico per un sito fatto una volta e per quello di casa
 * butta via l'informazione più utile che questa mappa possa dare. Tre scaglioni
 * e non una scala continua perché una mappa si legge a colpo d'occhio, e sette
 * dimensioni intermedie non si distinguono comunque.
 */
function stileDi(immersioni: number): string {
  return immersioni >= 10 ? 'sito-molte' : immersioni >= 3 ? 'sito-alcune' : 'sito-una';
}

export interface OpzioniKml {
  /** Il nome del documento dentro il file. */
  titolo?: string;
  /** Le etichette dentro le schede dei segnaposti: `'it'` o `'en'`. */
  lingua?: 'it' | 'en';
}

const TESTI = {
  it: {
    titolo: 'MyDiveLog — i miei siti',
    immersione: 'immersione',
    immersioni: 'immersioni',
    dal: 'dal',
    al: 'al',
    prof: 'profondità massima',
  },
  en: {
    titolo: 'MyDiveLog — my dive sites',
    immersione: 'dive',
    immersioni: 'dives',
    dal: 'from',
    al: 'to',
    prof: 'max depth',
  },
} as const;

export function esportaKml(dives: Dive[], opzioni: OpzioniKml = {}): RisultatoKml {
  const lingua = opzioni.lingua ?? 'it';
  const T = TESTI[lingua];
  const { siti, senzaCoordinate } = raggruppa(dives);

  const segnaposti = siti.map((s) => {
    const quante = `${s.immersioni} ${s.immersioni === 1 ? T.immersione : T.immersioni}`;
    const periodo = s.prima === s.ultima ? s.prima : `${T.dal} ${s.prima} ${T.al} ${s.ultima}`;
    const luogo = [s.zona, s.paese].filter(Boolean).join(', ');
    /*
     * La descrizione è testo semplice dentro CDATA, non HTML.
     *
     * Google Earth mostra l'HTML, i plotter no: chi apre il file su un
     * cartografico si ritroverebbe i tag scritti a schermo. Tre righe di testo
     * si leggono ovunque.
     */
    const descrizione = [quante, periodo, `${T.prof} ${s.profonditaMax.toFixed(1)} m`, luogo]
      .filter(Boolean)
      .join('\n');
    return [
      '    <Placemark>',
      `      <name>${esc(s.nome)}</name>`,
      `      <description><![CDATA[${descrizione}]]></description>`,
      `      <styleUrl>#${stileDi(s.immersioni)}</styleUrl>`,
      // KML vuole longitudine PRIMA della latitudine: è l'inverso di come si
      // scrivono di solito, ed è l'errore più comune con questo formato.
      `      <Point><coordinates>${s.lon},${s.lat},0</coordinates></Point>`,
      '    </Placemark>',
    ].join('\n');
  });

  const stile = (id: string, scala: number) =>
    [
      `    <Style id="${id}">`,
      '      <IconStyle>',
      `        <scale>${scala}</scale>`,
      '        <Icon><href>http://maps.google.com/mapfiles/kml/shapes/water.png</href></Icon>',
      '      </IconStyle>',
      '    </Style>',
    ].join('\n');

  const kml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<kml xmlns="http://www.opengis.net/kml/2.2">',
    '  <Document>',
    `    <name>${esc(opzioni.titolo ?? T.titolo)}</name>`,
    stile('sito-una', 0.9),
    stile('sito-alcune', 1.2),
    stile('sito-molte', 1.6),
    ...segnaposti,
    '  </Document>',
    '</kml>',
    '',
  ].join('\n');

  return { kml, siti: siti.length, senzaCoordinate };
}
