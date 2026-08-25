/**
 * Estrae il catalogo dei computer subacquei da libdivecomputer.
 *
 *   node scripts/catalogo-computer.mjs
 *
 * ────────────────────────────────────────────────────────────────────────────
 * PERCHÉ È GENERATO E NON SCRITTO A MANO. Sono centinaia di righe che
 * cambiano a ogni versione della libreria, e trascriverle a mano vuol dire
 * scoprire fra un anno che l'elenco dell'applicazione e quello della libreria
 * non coincidono più — con l'utente che sceglie un modello che il driver non
 * conosce, e un errore che sembra un guasto.
 *
 * La fonte è `src-tauri/vendor/libdivecomputer-0.9.0.tar.gz`, cioè il file
 * versionato, non la copia scompattata dalla build: quella è un artefatto e su
 * un'altra macchina può non esserci.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SI TIENE SOLO CIÒ CHE PARLA BLE, e non è un dettaglio.
 *
 * Il descrittore dichiara per ogni modello i trasporti che supporta: seriale,
 * USB, Bluetooth classico, BLE. Da un iPhone si raggiunge **soltanto il BLE**:
 * la porta seriale non esiste, l'USB non esiste, e il Bluetooth classico su iOS
 * è riservato ai profili di sistema.
 *
 * Su 356 modelli descritti dalla libreria, quelli che parlano BLE sono 110,
 * che accorpati per nome commerciale diventano 105 voci. Mostrarne 356 in un
 * selettore vorrebbe dire far scegliere a qualcuno un computer che il suo
 * telefono non potrà mai contattare, e dargli la colpa dopo.
 *
 * Attenzione al numero: `grep -c DC_TRANSPORT_BLE` ne conta 124, ma quattordici
 * di quelle righe sono codice C — definizioni e confronti — non descrittori.
 * Il conto giusto è quello che fa questo script, che le righe le sa leggere.
 */

import { execSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TARBALL = 'src-tauri/vendor/libdivecomputer-0.9.0.tar.gz';
const USCITA = 'src/core/ble/catalogoGenerato.ts';

const tmp = mkdtempSync(join(tmpdir(), 'ldc-'));
execSync(`tar xzf ${TARBALL} -C ${tmp}`);
const sorgente = readFileSync(join(tmp, 'libdivecomputer-0.9.0/src/descriptor.c'), 'utf8');

/*
 * Una riga del descrittore:
 *   {"Shearwater", "Petrel 2", DC_FAMILY_SHEARWATER_PETREL, 3, DC_TRANSPORT_… , …},
 * Marca, modello, famiglia, numero di modello, trasporti.
 */
const RIGA = /\{\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,\s*(DC_FAMILY_\w+)\s*,\s*([^,]+),([^}]*)\}/g;

const modelli = [];
for (const m of sorgente.matchAll(RIGA)) {
  const [, marca, modello, famiglia, numero, trasporti] = m;
  if (!/DC_TRANSPORT_BLE/.test(trasporti)) continue;
  modelli.push({
    marca,
    modello,
    famiglia: famiglia.replace('DC_FAMILY_', '').toLowerCase(),
    numero: Number(numero.trim().startsWith('0x') ? numero.trim() : numero.trim()) || 0,
  });
}

/*
 * ► LO STESSO NOME COMMERCIALE È PIÙ DI UN APPARECCHIO. ◄
 *
 * «Heinrichs Weikamp OSTC 2» compare tre volte, con tre numeri di modello
 * diversi: sono tre revisioni hardware vendute con lo stesso nome. Lo stesso
 * vale per OSTC Plus, OSTC Sport e Aqualung i200C.
 *
 * Mostrarle come tre voci identiche vorrebbe dire chiedere all'utente di
 * scegliere fra «OSTC 2», «OSTC 2» e «OSTC 2» — una domanda a cui NESSUNO può
 * rispondere, perché il numero di revisione non è scritto da nessuna parte
 * sull'apparecchio. Quindi si accorpano per nome e i numeri restano tutti
 * dentro: la revisione la riconosce il driver durante la connessione, che è
 * l'unico che può.
 */
/*
 * Quanti modelli descrive in tutto la libreria: serve solo per la frase in
 * testa al file generato, ma scritta a mano invecchia in silenzio. Si conta
 * riusando la stessa espressione con cui si leggono le righe, azzerandone lo
 * stato: un'espressione con /g ricorda dove si era fermata.
 */
RIGA.lastIndex = 0;
const totaleDescritti = [...sorgente.matchAll(RIGA)].length;

const perNome = new Map();
for (const m of modelli) {
  const chiave = `${m.marca}|${m.modello}`;
  const gia = perNome.get(chiave);
  if (gia) {
    if (!gia.numeri.includes(m.numero)) gia.numeri.push(m.numero);
  } else {
    perNome.set(chiave, { marca: m.marca, modello: m.modello, famiglia: m.famiglia, numeri: [m.numero] });
  }
}
const accorpati = [...perNome.values()].sort(
  (a, b) => a.marca.localeCompare(b.marca) || a.modello.localeCompare(b.modello),
);
const marche = [...new Set(accorpati.map((m) => m.marca))].sort();

const testa = `/**
 * I computer subacquei che libdivecomputer sa leggere VIA BLE.
 *
 * ► FILE GENERATO — non modificarlo a mano. ◄
 * Rigeneralo con: node scripts/catalogo-computer.mjs
 *
 * Fonte: libdivecomputer 0.9.0, \`src/descriptor.c\`, filtrato su
 * \`DC_TRANSPORT_BLE\`. Su ${totaleDescritti} modelli descritti dalla libreria, questi sono
 * quelli raggiungibili da un telefono: la porta seriale e l'USB su iPhone non
 * esistono, e il Bluetooth classico è riservato ai profili di sistema.
 *
 * Il perché per esteso sta in testa allo script che lo genera.
 */

export interface ModelloComputer {
  marca: string;
  modello: string;
  /** La famiglia di driver di libdivecomputer, es. \`shearwater_petrel\`. */
  famiglia: string;
  /**
   * I numeri di modello che portano questo nome commerciale.
   *
   * Quasi sempre uno solo. Quando sono più d'uno sono revisioni hardware
   * vendute con lo stesso nome — «OSTC 2» ne ha tre — e la revisione la
   * riconosce il driver alla connessione: il numero non è scritto da nessuna
   * parte sull'apparecchio, quindi non si può chiedere a chi ce l'ha in mano.
   */
  numeri: readonly number[];
}

/** ${accorpati.length} modelli, ${marche.length} marche. */
export const MODELLI_BLE: readonly ModelloComputer[] = [
`;

/*
 * APICI SINGOLI, e non `JSON.stringify`.
 *
 * `JSON.stringify` produce apici doppi, e Prettier — che in questo progetto
 * gira anche in CI, nel passo «Formato» — li riscriverebbe singoli. Il
 * risultato sarebbe un file generato che nasce già sporco: si rigenera, la CI
 * diventa rossa, e la correzione consiste nel formattare a mano un file che
 * dice «non modificarlo a mano». Meglio nascere nella forma giusta.
 */
const apici = (s) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

const righe = accorpati
  .map(
    (m) =>
      `  { marca: ${apici(m.marca)}, modello: ${apici(m.modello)}, famiglia: ${apici(m.famiglia)}, numeri: [${m.numeri.join(', ')}] },`,
  )
  .join('\n');

writeFileSync(USCITA, `${testa}${righe}\n];\n`);
console.log(
  `${USCITA}: ${accorpati.length} nomi (${modelli.length} descrittori BLE), ${marche.length} marche`,
);
console.log(marche.join(', '));
