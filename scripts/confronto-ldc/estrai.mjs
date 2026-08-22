/**
 * Tira fuori i blob binari Uwatec da un export LogTRAK.
 *
 * LogTRAK mette il profilo in `diveLogBase64`, un campo per immersione, e
 * quello è esattamente il record che comincia con `A5 A5 5A 5A` — cioè quello
 * che libdivecomputer si aspetta di ricevere da `uwatec_smart_extract_dives`, e
 * quello che il nostro `decodeUwatecSmart` legge. Nessuna trasformazione in
 * mezzo: le due implementazioni vedono gli stessi identici byte, che è tutto il
 * punto del confronto.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const sorgente = process.argv[2];
if (!sorgente) {
  console.error('uso: node estrai.mjs <file.logtrak>');
  process.exit(2);
}
const dati = JSON.parse(readFileSync(sorgente, 'utf8'));
const conProfilo = (dati.dives ?? []).filter((d) => d.diveLogBase64);
mkdirSync('/tmp/blob', { recursive: true });
conProfilo.forEach((d, i) => {
  writeFileSync(`/tmp/blob/${String(i).padStart(3, '0')}.bin`, Buffer.from(d.diveLogBase64, 'base64'));
});
console.log(`${dati.dives.length} immersioni, ${conProfilo.length} con profilo, scritte in /tmp/blob`);
