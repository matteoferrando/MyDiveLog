/**
 * I vincoli dell'App Store sulle schermate, misurati sui file veri.
 *
 *   node scripts/controlla-appstore.mjs
 *
 * ► PERCHÉ UN CONTROLLO SUO, E NON QUELLO DI PLAY. ◄ Le regole non si
 * somigliano. Play vuole un RAPPORTO — 16:9 o 9:16, col lato libero dentro un
 * intervallo. Apple vuole una MISURA presa da un elenco chiuso: 1320×2868
 * entra, 1320×2869 no, e un 16:10 perfetto come 1920×1200 viene rifiutato
 * anche sul Mac, che è tutto in 16:10. E Apple rifiuta una cosa che Play
 * accetta: **la trasparenza**, che a occhio non si vede — un PNG trasparente su
 * uno sfondo bianco sembra identico a uno opaco.
 *
 * Le misure sono quelle della pagina di Apple sulle specifiche delle schermate,
 * lette il 22 settembre 2026:
 *
 *   iPhone 6,9"  1260×2736 · 1290×2796 · 1320×2868, in verticale o in orizzontale
 *   Mac          1280×800 · 1440×900 · 2560×1600 · 2880×1800
 *
 * da una a dieci per apparecchio e per lingua. Il 6,9" basta per tutti gli
 * iPhone: le misure più piccole, se mancano, Apple le ricava da queste.
 *
 * ► LA TRASPARENZA SI LEGGE IN DUE POSTI. ◄ Il tipo di colore dell'`IHDR` — il
 * 4 e il 6 hanno il canale alfa — e il blocco `tRNS`, che rende trasparente un
 * colore anche in un PNG senza canale alfa. Guardare solo il tipo di colore
 * lascerebbe passare proprio il caso che nessuno vedrebbe.
 *
 * ► LE DUE LINGUE MOSTRANO LE STESSE SCENE, NELLO STESSO ORDINE. ◄ È la ragione
 * per cui quelle inglesi esistono: senza, Apple mostra a chi legge in inglese
 * le schermate della lingua principale. Una scena che c'è in italiano e manca
 * in inglese riaprirebbe lo stesso buco un riquadro più in là.
 *
 * ► E DUE FILE UGUALI BYTE PER BYTE NON PASSANO, nemmeno in due lingue. ◄ Una
 * schermata inglese identica a quella italiana vuol dire che la lingua non è
 * arrivata; due scene identiche vogliono dire che la seconda non è stata
 * raggiunta. È successo davvero, su Play: vedi `gemelle`.
 *
 * I nomi dei file sono `<apparecchio>-<lingua>-<numero>-<scena>.png`, come li
 * scrive `immagini-appstore.mjs`: **un file che non si legge così è un errore**,
 * perché da questa cartella si carica tutto quello che c'è, e un file in più
 * finisce nella scheda per sbaglio.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { gemelle, misura } from './controlla-play.mjs';

const RADICE = fileURLToPath(new URL('..', import.meta.url));
export const CARTELLA = path.join(RADICE, '_transfer/appstore');

export const LINGUE = ['it', 'en'];
const MASSIMO = 10;

export const APPARECCHI = [
  {
    nome: 'iPhone 6,9"',
    prefisso: 'iphone',
    misure: [
      [1260, 2736],
      [1290, 2796],
      [1320, 2868],
    ],
    ruota: true,
  },
  {
    nome: 'Mac',
    prefisso: 'mac',
    misure: [
      [1280, 800],
      [1440, 900],
      [2560, 1600],
      [2880, 1800],
    ],
    ruota: false,
  },
];

/**
 * I tipi dei blocchi di un PNG fino al primo `IDAT`: `tRNS`, quando c'è, sta
 * prima. Si legge a mano come l'`IHDR` in `controlla-play.mjs`: dodici byte di
 * cornice per blocco, niente librerie.
 */
export function blocchi(file) {
  const d = readFileSync(file);
  const tipi = [];
  let i = 8;
  while (i + 8 <= d.length) {
    const tipo = d.subarray(i + 4, i + 8).toString('latin1');
    tipi.push(tipo);
    if (tipo === 'IDAT' || tipo === 'IEND') break;
    i += 12 + d.readUInt32BE(i);
  }
  return tipi;
}

const NOME = /^([a-z0-9]+)-([a-z]{2})-(\d+)-([a-z0-9-]+)\.png$/;

