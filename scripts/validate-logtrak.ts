/**
 * Verifica il decoder Uwatec contro un file LogTRAK reale.
 *
 *   npx tsx scripts/validate-logtrak.ts ~/Downloads/export.logtrak
 *
 * Il punto: il JSON di LogTRAK contiene profondità massima, durata e temperature
 * minima e massima già calcolate dal computer subacqueo, mentre il profilo sta
 * in un blob binario separato. Sono due fonti indipendenti degli stessi numeri,
 * quindi confrontarle è un test di correttezza vero — non un test che verifica
 * che il codice faccia quello che il codice fa.
 *
 * Uno scostamento sulle TEMPERATURE è il segnale più forte che qualcosa non
 * torna: sono accumulate come delta con segno, quindi un errore di un bit da
 * qualche parte le fa divergere subito. La profondità massima invece può
 * differire di qualche decimetro in modo del tutto legittimo, perché
 * l'intestazione ha risoluzione doppia rispetto ai campioni.
 *
 * Da rieseguire quando si aggiunge un modello di computer: se il layout
 * dell'intestazione è sbagliato, qui si vede.
 */

import { readFileSync } from 'node:fs';
import { decodeUwatecSmart, trimSurface } from '../src/core/parsers/uwatecSmart';
import { base64ToBytes, logtrakParser } from '../src/core/parsers/logtrak';
import { aggregate } from '../src/core/analysis/aggregate';

const path = process.argv[2];
if (!path) {
  console.error('Uso: npx tsx scripts/validate-logtrak.ts <file.logtrak>');
  process.exit(1);
}

const text = readFileSync(path, 'utf8');
const file = JSON.parse(text) as {
  dives?: Record<string, unknown>[];
  equipment?: { diveComputers?: { id: string; deviceTypeNumber?: number; deviceType?: string }[] };
};
const computers = new Map((file.equipment?.diveComputers ?? []).map((c) => [c.id, c]));

interface Row {
  date: string;
  dMax: number;
  dTemp: number | null;
  dDur: number;
  dAvg: number | null;
  leftover: number;
  samples: number;
}

const rows: Row[] = [];
const failures: string[] = [];
let noProfile = 0;

for (const raw of file.dives ?? []) {
  const b64 = raw.diveLogBase64 as string | null | undefined;
  const date = String(raw.startTime ?? '').slice(0, 10);
  if (!b64) {
    noProfile++;
    continue;
  }
  const model = computers.get(String(raw.diveComputerId ?? ''))?.deviceTypeNumber;
  try {
    const d = decodeUwatecSmart(base64ToBytes(b64), { model });
    const trimmed = trimSurface(d.samples);
    const depths = trimmed.map((s) => s.depth).filter((v): v is number => v !== undefined);
    const temps = d.samples.map((s) => s.tempC).filter((v): v is number => v !== undefined);

    // Media pesata sul tempo sul profilo ritagliato.
    let area = 0;
    for (let i = 1; i < trimmed.length; i++) {
      area += (((trimmed[i].depth ?? 0) + (trimmed[i - 1].depth ?? 0)) / 2) * (trimmed[i].t - trimmed[i - 1].t);
    }
    const span = trimmed.length > 1 ? trimmed[trimmed.length - 1].t - trimmed[0].t : 0;

    rows.push({
      date,
      dMax: Math.max(...depths) - Number(raw.depthMetersMax ?? 0),
      dTemp:
        temps.length && raw.waterTempCelsiusMin != null
          ? Math.max(
              Math.abs(Math.min(...temps) - Number(raw.waterTempCelsiusMin)),
              raw.waterTempCelsiusMax != null ? Math.abs(Math.max(...temps) - Number(raw.waterTempCelsiusMax)) : 0,
            )
          : null,
      dDur: span - d.durationS,
      dAvg: d.avgDepth !== undefined && span > 0 ? area / span - d.avgDepth : null,
      leftover: d.bytesDeclared - d.bytesConsumed,
      samples: d.samples.length,
    });
  } catch (err) {
    failures.push(`${date}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

const stat = (label: string, values: (number | null)[], unit: string, tolerance: number) => {
  const xs = values.filter((v): v is number => v !== null).sort((a, b) => a - b);
  if (xs.length === 0) {
    console.log(`  ${label.padEnd(26)} nessun dato`);
    return;
  }
  const worst = Math.max(...xs.map(Math.abs));
  const median = xs[Math.floor(xs.length / 2)];
  const verdict = worst <= tolerance ? 'ok' : 'DA VERIFICARE';
  console.log(
    `  ${label.padEnd(26)} mediana ${median.toFixed(2).padStart(7)} ${unit}   scostamento massimo ${worst
      .toFixed(2)
      .padStart(7)} ${unit}   ${verdict}`,
  );
};

console.log(`\nFile: ${path}`);
console.log(`Immersioni: ${(file.dives ?? []).length} · con profilo: ${rows.length} · senza profilo: ${noProfile}`);
const models = [...new Set([...computers.values()].map((c) => `${c.deviceType} (0x${(c.deviceTypeNumber ?? 0).toString(16)})`))];
console.log(`Computer nel file: ${models.join(', ') || 'nessuno dichiarato'}`);

console.log('\nConfronto fra profilo decodificato e riepilogo del computer:');
stat('profondità massima', rows.map((r) => r.dMax), 'm', 0.5);
stat('temperature min/max', rows.map((r) => r.dTemp), '°C', 0.5);
// Tolleranza larga sulla durata, e per due ragioni legittime: l'intestazione la
// esprime in minuti interi (quindi tronca fino a 59 s) e il computer esclude dal
// tempo mostrato le escursioni sotto gli 0.8 m, che nel profilo invece ci sono.
// Uno scostamento di un paio di minuti è normale; uno di dieci non lo è.
stat('durata', rows.map((r) => r.dDur), 's', 180);
stat('profondità media (off. 24)', rows.map((r) => r.dAvg), 'm', 1.5);

const leftover = rows.filter((r) => r.leftover !== 0);
console.log(
  `\nByte residui dopo la decodifica: ${leftover.length === 0 ? 'nessuno su tutte le immersioni (allineamento corretto)' : `${leftover.length} immersioni disallineate`}`,
);
if (failures.length) {
  console.log(`\nDecodifiche fallite (${failures.length}):`);
  failures.slice(0, 10).forEach((f) => console.log(`  ${f}`));
}

// Import completo, per vedere cosa arriva davvero in archivio.
const parsed = logtrakParser.parse({ fileName: path.split('/').pop() ?? 'file', text });
const a = aggregate(parsed.dives);
console.log('\nImport completo:');
console.log(`  ${a.count} immersioni · ${(a.totalS / 3600).toFixed(0)} h · massima ${a.maxDepthEver} m`);
console.log(`  consumo calcolabile su ${a.rmv.length}, assetto su ${a.trim.length}`);
if (a.avgRmv !== undefined) console.log(`  consumo medio ${a.avgRmv} L/min (tendenza: ${a.rmvTrend?.direction ?? 'n/d'})`);
if (parsed.warnings.length) {
  console.log('\nAvvisi:');
  parsed.warnings.forEach((w) => console.log(`  - ${w}`));
}
console.log('');
