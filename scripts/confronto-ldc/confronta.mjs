/**
 * Il verdetto: le due serie di profondità coincidono, campione per campione?
 *
 * Si confrontano le STRINGHE a due decimali e non i numeri, di proposito. Un
 * confronto con tolleranza nasconderebbe proprio l'errore che si teme —
 * un'estensione del segno sbagliata produce scarti piccoli e sistematici, non
 * grandi e vistosi — e qui l'unica risposta accettabile è «identici».
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

function leggiTabulato(percorso) {
  const mappa = new Map();
  for (const riga of readFileSync(percorso, 'utf8').split('\n')) {
    if (!riga.trim()) continue;
    const [file, serie = ''] = riga.split('\t');
    mappa.set(file, serie.split(',').filter(Boolean));
  }
  return mappa;
}

const loro = leggiTabulato('/tmp/serie-ldc.txt');

// La nostra serie si genera qui, per non avere due file da tenere allineati.
const nostroTs = new URL('./nostra-serie.ts', import.meta.url).pathname;
execFileSync('npx', ['tsx', nostroTs], { stdio: 'inherit' });
const nostra = leggiTabulato('/tmp/serie-noi.txt');

let campioni = 0;
let diversi = 0;
let scartoMax = 0;
const problemi = [];
for (const [file, serieLoro] of [...loro].sort()) {
  const serieNostra = nostra.get(file);
  if (!serieNostra) {
    problemi.push(`${file}: noi non l'abbiamo decodificata`);
    continue;
  }
  if (serieLoro.length !== serieNostra.length) {
    problemi.push(`${file}: ${serieLoro.length} campioni loro, ${serieNostra.length} nostri`);
    continue;
  }
  for (let i = 0; i < serieLoro.length; i++) {
    campioni++;
    if (serieLoro[i] !== serieNostra[i]) {
      diversi++;
      scartoMax = Math.max(scartoMax, Math.abs(Number(serieLoro[i]) - Number(serieNostra[i])));
      if (problemi.length < 10) problemi.push(`${file} campione ${i}: ${serieLoro[i]} vs ${serieNostra[i]}`);
    }
  }
}

console.log(`immersioni: ${loro.size}`);
console.log(`campioni di profondità confrontati: ${campioni}`);
console.log(`campioni diversi: ${diversi}`);
console.log(`scarto massimo: ${scartoMax.toFixed(2)} m`);
for (const p of problemi) console.log('  ' + p);
process.exit(diversi === 0 && problemi.length === 0 ? 0 : 1);
