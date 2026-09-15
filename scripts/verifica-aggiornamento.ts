/**
 * Rifà, da fuori, il conto che fa l'applicazione installata quando si aggiorna.
 *
 *   npm run aggiornamento:verifica
 *
 * ► COSA CONTROLLA, E PERCHÉ NESSUN ALTRO PASSO LO CONTROLLA. ◄ Il passo 6
 * dell'elenco di rilascio conta gli allegati e legge le impronte: dice che i
 * file ci sono e che sono quelli. Non dice **che si installeranno**. Fra «il
 * pacchetto è pubblicato» e «l'aggiornamento automatico funziona» c'è una
 * firma, e una firma sbagliata non produce nessun errore visibile da nessuna
 * parte: l'applicazione scarica, verifica, fallisce in silenzio e resta ferma
 * dov'era. *Lo si scopre settimane dopo, guardando il numero di versione di
 * qualcuno che credeva di essere aggiornato.*
 *
 * Qui si scarica il manifesto **pubblicato** — non quello sul disco, che è
 * quello che credevamo di pubblicare — si scarica ogni pacchetto a cui punta, e
 * si verifica la firma con la chiave pubblica che sta in `tauri.conf.json`: la
 * stessa che è murata dentro il binario di chi aggiorna. Se questo script dice
 * di sì, l'aggiornamento funziona; se dice di no, non funziona per nessuno.
 *
 * ► E UNA COSA CHE LA CRITTOGRAFIA NON PUÒ DIRE. ◄ Una firma validissima può
 * essere la firma di un altro pacchetto — succede riusando un manifesto vecchio
 * dopo aver ricostruito gli artefatti. Il commento fidato che Tauri scrive
 * dentro la firma contiene il nome del file firmato, ed è coperto dalla firma
 * globale: si confronta con il nome nell'indirizzo, e i due devono combaciare.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { fileNelCommento, verificaFirma } from './lib/minisign';

const RADICE = fileURLToPath(new URL('..', import.meta.url));
const MANIFESTO = 'https://github.com/matteoferrando/MyDiveLog/releases/latest/download/latest.json';

interface Piattaforma {
  url: string;
  signature: string;
}
interface Manifesto {
  version?: string;
  platforms?: Record<string, Piattaforma>;
}

const versioneAttesa: string = JSON.parse(readFileSync(`${RADICE}package.json`, 'utf8')).version;
const pubkey: string | undefined = JSON.parse(readFileSync(`${RADICE}src-tauri/tauri.conf.json`, 'utf8'))
  .plugins?.updater?.pubkey;

if (!pubkey) {
  console.log('in tauri.conf.json non c’è nessuna chiave pubblica dell’aggiornatore.');
  process.exit(1);
}

// `?t=` in coda: senza, la risposta può venire da una cache e raccontare una
// cosa vecchia con la faccia di una misura. Stessa ragione di `sito:online`.
const risposta = await fetch(`${MANIFESTO}?t=${Date.now()}`, { redirect: 'follow' });
if (!risposta.ok) {
  console.log(`il manifesto pubblicato risponde ${risposta.status}.`);
  process.exit(1);
}
const manifesto: Manifesto = await risposta.json();

let guasti = 0;

if (manifesto.version !== versioneAttesa) {
  guasti++;
  console.log(
    `✗ il manifesto pubblicato dice ${manifesto.version}, il progetto sul disco è ${versioneAttesa}`,
  );
} else {
  console.log(`✓ versione nel manifesto: ${manifesto.version}`);
}

const piattaforme = Object.entries(manifesto.platforms ?? {});
if (piattaforme.length === 0) {
  guasti++;
  console.log('✗ il manifesto non elenca nessuna piattaforma');
}

for (const [nome, dati] of piattaforme) {
  const nelUrl = decodeURIComponent(new URL(dati.url).pathname.split('/').pop() ?? '');
  const pacchetto = await fetch(dati.url, { redirect: 'follow' });
  if (!pacchetto.ok) {
    guasti++;
    console.log(`✗ ${nome.padEnd(16)} il pacchetto risponde ${pacchetto.status} — ${nelUrl}`);
    continue;
  }
  const contenuto = Buffer.from(await pacchetto.arrayBuffer());

  let esito;
  try {
    esito = verificaFirma({ pubkey, firma: dati.signature, contenuto });
  } catch (e) {
    guasti++;
    console.log(`✗ ${nome.padEnd(16)} firma illeggibile: ${(e as Error).message}`);
    continue;
  }

  if (!esito.valido) {
    guasti++;
    console.log(`✗ ${nome.padEnd(16)} ${esito.motivo} — ${nelUrl}`);
    continue;
  }

  const firmato = fileNelCommento(esito.commentoFidato);
  if (firmato && firmato !== nelUrl) {
    guasti++;
    console.log(
      `✗ ${nome.padEnd(16)} firma valida ma di un altro file: firmato «${firmato}», nel manifesto «${nelUrl}»`,
    );
    continue;
  }

  const mb = (contenuto.length / 1024 / 1024).toFixed(1);
  console.log(`✓ ${nome.padEnd(16)} ${nelUrl} (${mb} MB) — firma verificata sul file pubblicato`);
}

if (guasti) {
  console.log(`\n${guasti} problemi: l’aggiornamento automatico NON funziona come pubblicato.`);
  process.exitCode = 1;
} else {
  console.log(
    '\nchi ha l’applicazione installata riceve questo aggiornamento: firme verificate sui file veri.',
  );
}
