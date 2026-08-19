/**
 * Stampa ESATTAMENTE quello che verrebbe mandato a Claude.
 *
 * PERCHÉ ESISTE. Le cinque analisi sono l'unica parte dell'applicazione che
 * nessuno ha mai letto prima di spedirla: il contesto si costruisce in memoria,
 * finisce in una richiesta HTTP, e quello che si vede è solo la risposta. Se un
 * campo è nullo per un motivo sbagliato, se un'unità manca, se il prompt promette
 * un dato che il contesto non contiene, la conseguenza non è un errore — è
 * un'analisi peggiore, che ha esattamente lo stesso aspetto di una buona.
 *
 * Girare una richiesta vera per accorgersene costa una chiave API, dei soldi e
 * un'attesa. Leggere il contesto costa un comando:
 *
 *     npm run dump:ai -- demo/shearwater-peregrine.xml
 *     npm run dump:ai -- ~/archivio.uddf --solo immersione
 *
 * Senza argomenti usa i file di `demo/`, che è quello che gira in automatico.
 *
 * COSA NON FA: non chiama l'API e non ha bisogno di una chiave. È di proposito —
 * uno strumento diagnostico che spende soldi lo si usa la metà delle volte.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { basename } from 'node:path';
import { parseFile } from '../src/core/parsers/index';
import { mergeImports } from '../src/core/dedupe';
import { chainArchive } from '../src/core/analysis/tissues';
import { aggregate } from '../src/core/analysis/aggregate';
import { buildPlan } from '../src/core/analysis/coaching';
import { archiveContext, diveContext, planContext } from '../src/ai/context';
import { archiveAnalysis, diveAnalysis, planAnalysis } from '../src/ai/prompts';
import type { Dive } from '../src/core/model';

const DEMO = [
  'demo/shearwater-peregrine.xml',
  'demo/shearwater-cloud-export.uddf',
  'demo/subsurface-archivio.ssrf',
  'demo/garmin-descent.fit',
  'demo/vecchio-logbook.csv',
];

const args = process.argv.slice(2);
const soloIdx = args.indexOf('--solo');
const solo = soloIdx >= 0 ? args[soloIdx + 1] : undefined;
const scriviIdx = args.indexOf('--scrivi');
const scrivi = scriviIdx >= 0 ? args[scriviIdx + 1] : undefined;
const files = args.filter((a, i) => !a.startsWith('--') && i !== soloIdx + 1 && i !== scriviIdx + 1);
const sorgenti = (files.length ? files : DEMO).filter((f) => existsSync(f));

if (sorgenti.length === 0) {
  console.error('Nessun file leggibile. Genera prima i dati dimostrativi con `npm run demo`.');
  process.exit(1);
}

/**
 * Una stima del costo, non un conteggio.
 *
 * Il tokenizer vero non è pubblico e installarne uno per un numero indicativo
 * sarebbe una dipendenza per niente. Su testo italiano con molti numeri il
 * rapporto sta intorno ai 3.6 caratteri per token: quello che serve sapere è se
 * un contesto pesa tremila token o trentamila, e per quello basta.
 */
const stimaToken = (s: string) => Math.round(s.length / 3.6);

const barra = (t: string) => `\n${'═'.repeat(78)}\n${t}\n${'═'.repeat(78)}`;

