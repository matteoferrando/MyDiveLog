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
 *
 * QUI STA ANCHE LA RADICE DELLE DUE COSE TRASVERSALI: la lingua e il «vai a».
 * La lingua perché il pulsante che la cambia vive nella barra in alto, cioè in
 * questo file; il «vai a» perché le pagine vuote devono poter mandare altrove
 * (vedi `navigazione.tsx`) e l'unico posto che sa come si cambia vista è il
 * guscio.
 */

import { Component, lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { imm } from './format';
import { Logbook } from './pages/Logbook';
import { CLAIM, Mark } from './components/Mark';
import { useDiveLog } from './state';
import { CambiaLingua, useLingua } from './lingua';
import { ProvvedituraNavigazione, type Vista } from './navigazione';

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

/*
 * Il tipo della vista sta in `navigazione.tsx` e non qui.
 *
 * Non per eleganza: se restasse in questo file, ogni pagina che vuole mandare
 * altrove dovrebbe importare `App.tsx` — cioè il guscio importerebbe le pagine
 * e le pagine il guscio. Un ciclo che il bundler risolve, ma che rompe il
 * caricamento pigro proprio delle pagine che si volevano rimandare.
 */
type View = Vista;

/*
 * Le etichette restano ITALIANE nella tabella, e si traducono al disegno.
 *
 * È la regola di tutta l'applicazione (vedi `lingua.tsx`): la frase italiana è
 * la chiave. Tradurle qui, una volta, vorrebbe dire tenere la tabella dentro il
 * componente per poter usare `t()` — e ricostruirla a ogni render per otto
 * stringhe costanti.
 */
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
 * La rete sotto l'interfaccia.
 *
 * NON c'era, e il costo si è visto: un solo record senza `maxDepth` — arrivato
 * da un backup malformato — faceva `undefined.toFixed(1)` nel logbook, React
 * smontava l'intero albero, e restava una pagina BIANCA. Siccome il record era
 * già sul disco, restava bianca anche dopo il riavvio: l'unico modo di rientrare
 * era cancellare l'archivio del browser, cioè perdere tutto per colpa di una riga.
 *
 * Un'applicazione che scrive su un archivio persistente non può permettersi che
 * un dato avvelenato la renda inavviabile. Qui l'errore resta confinato al
 * contenuto — la barra di navigazione sopravvive, quindi si può andare in
 * Impostazioni e ripristinare un backup — e viene mostrato invece che nascosto:
 * chi legge deve poterlo copiare in una segnalazione.
 *
 * `t` arriva come proprietà e non da `useLingua()`: questo è un componente a
 * classe, e deve restarlo — `getDerivedStateFromError` non ha equivalente con i
 * ganci. Un componente funzione attorno servirebbe solo a leggere il contesto,
 * e passare una funzione costa meno di un livello in più nell'albero.
 */
class ErrorBoundary extends Component<
  { children: ReactNode; t: (s: string) => string },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    const { t } = this.props;
    if (!this.state.error) return this.props.children;
    return (
      <div className="page">
        <div className="card">
          <h2>{t('Qualcosa si è rotto in questa pagina')}</h2>
          <p className="card-sub">
            {t(
              'Le altre schede funzionano. Se succede sempre qui, di solito è un dato d’archivio rovinato: da Impostazioni puoi ripristinare un backup.',
            )}
          </p>
          <pre
            style={{
              fontSize: 12,
              whiteSpace: 'pre-wrap',
              background: 'var(--surface-3)',
              padding: 10,
              borderRadius: 'var(--radius-sm)',
            }}
          >
            {this.state.error.message}
          </pre>
          <button className="btn" onClick={() => this.setState({ error: null })}>
            {t('Riprova')}
          </button>
        </div>
      </div>
    );
  }
}

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

/**
 * Il segno dell'hamburger, disegnato invece che scritto.
 *
 * Tre righe in un `svg` e non il carattere «☰»: quel carattere non esiste in
 * tutti i font di sistema, e dove manca la webview lo sostituisce con un glifo
 * di ripiego che cambia dimensione e allineamento da un dispositivo all'altro.
 * `currentColor` lo tiene legato al colore del testo, quindi segue il tema
 * chiaro e quello scuro senza una seconda regola.
 */
