/**
 * Android e Google Play: le cose che non danno errore finché non è tardi.
 *
 * ► IL NOME DEL PACCHETTO NON SI CAMBIA PIÙ. ◄ Su Google Play
 * `it.ferrando.mydivelog` è l'identità dell'app per sempre: non si rinomina,
 * non si sposta, e un pacchetto con un identificativo diverso viene rifiutato
 * al caricamento perché non corrisponde a quello registrato. Lo stesso vale
 * verso il basso, verso chi l'APK ce l'ha già installato dal sito: cambiarlo
 * non aggiornerebbe niente, installerebbe una seconda applicazione accanto alla
 * prima. Il valore qui sotto non è copiato da `tauri.conf.json` per comodità —
 * è stato letto il 29 agosto 2026 DENTRO l'APK pubblicato su GitHub, che è
 * l'unico posto in cui quel nome è un fatto e non un'intenzione.
 *
 * LA FIRMA. Il workflow ha due modi: la chiave del proprietario dai segreti, e
 * la chiave usa-e-getta con la password in chiaro che serviva quando l'unico
 * canale era il sito. Il secondo produce un pacchetto che **Google Play
 * rifiuta**, perché la prima consegna registra la chiave di caricamento e ogni
 * consegna successiva con una chiave diversa viene respinta. Le prove qui sotto
 * difendono le tre cose che rendono innocuo avere due modi: che il modo buono
 * esista, che l'`.aab` si costruisca solo lì, e che il workflow **dica** quale
 * dei due ha usato. *Una ricaduta silenziosa nel modo vecchio darebbe un
 * pacchetto inservibile con la stessa spunta verde di uno buono, ed è
 * esattamente la specie di guasto che questo progetto colleziona: non un
 * errore, un'assenza.*
 *
 * L'`.aab` NON VA NELLA RELEASE. È la stessa regola del `.pkg` del Mac App
 * Store: un pacchetto firmato per un negozio, allegato a una release che la
 * gente scarica a mano, è un file che non si installa — un difetto
 * autoinflitto. Qui la prova è che la cartella che diventa la release raccolga
 * solo `*.apk`.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const RADICE = fileURLToPath(new URL('..', import.meta.url));

function leggi(percorso: string): string {
  return readFileSync(RADICE + percorso, 'utf8');
}

/** Letto dentro `MyDiveLog-Android-arm64.apk` pubblicato, non dedotto. */
const IDENTIFICATIVO = 'it.ferrando.mydivelog';

describe('il nome del pacchetto Android', () => {
  it('è quello registrato su Google Play, e non si cambia', () => {
    const conf = JSON.parse(leggi('src-tauri/tauri.conf.json')) as { identifier?: string };
    expect(
      conf.identifier,
      'cambiarlo rende il pacchetto irricevibile da Play e non aggiorna chi ha già l’APK',
    ).toBe(IDENTIFICATIVO);
  });

  it('il minimo di API resta dichiarato', () => {
    // Senza, Tauri mette il suo default: un numero che cambia da una versione
    // all'altra della CLI e che nessuno si accorgerebbe di aver cambiato.
    const conf = JSON.parse(leggi('src-tauri/tauri.android.conf.json')) as {
      bundle?: { android?: { minSdkVersion?: number } };
    };
    expect(conf.bundle?.android?.minSdkVersion).toBeTypeOf('number');
    expect(conf.bundle?.android?.minSdkVersion).toBeGreaterThanOrEqual(24);
  });
});

/**
 * ► IL WORKFLOW HA DUE LAVORI, E TUTTI E DUE HANNO UN PASSO CHE SI CHIAMA
 * «Raccogli». ◄ La prima versione di questo file cercava `- name: Raccogli` nel
 * file intero e trovava quello di WINDOWS, che sta prima: la prova sull'`.aab`
 * girava su un pezzo di YAML che con Android non c'entra niente, ed era verde
 * per il motivo sbagliato. Se n'è accorta la mutazione — mettere l'`.aab` nella
 * cartella della release non la faceva diventare rossa.
 *
 * Da qui in poi si ritaglia PRIMA il lavoro giusto, e si controlla di averlo
 * ritagliato: `soloAndroid()` pretende di trovare dentro il ritaglio una riga
 * che esiste solo lì. *Un ritaglio sbagliato non è vuoto: è pieno di un'altra
 * cosa, e una prova che gira sulla cosa sbagliata passa senza fatica.*
 */
function soloAndroid(wf: string): string {
  const inizio = wf.indexOf('\n  android:\n');
  if (inizio < 0) throw new Error('il lavoro `android:` non c’è più nel workflow');
  return wf.slice(inizio);
}

