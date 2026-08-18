/**
 * Guscio dell'interfaccia e navigazione.
 *
 * Nessun router: le viste sono una manciata e lo stato di navigazione è una stringa.
 * Un router aggiungerebbe una dipendenza e, in un'app che gira dentro una
 * webview senza barra degli indirizzi, non porterebbe niente in cambio.
 */

import { useEffect, useState } from 'react';
import { imm } from './format';
import { Coach } from './pages/Coach';
import { DiveDetail } from './pages/DiveDetail';
import { ImportPage } from './pages/ImportPage';
import { Compare } from './pages/Compare';
import { Gear } from './pages/Gear';
import { Logbook } from './pages/Logbook';
import { CLAIM, Mark } from './components/Mark';
import { Planner } from './pages/Planner';
import { Stats } from './pages/Stats';
import { SyncPage } from './pages/SyncPage';
import { useDiveLog } from './state';

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

      <main className="main">
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
      </main>
    </div>
  );
}
