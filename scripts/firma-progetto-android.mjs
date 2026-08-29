/**
 * Aggiunge la configurazione di firma al progetto Android generato.
 *
 * ► IL DIFETTO CHE QUESTO SCRIPT CHIUDE, E CHE È DURATO SETTIMANE. ◄
 *
 * Il workflow generava un keystore e scriveva `src-tauri/gen/android/
 * keystore.properties`, con dentro percorso, alias e password. Sembrava una
 * firma. **Non lo era: quel file non lo leggeva nessuno.** Il
 * `app/build.gradle.kts` che Tauri genera non contiene nessun `signingConfigs`
 * e nessun `signingConfig` nel tipo `release` — la firma su Android, in Tauri
 * 2, la si aggiunge a mano al progetto generato, ed è scritto nella loro
 * documentazione, non nel loro template.
 *
 * Il risultato, misurato il 29 agosto 2026 sull'APK vero scaricato dalla
 * release: **nessuna firma v1** (niente `META-INF/*.RSA`, `*.SF`) e **nessun
 * APK Signing Block v2/v3**. Un APK non firmato **Android si rifiuta di
 * installarlo**: il pulsante «Scarica per Android» del sito ha consegnato per
 * settimane un file che non si installa, a chiunque l'abbia premuto.
 *
 * Nessun comando è mai fallito. `tauri android build --apk` finiva con esito
 * zero, il workflow era verde, l'artefatto c'era e pesava dieci megabyte. È la
 * sesta volta che questo progetto paga la stessa specie di guasto — il gestore
 * Rust registrato per due piattaforme su quattro, il file fuori dalla lista dei
 * sorgenti, la rotta promessa da un file di configurazione, la dichiarazione
 * doganale in un plist su due, il numero sbagliato dentro un commento — e la
 * regola è sempre quella: **nessuna dà errore, perché nessuna è malformata.
 * Sono assenze.**
 *
 * E come le altre cinque, è stata trovata guardando dentro il file consegnato,
 * non facendo girare i controlli.
 *
 * PERCHÉ QUI E NON NEL TEMPLATE. Stessa ragione di
 * `pulisci-progetto-ios.mjs`: prendere in gestione il template di Tauri
 * significa possederne una copia per sempre e perderne le correzioni in
 * silenzio. Questo tocca UNA volta un file appena generato, e se un giorno
 * Tauri aggiungesse la firma da sé questo script se ne accorge e lo dice.
 *
 * ► SE NON RIESCE, DEVE ROMPERE. ◄ Uno script che «sistema» un file generato e
 * fallisce in silenzio quando il file cambia forma riporta esattamente al
 * guasto che è nato per chiudere — solo con una riga in più nel log a dire che
 * andava tutto bene.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const GRADLE = 'src-tauri/gen/android/app/build.gradle.kts';
const PROPRIETA = 'src-tauri/gen/android/keystore.properties';

if (!existsSync(GRADLE)) {
  console.error(`${GRADLE} non c’è: va lanciato dopo \`tauri android init\``);
  process.exit(1);
}

let testo = readFileSync(GRADLE, 'utf8');

if (testo.includes('signingConfigs')) {
  // Non è un errore: è il caso di chi lo lancia due volte, o del giorno in cui
  // Tauri la firma la mette da sé. Vale la pena dirlo, perché il secondo caso
  // vuole che questo script sparisca.
  console.log('firma già configurata, niente da fare');
  process.exit(0);
}

if (!existsSync(PROPRIETA)) {
  console.error(`${PROPRIETA} non c’è: senza non c’è niente con cui firmare`);
  process.exit(1);
}

/*
 * `keystore.properties` ha UNA voce `password`, e viene usata sia come
 * `storePassword` sia come `keyPassword`. Non è una semplificazione nostra: è
 * la forma che Tauri documenta, ed è il motivo per cui il keystore va generato
 * con `-storepass` e `-keypass` uguali. Con due password diverse gradle
 * fallisce, e il suo messaggio non nomina questa causa.
 */
const BLOCCO =
  `
// ── firma ──────────────────────────────────────────────────────────────────
// Aggiunto da scripts/firma-progetto-android.mjs. Vedi i commenti là: il
// template di Tauri non contiene nessuna configurazione di firma, e senza
// questo blocco ` +
  '`keystore.properties`' +
  ` non lo legge nessuno e il pacchetto esce
// NON FIRMATO — cosa che nessun comando segnala, e che Android scopre al
// momento dell'installazione rifiutandola.
val proprietaKeystore = Properties().apply {
    val f = rootProject.file("keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}

android {
    signingConfigs {
        create("release") {
            val percorso = proprietaKeystore.getProperty("storeFile")
            if (percorso != null) {
                storeFile = file(percorso)
                keyAlias = proprietaKeystore.getProperty("keyAlias")
                // Una password sola per tutti e due: vedi sopra.
                storePassword = proprietaKeystore.getProperty("password")
                keyPassword = proprietaKeystore.getProperty("password")
            }
        }
    }
    buildTypes {
        getByName("release") {
            signingConfig = signingConfigs.getByName("release")

            // I SIMBOLI DEL CODICE NATIVO. Senza, Play avvisa al caricamento e,
            // il giorno di un crash dentro Rust o dentro libdivecomputer, in
            // Android Vitals arrivano indirizzi esadecimali invece dei nomi
            // delle funzioni: un rapporto che non si può leggere. Non tocca chi
            // usa l'app, tocca la possibilità di capire cosa le è successo.
            //
            // SYMBOL_TABLE e non FULL: dà i nomi delle funzioni senza i numeri
            // di riga, e pesa una frazione. FULL su 115 file C più tutto Rust
            // gonfierebbe il caricamento per un dettaglio che serve poche volte
            // — e i simboli restano su Play, non finiscono sul telefono di
            // nessuno.
            ndk {
                debugSymbolLevel = "SYMBOL_TABLE"
            }
        }
    }
}
`;

// Si aggiunge in coda: `android { }` in Kotlin DSL si può riaprire, e un blocco
// in fondo non deve indovinare dove finisce quello generato — che è
// esattamente il genere di indovinello che si rompe alla prossima versione.
const ANCORA = 'apply(from = "tauri.build.gradle.kts")';
if (!testo.includes(ANCORA)) {
  console.error(
    `${GRADLE} non contiene più \`${ANCORA}\`: il template di Tauri è cambiato, ` +
      'e questo script va riguardato invece di tirare a indovinare',
  );
  process.exit(1);
}
if (!testo.includes('import java.util.Properties')) {
  testo = `import java.util.Properties\n${testo}`;
}
testo += BLOCCO;
writeFileSync(GRADLE, testo);

// Si rilegge dal disco e si pretende di ritrovare quello che si è scritto: in
// questo progetto una scrittura dichiarata non è una scrittura avvenuta.
const riletto = readFileSync(GRADLE, 'utf8');
for (const atteso of [
  'signingConfigs',
  'signingConfig = signingConfigs',
  'debugSymbolLevel',
  'import java.util.Properties',
]) {
  if (!riletto.includes(atteso)) {
    console.error(`la modifica non è finita sul disco: manca \`${atteso}\``);
    process.exit(1);
  }
}
console.log('firma configurata in', GRADLE);
