/**
 * Verifica il decoder del log nativo Shearwater contro un database reale.
 *
 *   npm run validate:pnf ~/percorso/al/database.db
 *
 * Il metodo: ogni log contiene i campioni, e Shearwater Cloud tiene accanto i
 * valori che ha calcolato per conto suo da quegli stessi campioni (profondità
 * media e massima, temperatura minima e massima, durata, obbligo decompressivo).
 * Sono due letture indipendenti dello stesso dato: se coincidono, il decoder
 * legge i byte giusti. Nessun dato personale entra nel repository — lo script
 * riceve il percorso del file e stampa solo scostamenti e impostazioni.
 */

import sqlite3 from 'node:sqlite';
import { decodePnfBlob } from '../src/core/parsers/shearwaterPnf';

const path = process.argv[2];
if (!path) {
  console.error('Uso: npm run validate:pnf <database di Shearwater Cloud>');
  process.exit(1);
}
/*
 * `node:sqlite` è sperimentale e i suoi tipi non sono ancora pubblicati, quindi
 * la forma va dichiarata qui invece di zittire il controllo con un `any`: un
 * `any` toglie il messaggio del compilatore e con lui anche il controllo, e su
 * uno script che legge un database altrui è proprio dove serve.
 */
interface RigaLog {
  log_id: number;
  file_name: string;
  /** JSON, come stringa o come blob a seconda del driver. */
  cv: string | Uint8Array;
  blob: Uint8Array;
  hdr: string | Uint8Array;
}
interface DatabaseSync {
  prepare(sql: string): { all(): unknown[] };
}
const db = new (sqlite3 as unknown as { DatabaseSync: new (p: string) => DatabaseSync }).DatabaseSync(path);
const rows = db
  .prepare(
    `select l.log_id, l.file_name, l.calculated_values_from_samples as cv,
  l.data_bytes_1 as blob, l.data_bytes_3 as hdr from log_data l order by l.created_unixtime`,
  )
  .all() as RigaLog[];

let ok = 0;
const problems: string[] = [];
const settingsSeen = new Map<string, number>();
for (const r of rows) {
  const dec = (v: string | Uint8Array) => (typeof v === 'string' ? v : Buffer.from(v).toString('utf8'));
  const cv = JSON.parse(dec(r.cv));
  const hdr = JSON.parse(dec(r.hdr));
  let log;
  try {
    log = decodePnfBlob(new Uint8Array(r.blob));
  } catch (err) {
    problems.push(`${r.file_name}: ${(err as Error).message}`);
    continue;
  }
  const depths = log.samples.map((s) => s.depth);
  // Anche le temperature vanno prese sui soli campioni in acqua: un campione in
  // superficie a 23 °C alzava il massimo di un grado su un'immersione.
  const temps = log.samples
    .filter((s) => s.depth > 0)
    .map((s) => s.tempC)
    .filter((t): t is number => t !== undefined);
  // La media di Shearwater Cloud esclude i campioni a profondità zero: verificato
  // su tutti i log, dove così coincide alla terza cifra decimale.
  const wet = depths.filter((d) => d > 0);
  const avg = wet.reduce((a, b) => a + b, 0) / wet.length;
  const maxD = log.maxDepth ?? Math.max(...depths);
  const minT = Math.min(...temps);
  const maxT = Math.max(...temps);
  const decoMin = Math.max(0, ...log.samples.map((s) => (s.stopTimeS ?? 0) / 60));
  // `MinNDL` di Shearwater Cloud vale 99 su tutte le immersioni — è il fondo
  // scala, non una misura — quindi non è un termine di confronto. L'NDL vero,
  // campione per campione, esce dai campioni, e questo script non lo confronta
  // con niente: la riga che lo calcolava è stata tolta perché il valore non
  // veniva letto da nessuno, ed era una scansione completa dei campioni per
  // buttarla via.

  const checks: [string, number, number, number][] = [
    ['AverageDepth', avg, cv.AverageDepth, 0.005],
    ['MaxDepth', maxD, hdr.MaxDepth, 0.001],
    ['MinTemp', minT, cv.MinTemp, 0.001],
    ['MaxTemp', maxT, cv.MaxTemp, 0.001],
    ['MaxDecoObligation', decoMin, cv.MaxDecoObligation, 0.01],
    ['DiveTime', log.durationS ?? 0, hdr.DiveTimeInSeconds, 0.001],
  ];
  let fail = false;
  for (const [name, mine, theirs, tol] of checks) {
    if (theirs === undefined || theirs === null) continue;
    if (Math.abs(mine - theirs) > tol) {
      problems.push(`${r.file_name}: ${name} mio=${mine.toFixed(2)} loro=${theirs} `);
      fail = true;
    }
  }
  if (!fail) ok++;
  const key = JSON.stringify({
    ...log.settings,
    model: log.computer.model,
    fw: log.computer.firmware,
    serial: log.computer.serial,
    gases: log.gases,
  });
  settingsSeen.set(key, (settingsSeen.get(key) ?? 0) + 1);
}
console.log(`log verificati senza scostamenti: ${ok}/${rows.length}`);
console.log(
  '(confronto con i valori che Shearwater Cloud calcola per conto suo: profondità media e massima, temperatura minima e massima, durata, obbligo deco)',
);
if (problems.length) console.log('PROBLEMI:\n' + problems.slice(0, 25).join('\n'));
console.log('\nimpostazioni distinte trovate:');
for (const [k, n] of settingsSeen) console.log(`  ×${n}`, k);
const one = decodePnfBlob(new Uint8Array(rows[rows.length - 1].blob));
console.log(
  '\nesempio ultimo log:',
  JSON.stringify(
    {
      computer: one.computer,
      settings: one.settings,
      gases: one.gases,
      tanks: one.tanks,
      entry: one.entry,
      exit: one.exit,
      bookmarks: one.bookmarks.length,
      notes: one.notes,
      samples: one.samples.length,
    },
    null,
    1,
  ),
);
console.log('primi campioni:', JSON.stringify(one.samples.slice(0, 3)));
console.log(
  'campione più profondo:',
  JSON.stringify(one.samples.reduce((a, b) => (b.depth > a.depth ? b : a))),
);
