/** La serie delle profondità secondo il NOSTRO decoder, nello stesso formato. */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { decodeUwatecSmart } from '../../src/core/parsers/uwatecSmart';

const righe: string[] = [];
for (const f of readdirSync('/tmp/blob')
  .filter((x) => x.endsWith('.bin'))
  .sort()) {
  const d = decodeUwatecSmart(new Uint8Array(readFileSync(`/tmp/blob/${f}`)));
  const profondita = d.samples
    .filter((s) => s.depth !== undefined)
    .map((s) => (s.depth as number).toFixed(2));
  righe.push(`/tmp/blob/${f}\t${profondita.join(',')}`);
}
writeFileSync('/tmp/serie-noi.txt', righe.join('\n') + '\n');
