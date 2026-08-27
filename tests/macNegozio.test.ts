/**
 * Quello che il pacchetto per il Mac App Store deve dichiarare ad Apple.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ► IL DIFETTO CHE HA FATTO NASCERE QUESTO FILE. ◄
 *
 * `tests/iosGuardie.test.ts` controllava da mesi che `Info.ios.plist`
 * dichiarasse l'esenzione sulla crittografia. Il plist di macOS non lo
 * controllava nessuno, perché fino al 27 agosto 2026 su macOS non si caricava
 * niente su App Store Connect: il Mac usciva dal sito, in `.dmg`, e a un `.dmg`
 * la dogana non chiede niente.
 *
 * Il giorno del primo caricamento sul Mac App Store la build è arrivata intera e
 * si è fermata su «Conformità mancante». Non è un rifiuto: è la domanda
 * doganale fatta a mano, e finché non le si risponde nel pannello la versione
 * sta ferma. La chiave c'era, in un file, per una piattaforma sola.
 *
 * ► PERCHÉ NESSUN CONTROLLO POTEVA PRENDERLO. ◄ Il plist di macOS era valido,
 * il pacchetto era firmato, le entitlements erano giuste e la build era
 * accettata. Mancava una dichiarazione, e una dichiarazione che manca non
 * produce un errore: produce **un'attesa**. È la stessa forma dei difetti che
 * questo progetto ha già pagato — il gestore Rust registrato per due
 * piattaforme su quattro, il file mancante dalla lista dei sorgenti, il numero
 * sbagliato dentro un commento, la rotta promessa in un `.toml` e mai scritta.
 * Codice corretto, e una mancanza che nessun compilatore guarda.
 *
 * ► E IL SECONDO DIFETTO, PEGGIORE. ◄ `minimumSystemVersion` diceva 10.15
 * mentre il binario era solo arm64. Per settimane il sito ha offerto un
 * download che su un Mac Intel — e su qualunque Mac fermo al Catalina —
 * installa e non si apre. Non l'ha scoperto un utente e non l'ha scoperto un
 * test: l'ha scoperto Apple, rifiutando il caricamento. Un numero scritto a mano
 * che descrive il binario sbagliato è una bugia che non fa rumore.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const leggi = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');

const PLIST_MAC = leggi('../src-tauri/Info.plist');
const PLIST_IOS = leggi('../src-tauri/Info.ios.plist');
const ENTITLEMENTS = leggi('../src-tauri/Entitlements.negozio.plist');
const CONFIGURAZIONE = JSON.parse(leggi('../src-tauri/tauri.conf.json'));

/** Legge il valore booleano di una chiave in un plist, senza dipendere da un parser. */
function booleanoNelPlist(plist: string, chiave: string): boolean | undefined {
  const trovato = plist.match(new RegExp(`<key>${chiave}</key>\\s*\\n?\\s*<(true|false)\\s*/>`));
  return trovato ? trovato[1] === 'true' : undefined;
}

/** Legge il valore testuale di una chiave in un plist. */
function stringaNelPlist(plist: string, chiave: string): string | undefined {
  const trovato = plist.match(new RegExp(`<key>${chiave}</key>\\s*\\n?\\s*<string>([^<]*)</string>`));
  return trovato ? trovato[1] : undefined;
}

describe('la dichiarazione doganale sulla crittografia', () => {
  it('c’è anche nel plist di macOS, o ogni build si ferma su «Conformità mancante»', () => {
    expect(booleanoNelPlist(PLIST_MAC, 'ITSAppUsesNonExemptEncryption')).toBe(false);
  });

  it('dice la STESSA cosa su macOS e su iOS', () => {
    /*
     * Non è pedanteria da configurazione. È la stessa applicazione, e la
     * domanda è di un'autorità doganale: due risposte diverse alla stessa
     * domanda, per lo stesso prodotto, sono una contraddizione che resta agli
     * atti. Il giorno che l'app cifrerà davvero qualcosa — un backup protetto,
     * un algoritmo nostro — le righe da cambiare sono due, e questo test è
     * quello che costringe a ricordarsene.
     */
    const mac = booleanoNelPlist(PLIST_MAC, 'ITSAppUsesNonExemptEncryption');
    const ios = booleanoNelPlist(PLIST_IOS, 'ITSAppUsesNonExemptEncryption');
    expect(mac).toBe(ios);
  });
});

describe('il minimo di sistema dichiarato per macOS', () => {
  it('è almeno 12.0, perché il binario è solo arm64', () => {
    /*
     * Non è una preferenza: è la regola con cui Apple ha rifiutato il primo
     * caricamento. Un pacchetto che contiene solo arm64 e dichiara un minimo
     * sotto il 12.0 promette di girare su Mac Intel, dove non gira. Se un
     * giorno si compila anche per Intel — un binario universale — questo test
     * va cambiato di proposito, e nel cambiarlo ci si accorge di cosa si sta
     * promettendo.
     */
    const minimo = String(CONFIGURAZIONE.bundle?.macOS?.minimumSystemVersion ?? '');
    expect(minimo).toMatch(/^\d+\.\d+$/);
    const [grande, piccolo] = minimo.split('.').map(Number);
    expect(grande * 100 + piccolo).toBeGreaterThanOrEqual(1200);
  });
});

describe('le entitlements del pacchetto per il negozio', () => {
  it('portano l’identificativo dell’app che dice davvero tauri.conf.json', () => {
    /*
     * Un identificativo che non combacia non fa fallire la firma: `codesign`
     * scrive quello che gli si dà. Il rifiuto arriva al caricamento, dopo una
     * compilazione intera. Lo script di pubblicazione lo confronta col profilo
     * di provisioning; questo test lo confronta con la configurazione, che è
     * l'altra metà della stessa verità.
     */
    const squadra = stringaNelPlist(ENTITLEMENTS, 'com.apple.developer.team-identifier');
    const app = stringaNelPlist(ENTITLEMENTS, 'com.apple.application-identifier');
    expect(squadra).toBeTruthy();
    expect(app).toBe(`${squadra}.${CONFIGURAZIONE.identifier}`);
  });

  it('tengono la sandbox accesa, che è la condizione per stare nel negozio', () => {
    /*
     * Senza App Sandbox il pacchetto viene rifiutato in lavorazione. È l'unica
     * entitlement che non si può togliere «per provare»: toglierla fa
     * funzionare tutto in locale e fallire il caricamento.
     */
    expect(booleanoNelPlist(ENTITLEMENTS, 'com.apple.security.app-sandbox')).toBe(true);
  });

  it('chiedono il Bluetooth, che è la ragione per cui l’app esiste', () => {
    expect(booleanoNelPlist(ENTITLEMENTS, 'com.apple.security.device.bluetooth')).toBe(true);
  });
});