export function controlla(cartella = CARTELLA) {
  const file = readdirSync(cartella)
    .filter((f) => !f.startsWith('.'))
    .sort();
  const guai = [];
  const righe = [];
  /** `iphone` → `it` → i file, in ordine di nome. */
  const gruppi = new Map(APPARECCHI.map((a) => [a.prefisso, new Map(LINGUE.map((l) => [l, []]))]));

  for (const f of file) {
    const m = NOME.exec(f);
    const suoi = m ? gruppi.get(m[1])?.get(m[2]) : undefined;
    if (!m || !suoi) {
      guai.push(
        `${f}: non è la schermata di nessun apparecchio in nessuna lingua — un file in più si carica per sbaglio`,
      );
      continue;
    }
    suoi.push({ f, numero: Number(m[3]), scena: m[4] });
  }

  for (const app of APPARECCHI) {
    const perLingua = gruppi.get(app.prefisso);
    for (const lingua of LINGUE) {
      const suoi = perLingua.get(lingua);
      if (suoi.length < 1) guai.push(`${app.nome}, ${lingua}: nessuna schermata, ne serve almeno una`);
      if (suoi.length > MASSIMO)
        guai.push(`${app.nome}, ${lingua}: ${suoi.length} schermate, il massimo è ${MASSIMO}`);

      // Due file per la stessa scena sono il residuo di una rinumerazione:
      // la storia è in `controlla-play.mjs`, dove è successo davvero.
      const scene = new Map();
      for (const { f, scena } of suoi) {
        if (scene.has(scena))
          guai.push(`${f}: stessa schermata di ${scene.get(scena)} — residuo di una rinumerazione`);
        else scene.set(scena, f);
      }

      for (const { f } of suoi) {
        const pieno = path.join(cartella, f);
        const m = misura(pieno);
        const g = [];
        const giusta = app.misure.some(
          ([l, a]) =>
            (m.larghezza === l && m.altezza === a) || (app.ruota && m.larghezza === a && m.altezza === l),
        );
        if (!giusta)
          g.push(
            `${m.larghezza}×${m.altezza} non è una misura di Apple per ${app.nome} (${app.misure.map((x) => x.join('×')).join(', ')}${app.ruota ? ', anche girate' : ''})`,
          );
        if (m.tipoColore === 4 || m.tipoColore === 6 || blocchi(pieno).includes('tRNS'))
          g.push(`ha la trasparenza (tipo di colore ${m.tipoColore}), che Apple rifiuta`);
        righe.push(
          `  ${g.length ? '✗' : '✓'} ${f.padEnd(32)} ${m.larghezza}×${m.altezza}  ${(statSync(pieno).size / 1024).toFixed(0)} kB${g.length ? '  → ' + g.join('; ') : ''}`,
        );
        for (const x of g) guai.push(`${f}: ${x}`);
      }
    }

    // Le stesse scene nelle due lingue, con gli stessi numeri: l'ordine della
    // scheda è l'ordine dei file.
    const [prima, ...altre] = LINGUE;
    const elenco = (l) => perLingua.get(l).map(({ numero, scena }) => `${numero}-${scena}`);
    for (const altra of altre) {
      const a = elenco(prima);
      const b = elenco(altra);
      for (const s of a.filter((x) => !b.includes(x)))
        guai.push(`${app.prefisso}: «${s}» c'è in ${prima} e non in ${altra}`);
      for (const s of b.filter((x) => !a.includes(x)))
        guai.push(`${app.prefisso}: «${s}» c'è in ${altra} e non in ${prima}`);
    }
    righe.push('');
  }

  // Due file con gli stessi byte sono la stessa fotografia con due nomi: vedi
  // `gemelle` in `controlla-play.mjs`. Qui vale anche FRA LE LINGUE — una
  // schermata «inglese» identica a quella italiana vuol dire che la lingua non
  // è arrivata, cioè esattamente il buco che queste schermate chiudono.
  guai.push(...gemelle(cartella, file));

  return { righe, guai };
}

// Lanciato da solo stampa e fallisce; importato, lascia decidere a chi importa.
if (import.meta.url === `file://${process.argv[1]}`) {
  const { righe, guai } = controlla();
  console.log(righe.join('\n'));
  if (guai.length) {
    console.error('NON VA:\n' + guai.map((g) => '  - ' + g).join('\n'));
    process.exit(1);
  }
  console.log("Tutto dentro le specifiche dell'App Store.");
}
