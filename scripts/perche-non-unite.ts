/**
 * PERCHÉ QUESTE DUE IMMERSIONI NON SI SONO UNITE.
 *
 * IL DIFETTO CHE QUESTO STRUMENTO CHIUDE non è nella deduplica: è che quando la
 * deduplica sbaglia **non dice niente**. L'import annuncia «2 aggiunte» e
 * l'archivio si ritrova quattro righe dove dovevano essercene due, senza un
 * appiglio per capire se ha ceduto la profondità, la durata, l'orario o
 * l'impronta. Da fuori sono tutte la stessa cosa: «non le ha unite».
 *
 * `likelySame` è una catena di `return false`. Qui la stessa catena viene
 * percorsa un anello alla volta, e OGNI anello dice il proprio verdetto con i
 * numeri veri accanto — anche quelli che sono passati, perché sapere che la
 * profondità combaciava per un pelo conta quanto sapere che la durata no.
 *
 * Uso:
 *   npx tsx scripts/perche-non-unite.ts backup.json
 *   npx tsx scripts/perche-non-unite.ts backup.json 2026-08-24
 *
 * Senza data guarda le immersioni del giorno più recente. Non modifica niente:
 * legge un backup e stampa.
 */

import { readFileSync } from 'node:fs';
import { matchComputer, similar, likelySame, inferClockOffsets } from '../src/core/dedupe';
import type { Dive } from '../src/core/model';

const TOLLERANZA_M = 1;
const TOLLERANZA_S = 5 * 60;

/**
 * La tolleranza vera di `similar`, scritta per esteso.
 *
 * `similar` passa se lo scarto sta sotto la soglia fissa OPPURE sotto il 10%
 * del valore maggiore. Stampare solo la soglia fissa fa sembrare sbagliato un
 * verdetto giusto — 1.40 m su 30.7 passa, ed è il ramo proporzionale a
 * deciderlo. Chi legge deve vedere il numero che ha davvero contato.
 */
function soglia(a: number, b: number, fissa: number): string {
  const relativa = Math.max(a, b) / 10;
  return `${Math.max(fissa, relativa).toFixed(2)} (la maggiore fra ${fissa} e il 10% = ${relativa.toFixed(2)})`;
}

function giornoDelLuogo(d: Dive): string {
  // Il giorno è quello del LUOGO, non quello UTC: è la stessa regola che vale
  // in tutto il resto dell'applicazione, e qui serve perché due immersioni di
  // un pomeriggio possono cadere in due giorni UTC diversi.
  const t = Date.parse(d.startTime) + (d.utcOffsetMinutes ?? 0) * 60_000;
  return new Date(t).toISOString().slice(0, 10);
}

function etichetta(d: Dive): string {
  const ora = new Date(Date.parse(d.startTime) + (d.utcOffsetMinutes ?? 0) * 60_000)
    .toISOString()
    .slice(11, 16);
  const chi = d.computer?.model ?? d.source?.format ?? 'ignoto';
  return `${ora} · ${d.maxDepth?.toFixed(1)} m · ${Math.round((d.durationS ?? 0) / 60)}′ · ${chi}`;
}

function impronte(d: Dive): string[] {
  const out: string[] = [];
  if (d.computer?.profileFingerprint) out.push(d.computer.profileFingerprint);
  for (const c of d.otherComputers ?? []) if (c.profileFingerprint) out.push(c.profileFingerprint);
  return out;
}

