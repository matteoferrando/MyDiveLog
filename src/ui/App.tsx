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

import {
  Component,
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { imm } from './format';
import { Logbook } from './pages/Logbook';
import { CLAIM, Mark } from './components/Mark';
import { useDiveLog } from './state';
import { CambiaLingua, useLingua } from './lingua';
import { BARRA, GRUPPI_ALTRO, ProvvedituraNavigazione, TABS, type Vista } from './navigazione';
import { contenitoreCheScorre } from './memoriaDellElenco';

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
const ProfiloPage = lazy(() => import('./pages/ProfiloPage').then((m) => ({ default: m.ProfiloPage })));
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
 * I segni della barra in basso, disegnati invece che scritti.
 *
 * ► PERCHÉ NON EMOJI E NON CARATTERI SPECIALI. ◄ Un «☰» o un «⚙» non esiste in
 * tutti i font di sistema, e dove manca la webview lo sostituisce con un glifo
 * di ripiego che cambia dimensione e allineamento da un dispositivo all'altro —
 * cioè proprio in una barra dove cinque bersagli devono stare allineati al
 * pixel. Le emoji fanno di peggio: portano un colore loro, che a schermo scuro
 * stona e che nessuna regola di tema può correggere.
 *
 * `currentColor` lega il tratto al colore del testo: la voce attiva si accende
 * cambiando UNA proprietà, e il tema chiaro e quello scuro non hanno bisogno di
 * una seconda regola.
 *
 * ► I DISEGNI SONO DELIBERATAMENTE BANALI. ◄ Un elenco puntato, tre barre, una
 * freccia in un cassetto, una bombola, tre punti. Un'icona in una barra di
 * navigazione non deve essere bella: deve essere riconosciuta di sfuggita, con
 * il telefono in una mano e l'attrezzatura nell'altra. L'unica che si concede
 * un disegno vero è la bombola, perché è l'unica cosa qui dentro che una
 * convenzione universale non ce l'ha — e perché chi apre quest'app la riconosce
 * prima di leggere la parola sotto.
 */
const SEGNI: Record<string, ReactNode> = {
  // Un elenco puntato: righe e punti. Con `strokeLinecap: round` un tratto
  // lungo zero (`h.01`) si disegna come un cerchietto pieno — è il modo
  // standard di fare un punto senza aggiungere un secondo elemento.
  logbook: (
    <>
      <path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01" />
      <path d="M9 6h10.5M9 12h10.5M9 18h10.5" />
    </>
  ),
  stats: <path d="M5 20v-6.5M12 20V4.5M19 20v-9.5" />,
  // Una freccia che entra in un cassetto: «arriva roba da fuori». La stessa
  // figura, girata, vorrebbe dire esportare — ed è per questo che la punta va
  // in basso e il cassetto sta sotto, non sopra.
  import: (
    <>
      <path d="M12 3.5v9.5" />
      <path d="m8.25 9.25 3.75 3.75 3.75-3.75" />
      <path d="M4.5 15.5V18a2.5 2.5 0 0 0 2.5 2.5h10a2.5 2.5 0 0 0 2.5-2.5v-2.5" />
    </>
  ),
  // Una bombola: rubinetteria, collo, corpo arrotondato in basso.
  planner: (
    <>
      <path d="M10 3.5h4" />
      <path d="M11 3.5V7M13 3.5V7" />
      <path d="M9.5 9a2 2 0 0 1 2-2h1a2 2 0 0 1 2 2v8.5a2.5 2.5 0 0 1-2.5 2.5h-.01a2.5 2.5 0 0 1-2.49-2.5z" />
    </>
  ),
  /* I puntini hanno il LORO spessore, e non quello comune. Un tratto lungo
     zero con la punta tonda diventa un cerchio del diametro dello spessore:
     a 1.9 px erano tre granelli accanto a segni larghi 15, e la quinta voce
     sembrava scolorita. A 2.8 px pesano come gli altri. */
  altro: <path d="M5.5 12h.01M12 12h.01M18.5 12h.01" strokeWidth="2.8" />,
};

function Segno({ quale }: { quale: string }) {
  return (
    <svg
      width="23"
      height="23"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {SEGNI[quale]}
    </svg>
  );
}

export function App() {
  const { ready, dives, initError } = useDiveLog();
  const { t } = useLingua();
  const [view, setView] = useState<View>('logbook');
  const [openDive, setOpenDive] = useState<string | null>(null);

  /*
   * ► UNA SCHEDA SI APRE SEMPRE DALL'INIZIO. ◄
   *
   * L'altra metà della richiesta del 12 settembre 2026: *tornando* all'elenco
   * si riprende da dove si era — ci pensa `Logbook` leggendo
   * `memoriaDellElenco` — ma *aprendo* una scheda si riparte dalla cima. Sono
   * due desideri opposti sullo stesso contenitore, ed è per questo che vanno
   * scritti tutti e due: `.main` non si azzera da sé cambiando contenuto, e chi
   * apriva la riga centoquaranta si ritrovava a metà della scheda nuova, su un
   * punto che non vuol dire niente.
   *
   * Sta qui e non in `DiveDetail` perché il nodo che scorre è di questa pagina.
   * `useLayoutEffect` perché avviene prima che il browser disegni: fatto dopo,
   * si vedrebbe la scheda comparire storta e raddrizzarsi.
   */
  useLayoutEffect(() => {
    if (!openDive) return;
    const nodo = contenitoreCheScorre();
    if (nodo) nodo.scrollTop = 0;
  }, [openDive]);

  // Al primo avvio con archivio vuoto, la vista utile è l'import.
  useEffect(() => {
    // Non è uno stato derivato: è una NAVIGAZIONE, e dipende da `ready`, cioè da quando il
    // database ha finito di aprirsi. Derivarla durante il render vorrebbe dire scegliere la
    // scheda prima di sapere se l'archivio è vuoto o solo non ancora letto, e mandare
    // all'import chi ha quattrocento immersioni.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (ready && dives.length === 0) setView('import');
  }, [ready, dives.length]);

  /*
   * LO STATO DEL FOGLIO «ALTRO», e perché è rimasto quello del vecchio menu.
   *
   * Il pannello a comparsa non c'è più — al suo posto c'è la barra in basso più
   * un foglio con le destinazioni che nella barra non stanno — ma le tre cose
   * che gli stavano attorno servono identiche: uno stato aperto/chiuso, il
   * riferimento al pulsante che lo apre (per RIDARGLI il fuoco alla chiusura) e
   * quello al pannello (per PRENDERE il fuoco all'apertura). Riscriverle
   * sarebbe stato riscrivere gli stessi tre effetti con nomi nuovi, e rifare da
   * capo gli errori che quei tre effetti hanno già imparato a evitare.
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
            // Stessa regola della barra in basso, e per lo stesso motivo: la
            // scheda da cui si è aperta un'immersione è ancora quella, e
            // premerla riporta all'elenco. Vedi il commento là sotto.
            const corrente = view === scheda.id;
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
         * IL CAMBIO LINGUA STA NELLA BARRA, ma solo dove nella barra c'è posto.
         *
         * Chi apre l'app e non capisce la lingua non sa che «Impostazioni» vuol
         * dire impostazioni: due sigle in un angolo si riconoscono senza saper
         * leggere niente di quello che c'è attorno, e sul desktop non costano
         * niente a nessuno.
         *
         * Sotto i 700 px questa copia è nascosta dal CSS e NON ne compare più
         * un'altra nel menu: dal 15 settembre 2026 la lingua è una riga di
         * Impostazioni come le altre (vedi `RigaLingua` in `lingua.tsx`). Nel
         * menu a comparsa era l'elemento più forte dello schermo — due caselle,
         * una piena del colore d'accento, sotto nove voci tutte uguali — cioè il
         * comando più raro dell'applicazione disegnato come il più importante.
         */}
        <CambiaLingua />
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
        {/*
         * ► LA `key` È QUELLO CHE RENDE VERA LA FRASE «Le altre schede
         *   funzionano». ◄
         *
         * Un confine d'errore, una volta scattato, NON si azzera da solo:
         * `state.error` resta finché il componente non viene rimontato. Senza
         * questa `key` React vedeva sempre lo stesso elemento al cambio di
         * scheda e lo conservava — la schermata rotta restava lì mentre il suo
         * testo prometteva che altrove si può lavorare. Chi ci provava scopriva
         * che non era vero, e da quel momento non si fida più di nessun altro
         * messaggio dell'applicazione.
         *
         * Cambiando `key` React smonta e rimonta: lo stato dell'errore muore
         * con il componente vecchio, che è l'unico modo che un confine d'errore
         * ha di dimenticare. Il pulsante «Riprova» resta perché serve a un'altra
         * cosa — riprovare la STESSA pagina, senza andarsene.
         *
         * L'immersione aperta entra nella chiave insieme alla scheda, e non è
         * un di più: `go('logbook')` con una scheda d'immersione rotta sopra al
         * logbook azzera `openDive` ma lascia `view` su `logbook`. Una chiave
         * fatta della sola vista non cambierebbe, e da un dettaglio che si è
         * rotto — dove il pulsante «indietro» sta dentro la parte che non c'è
         * più — non si uscirebbe in nessun modo.
         */}
        <ErrorBoundary key={openDive ? `immersione:${openDive}` : `scheda:${view}`} t={t}>
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
              ) : view === 'profilo' ? (
                <ProfiloPage />
              ) : view === 'sync' ? (
                <SyncPage />
              ) : (
                <ImportPage onDone={() => go('logbook')} />
              )}
            </ProvvedituraNavigazione>
          </Suspense>
        </ErrorBoundary>
      </main>

      {/*
       * ► LA BARRA STA NEL FLUSSO, NON IN `position: fixed`. ◄
       *
       * È un figlio della colonna flessibile `.app`, come la barra in alto e
       * come `.main`: si prende la sua altezza, e quella che resta è l'altezza
       * del contenuto. Con `fixed` avrebbe galleggiato SOPRA la pagina, e
       * l'ultima carta di ogni scheda sarebbe finita sotto — il rimedio classico
       * è un `padding-bottom` sul contenuto pari all'altezza della barra, cioè
       * una costante da tenere allineata a mano con un'altezza che cambia con il
       * ritaglio dello schermo e con la dimensione del testo di sistema. Quella
       * costante sarebbe sbagliata il giorno dopo su un telefono diverso.
       *
       * Sopra i 700 px il CSS la spegne: là c'è la striscia in alto, e due
       * navigazioni sono una di troppo.
       */}
      <nav className="barra-basso" aria-label={t('Sezioni')}>
        {BARRA.map((scheda) => (
          <button
            key={scheda.id}
            className={scheda.id === 'import' ? 'voce voce-importa' : 'voce'}
            onClick={() => go(scheda.id)}
            /*
             * ► LA SCHEDA ACCESA È `view`, ANCHE CON UN'IMMERSIONE APERTA. ◄
             *
             * La striscia in alto ci metteva `&& !openDive`, e sul telefono
             * quella regola lasciava la barra tutta spenta per l'intera durata
             * della scheda di un'immersione — cinque bersagli grigi, che si
             * leggono come un guasto. Ed era anche falsa: `openDive` non azzera
             * `view`, la scheda da cui si è entrati è ancora quella, e premerla
             * riporta esattamente all'elenco da cui si è partiti. La barra dice
             * la verità sullo stato, e la stessa regola vale ora anche in alto.
             */
            aria-current={view === scheda.id ? 'page' : undefined}
          >
            <span className="voce-segno">
              <Segno quale={scheda.id} />
            </span>
            <span className="voce-nome">{t(scheda.label)}</span>
          </button>
        ))}
        {/*
         * «Altro» è marcato `aria-current="true"` e non `"page"` quando la
         * pagina aperta sta nel foglio: non È la pagina corrente, è il ramo che
         * la contiene. La distinzione la fa la specifica (`page` per la pagina,
         * `true` per il generico «elemento corrente dell'insieme»), e a un
         * lettore di schermo cambia la frase che pronuncia.
         */}
        <button
          ref={bottoneMenu}
          className="voce voce-altro"
          onClick={() => setMenuAperto((v) => !v)}
          aria-expanded={menuAperto}
          aria-controls="menu-altro"
          aria-haspopup="menu"
          aria-current={BARRA.some((b) => b.id === view) ? undefined : 'true'}
        >
          <span className="voce-segno">
            <Segno quale="altro" />
          </span>
          <span className="voce-nome">{t('Altro')}</span>
        </button>
      </nav>

      {menuAperto && (
        <>
          {/*
           * Il fondo è un PULSANTE, non un `div` con un `onClick`.
           *
           * Toccare fuori per chiudere è il gesto che ci si aspetta, ma un `div`
           * cliccabile non esiste per chi naviga da tastiera e non esiste per un
           * lettore di schermo: il foglio resterebbe aperto senza via d'uscita
           * se non con Esc. Un pulsante con la sua etichetta è la stessa cosa
           * per il dito e una via d'uscita vera per tutti gli altri.
           */}
          <button
            className="foglio-fondo"
            aria-label={t('Chiudi il menu')}
            onClick={() => setMenuAperto(false)}
          />
          <div className="foglio-altro" id="menu-altro" ref={pannelloMenu} tabIndex={-1}>
            {/* La maniglia non fa niente — non c'è nessun trascinamento da
                intercettare — e serve lo stesso: è il segno convenzionale che
                dice «questo è un foglio che si chiude», e senza, il pannello si
                legge come una parte della pagina. */}
            <span className="foglio-maniglia" aria-hidden="true" />
            {GRUPPI_ALTRO.map((gruppo) => (
              <section key={gruppo.titolo} className="foglio-gruppo">
                <h2>{t(gruppo.titolo)}</h2>
                <nav aria-label={t(gruppo.titolo)}>
                  {gruppo.voci.map((id) => {
                    const scheda = TABS.find((s) => s.id === id);
                    if (!scheda) return null;
                    return (
                      <button key={id} onClick={() => go(id)} aria-current={view === id ? 'page' : undefined}>
                        {t(scheda.label)}
                      </button>
                    );
                  })}
                </nav>
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
