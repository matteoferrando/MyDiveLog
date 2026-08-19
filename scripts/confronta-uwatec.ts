/**
 * Perché la stessa immersione arrivata da due strade non si riconosce.
 *
 *   npx tsx scripts/confronta-uwatec.ts grezzi.json export.logtrak
 *
 * IL PROBLEMA CHE RISOLVE. Un'immersione scaricata via Bluetooth e la stessa
 * immersione importata dal file di LogTRAK dovrebbero essere la stessa riga in
 * archivio. Quando non lo sono, la domanda è quale dei tre criteri di
 * `likelySame` non combacia — orario, profondità, durata — e di quanto. A
 * schermo quella risposta non c'è: si vedono due righe, e basta.
 *
 * Questo script la dà. Prende i byte grezzi salvati dalla schermata dello
 * scarico («Salva i dati grezzi») e il file `.logtrak`, decodifica entrambi con
 * gli STESSI decodificatori dell'app, e per ogni coppia stampa i due valori e
 * il verdetto.
 *
 * PERCHÉ NON PARLA IN BLUETOOTH. Perché da Node su macOS servirebbe un modulo
 * nativo e il permesso Bluetooth al Terminale, e si arriverebbe esattamente
 * agli stessi byte che l'app ha già in mano. I byte salvati su file valgono di
 * più: restano, e il confronto si rifà mille volte senza il computer davanti.
 */

import { readFileSync } from 'node:fs';
import { uwatecDriver } from '../src/core/ble/drivers/uwatec';
import { logtrakParser } from '../src/core/parsers/logtrak';
import { likelySame, similar } from '../src/core/dedupe';
import type { Dive } from '../src/core/model';

const [, , fileGrezzi, fileLogtrak] = process.argv;
if (!fileGrezzi || !fileLogtrak) {
  console.error('Uso: npx tsx scripts/confronta-uwatec.ts <grezzi.json> <export.logtrak>');
  process.exit(1);
}

// --------------------------------------------------------------- i due lati

interface Grezzi {
  driver: string;
  model?: string;
  serial?: string;
  records: { key: string; base64: string }[];
}

const grezzi = JSON.parse(readFileSync(fileGrezzi, 'utf8')) as Grezzi;
const records = grezzi.records.map((r) => ({ key: r.key, bytes: Buffer.from(r.base64, 'base64') }));
const daBluetooth = uwatecDriver.decode(records.map((r) => ({ key: r.key, bytes: new Uint8Array(r.bytes) })));

const testoLogtrak = readFileSync(fileLogtrak, 'utf8');
const daFile = logtrakParser.parse({ fileName: fileLogtrak, text: testoLogtrak });

console.log(
  `Bluetooth: ${daBluetooth.dives.length} immersioni (${grezzi.model ?? '?'}, seriale ${grezzi.serial ?? '?'})`,
);
console.log(`File:      ${daFile.dives.length} immersioni`);
for (const w of daBluetooth.warnings) console.log(`  ⚠ BLE  ${w}`);
for (const w of daFile.warnings) console.log(`  ⚠ file ${w}`);
console.log('');

// --------------------------------------------------- accoppiamento per data

/**
 * Si accoppia per GIORNO, non per orario.
 *
 * Se l'orario fosse il criterio, uno scarto sistematico di due ore — che è una
 * delle ipotesi da verificare — farebbe risultare zero coppie e lo script non
 * direbbe niente. Il giorno regge anche con qualche ora di scarto, ed è
 * abbastanza selettivo: due immersioni lo stesso giorno si distinguono per
 * profondità e durata.
 */
const giorno = (d: Dive) => d.startTime.slice(0, 10);
const ora = (d: Dive) => new Date(d.startTime).toISOString().slice(11, 16);
const min = (s: number) => `${Math.round(s / 60)} min`;

const perGiorno = new Map<string, Dive[]>();
for (const d of daFile.dives) {
  const g = perGiorno.get(giorno(d)) ?? [];
  g.push(d);
  perGiorno.set(giorno(d), g);
}

let combaciano = 0;
const orfane: Dive[] = [];
const scarti: number[] = [];