function confronta(a: Dive, b: Dive, offsets: number[]): void {
  console.log(`\n── ${etichetta(a)}\n   ${etichetta(b)}`);

  const ia = impronte(a);
  const ib = impronte(b);
  if (ia.some((x) => ib.includes(x))) {
    console.log('   ✓ IMPRONTA DEL PROFILO uguale: sarebbero state unite subito.');
    return;
  }
  console.log(
    `   · impronta: ${ia.length ? ia.map((x) => x.slice(0, 12)).join(', ') : '—'}` +
      ` vs ${ib.length ? ib.map((x) => x.slice(0, 12)).join(', ') : '—'}` +
      ' (diverse: normale fra computer diversi, non decide niente)',
  );

  if (matchComputer(a, b) < 0) {
    console.log(
      `   ✗ VETO: stesso apparecchio (${a.computer?.model} ${a.computer?.deviceId ?? ''}), ` +
        `identificativi interni diversi (${a.computer?.diveId} ≠ ${b.computer?.diveId}). ` +
        'È il computer stesso a dire che sono due immersioni.',
    );
    return;
  }

  const dProf = Math.abs((a.maxDepth ?? 0) - (b.maxDepth ?? 0));
  const okProf = similar(a.maxDepth, b.maxDepth, TOLLERANZA_M);
  console.log(
    `   ${okProf ? '·' : '✗'} profondità massima: ${a.maxDepth?.toFixed(1)} vs ${b.maxDepth?.toFixed(1)} m ` +
      `→ scarto ${dProf.toFixed(2)} m, tolleranza ${soglia(a.maxDepth ?? 0, b.maxDepth ?? 0, TOLLERANZA_M)}`,
  );
  if (!okProf) return;

  if (a.avgDepth && b.avgDepth) {
    const dMed = Math.abs(a.avgDepth - b.avgDepth);
    const okMed = similar(a.avgDepth, b.avgDepth, TOLLERANZA_M);
    console.log(
      `   ${okMed ? '·' : '✗'} profondità media: ${a.avgDepth.toFixed(1)} vs ${b.avgDepth.toFixed(1)} m ` +
        `→ scarto ${dMed.toFixed(2)} m, tolleranza ${soglia(a.avgDepth, b.avgDepth, TOLLERANZA_M)}`,
    );
    if (!okMed) return;
  } else {
    console.log('   · profondità media: assente da una delle due, non decide niente');
  }

  if (!a.durationS || !b.durationS) {
    console.log('   ✗ durata assente da una delle due: senza durata non si uniscono mai');
    return;
  }
  const dDur = Math.abs(a.durationS - b.durationS);
  const okDur = similar(a.durationS, b.durationS, TOLLERANZA_S);
  console.log(
    `   ${okDur ? '·' : '✗'} durata: ${Math.round(a.durationS / 60)}′${a.durationS % 60}″ vs ` +
      `${Math.round(b.durationS / 60)}′${b.durationS % 60}″ → scarto ${Math.round(dDur / 60)}′${dDur % 60}″ ` +
      `(tolleranza ${soglia(a.durationS, b.durationS, TOLLERANZA_S)} s)`,
  );
  if (!okDur) return;

  const fuzz = Math.max(60, Math.max(a.durationS, b.durationS) / 2);
  const ta = Date.parse(a.startTime);
  const tb = Date.parse(b.startTime);
  const scarto = ta - tb;
  console.log(`   · finestra temporale: ±${Math.round(fuzz / 60)}′ (metà della durata più lunga)`);
  for (const off of offsets) {
    const residuo = Math.abs(scarto - off);
    const dentro = residuo <= fuzz * 1000;
    console.log(
      `   ${dentro ? '✓' : '✗'} con sfasamento ${Math.round(off / 60_000)}′: ` +
        `scarto d'orario ${(residuo / 60_000).toFixed(1)}′ ` +
        `${dentro ? '→ SI UNISCONO' : '→ fuori finestra'}`,
    );
  }
  if (!offsets.some((off) => likelySame(a, b, off))) {
    console.log(
      `   ⇒ scarto reale fra i due orari: ${(scarto / 60_000).toFixed(1)}′. ` +
        'Se è questo il motivo, gli orologi dei due computer non sono allineati.',
    );
  }
}

const percorso = process.argv[2];
if (!percorso) {
  console.error('Uso: npx tsx scripts/perche-non-unite.ts <backup.json> [AAAA-MM-GG]');
  process.exit(1);
}

const file = JSON.parse(readFileSync(percorso, 'utf8')) as { dives: Dive[] };
const tutte = (file.dives ?? []).filter((d) => !d.deletedAt);
if (!tutte.length) {
  console.error('Il backup non contiene immersioni.');
  process.exit(1);
}

const giorni = [...new Set(tutte.map(giornoDelLuogo))].sort();
const giorno = process.argv[3] ?? giorni[giorni.length - 1];
const delGiorno = tutte
  .filter((d) => giornoDelLuogo(d) === giorno)
  .sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime));

console.log(`Archivio: ${tutte.length} immersioni. Giorno esaminato: ${giorno} (${delGiorno.length}).`);
if (delGiorno.length < 2) {
  console.log('Meno di due immersioni quel giorno: non c’è niente da confrontare.');
  console.log(`Giorni disponibili: ${giorni.slice(-8).join(', ')}`);
  process.exit(0);
}

/*
 * Gli sfasamenti si stimano come li stima l'import vero, sull'intero archivio
 * contro le immersioni del giorno: rifarlo solo sulle quattro darebbe una
 * risposta diversa da quella che ha prodotto il difetto.
 */
const resto = tutte.filter((d) => giornoDelLuogo(d) !== giorno);
const stimati = inferClockOffsets(resto, delGiorno);
console.log(
  stimati.length
    ? `Sfasamenti d'orologio riconosciuti: ${stimati.map((c) => `${Math.round(c.offsetMs / 60_000)}′ su ${c.pairs} coppie`).join(', ')}`
    : "Nessuno sfasamento d'orologio riconosciuto: servono 3 coppie che concordino entro cinque minuti, oppure 2 che concordino entro due minuti.",
);
const offsets = [0, ...stimati.map((c) => c.offsetMs)];

for (let i = 0; i < delGiorno.length; i++) {
  for (let j = i + 1; j < delGiorno.length; j++) {
    confronta(delGiorno[i], delGiorno[j], offsets);
  }
}
console.log('');
