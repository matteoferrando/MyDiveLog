/**
 * Genera un archivio dimostrativo in `demo/`, un file per formato.
 *
 *   npx tsx scripts/generate-demo-data.ts
 *
 * Serve per provare l'app — import, statistiche, piano — senza dover prima
 * esportare il proprio logbook, e per verificare a occhio che il rilevamento
 * del formato e la deduplica funzionino su file veri.
 *
 * L'archivio è costruito con una progressione deliberata: le immersioni più
 * vecchie hanno consumo alto e assetto instabile, le recenti sono migliori.
 * Così il piano di miglioramento ha qualcosa di sensato da dire e le tendenze
 * si vedono nei grafici.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  synthesise,
  toCsv,
  toFit,
  toShearwaterXml,
  toSubsurface,
  toUddf,
  type Synthetic,
} from '../tests/fixtures';

const OUT = join(process.cwd(), 'demo');
mkdirSync(OUT, { recursive: true });

const DAY = 86_400_000;
const NOW = Date.now();

/**
 * Siti con coordinate vere: servono a far comparire la carta dei luoghi, che
 * senza coordinate resta nascosta — e un pezzo di interfaccia che i dati
 * dimostrativi non attivano è un pezzo che nessuno guarda mai prima dell'utente.
 * Sono posizioni reali arrotondate, non rilievi GPS.
 */
const SITES: { name: string; lat: number; lon: number }[] = [
  { name: 'Punta Chiappa', lat: 44.3167, lon: 9.15 },
  { name: 'Secca Gonzatti', lat: 44.3, lon: 9.1333 },
  { name: 'Isuela', lat: 44.3208, lon: 9.1611 },
  { name: 'Relitto Haven', lat: 44.4131, lon: 8.755 },
  { name: 'Moregallo', lat: 45.8611, lon: 9.3389 },
  { name: 'Punta del Faro', lat: 44.3042, lon: 9.1508 },
  { name: 'Colombara', lat: 44.2986, lon: 9.2153 },
];

/** Progressione: i valori interpolano fra "principiante" e "esperto". */
function progression(i: number, total: number) {
  const t = total <= 1 ? 1 : i / (total - 1); // 0 = più vecchia, 1 = più recente
  return {
    rmvLpm: 26 - t * 9, // 26 → 17 L/min
    wobbleM: 2.6 - t * 2.2, // 2.6 → 0.4 m di oscillazione
    wobblePeriodS: 70 + t * 90,
    ascentRateMpm: 13 - t * 4, // 13 → 9 m/min
    safetyStopS: t < 0.35 ? 0 : 180 + Math.round(t * 120),
  };
}

const dives: Synthetic[] = [];
const TOTAL = 48;

for (let i = 0; i < TOTAL; i++) {
  const p = progression(i, TOTAL);
  // Un'uscita ogni ~11 giorni, con una pausa invernale fra la 18ª e la 19ª.
  const winterGap = i >= 18 ? 95 : 0;
  const daysAgo = (TOTAL - i) * 11 + (i < 18 ? 95 : 0) - winterGap * 0;
  const isLake = i % 9 === 4;
  const isDeep = i % 7 === 6;

  const startTime = new Date(NOW - daysAgo * DAY);
  startTime.setHours(9 + (i % 3), (i % 4) * 15, 0, 0);

  dives.push(
    synthesise({
      startTime,
      ...(() => {
        const site = isLake ? SITES.find((x) => x.name === 'Moregallo')! : SITES[i % SITES.length];
        return { siteName: site.name, lat: site.lat, lon: site.lon };
      })(),
      maxDepth: isDeep ? 38 + (i % 3) * 2 : 20 + (i % 5) * 3,
      durationS: (isDeep ? 34 : 45 + (i % 4) * 3) * 60,
      intervalS: 10,
      minTempC: isLake ? 9 : 15 + (i % 4),
      surfaceTempC: isLake ? 18 : 23 + (i % 3),
      o2: isDeep ? 0.28 : 0.32,
      tankSizeL: isDeep ? 15 : 12,
      startBar: 220,
      decoCeilingM: isDeep && i > TOTAL * 0.7 ? 6 : 0,
      ...p,
    }),
  );
}

// Un file per formato, su sottoinsiemi che si sovrappongono di proposito: così
// importando tutto si vede la deduplica al lavoro (le immersioni in comune fra
// due file non devono comparire due volte).
const recent = dives.slice(30); // 18 immersioni, le più recenti

writeFileSync(join(OUT, 'shearwater-cloud-export.uddf'), multiUddf(recent, 31));
writeFileSync(join(OUT, 'subsurface-archivio.ssrf'), multiSubsurface(dives.slice(0, 30)));
writeFileSync(
  join(OUT, 'shearwater-peregrine.xml'),
  toShearwaterXml(dives[dives.length - 1], { diveNumber: TOTAL, gf: { low: 20, high: 85 } }),
);
/*
 * UNA SECONDA IMMERSIONE SHEARWATER, con gradient factor DIVERSI.
 *
 * Non è un doppione per sbaglio: serve a far comparire la carta «Impostazioni
 * del computer nel tempo», che si disegna solo quando l'archivio contiene
 * almeno due periodi con impostazioni diverse. È il caso vero di questo
 * progetto — il Peregrine passato da 45/95 a 20/85 nel settembre 2025 — e
 * finché l'archivio dimostrativo non ce l'aveva, quella carta non veniva
 * disegnata da nessun controllo automatico. Il suo difetto (cinque colonne
 * senza contenitore che scorre, quindi la PAGINA che si trascina di lato a 440
 * px) è stato trovato usando l'app sul telefono, che è il modo più caro.
 */
