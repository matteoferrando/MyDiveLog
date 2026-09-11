/**
 * Il numero di versione dell'applicazione, dentro l'interfaccia.
 *
 * ► ESISTE PER LE REGISTRAZIONI DEL BANCO DI PROVA. ◄ Quei file sono fatti per
 * essere riaperti fra mesi, quando l'apparecchio non c'è più e nessuno ricorda
 * quale versione li ha prodotti. *Una registrazione che non dice da quale
 * programma viene obbliga chi la legge a indovinare, e chi indovina sbaglia
 * proprio sui casi interessanti.*
 *
 * Il valore lo inserisce Vite al momento della compilazione leggendo
 * `package.json` — la stessa fonte di `Cargo.toml` e `tauri.conf.json`, che una
 * prova tiene allineati. Nelle prove, dove Vite non c'è, si ripiega su una
 * parola che lo dichiara invece di far esplodere qualcosa: *un numero di
 * versione mancante non deve poter rompere uno scarico.*
 */
declare const __VERSIONE__: string | undefined;

export function versione(): string {
  try {
    return typeof __VERSIONE__ === 'string' ? __VERSIONE__ : 'sconosciuta';
  } catch {
    return 'sconosciuta';
  }
}
