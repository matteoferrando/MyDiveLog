import { readFileSync } from 'node:fs';

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

/**
 * Il numero di versione, dentro l'interfaccia.
 *
 * ► SERVE A UN FILE, NON A UNA SCHERMATA. ◄ Le registrazioni del banco di prova
 * sono fatte per essere riaperte fra mesi, quando l'apparecchio non c'è più e
 * nessuno ricorda quale versione le ha prodotte. *Una registrazione che non dice
 * da quale programma viene obbliga chi la legge a indovinare, e chi indovina
 * sbaglia proprio sui casi interessanti.*
 *
 * Si legge da `package.json`, che è la stessa fonte da cui lo prendono
 * `Cargo.toml` e `tauri.conf.json`: tre file con lo stesso numero, e una prova
 * che li confronta.
 */
const VERSIONE = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;

// Tauri espone TAURI_DEV_HOST / TAURI_ENV_PLATFORM quando lancia vite.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  define: { __VERSIONE__: JSON.stringify(VERSIONE) },
  plugins: [react()],
  resolve: {
    alias: {
      '@core': fileURLToPath(new URL('./src/core', import.meta.url)),
      '@ui': fileURLToPath(new URL('./src/ui', import.meta.url)),
      '@storage': fileURLToPath(new URL('./src/storage', import.meta.url)),
    },
  },
  // Tauri usa una porta fissa e non tollera fallback silenziosi.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  build: {
    // Safari 15+ / WKWebView su iOS.
    target: 'safari15',
    minify: !process.env.TAURI_ENV_DEBUG,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
    rollupOptions: {
      output: {
        /*
         * Le dipendenze grosse vanno in pezzi propri, separati dal codice
         * dell'applicazione.
         *
         * Non è una questione di byte scaricati al primo avvio — react-dom e
         * fast-xml-parser servono comunque subito, perché `state.tsx` monta i
         * parser insieme all'archivio — ma di CACHE. Il codice nostro cambia a
         * ogni commit; react-dom cambia due volte l'anno. Tenuti insieme,
         * l'hash del file unico si sposta a ogni build e l'utente riscarica
         * 500 kB per aver corretto un'etichetta. Separati, dopo il primo avvio
         * ogni aggiornamento costa solo la parte che è davvero cambiata.
         *
         * `@garmin/fitsdk` e `@libsql/client` sono già in pezzi propri perché
         * chi li usa li importa con `import()` dinamico; nominarli qui non
         * cambia il grafo, dà solo un nome leggibile al file invece di un hash
         * anonimo — quando il pezzo da 385 kB compare nel pannello di rete si
         * capisce al volo che è il decoder FIT e non un pezzo dell'app.
         *
         * La forma a funzione e non a mappa: la mappa (`{ react: ['react'] }`)
         * risolve gli specificatori una volta sola e si perde i sottomoduli
         * raggiunti per percorso, tipo `react/jsx-runtime`.
         */
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined;
          // La barra finale evita che `react` acchiappi anche `react-dom`.
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'react';
          if (id.includes('node_modules/fast-xml-parser')) return 'xml';
          if (id.includes('node_modules/@garmin/fitsdk')) return 'fit';
          if (id.includes('node_modules/@libsql')) return 'libsql';
          return undefined;
        },
      },
    },
  },
  test: {
    environment: 'node',
    // Una riga sola, che alza `IS_REACT_ACT_ENVIRONMENT`: senza, ogni render
    // dei test che montano componenti stampava «The current testing environment
    // is not configured to support act(...)», e una passata ne produceva
    // centinaia. Il perché per esteso sta in testa a quel file.
    setupFiles: ['tests/preparazione.ts'],
    // I test che montano componenti React hanno bisogno di un DOM: lo chiedono
    // con `// @vitest-environment jsdom` in testa al file, così gli altri 200
    // test restano in ambiente Node e girano in un secondo.
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    // I 5 secondi predefiniti sono tarati su una macchina da sviluppo. I runner
    // condivisi della CI sono parecchie volte più lenti, e il test che costruisce
    // un albero B da 2000 righe con pagine da 512 byte — un secondo scarso qui —
    // là sforava e faceva fallire tutta la suite per un motivo che non è un bug.
    // Un limite alto non nasconde niente: serve a distinguere «lento» da «rotto»,
    // e un test davvero bloccato sfora comunque.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
