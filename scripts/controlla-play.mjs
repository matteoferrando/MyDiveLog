/**
 * I vincoli di Google Play sulle immagini della scheda, misurati sui file veri.
 *
 *   node scripts/controlla-play.mjs
 *
 * ► PERCHÉ ESISTE. ◄ Play rifiuta il caricamento quando un'immagine ha il
 * rapporto sbagliato, **senza dire quale**: si carica una cartella di sedici
 * file e si riceve un errore che non nomina niente. E il rapporto sbagliato non
 * si vede a occhio — 1080×1919 e 1080×1920 sono la stessa immagine per chi
 * guarda, e una delle due non entra. Quindi si misura, e si misura sui byte del
 * file invece che su come sono stati chiesti allo strumento che li ha prodotti:
 * *il nome della cartella e la riga di codice che ha scattato la fotografia
 * sono etichette, e un'etichetta può essere sbagliata.*
 *
 * Le misure si leggono dall'intestazione PNG a mano — dodici byte, `IHDR` —
 * invece di tirare dentro una libreria di immagini per leggere due interi.
 * Stessa scelta di `inflate.ts` e del lettore SQLite scritti a mano.
 *
 * I limiti vengono dal modulo di Play, riquadro per riquadro, e sono diversi
 * fra loro: il tablet da 10 pollici pretende almeno 1080 per lato dove il
 * telefono si accontenta di 320.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const RADICE = fileURLToPath(new URL('..', import.meta.url));
export const CARTELLA = path.join(RADICE, '_transfer/play');

/** Larghezza e altezza dall'`IHDR` di un PNG. Zero dipendenze. */
export function misura(file) {
  const d = readFileSync(file);
  const png = d.subarray(0, 8).toString('hex') === '89504e470d0a1a0a';
  if (!png) throw new Error(`${path.basename(file)}: non è un PNG`);
  return {
    larghezza: d.readUInt32BE(16),
    altezza: d.readUInt32BE(20),
    profondita: d[24],
    tipoColore: d[25],
    byte: statSync(file).size,
  };
}

const MB = 1024 * 1024;

/** I cinque riquadri del modulo, con i vincoli di ciascuno. */
export const RIQUADRI = [
  {
    nome: 'icona',
    prefisso: 'icona-512',
    esatte: [512, 512],
    maxByte: 1024 * 1024,
    minimo: 1,
    massimo: 1,
  },
  {
    nome: 'feature graphic',
    prefisso: 'feature-graphic',
    esatte: [1024, 500],
    maxByte: 15 * MB,
    minimo: 1,
    massimo: 1,
  },
  {
    nome: 'telefono',
    prefisso: 'telefono-',
    rapporto: true,
    lato: [320, 3840],
    maxByte: 8 * MB,
    minimo: 2,
    massimo: 8,
  },
  {
    nome: 'tablet 7 pollici',
    prefisso: 'tablet7-',
    rapporto: true,
    lato: [320, 3840],
    maxByte: 8 * MB,
    minimo: 1,
    massimo: 8,
  },
  {
    nome: 'tablet 10 pollici',
    prefisso: 'tablet10-',
    rapporto: true,
    lato: [1080, 7680],
    maxByte: 8 * MB,
    minimo: 1,
    massimo: 8,
  },
];

/**
 * 16:9 o 9:16, e **esatti**. Si confronta con una moltiplicazione incrociata e
 * non con una divisione: `1080/1920` e `9/16` sono uguali in virgola mobile
 * oggi, e un giorno con altri numeri non lo sarebbero — e un rapporto che
 * «quasi» torna è esattamente quello che Play rifiuta.
 */
export function rapportoBuono(l, a) {
  return l * 9 === a * 16 || l * 16 === a * 9;
}

export function controlla() {
  const file = readdirSync(CARTELLA).filter((f) => f.endsWith('.png'));
  const guai = [];
  const righe = [];

  for (const r of RIQUADRI) {
    const suoi = file.filter((f) => f.startsWith(r.prefisso)).sort();
    if (suoi.length < r.minimo) guai.push(`${r.nome}: ${suoi.length} file, ne servono almeno ${r.minimo}`);
    if (suoi.length > r.massimo) guai.push(`${r.nome}: ${suoi.length} file, il massimo è ${r.massimo}`);

    /*
     * ► DUE FILE PER LA STESSA SCHERMATA SONO UN RESIDUO, NON UNA SCELTA. ◄
     *
     * Successo davvero: rinumerando le fotografie da cinque a sei, quelle con i
     * numeri vecchi sono rimaste sul disco accanto a quelle nuove. Otto file per
     * apparecchio — che è **esattamente** il massimo che Play accetta, quindi il
     * conteggio non si è accorto di niente — e dentro c'erano `3-statistiche` e
     * `4-statistiche`, la stessa schermata due volte. Caricandoli, la scheda
     * avrebbe mostrato due volte la stessa cosa.
     *
     * La regola guarda il nome DOPO il numero: due file che raccontano la stessa
     * schermata sono un residuo di una rinumerazione, sempre.
     */
    const scene = new Map();
    for (const f of suoi) {
      const scena = f.replace(r.prefisso, '').replace(/^\d+-/, '');
      if (scene.has(scena))
        guai.push(`${f}: stessa schermata di ${scene.get(scena)} — residuo di una rinumerazione`);
      else scene.set(scena, f);
    }

    for (const f of suoi) {
      const m = misura(path.join(CARTELLA, f));
      const g = [];
      if (r.esatte && (m.larghezza !== r.esatte[0] || m.altezza !== r.esatte[1]))
        g.push(`deve essere ${r.esatte[0]}×${r.esatte[1]}`);
      if (r.rapporto && !rapportoBuono(m.larghezza, m.altezza)) g.push('non è 16:9 né 9:16');
      if (r.lato) {
        for (const [etichetta, v] of [
          ['larghezza', m.larghezza],
          ['altezza', m.altezza],
        ]) {
          if (v < r.lato[0] || v > r.lato[1]) g.push(`${etichetta} ${v} fuori da ${r.lato[0]}–${r.lato[1]}`);
        }
      }
      if (m.byte > r.maxByte)
        g.push(`pesa ${(m.byte / MB).toFixed(2)} MB, il massimo è ${(r.maxByte / MB).toFixed(0)} MB`);
      righe.push(
        `  ${g.length ? '✗' : '✓'} ${f.padEnd(30)} ${m.larghezza}×${m.altezza}  ${(m.byte / 1024).toFixed(0)} kB${g.length ? '  → ' + g.join('; ') : ''}`,
      );
      for (const x of g) guai.push(`${f}: ${x}`);
    }
    righe.push('');
  }

  return { righe, guai };
}

// Lanciato da solo stampa e fallisce; importato, lascia decidere a chi importa.
if (import.meta.url === `file://${process.argv[1]}`) {
  const { righe, guai } = controlla();
  console.log(righe.join('\n'));
  if (guai.length) {
    console.error('NON VA:\n' + guai.map((g) => '  - ' + g).join('\n'));
    process.exit(1);
  }
  console.log('Tutto dentro i vincoli di Play.');
}