async function main() {
  let dives: Dive[] = [];
  for (const f of sorgenti) {
    const raw = readFileSync(f);
    const res = await parseFile({
      fileName: basename(f),
      text: f.endsWith('.fit') ? undefined : raw.toString('utf8'),
      bytes: new Uint8Array(raw),
    });
    dives = mergeImports(dives, res.dives).dives;
  }
  /*
   * La catena dei tessuti va percorsa, non saltata.
   *
   * Senza, dal contesto mancano proprio i campi sulle ripetitive che le
   * istruzioni dicono al modello di usare — azoto residuo d'ingresso, GF99
   * senza residuo, intervallo di superficie. Uno strumento diagnostico che
   * guarda un contesto più povero di quello vero è peggio di nessuno
   * strumento: assolve il caso che va controllato.
   *
   * I profili sono già in memoria qui (arrivano dai parser), quindi il
   * caricatore che `chainArchive` si aspetta è una semplice lettura.
   */
  const perId = new Map(dives.map((d) => [d.id, d]));
  dives = (await chainArchive(dives, async (id) => perId.get(id)?.samples ?? [])).dives;
  dives.sort((a, b) => a.startTime.localeCompare(b.startTime));

  const pezzi: { nome: string; testo: string }[] = [];

  if (!solo || solo === 'immersione') {
    /*
     * Tre immersioni e non una: la più ricca, la più povera e una ripetitiva.
     *
     * Guardare solo la migliore è il modo di non accorgersi di niente. Il caso
     * che rompe le analisi è quello povero — un'immersione senza profilo e senza
     * pressioni — e il caso in cui il contesto vale di più è la ripetitiva, che
     * è l'unica in cui esistono azoto residuo e GF99 senza residuo.
     */
    const conProfilo = dives.filter((d) => (d.samples?.length ?? 0) > 0);
    const ricca = conProfilo.reduce(
      (a, b) =>
        Object.values(b).filter((v) => v != null).length > Object.values(a).filter((v) => v != null).length
          ? b
          : a,
      conProfilo[0] ?? dives[0],
    );
    const povera = dives.reduce(
      (a, b) =>
        Object.values(b).filter((v) => v != null).length < Object.values(a).filter((v) => v != null).length
          ? b
          : a,
      dives[0],
    );
    const ripetitiva = dives.find((d) => d.metrics?.surfaceIntervalMin !== undefined);

    for (const [etichetta, d] of [
      ['la più ricca', ricca],
      ['la più povera', povera],
      ['una ripetitiva', ripetitiva],
    ] as const) {
      if (!d) {
        /*
         * Un caso che manca si DICE, non si salta.
         *
         * La prima versione faceva `continue` e basta: l'archivio dimostrativo
         * non contiene ripetitive, quindi la sezione spariva e il rapporto
         * sembrava completo. È il difetto peggiore che uno strumento
         * diagnostico possa avere — assolvere in silenzio il caso che non ha
         * guardato. E qui pesa il doppio, perché le istruzioni di sistema
         * dedicano un paragrafo intero ai campi delle ripetitive: se nessuno li
         * vede mai, nessuno si accorge se smettono di arrivare.
         */
        pezzi.push({
          nome: `IMMERSIONE — ${etichetta}: NESSUN CASO IN QUESTO ARCHIVIO`,
          testo:
            `Questo archivio non contiene «${etichetta}»: la sezione non è stata generata.\n` +
            'Per le ripetitive significa che i campi `intervalloDiSuperficieMin`, ' +
            '`azotoResiduoIngressoBar` e `gf99SenzaResiduoPct` — a cui le istruzioni di ' +
            'sistema dedicano un paragrafo — non sono stati verificati su dati veri. ' +
            'Passa un archivio che ne contenga, oppure sappi che quella parte è scoperta.',
        });
        continue;
      }
      pezzi.push({
        nome: `IMMERSIONE — ${etichetta} (${d.startTime}, ${d.maxDepth} m)`,
        testo: diveAnalysis(diveContext(d)).prompt,
      });
    }
  }

  const aggregates = aggregate(dives);

  if (!solo || solo === 'archivio') {
    pezzi.push({
      nome: 'ARCHIVIO',
      testo: archiveAnalysis(archiveContext(dives, aggregates, 'tutto l’archivio')).prompt,
    });
  }

  if (!solo || solo === 'piano') {
    const plan = buildPlan(dives, aggregates, 'general');
    pezzi.push({
      nome: 'PIANO DI MIGLIORAMENTO',
      testo: planAnalysis(planContext(plan, aggregates, 'tutto l’archivio')).prompt,
    });
  }

  const righe: string[] = [];
  righe.push(`Archivio: ${dives.length} immersioni da ${sorgenti.length} file.`);
  righe.push(
    `Sistema: ${stimaToken((await import('../src/ai/prompts')).SYSTEM)} token stimati (vale per tutte).`,
  );
  for (const p of pezzi) {
    righe.push(barra(`${p.nome} — ${stimaToken(p.testo)} token stimati`));
    righe.push(p.testo);
  }

  /*
   * I CAMPI SEMPRE NULLI, contati.
   *
   * È il numero che ha cambiato le istruzioni una volta e che le cambierà
   * ancora: se dodici campi su un archivio importato da un computer sono
   * costantemente nulli, l'analisi passa metà dello spazio a elencarli. Vale la
   * pena vederlo come conteggio e non come impressione, ogni volta che si tocca
   * il contesto.
   */
  const chiavi = new Set<string>();
  for (const d of dives) for (const k of Object.keys(d)) chiavi.add(k);
  const vuoti = [...chiavi]
    .map((k) => ({
      k,
      mancanti: dives.filter((d) => (d as unknown as Record<string, unknown>)[k] == null).length,
    }))
    .filter((x) => x.mancanti > 0)
    .sort((a, b) => b.mancanti - a.mancanti);
  righe.push(barra('CAMPI ASSENTI, su tutto l’archivio'));
  for (const v of vuoti) {
    righe.push(`${v.k}: mancante su ${v.mancanti} immersioni su ${dives.length}`);
  }

  const out = righe.join('\n');
  if (scrivi) {
    writeFileSync(scrivi, out);
    console.log(`Scritto in ${scrivi} (${Math.round(out.length / 1024)} kB).`);
  } else {
    console.log(out);
  }
}

void main();
