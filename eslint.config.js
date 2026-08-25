/**
 * Configurazione ESLint (flat config, ESLint 9).
 *
 * Il criterio con cui è scritta è uno solo: un linter che protesta su ogni riga
 * viene spento il primo giorno, e allora tanto vale non averlo. Qui dentro ci
 * sono le regole che trovano BACHI — codice che fa una cosa diversa da quella
 * che sembra fare — e non ci sono le regole che hanno un'opinione su come si
 * scrive. Della forma si occupa Prettier, e `eslint-config-prettier` in coda
 * spegne tutto ciò che potrebbe litigarci: due strumenti che si contraddicono
 * sullo stesso file sono peggio di nessuno dei due.
 *
 * Il risultato su ~43.000 righe è un centinaio di segnalazioni, quasi tutte
 * vere. È il numero giusto: abbastanza basso da poterle leggere una per una,
 * abbastanza alto da valere la lettura.
 *
 * Dove ho spento qualcosa l'ho scritto sul posto, con il motivo. Un `off` senza
 * spiegazione, fra sei mesi, è indistinguibile da una svista.
 */

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  {
    // `dist` e `node_modules` sono generati; `src-tauri` è Rust e ha il suo
    // strumentario (cargo clippy, cargo fmt); `demo` sono file di prova dei
    // computer subacquei — cioè dati, non codice — e `docs` è prosa.
    //
    // `dist-*` non era nell'elenco, e la mancanza si vedeva solo su una macchina
    // che avesse già fatto una build: `eslint .` entrava nel JavaScript minificato
    // e sputava duemila errori su codice che non abbiamo scritto noi. In CI la
    // cartella non esiste e il controllo passava — cioè il difetto era invisibile
    // esattamente dove serviva vederlo.
    ignores: [
      'dist/**',
      'dist-*/**',
      'node_modules/**',
      'src-tauri/**',
      'demo/**',
      'docs/**',
      'public/**',
      'screenshots/**',
      '_transfer/**',
    ],
  },

  js.configs.recommended,
  tseslint.configs.recommended,
  reactHooks.configs.flat['recommended-latest'],

  {
    // ---------------------------------------------------------------------
    // Regole con i tipi.
    //
    // Costano: obbligano ESLint a far girare il compilatore, e il controllo
    // completo passa da tre secondi a una trentina. Le tengo lo stesso, ma solo
    // le tre che senza i tipi sarebbero impossibili, non l'intero preset
    // `recommendedTypeChecked` — quello porta con sé la famiglia `no-unsafe-*`,
    // che su un progetto che parla con parser binari e SDK esterni segnala
    // centinaia di confini `any` già noti e volutamente lasciati lì.
    //
    // Vale solo per `src` e `tests`, gli unici due alberi che il tsconfig
    // include: chiedere i tipi per un file fuori dal progetto TypeScript fa
    // fallire il parser, non il file.
    // ---------------------------------------------------------------------
    files: ['src/**/*.{ts,tsx}', 'tests/**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // Una promise persa non fallisce: sparisce. In una app che scrive su
      // SQLite e sincronizza su Turso è esattamente il modo in cui un salvataggio
      // non riuscito diventa un archivio corrotto in silenzio.
      '@typescript-eslint/no-floating-promises': 'error',
      // `onClick={async () => …}`: React ignora la promise restituita, quindi
      // un'eccezione dentro l'handler diventa una unhandled rejection e l'utente
      // vede un bottone che non fa niente invece di un errore.
      '@typescript-eslint/no-misused-promises': 'error',
      // `await` su un valore che non è una promise di solito vuol dire che ci si
      // è dimenticati le parentesi di una chiamata.
      '@typescript-eslint/await-thenable': 'error',
    },
  },

  {
    // ---------------------------------------------------------------------
    // Regole generali.
    // ---------------------------------------------------------------------
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      // `==` fa coercizioni che quasi nessuno ricorda a memoria. L'eccezione su
      // `null` è deliberata: `x == null` è l'unico modo conciso di dire «null
      // oppure undefined», il codice lo usa una trentina di volte apposta, e
      // vietarlo vorrebbe dire riscrivere trenta condizioni corrette.
      eqeqeq: ['error', 'always', { null: 'ignore' }],

      // Della coercizione implicita tengo solo il pezzo che segnala qualcosa di
      // vero. Le altre due le spengo perché qui sono idiomi, non errori:
      //   - `number: false` → `+y` sulle catture di una regex di data e
      //     `+new Date(b) - +new Date(a)` nei comparatori. Sono 53 occorrenze
      //     dello stesso identico gesto, tutte corrette; sostituirle con
      //     `Number(...)` allunga le righe e non aggiunge nulla.
      //   - `boolean: false` → `!!x` per normalizzare a booleano, dieci volte,
      //     sempre dove il tipo di ritorno è dichiarato `boolean`.
      // Resta acceso `string`, che pesca `'' + x`: quello sì è un modo oscuro di
      // scrivere `String(x)` in un progetto che formatta numeri ovunque.
      'no-implicit-coercion': ['error', { boolean: false, number: false, string: true }],

      // Il `^_` è la convenzione per «lo so, non lo uso»: serve per gli argomenti
      // posizionali che stanno solo a tener posto e per i `catch (_e)`.
      // Attenzione: questa regola NON si sovrappone a `noUnusedLocals` del
      // tsconfig. TypeScript considera usata una variabile a cui si scrive e
      // basta; ESLint no. La differenza ha già trovato un accumulatore morto in
      // `planDeco`.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],

      // Le dipendenze sbagliate di un hook sono bachi veri — una vista che non si
      // aggiorna, o che si ricalcola a ogni render — non consigli di stile.
      // L'impostazione predefinita del plugin è `warn`; qui è `error` perché le
      // due segnalazioni attuali indicano entrambe un difetto reale, e perché il
      // codice contiene già un `eslint-disable-next-line` per questa regola:
      // l'autore la considerava vincolante prima ancora che ci fosse un linter.
      'react-hooks/exhaustive-deps': 'error',

      // ------------------------------------------------------------------
      // La famiglia «React Compiler» arrivata con eslint-plugin-react-hooks 7.
      // Non le spengo — trovano cose sensate — ma le abbasso a `warn`, perché
      // dicono «questo si potrebbe fare meglio», non «questo è rotto»: sono
      // pattern che qui sono scritti apposta e accompagnati da un commento che
      // spiega perché. Un avviso resta visibile senza bloccare una consegna.
      // ------------------------------------------------------------------
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/use-memo': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/static-components': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      // Questa invece resta `error`: chiamare un hook dentro una condizione non è
      // un'opinione, è il modo in cui React perde lo stato di un componente.
      'react-hooks/rules-of-hooks': 'error',

      // L'unico spazio irregolare del progetto è un BOM (U+FEFF) scritto dentro
      // la regex che serve proprio a togliere il BOM dai CSV esportati da Windows
      // (`src/core/parsers/csv.ts`). Segnalarlo è un falso positivo permanente.
      // Fuori dalle regex la regola resta accesa, che è dove conta: uno spazio
      // unicode capitato per sbaglio in mezzo al codice è illeggibile.
      'no-irregular-whitespace': ['error', { skipRegExps: true }],
    },
  },

  {
    // ---------------------------------------------------------------------
    // Fast Refresh: SPENTA, e vale la pena dire perché invece di toglierla.
    //
    // `only-export-components` chiede che un modulo esporti solo componenti,
    // altrimenti Vite in sviluppo ricarica la pagina invece del solo componente.
    // È ergonomia del dev server, non correttezza. Qui produce 27 segnalazioni
    // identiche, tutte su moduli organizzati apposta come cassette degli
    // attrezzi — `Charts.tsx` esporta i grafici insieme alle scale e ai
    // formattatori che li accompagnano, e sono 18 delle 27. Spezzare quei file
    // per far contento un ricaricamento a caldo è la coda che scodinzola il cane.
    //
    // Resta configurata e non cancellata: chi cambia idea sul layout dei moduli
    // riaccende una parola.
    // ---------------------------------------------------------------------
    files: ['src/**/*.tsx'],
    plugins: { 'react-refresh': reactRefresh },
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },

  {
    // Gli script di supporto e i file di configurazione girano in Node, non nel
    // browser. Per gli `.mjs` la distinzione non è cosmetica: lì `no-undef` è
    // attiva davvero (nei file TypeScript la spegne `tseslint`, perché a dire
    // quali nomi esistono ci pensa già il compilatore), e senza i globali di Node
    // ogni `process` e ogni `console` risulterebbe una variabile inventata.
    files: ['scripts/**', '*.config.{js,ts}', 'eslint.config.js'],
    languageOptions: { globals: globals.node },
  },

  // Sempre per ultimo: spegne ogni regola ESLint che esprima un'opinione sulla
  // formattazione, così Prettier è l'unica voce in capitolo sulla forma.
  prettier,
);
