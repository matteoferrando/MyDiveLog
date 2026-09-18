/**
 * QUANTO COSTA UN ARCHIVIO GRANDE.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * ► PERCHÉ ESISTE. ◄ Il debito era scritto da settimane in `stato-progetto.md`:
 * *«prestazioni mai misurate oltre le ~2000 immersioni»*. Non è una frase che si
 * cancella scrivendo «va bene»: si cancella misurando, e la misura va rifatta
 * quando l'analisi cambia. Quindi sta qui dentro e non in un resoconto.
 *
 * Misura il livello dell'ANALISI — metriche, aggregazioni, suggerimenti,
 * deduplica — che è dove vivono i rischi quadratici: la deduplica confronta
 * ogni immersione in arrivo con ogni immersione in archivio. Il disegno non lo
 * misura: l'elenco del logbook è a finestra e mostra cinquanta righe per volta.
 *
 * Uso:
 *   npm run prestazioni
 *
 * Misurato il 18 settembre 2026 su un Mac con Apple Silicon:
 *
 *                                            500     2000    10000
 *   costruzione + computeMetrics di tutte    53 ms  125 ms   597 ms
 *   aggregate (tutto l'archivio)             12 ms   14 ms    86 ms
 *   aggregate (finestra 12 mesi)              4 ms   11 ms    76 ms
 *   buildPlan (i suggerimenti)                1 ms    1 ms     9 ms
 *   mergeImports di 50 immersioni            16 ms   52 ms   304 ms
 *   mergeImports di 200 doppioni              6 ms    7 ms    11 ms
 *
 * Tutto lineare tranne l'unico termine che non può esserlo — l'import, che
 * confronta il lotto in arrivo con l'archivio: sei millisecondi per immersione
 * importata su diecimila in archivio. Importarne cinquecento in un archivio da
 * diecimila sono tre secondi, una volta sola, con la barra di avanzamento
 * davanti. I doppioni costano MENO del nuovo: la catena di `likelySame` esce
 * al primo anello che combacia.
 */
import { aggregate } from '../src/core/analysis/aggregate';
import { computeMetrics } from '../src/core/analysis/metrics';
import { mergeImports } from '../src/core/dedupe';
import { buildPlan } from '../src/core/analysis/coaching';
import { AIR, type Dive, type Sample } from '../src/core/model';

const GIORNO = 86_400_000;
function campioni(n: number): Sample[] {
  return Array.from({ length: n }, (_, k) => ({
    t: k * 10,
    depth: Math.max(0, 28 - Math.abs(n / 2 - k) * (56 / n)),
    tempC: 17,
    pressureBar: [200 - (k * 140) / n],
  }));
}
function archivio(n: number, conProfilo: boolean): Dive[] {
  const ora = Date.now();
  return Array.from({ length: n }, (_, i) => {
    const inizio = new Date(ora - (n - i) * GIORNO * 0.7);
    const samples = conProfilo ? campioni(240) : [];
    const d: Dive = {
      id: `v${i}`,
      number: i + 1,
      startTime: inizio.toISOString(),
      durationS: 2400,
      maxDepth: 20 + (i % 20),
      minTempC: 15 + (i % 10),
      site: { name: `Sito ${i % 60}`, lat: 44 + (i % 30) / 100, lon: 9 + (i % 30) / 100 },
      mode: 'oc',
      cylinders: [{ mix: AIR, sizeL: 12, startBar: 200, endBar: 60 + (i % 30) }],
      salinity: 'salt',
      source: { format: 'uddf', file: 'f', importedAt: inizio.toISOString() },
      tags: [],
      samples,
    } as Dive;
    d.metrics = computeMetrics(d);
    return d;
  });
}

/* Si chiama `cronometra` e non `t`: `t` è la funzione che traduce, e la
   prova del dizionario cerca ogni chiamata a `t` del progetto e pretende che quella
   frase abbia la sua voce in inglese. Un cronometro chiamato `t` faceva
   chiedere al dizionario la traduzione di «mergeImports di 50 immersioni». */
const cronometra = (nome: string, f: () => unknown) => {
  const a = performance.now();
  const r = f();
  const ms = performance.now() - a;
  console.log(`  ${nome.padEnd(42)} ${ms.toFixed(0).padStart(7)} ms`);
  return { ms, r };
};

for (const n of [500, 2000, 10000]) {
  console.log(`\n══ archivio da ${n} immersioni (con profilo da 240 campioni)`);
  const a0 = performance.now();
  const dives = archivio(n, true);
  console.log(
    `  ${'costruzione + computeMetrics di tutte'.padEnd(42)} ${(performance.now() - a0).toFixed(0).padStart(7)} ms`,
  );
  cronometra('aggregate (tutto l archivio)', () => aggregate(dives));
  cronometra('aggregate (finestra 12 mesi)', () => aggregate(dives, Date.now(), 12));
  const agg = aggregate(dives);
  cronometra('buildPlan (i suggerimenti)', () => buildPlan(dives, agg));
  const nuove = archivio(50, true).map((d, i) => ({ ...d, id: `nuova${i}` }));
  cronometra('mergeImports di 50 immersioni', () => mergeImports(dives, nuove));
  // il caso peggiore: reimportare le stesse
  cronometra('mergeImports delle stesse 200 (doppioni)', () => mergeImports(dives, dives.slice(0, 200)));
}
