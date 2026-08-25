/**
 * La pagina da cui le immersioni entrano in archivio.
 *
 * È la prima pagina che vede chi apre l'applicazione con l'archivio vuoto, e
 * quindi è quella dove i testi devono essere più corti: chi arriva qui vuole
 * caricare un file, non leggere come funziona il programma. Le spiegazioni
 * lunghe sui formati stanno in fondo, dopo il pulsante.
 */

import { useRef, useState } from 'react';
import { ACCEPTED_EXTENSIONS, PARSERS } from '../../core/parsers';
import { imm, plural } from '../format';
import { suIOS } from '../../piattaforma';
import { accettaFile } from '../accettaFile';
import { useDiveLog, type ImportOutcome } from '../state';
import { BleDownload } from '../components/BleDownload';
import { BottoneConferma } from '../components/Conferma';
import { useLingua } from '../lingua';

export function ImportPage({ onDone }: { onDone: () => void }) {
  const { importFiles, dives, storeLocation, clearAll } = useDiveLog();
  const { t } = useLingua();
  const [busy, setBusy] = useState(false);
  const [azzerando, setAzzerando] = useState(false);
  const [over, setOver] = useState(false);
  const [outcomes, setOutcomes] = useState<ImportOutcome[] | null>(null);
  /**
   * Quello che sta succedendo, per chi non guarda lo schermo.
   *
   * L'import è la sola operazione dell'applicazione che può durare dieci secondi
   * e cambiare l'archivio: fino a ieri chi usa uno screen reader premeva «Scegli
   * file» e da lì in poi non riceveva più niente — il testo del pulsante cambia,
   * ma il testo di un pulsante che non ha il fuoco non viene riletto, e la
   * tabella dell'esito compare in silenzio in fondo alla pagina.
   *
   * Sono due stringhe e non una perché finiscono in due regioni con urgenze
   * diverse (vedi il commento sulle regioni, più sotto), e sono stringhe di stato
   * e non testo dedotto dal render perché il momento «è partita» non ha nessun
   * corrispettivo nel DOM: esiste solo nel tempo.
   */
  const [annuncio, setAnnuncio] = useState('');
  const [allarme, setAllarme] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handle = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const scelti = [...files];
    setBusy(true);
    setOutcomes(null);
    setAllarme('');
    setAnnuncio(`${scelti.length} ${t('file in lettura')}.`);
    try {
      const result = await importFiles(scelti);
      setOutcomes(result);
      const letti = result.filter((o) => o.ok);
      const falliti = result.filter((o) => !o.ok);
      const somma = (campo: 'found' | 'added' | 'merged' | 'duplicates') =>
        result.reduce((a, o) => a + o[campo], 0);
      const avvisi = result.reduce((a, o) => a + o.warnings.length, 0);
      /*
       * I numeri, non «import riuscito».
       *
       * Chi guarda la tabella dell'esito legge in un colpo d'occhio quante ne
       * sono entrate e quante erano già lì; è esattamente quello che va detto, e
       * sono numeri che questa funzione ha già in mano. «Operazione completata»
       * costringerebbe a cercare la tabella con il cursore virtuale per sapere
       * l'unica cosa che interessa.
       *
       * Quando NON è stato letto nemmeno un file il riepilogo sarebbe una fila di
       * zeri seguita comunque dall'allarme con i motivi: qui si tace e si lascia
       * parlare l'allarme, che è l'unica informazione utile.
       */
      setAnnuncio(
        letti.length === 0
          ? ''
          : `${t('Import finito')}: ${letti.length}/${result.length} ${t('file letti')}, ` +
              `${imm(somma('found'), t)} ${t('trovate')}, ${somma('added')} ${t('nuove')}, ` +
              `${somma('merged')} ${t('arricchite')}, ${somma('duplicates')} ${t('già presenti')}` +
              (avvisi > 0 ? `, ${plural(avvisi, 'avviso', 'avvisi', t)}` : '') +
              '.',
      );
      if (falliti.length > 0) {
        setAllarme(
          `${falliti.length}/${result.length} ${t('file non letti')}: ` +
            falliti.map((o) => `${o.fileName} (${o.error ?? t('motivo non riportato')})`).join('; ') +
            '.',
        );
      }
    } catch (err) {
      // Prima di questo `catch` un errore sollevato da `importFiles` — non quelli
      // del singolo file, che tornano dentro l'esito, ma quelli dell'archivio:
      // quota esaurita, database chiuso — usciva come promessa rifiutata e non
      // annunciata da `void handle(...)`: la pagina tornava semplicemente com'era
      // prima, senza esito e senza spiegazione, per chiunque.
      setAnnuncio('');
      setAllarme(`${t('Import fallito')}: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const azzera = async () => {
    const quante = dives.length;
    setAzzerando(true);
    setAllarme('');
    setAnnuncio(`${t('Cancellazione in corso…')} (${imm(quante, t)})`);
    try {
      await clearAll();
      // L'esito visivo di un archivio azzerato è la sparizione di mezza pagina:
      // niente che una voce possa raccontare da sola, quindi lo si dice.
      setAnnuncio(`${t('Archivio azzerato')}: ${imm(quante, t)}.`);
    } catch (err) {
      setAnnuncio('');
      setAllarme(
        `${t('Cancellazione fallita')}: ${err instanceof Error ? err.message : String(err)}. ${t('L’archivio non è stato svuotato.')}`,
      );
    } finally {
      setAzzerando(false);
    }
  };

  const totalAdded = outcomes?.reduce((a, o) => a + o.added, 0) ?? 0;

  return (
    <div className="page">
      <div className="page-title-row">
        <h1 className="page-title">{t('Importa immersioni')}</h1>
        <span className="muted" style={{ fontSize: 12 }}>
          {imm(dives.length, t)} · {t(storeLocation)}
        </span>
      </div>

      {/*
        Le due regioni che raccontano l'import a chi non vede lo schermo.

        POLITE PER L'ESITO, ASSERTIVO PER IL FALLIMENTO. Un esito arriva quando
        l'operazione è già finita e non c'è niente da salvare: interrompere la
        frase che lo screen reader sta leggendo — magari il nome di un file
        nell'elenco — per anticipare di due secondi «12 nuove aggiunte» è un
        fastidio senza guadagno. Un fallimento invece cambia quello che si sta per
        fare: chi crede di aver importato lo storico e non lo ha importato ne
        deve venire a conoscenza subito, prima di andarsene dalla pagina, e
        `role="alert"` è l'unico modo di dirlo scavalcando la coda.

        STANNO SEMPRE NEL DOM, ANCHE VUOTE. Una regione live creata insieme al
        testo che dovrebbe annunciare viene ignorata da diversi screen reader: la
        regione deve esistere prima, e cambiare contenuto dopo. Sono due `div`
        vuoti a pagina ferma — l'unico modo perché funzionino.

        SONO INVISIBILI. Il loro contenuto è la versione a parole di ciò che lo
        schermo mostra già come stato del pulsante e come tabella: mostrarlo due
        volte allungherebbe la pagina per tutti senza aggiungere niente per
        nessuno. `.solo-lettori` toglie dal disegno e lascia nell'albero di
        accessibilità.
      */}
      <div className="solo-lettori" role="status" aria-live="polite" aria-atomic="true">
        {annuncio}
      </div>
      <div className="solo-lettori" role="alert" aria-live="assertive" aria-atomic="true">
        {allarme}
      </div>

      <div
        className={`dropzone${over ? ' over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void handle(e.dataTransfer.files);
        }}
      >
        {/*
         * Su iPhone non si trascina niente, e «dal disco» non vuol dire niente.
         *
         * Il campo file sotto funziona benissimo su iOS — apre l'app File e la
         * libreria foto — ma la frase invitava a un gesto impossibile e
         * nominava un posto che sull'iPhone non esiste. Un invito che non si
         * può accettare fa sembrare rotta la funzione, non il testo.
         */}
        <p style={{ margin: '0 0 12px', fontWeight: 600 }}>
          {t(suIOS() ? 'Scegli i file dall’app File' : 'Trascina qui i file, o scegli dal disco')}
        </p>
        <p className="muted" style={{ margin: '0 0 16px', fontSize: 12 }}>
          {t('Puoi sceglierne più di uno: le immersioni doppie vengono unite.')}
        </p>
        {/*
          `aria-busy` sull'etichetta e non sull'input: l'input è `display:none` e
          per l'albero di accessibilità non esiste: il comando è questa etichetta,
          ed è su di essa che va detto «sto lavorando». Il testo cambia già, ma un
          testo che cambia dentro un elemento che non ha il fuoco non viene
          riletto da nessuno: `aria-busy` è ciò che risponde a chi torna a
          controllare il pulsante con il cursore virtuale.
        */}
        <label className="btn btn-primary" aria-busy={busy}>
          {t(busy ? 'Lettura in corso…' : 'Scegli file')}
          {/*
           * ► L'ATTRIBUTO CHE HA FATTO MORIRE L'APP IN REVISIONE. ◄
           *
           * Il valore lo decide `accettaFile`, e là c'è scritto tutto: su iOS
           * non si filtra per estensione (i formati subacquei un UTI non ce
           * l'hanno e i file diventano non selezionabili), ma non si può
           * nemmeno lasciare `accept` vuoto — senza, la WKWebView offre
           * «Scatta foto o video» e il sistema uccide il processo perché nel
           * plist non c'è `NSCameraUsageDescription`.
           */}
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={accettaFile(suIOS(), ACCEPTED_EXTENSIONS)}
            style={{ display: 'none' }}
            onChange={(e) => void handle(e.target.files)}
            disabled={busy}
          />
        </label>
      </div>

      {outcomes && (
        <div className="card">
          <h2>{t('Esito')}</h2>
          <p className="card-sub">
            {totalAdded > 0
              ? `${imm(totalAdded, t)} ${t(totalAdded === 1 ? 'aggiunta' : 'aggiunte')}.`
              : t('Nessuna immersione nuova: c’era già tutto.')}
          </p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{t('File')}</th>
                  <th className="num">{t('Trovate')}</th>
                  <th className="num">{t('Nuove')}</th>
                  <th className="num">{t('Arricchite')}</th>
                  <th className="num">{t('Già presenti')}</th>
                </tr>
              </thead>
              <tbody>
                {outcomes.map((o) => (
                  <tr key={o.fileName}>
                    <td>
                      <div style={{ fontWeight: 550 }}>{o.fileName}</div>
                      {o.error && <div style={{ color: 'var(--critical)', fontSize: 12 }}>{o.error}</div>}
                      {o.warnings.map((w) => (
                        <div key={w} className="muted" style={{ fontSize: 12 }}>
                          {w}
                        </div>
                      ))}
                    </td>
                    <td className="num">{o.found}</td>
                    <td className="num">{o.added}</td>
                    <td className="num">{o.merged}</td>
                    <td className="num">{o.duplicates}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totalAdded > 0 && (
            <div className="row" style={{ marginTop: 14 }}>
              <button className="btn btn-primary" onClick={onDone}>
                {t('Vai al logbook')}
              </button>
            </div>
          )}
        </div>
      )}

      {/*
       * Lo scarico diretto sta DOPO l'import da file, non prima.
       *
       * L'ordine dice quale delle due strade funziona oggi: il file è quella che
       * porta in archivio sei anni di immersioni adesso, il Bluetooth è quella
       * che eviterà il giro dall'applicazione del costruttore quando ci sarà il
       * protocollo del computer giusto. Metterlo in cima lo farebbe provare per
       * primo a chi apre la pagina per importare, e fallire.
       */}
      <BleDownload />

      <div className="card">
        <h2>{t('Formati supportati')}</h2>
        <p className="card-sub">
          {t(
            'Il formato si riconosce dal contenuto, non dall’estensione: un .xml può essere UDDF, Subsurface o Shearwater.',
          )}
        </p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>{t('Formato')}</th>
                <th>{t('Estensioni')}</th>
                <th>{t('Come ottenerlo')}</th>
              </tr>
            </thead>
            <tbody>
              {PARSERS.map((p) => (
                <tr key={p.format}>
                  <td style={{ fontWeight: 550 }}>{p.label}</td>
                  <td className="muted tabular">{p.extensions.join(' ')}</td>
                  <td className="secondary">{t(HOWTO[p.format] ?? '')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/*
       * Cosa porta ogni formato: cinque righe, non cinque paragrafi.
       *
       * Prima qui c'era la storia di ogni limite — perché l'UDDF perde il
       * collegamento fra bombole e miscele, come si deduce il volume da
       * `tank_summary`. Sono cose vere e sono cose che servivano a chi scriveva
       * il parser, non a chi importa un file: chi legge questa scheda vuole
       * sapere se dopo l'import dovrà completare qualcosa a mano.
       */}
      <div className="card">
        <h2>{t('Cosa porta ogni formato')}</h2>
        <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--text-secondary)', fontSize: 13 }}>
          <li>
            <b>Shearwater</b>{' '}
            {t(
              '(XML o UDDF): profilo, temperatura, tetto deco, PPO2. Nell’UDDF il gas può mancare: verificalo nella scheda.',
            )}
          </li>
          <li>
            <b>Garmin FIT</b>
            {t(': profilo e pressioni. Il volume della bombola non c’è nel formato: si inserisce una volta.')}
          </li>
          <li>
            <b>{t('FIT dall’app Suunto')}</b>
            {t(': leggibile ma povero. Gas e miscela vanno completati nella scheda.')}
          </li>
          <li>
            <b>Scubapro LogTRAK</b>
            {t(
              ': profilo, temperatura, bombola, zavorra, fuso, condizioni. Niente dati di deco: le soste le ricaviamo dal profilo.',
            )}
          </li>
          <li>
            <b>CSV</b>
            {t(': solo riepilogo, nessun profilo. Utile per recuperare uno storico da un foglio di calcolo.')}
          </li>
        </ul>
      </div>

      {dives.length > 0 && (
        <div className="card">
          <h2>{t('Azzera l’archivio')}</h2>
          <p className="card-sub">
            {t(
              'Cancella tutte le immersioni e i profili. Non si torna indietro, ma i file di origine restano e si può reimportare.',
            )}
          </p>
          {azzerando ? (
            <button className="btn btn-danger" disabled aria-busy>
              {t('Cancellazione in corso…')}
            </button>
          ) : (
            <BottoneConferma
              className="btn btn-danger"
              etichetta={t('Cancella tutto')}
              conferma={`${t('Sì, cancella')} (${dives.length})`}
              domanda={t('Non passano dal cestino e non si recuperano. Si possono solo reimportare.')}
              onConferma={() => void azzera()}
            />
          )}
        </div>
      )}
    </div>
  );
}

const HOWTO: Record<string, string> = {
  uddf: 'Shearwater Cloud Desktop → Export → UDDF',
  subsurface: 'Subsurface → File → Salva con nome (.ssrf)',
  'shearwater-xml': 'Shearwater Cloud Desktop → Export → XML',
  'shearwater-cloud': 'Il database di Shearwater Cloud Desktop, o il suo backup .db',
  'garmin-fit': 'Garmin Connect → attività → esporta FIT, oppure dalla cartella ACTIVITY del dispositivo',
  logtrak: 'App o desktop Scubapro LogTRAK → Esporta → file .logtrak',
  csv: 'Qualsiasi foglio di calcolo con una riga per immersione e le intestazioni in prima riga',
};