function SegnoMenu({ chiuso }: { chiuso: boolean }) {
  return (
    <svg width="18" height="14" viewBox="0 0 18 14" aria-hidden="true" focusable="false">
      {chiuso ? (
        <>
          <path d="M2 2 L16 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <path d="M16 2 L2 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </>
      ) : (
        <>
          <path d="M1 2 H17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <path d="M1 7 H17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <path d="M1 12 H17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}

export function App() {
  const { ready, dives, initError } = useDiveLog();
  const { t } = useLingua();
  const [view, setView] = useState<View>('logbook');
  const [openDive, setOpenDive] = useState<string | null>(null);

  // Al primo avvio con archivio vuoto, la vista utile è l'import.
  useEffect(() => {
    if (ready && dives.length === 0) setView('import');
  }, [ready, dives.length]);

  /*
   * SUL TELEFONO LA NAVIGAZIONE È UN MENU, NON UNA STRISCIA.
   *
   * La striscia orizzontale era l'unica cosa dell'applicazione che si
   * trascinasse di lato, e stava in cima a OGNI pagina: la sensazione che
   * restava era che l'app scorresse in orizzontale, non che ci fosse dell'altra
   * navigazione. Con otto schede e 390 px non c'è larghezza che basti, e la
   * sfumatura sul bordo destro dice che c'è dell'altro senza dire che cosa.
   *
   * Un menu a comparsa cambia il compromesso: costa un tocco in più, e in cambio
   * mostra TUTTE le destinazioni con il loro nome per intero, con bersagli
   * grandi abbastanza per un pollice. Sopra i 700 px la striscia resta com'era —
   * lì ci sta, ed è più veloce.
   */
  const [menuAperto, setMenuAperto] = useState(false);
  const bottoneMenu = useRef<HTMLButtonElement>(null);
  const pannelloMenu = useRef<HTMLDivElement>(null);

  /*
   * Chiudere col tasto Esc, e RIDARE IL FUOCO al pulsante.
   *
   * Senza la seconda metà, chi naviga da tastiera chiude il menu e si ritrova il
   * fuoco sul corpo del documento: il Tab successivo riparte dall'inizio della
   * pagina, cioè si perde il posto. È lo stesso motivo per cui si riporta il
   * fuoco dopo aver chiuso una finestra di dialogo.
   */
  useEffect(() => {
    if (!menuAperto) return;
    const suTasto = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenuAperto(false);
        bottoneMenu.current?.focus();
      }
    };
    window.addEventListener('keydown', suTasto);
    // Il pannello prende il fuoco all'apertura: da lì il Tab entra nelle voci
    // invece di ripartire dalla cima della pagina che sta sotto.
    pannelloMenu.current?.focus();

    /*
     * Se la finestra si allarga, il menu si chiude DA SÉ.
     *
     * Sopra i 700 px il pannello è nascosto dal CSS ma resterebbe aperto nello
     * stato: chi allarga la finestra del Mac e poi la restringe se lo
     * ritroverebbe spalancato senza averlo chiesto. Su iPhone non succede mai —
     * succede sul desktop, che è dove l'app si ridimensiona davvero.
     */
    const largo = window.matchMedia('(min-width: 701px)');
    const suCambio = () => {
      if (largo.matches) setMenuAperto(false);
    };
    largo.addEventListener('change', suCambio);
    return () => {
      window.removeEventListener('keydown', suTasto);
      largo.removeEventListener('change', suCambio);
    };
  }, [menuAperto]);

  const go = (v: View) => {
    setOpenDive(null);
    setView(v);
    setMenuAperto(false);
  };

  if (!ready) {
    return (
      <div className="app">
        <div className="empty">
          <Mark size={56} />
          <p className="muted" style={{ marginTop: 12 }}>
            {t('Apertura dell’archivio…')}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand" title={t(CLAIM)}>
          <Mark size={30} />
          <div>
            MyDiveLog
            <small>{imm(dives.length, t)}</small>
          </div>
        </div>
        {/*
         * La scheda corrente si porta SEMPRE in vista.
         *
         * La striscia scorre in orizzontale, e su uno schermo stretto la scheda
         * su cui si è può essere fuori dal riquadro visibile: si legge «Logbook
         * Confronta S» mentre a schermo c'è Statistiche. `scrollIntoView` sul
         * pulsante marcato `aria-current` risolve sia il caso della navigazione
         * fatta a mano sia quello dell'apertura diretta di una pagina.
         */}
        <nav className="nav" aria-label={t('Sezioni')}>
          {TABS.map((scheda) => {
            const corrente = view === scheda.id && !openDive;
            return (
              <button
                key={scheda.id}
                ref={
                  corrente ? (el) => el?.scrollIntoView({ block: 'nearest', inline: 'nearest' }) : undefined
                }
                onClick={() => go(scheda.id)}
                aria-current={corrente ? 'page' : undefined}
              >
                {t(scheda.label)}
              </button>
            );
          })}
        </nav>
        <span className="topbar-spacer" />
        {/*
         * IL CAMBIO LINGUA STA NELLA BARRA, non dentro Impostazioni.
         *
         * Chi apre l'app e non capisce la lingua non sa che «Impostazioni» vuol
         * dire impostazioni: due sigle in un angolo si riconoscono senza saper
         * leggere niente di quello che c'è attorno.
         *
         * Sotto i 700 px questa copia è nascosta dal CSS e ne compare un'altra
         * dentro il menu: in alto non ci stava, e la barra portava il documento
         * a 412 px su uno schermo da 390. Sono due elementi e non uno spostato
         * perché il menu esiste solo quando è aperto.
         */}
        <CambiaLingua />
        {/*
         * Il pulsante dice DOVE SI È, non solo che esiste un menu.
         *
         * Un hamburger muto costringe ad aprirlo per sapere in che pagina si
         * sta: il nome accanto al segno è la stessa informazione che sul
         * desktop dà la scheda evidenziata, e costa i pixel che sul telefono
         * avanzano perché la striscia non c'è più.
         */}
        <button
          ref={bottoneMenu}
          className="hamburger"
          onClick={() => setMenuAperto((v) => !v)}
          aria-expanded={menuAperto}
          aria-controls="menu-principale"
          aria-haspopup="menu"
        >
          <SegnoMenu chiuso={menuAperto} />
          <span>{t(openDive ? 'Immersione' : (TABS.find((s) => s.id === view)?.label ?? 'Menu'))}</span>
        </button>
        {menuAperto && (
          <>
            {/*
             * Il fondo è un PULSANTE, non un `div` con un `onClick`.
             *
             * Toccare fuori per chiudere è il gesto che ci si aspetta, ma un
             * `div` cliccabile non esiste per chi naviga da tastiera e non
             * esiste per un lettore di schermo: il menu resterebbe aperto senza
             * via d'uscita se non con Esc. Un pulsante con la sua etichetta è la
             * stessa cosa per il dito e una via d'uscita vera per tutti gli
             * altri.
             */}
            <button
              className="menu-fondo"
              aria-label={t('Chiudi il menu')}
              onClick={() => setMenuAperto(false)}
            />
            <div className="menu-telefono" id="menu-principale" ref={pannelloMenu} tabIndex={-1}>
              <nav aria-label={t('Sezioni')}>
                {TABS.map((scheda) => {
                  const corrente = view === scheda.id && !openDive;
                  return (
                    <button
                      key={scheda.id}
                      onClick={() => go(scheda.id)}
                      aria-current={corrente ? 'page' : undefined}
                    >
                      {t(scheda.label)}
                    </button>
                  );
                })}
              </nav>
              <CambiaLingua />
            </div>
          </>
        )}
      </header>

      {/*
       * Un solo `Suspense` attorno a tutto il contenuto, dentro `.main`: la barra
       * in alto non deve mai smontarsi mentre una pagina arriva, altrimenti i
       * pulsanti di navigazione sparirebbero proprio nell'istante in cui l'utente
       * ha appena finito di premerne uno.
       */}
      <main className="main">
        {/*
         * L'avvio parziale si dichiara, e sta FUORI dall'ErrorBoundary.
         *
         * Se una parte dell'archivio non si è aperta, l'applicazione parte
         * comunque — è la scelta giusta, meglio metà che niente — ma senza
         * questa riga metà archivio e archivio vuoto sono indistinguibili, e la
         * reazione naturale a «non ci sono le mie immersioni» è reimportarle,
         * cioè scrivere sopra a un archivio che c'era già.
         */}
        {initError && (
          <div className="page" style={{ paddingBottom: 0 }}>
            <div className="notice notice-error" role="alert">
              {initError}
            </div>
          </div>
        )}
        <ErrorBoundary t={t}>
          <Suspense fallback={<PagePlaceholder />}>
            <ProvvedituraNavigazione vaiA={go}>
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
            </ProvvedituraNavigazione>
          </Suspense>
        </ErrorBoundary>
      </main>
    </div>
  );
}
