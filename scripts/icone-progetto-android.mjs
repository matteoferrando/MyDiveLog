/**
 * Mette le NOSTRE icone nel progetto Android che `tauri android init` genera.
 *
 *   node scripts/icone-progetto-android.mjs
 *
 * Va lanciato dopo `tauri android init` e prima di `tauri android build`: il
 * workflow lo fa nel passo «Le nostre icone nel progetto Android».
 *
 * ► IL DIFETTO CHE CHIUDE: GOOGLE PLAY HA RIFIUTATO LA 1.8.31. ◄ Il 2 ottobre
 * 2026, norma *Misleading Claims*: l'icona installata non era quella della
 * scheda. Il progetto Android non sta nel repository, lo rigenera il workflow
 * a ogni giro, e `tauri android init` ci mette l'icona di fabbrica di Tauri.
 * Le nostre stavano in `src-tauri/icons/android/` dall'agosto e nessun passo le
 * copiava: **ogni APK e ogni `.aab` costruiti fino alla 1.8.31 avevano i due
 * anelli di Tauri**, compreso l'APK che il sito offre a chi installa a mano.
 * Nessun comando falliva. È lo stesso schema della firma mancante (vedi
 * `firma-progetto-android.mjs`): una cosa che il template non fa, e che
 * nessuno vedeva perché nessuno guardava dentro il pacchetto.
 *
 * La copia si ricontrolla byte per byte, e zero file copiati è un errore: una
 * copia che non trova la cartella d'origine non dà errore, non copia niente, e
 * lascia nel pacchetto l'icona di Tauri con la stessa spunta verde. Quello che
 * arriva davvero nel pacchetto lo guarda poi `icona-nel-pacchetto.py`.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Copia ogni file di `origine` in `destinazione`, con le stesse sottocartelle. */
export function copiaIcone(origine, destinazione) {
  if (!existsSync(destinazione)) {
    throw new Error(`${destinazione} non c’è: va lanciato dopo \`tauri android init\``);
  }
  if (!existsSync(origine)) throw new Error(`${origine} non c’è: non ci sono icone da copiare`);
  const copiati = [];
  for (const cartella of readdirSync(origine).sort()) {
    const da = path.join(origine, cartella);
    if (!statSync(da).isDirectory()) continue;
    const a = path.join(destinazione, cartella);
    mkdirSync(a, { recursive: true });
    for (const file of readdirSync(da).sort()) {
      copyFileSync(path.join(da, file), path.join(a, file));
      // Si rilegge quello che si è scritto, invece di fidarsi della copia.
      if (!readFileSync(path.join(da, file)).equals(readFileSync(path.join(a, file)))) {
        throw new Error(`${cartella}/${file}: la copia non è uguale all'originale`);
      }
      copiati.push(`${cartella}/${file}`);
    }
  }
  if (copiati.length === 0) throw new Error(`${origine}: nessuna icona copiata`);
  if (!copiati.includes('mipmap-anydpi-v26/ic_launcher.xml')) {
    throw new Error('manca mipmap-anydpi-v26/ic_launcher.xml: senza, Android non usa l’icona adattiva');
  }
  return copiati;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const radice = fileURLToPath(new URL('..', import.meta.url));
  try {
    const copiati = copiaIcone(
      path.join(radice, 'src-tauri/icons/android'),
      path.join(radice, 'src-tauri/gen/android/app/src/main/res'),
    );
    console.log(`${copiati.length} file di icone nel progetto Android:\n  ${copiati.join('\n  ')}`);
  } catch (errore) {
    console.error(String(errore instanceof Error ? errore.message : errore));
    process.exit(1);
  }
}
