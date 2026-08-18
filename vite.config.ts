import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// Tauri espone TAURI_DEV_HOST / TAURI_ENV_PLATFORM quando lancia vite.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
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
  },
  test: {
    environment: 'node',
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