writeFileSync(
  join(OUT, 'shearwater-peregrine-precedente.xml'),
  // Dentro gli ultimi dodici mesi: il periodo predefinito delle statistiche è
  // «ultimi 12 mesi», e un'immersione più vecchia verrebbe filtrata via prima
  // di arrivare alla carta — che quindi resterebbe invisibile lo stesso.
  toShearwaterXml(dives[35], { diveNumber: 36, gf: { low: 45, high: 95 } }),
);
writeFileSync(join(OUT, 'garmin-descent.fit'), toFit(dives[dives.length - 2]));
writeFileSync(join(OUT, 'vecchio-logbook.csv'), toCsv(dives.slice(0, 18)));

console.log(`Scritti 6 file in ${OUT}:`);
console.log(`  shearwater-cloud-export.uddf   ${recent.length} immersioni (UDDF)`);
console.log(`  subsurface-archivio.ssrf       30 immersioni (Subsurface XML)`);
console.log(`  shearwater-peregrine.xml       1 immersione (Shearwater XML, GF 20/85)`);
console.log(`  shearwater-peregrine-precedente.xml  1 immersione (Shearwater XML, GF 45/95)`);
console.log(`  garmin-descent.fit             1 immersione (Garmin FIT, binario)`);
console.log(`  vecchio-logbook.csv            18 immersioni (CSV, senza profilo)`);
console.log('');
console.log(
  `Importali tutti insieme: il totale in archivio deve essere ${TOTAL}, non ${recent.length + 30 + 2 + 1 + 18}.`,
);
console.log('La differenza è la deduplica: gli insiemi si sovrappongono di proposito.');

// ---------------------------------------------------------------------------
// I fixture generano un file per immersione: qui li fondiamo in un documento
// unico, che è come arrivano gli export veri.
// ---------------------------------------------------------------------------

/**
 * I fixture generano un documento per immersione, con un solo sito e una sola
 * miscela. Qui li fondiamo riscrivendo i riferimenti: ogni immersione punta al
 * PROPRIO sito, altrimenti l'archivio dimostrativo mostrerebbe 18 immersioni
 * tutte allo stesso posto.
 */
function multiUddf(list: Synthetic[], numberFrom: number): string {
  const parts = list.map((d, i) => {
    const single = toUddf(d, numberFrom + i);
    const dive = single.slice(single.indexOf('<dive '), single.indexOf('</dive>') + 7);
    return dive.replaceAll('ref="site1"', `ref="site${i + 1}"`);
  });

  const sites = list
    .map(
      (d, i) => `    <site id="site${i + 1}">
      <name>${d.spec.siteName}</name>
      <geography><location>${d.spec.minTempC < 12 ? 'Lombardia' : 'Liguria'}</location><country>Italia</country>${
        d.spec.lat !== undefined
          ? `<latitude>${d.spec.lat.toFixed(4)}</latitude><longitude>${d.spec.lon!.toFixed(4)}</longitude>`
          : ''
      }</geography>
    </site>`,
    )
    .join('\n');

  const mixes = [...new Set(list.map((d) => Math.round(d.spec.o2 * 100)))]
    .map((o2) => `    <mix id="mix1"><name>EAN${o2}</name><o2>${o2 / 100}</o2><he>0</he></mix>`)
    .slice(0, 1)
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<uddf version="3.2.3">
  <generator><name>Shearwater Cloud</name></generator>
  <gasdefinitions>
${mixes}
  </gasdefinitions>
  <divesite>
${sites}
  </divesite>
  <profiledata>
    <repetitiongroup id="rg1">
${parts.join('\n')}
    </repetitiongroup>
  </profiledata>
</uddf>
`;
}

function multiSubsurface(list: Synthetic[]): string {
  const uuid = (i: number) => (i + 1).toString(16).padStart(8, '0');
  const parts = list.map((d, i) => {
    const single = toSubsurface(d, i + 1);
    const dive = single.slice(single.indexOf('<dive '), single.indexOf('</dive>') + 7);
    return dive.replaceAll("divesiteid='a1b2c3d4'", `divesiteid='${uuid(i)}'`);
  });
  const sites = list
    .map(
      (d, i) =>
        `  <site uuid='${uuid(i)}' name='${d.spec.siteName}'${
          d.spec.lat !== undefined ? ` gps='${d.spec.lat.toFixed(6)} ${d.spec.lon!.toFixed(6)}'` : ''
        }/>`,
    )
    .join('\n');
  return `<divelog program='mydivelog-demo' version='3'>
<divesites>
${sites}
</divesites>
<dives>
${parts.join('\n')}
</dives>
</divelog>
`;
}