describe('il workflow che costruisce per Android', () => {
  const wf = soloAndroid(leggi('.github/workflows/altre-piattaforme.yml'));

  it('il ritaglio è davvero il lavoro Android e non quello di Windows', () => {
    expect(wf, 'nel ritaglio non c’è il comando che costruisce Android').toContain('tauri android build');
    expect(wf, 'il ritaglio si è portato dietro il lavoro Windows').not.toContain('shell: pwsh');
  });

  it('prende la chiave dai tre segreti', () => {
    for (const segreto of ['ANDROID_KEYSTORE_BASE64', 'ANDROID_KEYSTORE_PASSWORD', 'ANDROID_KEY_ALIAS']) {
      expect(wf, `manca il segreto ${segreto}`).toContain(`secrets.${segreto}`);
    }
  });

  it("costruisce l'.aab quando la chiave è quella vera", () => {
    expect(wf, 'senza --aab non c’è niente da caricare su Play').toMatch(/tauri android build --apk --aab/);
  });

  it('dice a voce alta con quale delle due chiavi ha firmato', () => {
    // Il passo esiste, e ha DUE rami: uno che annuncia il modo buono e uno che
    // avverte del modo usa-e-getta. Un passo con un ramo solo tacerebbe proprio
    // nel caso in cui c'è qualcosa da dire.
    expect(wf).toMatch(/name: Come si è firmato/);
    expect(wf).toMatch(/::notice::.*chiave del proprietario/);
    expect(wf).toMatch(/::warning::.*usa-e-getta/);
  });

  it("non mette l'.aab nella cartella che diventa la release di GitHub", () => {
    const raccogli = /- name: Raccogli\n([\s\S]*?)\n\n/.exec(wf);
    expect(raccogli, 'il passo «Raccogli» non c’è più').not.toBeNull();
    expect(
      raccogli![1],
      'un pacchetto da negozio allegato a una release è un file che non si installa',
    ).not.toContain('.aab');
  });

  /**
   * ► LE TRE PROVE CHE NASCONO DAL 29 AGOSTO 2026. ◄
   *
   * L'APK pubblicato **non era firmato**: né v1 né v2/v3, misurato sul file
   * scaricato dalla release. Il workflow scriveva `keystore.properties` e il
   * `build.gradle.kts` generato da Tauri non lo legge, perché non contiene
   * nessuna configurazione di firma. Nessun comando è fallito, il workflow era
   * verde, l'artefatto pesava dieci megabyte — e Android un APK non firmato si
   * rifiuta di installarlo.
   *
   * Servono tutte e tre insieme: che la firma venga configurata, che il
   * pacchetto venga guardato dentro dopo la build, e che il guardare venga DOPO
   * il costruire. La terza sembra pedanteria e non lo è: lo stesso controllo
   * messo prima passerebbe sempre, perché non ci sarebbe niente da guardare.
   */
  it('configura la firma nel progetto generato', () => {
    expect(wf, 'senza questo il pacchetto esce non firmato').toContain(
      'node scripts/firma-progetto-android.mjs',
    );
  });

  it('guarda dentro il pacchetto per vedere se è firmato', () => {
    expect(wf).toMatch(/name: Il pacchetto è davvero firmato\?/);
    expect(wf, 'deve cercare la firma v2/v3 nel blocco dell’APK').toContain('APK Sig Block 42');
    expect(wf, 'e la firma del bundle, che è quella che Play pretende').toMatch(
      /\.aab.*NON è firmato|NON è firmato: Google Play/,
    );
  });

  /**
   * ► GUARDA SOLO I PACCHETTI CONSEGNATI, E CONTA QUELLI CHE HA GUARDATO. ◄
   *
   * Il primo giro con la chiave vera è fallito, e aveva quasi ragione: i due
   * pacchetti veri erano firmati (APK v2/v3, `.aab` v1), ma la ricerca guardava
   * sotto tutto `gen/android` e si è accesa su
   * `build/intermediates/.../intermediary-bundle.aab` — un file di passaggio di
   * gradle, che non è firmato perché non deve esserlo. *Una guardia che si
   * accende su una cosa che va bene insegna a spegnerla.*
   *
   * E restringere una ricerca ha il rischio gemello, che è peggiore: se un
   * giorno il percorso cambia, la ricerca non trova più niente e il controllo
   * **passa a vuoto**. Le due prove qui sotto stanno insieme apposta — la
   * seconda esiste solo perché esiste la prima.
   */
  it('guarda solo sotto build/outputs, dove stanno i pacchetti consegnati', () => {
    expect(wf, 'guardare gli intermedi di gradle accende la guardia per niente').toContain(
      "glob.glob('src-tauri/gen/android/app/build/outputs/**/*.apk'",
    );
    expect(wf).toContain("glob.glob('src-tauri/gen/android/app/build/outputs/**/*.aab'");
    expect(wf, 'nessuna ricerca deve pescare da tutto gen/android').not.toContain(
      "glob.glob('src-tauri/gen/android/**/",
    );
  });

  it('e considera un errore non aver guardato niente', () => {
    expect(wf, 'zero file guardati non è «tutto a posto»').toContain('il controllo non ha guardato niente');
    expect(wf, 'e per Play serve che un .aab ci sia stato davvero').toContain(
      'ma si stava costruendo per Play',
    );
  });

  it('lo guarda DOPO averlo costruito', () => {
    const costruisce = wf.indexOf('name: Costruisci');
    const verifica = wf.indexOf('name: Il pacchetto è davvero firmato?');
    expect(costruisce).toBeGreaterThan(-1);
    expect(verifica).toBeGreaterThan(-1);
    expect(verifica, 'un controllo prima della build non guarda niente').toBeGreaterThan(costruisce);
  });

  it("l'.aab esce in una cartella sua, col numero di versione nel nome", () => {
    expect(wf).toMatch(/mkdir per-play/);
    expect(wf).toMatch(/MyDiveLog-\$\{\{ inputs\.versione \}\}-play\.aab/);
  });
});