for (const b of daBluetooth.dives) {
  const candidati = perGiorno.get(giorno(b)) ?? [];
  // Il candidato più vicino nel tempo fra quelli dello stesso giorno.
  let migliore: Dive | undefined;
  let distanza = Infinity;
  for (const f of candidati) {
    const dt = Math.abs(Date.parse(b.startTime) - Date.parse(f.startTime));
    if (dt < distanza) {
      distanza = dt;
      migliore = f;
    }
  }

  if (!migliore) {
    orfane.push(b);
    continue;
  }

  const stesse = likelySame(b, migliore);
  if (stesse) combaciano++;
  scarti.push((Date.parse(b.startTime) - Date.parse(migliore.startTime)) / 1000);

  if (stesse) continue;

  // ------------------------------------------------- il verdetto, criterio per criterio
  const okProf = similar(b.maxDepth, migliore.maxDepth, 1);
  const okMedia = !b.avgDepth || !migliore.avgDepth || similar(b.avgDepth, migliore.avgDepth, 1);
  const okDurata = !!b.durationS && !!migliore.durationS && similar(b.durationS, migliore.durationS, 300);
  const finestra = Math.max(60, Math.max(b.durationS, migliore.durationS) / 2);
  const dt = (Date.parse(b.startTime) - Date.parse(migliore.startTime)) / 1000;
  const okOrario = Math.abs(dt) <= finestra;

  console.log(`${giorno(b)} — NON si fondono`);
  console.log(
    `  orario     BLE ${ora(b)}   file ${ora(migliore)}   scarto ${dt >= 0 ? '+' : ''}${Math.round(dt)} s` +
      `   (finestra ±${Math.round(finestra)} s) ${okOrario ? 'ok' : '✗'}`,
  );
  console.log(
    `  profondità BLE ${b.maxDepth.toFixed(1)} m  file ${migliore.maxDepth.toFixed(1)} m ${okProf ? 'ok' : '✗'}`,
  );
  console.log(
    `  media      BLE ${b.avgDepth?.toFixed(1) ?? '—'} m  file ${migliore.avgDepth?.toFixed(1) ?? '—'} m ${okMedia ? 'ok' : '✗'}`,
  );
  console.log(
    `  durata     BLE ${min(b.durationS)}  file ${min(migliore.durationS)} ${okDurata ? 'ok' : '✗'}`,
  );
  console.log(
    `  campioni   BLE ${b.samples?.length ?? 0}  file ${migliore.samples?.length ?? 0}` +
      (migliore.samples?.length ? '' : '   ← il file non conteneva il profilo'),
  );
  console.log('');
}

// ------------------------------------------------------------------ riepilogo

console.log('─'.repeat(60));
console.log(`Si fondono:            ${combaciano} su ${daBluetooth.dives.length}`);
console.log(`Senza pari nel file:   ${orfane.length}`);
for (const o of orfane)
  console.log(`   ${giorno(o)} ${ora(o)} · ${o.maxDepth.toFixed(1)} m · ${min(o.durationS)}`);

if (scarti.length) {
  const ordinati = [...scarti].sort((a, b) => a - b);
  const mediana = ordinati[Math.floor(ordinati.length / 2)];
  console.log('');
  console.log(`Scarto di orario, mediana: ${mediana >= 0 ? '+' : ''}${Math.round(mediana)} s`);
  /*
   * Un valore mediano vicino a un numero tondo di ore è la firma di un problema
   * di FUSO, non di un errore di lettura: significa che i due lati leggono lo
   * stesso contatore ma uno lo considera UTC e l'altro ora locale. Un valore
   * sparso, invece, è la deriva dell'orologio del computer, che è un'altra cosa
   * e non si corregge nel codice.
   */
  const ore = mediana / 3600;
  if (Math.abs(ore - Math.round(ore)) < 0.05 && Math.abs(ore) >= 0.9) {
    console.log(
      `  → è esattamente ${Math.round(ore)} ore: è un problema di FUSO ORARIO, non di lettura dei byte.` +
        ' Uno dei due lati considera il contatore del computer come UTC e l’altro come ora locale.',
    );
  } else if (Math.abs(mediana) > 120) {
    const spread = ordinati[ordinati.length - 1] - ordinati[0];
    console.log(
      `  → non è un numero tondo di ore e gli scarti coprono ${Math.round(spread)} s:` +
        ' assomiglia alla deriva dell’orologio del computer, non a un errore di interpretazione.',
    );
  }
}
