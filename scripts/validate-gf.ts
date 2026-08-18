/**
 * Valida il nostro Bühlmann contro quello di Shearwater.
 *
 *   npm run validate:gf <database.db|cartella>
 *
 * Shearwater Cloud calcola il GF99 all'uscita con la propria implementazione e lo
 * salva accanto ai campioni. Sono valori di controllo su dati veri, prodotti da un
 * codice che non è il nostro: è l'unico modo onesto di sapere se il modello che
 * abbiamo scritto è un modello o un generatore di numeri plausibili.
 *
 * Cosa aspettarsi. Due implementazioni di ZH-L16C non danno mai lo stesso decimo:
 * cambiano la densità dell'acqua usata, il passo di integrazione, il vapore
 * acqueo, il modo di trattare la discesa dentro un campione. Uno scarto di qualche
 * punto percentuale è fisiologico; uno scarto sistematico nella stessa direzione
 * dice che una costante è sbagliata; uno scarto che cresce con la durata dice che
 * è l'integrazione a divergere.
 */

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { shearwaterCloudParser } from '../src/core/parsers/shearwaterCloud';
import { desaturate, runProfile, surfacedTissues } from '../src/core/analysis/buhlmann';
import type { Dive } from '../src/core/model';

const arg = process.argv[2];
if (!arg) {
  console.error('Uso: npm run validate:gf <database.db|cartella>');
  process.exit(1);
}

async function filesFrom(path: string): Promise<string[]> {
  try {
    const entries = await readdir(path);
    return entries.filter((f) => f.endsWith('.db')).map((f) => join(path, f));
  } catch {
    return [path];
  }
}

const rows: { dive: Dive; theirs: number; ours: number; repetitive: boolean }[] = [];
const parsed: Dive[] = [];

for (const file of await filesFrom(arg)) {
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await readFile(file));
  } catch {
    // Un percorso sbagliato è l'errore più probabile qui, e una pila di
    // eccezioni non aiuta chi sta cercando il file giusto.
    console.error(`Non riesco a leggere ${file}.`);
    console.error(
      'Serve il database di Shearwater Cloud (un file .db), oppure la cartella che lo contiene.',
    );
    process.exit(1);
  }
  let result;
  try {
    result = await shearwaterCloudParser.parse({ fileName: file, bytes });
  } catch (err) {
    console.error(`${file} non sembra un database di Shearwater Cloud: ${(err as Error).message}`);
    continue;
  }
  parsed.push(...result.dives);
}

/**
 * Le immersioni si incatenano in ordine cronologico.
 *
 * Ogni tuffo parte dai tessuti con cui è finito il precedente, desaturati per la
 * durata dell'intervallo di superficie. Senza questo, ogni ripetitiva riparte da
 * tessuti puliti: è il motivo per cui i nostri GF99 uscivano sistematicamente
 * sotto quelli del computer, e tanto più sotto quanto più la seconda immersione
 * della giornata era impegnativa.
 *
 * Oltre le ventiquattro ore la desaturazione è praticamente completa e la catena
 * si spezza da sola: non serve una regola per dire "questa è una nuova giornata".
 */
parsed.sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime));

let state = surfacedTissues();
let previousEnd: number | undefined;

for (const dive of parsed) {
  if (!dive.samples?.length) continue;
  const start = Date.parse(dive.startTime);
  const surfaceMinutes = previousEnd === undefined ? Infinity : (start - previousEnd) / 60_000;
  const repetitive = Number.isFinite(surfaceMinutes) && surfaceMinutes < 12 * 60;

  const surfacePressureBar = dive.surfacePressureBar;
  state = Number.isFinite(surfaceMinutes)
    ? desaturate(state, surfaceMinutes, surfacePressureBar)
    : surfacedTissues(surfacePressureBar);

  const result = runProfile(dive.samples, {
    mixOf: (s) => dive.cylinders[s.gasIndex ?? 0]?.mix ?? dive.cylinders[0]?.mix,
    mix: dive.cylinders[0]?.mix ?? { o2: 0.21, he: 0 },
    gfLow: (dive.computer?.gfLow ?? 30) / 100,
    gfHigh: (dive.computer?.gfHigh ?? 85) / 100,
    salinity: dive.salinity ?? 'salt',
    surfacePressureBar,
    initial: state,
  });
  state = result.state;
  previousEnd = start + dive.durationS * 1000;

  const theirs = dive.reported?.gf99End;
  if (theirs !== undefined) rows.push({ dive, theirs, ours: result.gf99End, repetitive });
}

if (rows.length === 0) {
  console.log('Nessuna immersione con GF99 riportato da Shearwater in questi file.');
  process.exit(0);
}

console.log(
  `${'data'.padEnd(12)} ${'prof'.padStart(6)} ${'durata'.padStart(7)} ${'GF'.padStart(7)} ` +
    `${'rip'.padStart(4)} ${'loro'.padStart(6)} ${'noi'.padStart(6)} ${'scarto'.padStart(7)}`,
);
let sum = 0;
let sumAbs = 0;
let worst = { delta: 0, label: '' };
for (const { dive, theirs, ours } of rows.sort((a, b) => a.dive.startTime.localeCompare(b.dive.startTime))) {
  const delta = ours - theirs;
  sum += delta;
  sumAbs += Math.abs(delta);
  if (Math.abs(delta) > Math.abs(worst.delta)) {
    worst = { delta, label: `${dive.startTime.slice(0, 10)} ${dive.site?.name ?? ''}`.trim() };
  }
  console.log(
    `${dive.startTime.slice(0, 10).padEnd(12)} ${dive.maxDepth.toFixed(1).padStart(6)} ` +
      `${Math.round(dive.durationS / 60).toString().padStart(7)} ` +
      `${`${dive.computer?.gfLow ?? '?'}/${dive.computer?.gfHigh ?? '?'}`.padStart(7)} ` +
      `${(rows.find((r) => r.dive === dive)?.repetitive ? 'sì' : '—').padStart(4)} ` +
      `${theirs.toFixed(0).padStart(6)} ${ours.toFixed(0).padStart(6)} ` +
      `${(delta > 0 ? '+' : '') + delta.toFixed(1)}`.padStart(8),
  );
}

const n = rows.length;
const rip = rows.filter((r) => r.repetitive);
const prime = rows.filter((r) => !r.repetitive);
const media = (list: typeof rows) =>
  list.length ? list.reduce((a, r) => a + (r.ours - r.theirs), 0) / list.length : 0;

console.log(`\n${n} immersioni confrontate.`);
console.log(
  `Prime della giornata (${prime.length}): scarto medio ${media(prime).toFixed(2)} — ` +
    `ripetitive (${rip.length}): ${media(rip).toFixed(2)}.`,
);
console.log('Se le due cifre ora si somigliano, il carico residuo era la causa principale.');
console.log(`Scarto medio con segno: ${(sum / n).toFixed(2)} punti — dice se siamo sistematicamente sopra o sotto.`);
console.log(`Scarto medio assoluto:  ${(sumAbs / n).toFixed(2)} punti.`);
console.log(`Caso peggiore: ${worst.delta > 0 ? '+' : ''}${worst.delta.toFixed(1)} su ${worst.label}.`);
console.log(
  '\nUno scarto medio con segno vicino a zero e un assoluto di pochi punti significa che il\n' +
    'modello è tarato. Uno scarto sistematico dice che una costante non torna.',
);
