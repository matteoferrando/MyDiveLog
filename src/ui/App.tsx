/**
 * Guscio dell'interfaccia e navigazione.
 *
 * Nessun router: le viste sono una manciata e lo stato di navigazione è una stringa.
 * Un router aggiungerebbe una dipendenza e, in un'app che gira dentro una
 * webview senza barra degli indirizzi, non porterebbe niente in cambio.
 *
 * Le pagine, però, sono a caricamento pigro. Il motivo non è il desktop — lì il
 * bundle intero arriva dal disco locale e nessuno se ne accorge — ma il primo
 * avvio su iPhone, dove la WKWebView deve leggere, decomprimere e *compilare*
 * tutto il JavaScript prima di disegnare un pixel. Il pianificatore di gas e la
 * scheda di dettaglio, da soli, sono metà del codice dell'applicazione e servono
 * a partire dal secondo tocco, non al primo.
 *
 * Il Logbook resta importato in modo statico ed è l'unica eccezione voluta: è la
 * vista di partenza. Renderlo pigro significherebbe scambiare un bundle grosso
 * con un lampo di pagina vuota all'apertura, che è un peggioramento travestito
 * da ottimizzazione.
 */

import { lazy, Suspense, useEffect, useState } from 'react';
import { imm } from './format';
import { Logbook } from './pages/Logbook';
import { CLAIM, Mark } from './components/Mark';
import { useDiveLog } from './state';

/*
 * `React.lazy` vuole un modulo con export predefinito; le pagine esportano un
 * nome. Il `.then` che rimappa è la traduzione fra le due convenzioni, e sta
 * qui invece che nelle pagine perché la forma dell'export è un dettaglio di
 * questo file, non un vincolo che i moduli debbano subire.
 */
const Planner = lazy(() => import('./pages/Planner').then((m) => ({ default: m.Planner })));
const Stats = lazy(() => import('./pages/Stats').then((m) => ({ default: m.Stats })));
const Coach = lazy(() => import('./pages/Coach').then((m) => ({ default: m.Coach })));
const Compare = lazy(() => import('./pages/Compare').then((m) => ({ default: m.Compare })));
const Gear = lazy(() => import('./pages/Gear').then((m) => ({ default: m.Gear })));
const ImportPage = lazy(() => import('./pages/ImportPage').then((m) => ({ default: m.ImportPage })));
const SyncPage = lazy(() => import('./pages/SyncPage').then((m) => ({ default: m.SyncPage })));
const DiveDetail = lazy(() => import('./pages/DiveDetail').then((m) => ({ default: m.DiveDetail })));

type View = 'logbook' | 'compare' | 'stats' | 'coach' | 'planner' | 'gear' | 'import' | 'sync';

const TABS: { id: View; label: string }[] = [
  { id: 'logbook', label: 'Logbook' },
  { id: 'compare', label: 'Confronta' },
  { id: 'stats', label: 'Statistiche' },
  { id: 'coach', label: 'Suggerimenti' },
  { id: 'planner', label: 'Gas' },
  { id: 'gear', label: 'Attrezzatura' },
  { id: 'import', label: 'Importa' },
  { id: 'sync', label: 'Impostazioni' },
];

/**
 * Segnaposto mostrato mentre il pezzo di codice di una pagina arriva.
 *
 * Deliberatamente muto. Un chunk servito dal disco (Tauri) o da una connessione
 * decente si risolve in poche decine di millisecondi: uno spinner o la scritta
 * «Caricamento…» in quella finestra non informa nessuno, lampeggia e basta —
 * e il lampeggio si legge come un difetto, non come un'attesa.
 *
 * Quello che conta è che il segnaposto occupi lo stesso spazio della pagina che
 * sostituirà. Ha quindi la classe `page` — stessa larghezza massima, stesso
 * padding, stesso incolonnamento — e un'altezza minima che tiene ferma la barra
 * di scorrimento di `.main`. Senza, il contenuto vero comparirebbe dopo un salto
 * verticale: la pagina si apre a zero pixel, la scrollbar sparisce, la finestra
 * si allarga, e al render successivo tutto torna indietro. È lo stesso motivo
 * per cui si riservano le dimensioni di un'immagine prima di caricarla.
 *
 * `aria-busy` dice a un lettore di schermo che quella regione è in transizione,
 * visto che non c'è testo a dirlo.
 */
function PagePlaceholder() {
  return <div className="page" aria-busy="true" style={{ minHeight: '70vh' }} />;
}

export function App() {
  const { ready, dives } = useDiveLog();
  const [view, setView] = useState<View>('logbook');
  const [openDive, setOpenDive] = useState<string | null>(null);

  // Al primo avvio con archivio vuoto, la vista utile è l'import.
  useEffect(() => {
    if (ready && dives.length === 0) setView('import');
  }, [ready, dives.length]);

  const go = (v: View) => {
    setOpenDive(null);
    setView(v);
  };

  if (!ready) {
    return (
      <div className="app">
        <div className="empty">
          <Mark size={56} />
          <p className="muted" style={{ marginTop: 12 }}>
            Apertura dell'archivio…
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand" title={CLAIM}>
          <Mark size={30} />
          <div>
            MyDiveLog
            <small>{imm(dives.length)}</small>
          </div>
        </div>
        <nav className="nav">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => go(t.id)}
              aria-current={view === t.id && !openDive ? 'page' : undefined}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <span className="topbar-spacer" />
      </header>

      {/*
       * Un solo `Suspense` attorno a tutto il contenuto, dentro `.main`: la barra
       * in alto non deve mai smontarsi mentre una pagina arriva, altrimenti i
       * pulsanti di navigazione sparirebbero proprio nell'istante in cui l'utente
       * ha appena finito di premerne uno.
       */}
      <main className="main">
        <Suspense fallback={<PagePlaceholder />}>
          {openDive ? (
            <DiveDetail id={openDive} onBack={() => setOpenDive(null)} />
          ) : view === 'logbook' ? (
            <Logbook onOpen={setOpenDive} />
          ) : view === 'stats' ? (
            <Stats onOpen={setOpenDive} />
          ) : view === 'coach' ? (
            <Coach />
          ) : view === 'planner' ? (
            <Planner />
          ) : view === 'compare' ? (
            <Compare onOpen={setOpenDive} />
          ) : view === 'gear' ? (
            <Gear />
          ) : view === 'sync' ? (
            <SyncPage />
          ) : (
            <ImportPage onDone={() => go('logbook')} />
          )}
        </Suspense>
      </main>
    </div>
  );
}
