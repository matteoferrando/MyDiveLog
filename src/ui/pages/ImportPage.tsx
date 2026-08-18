import { useRef, useState } from 'react';
import { ACCEPTED_EXTENSIONS, PARSERS } from '../../core/parsers';
import { imm, plural } from '../format';
import { useDiveLog, type ImportOutcome } from '../state';

export function ImportPage({ onDone }: { onDone: () => void }) {
  const { importFiles, dives, storeLocation, clearAll } = useDiveLog();
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
    setAnnuncio(`Lettura di ${scelti.length} file avviata.`);
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
          : `Import finito: ${letti.length} file su ${result.length} letti, ` +
              `${imm(somma('found'))} trovate, ${somma('added')} nuove, ` +
              `${somma('merged')} arricchite, ${somma('duplicates')} già presenti` +
              (avvisi > 0 ? `, ${plural(avvisi, 'avviso', 'avvisi')} nella tabella dell'esito` : '') +
              '.',
      );
      if (falliti.length > 0) {
        setAllarme(
          `${falliti.length} file su ${result.length} non letti: ` +
            falliti.map((o) => `${o.fileName} (${o.error ?? 'motivo non riportato'})`).join('; ') +
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
      setAllarme(`Import fallito: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const azzera = async () => {
    const quante = dives.length;
    if (!confirm(`Cancellare tutte le ${quante} immersioni dall'archivio?`)) return;
    setAzzerando(true);
    setAllarme('');
    setAnnuncio(`Cancellazione di ${imm(quante)} in corso…`);
    try {
      await clearAll();
      // L'esito visivo di un archivio azzerato è la sparizione di mezza pagina:
      // niente che una voce possa raccontare da sola, quindi lo si dice.
      setAnnuncio(
        `Archivio azzerato: ${imm(quante)} cancellate. I file di origine sono ancora sul disco, quindi si può reimportare.`,
      );
    } catch (err) {
      setAnnuncio('');
      setAllarme(
        `Cancellazione fallita: ${err instanceof Error ? err.message : String(err)}. L'archivio non è stato svuotato.`,
      );
    } finally {
      setAzzerando(false);
    }
  };

  const totalAdded = outcomes?.reduce((a, o) => a + o.added, 0) ?? 0;

  return (
    <div className="page">
      <div className="page-title-row">
        <h1 className="page-title">Importa immersioni</h1>
        <span className="muted" style={{ fontSize: 12 }}>
          {imm(dives.length)} in archivio · {storeLocation}
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
        <p style={{ margin: '0 0 12px', fontWeight: 600 }}>
          Trascina qui i file, o scegli dal disco
        </p>
        <p className="muted" style={{ margin: '0 0 16px', fontSize: 12 }}>
          Puoi selezionarne più di uno: le immersioni presenti in due file diversi vengono unite, non
          duplicate.
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
          {busy ? 'Lettura in corso…' : 'Scegli file'}
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={ACCEPTED_EXTENSIONS.join(',')}
            style={{ display: 'none' }}
            onChange={(e) => void handle(e.target.files)}
            disabled={busy}
          />
        </label>
      </div>

      {outcomes && (
        <div className="card">
          <h2>Esito dell'import</h2>
          <p className="card-sub">
            {totalAdded > 0
              ? `${imm(totalAdded)} ${totalAdded === 1 ? 'nuova aggiunta' : 'nuove aggiunte'} all'archivio.`
              : 'Nessuna immersione nuova: tutto era già presente.'}
          </p>
          <table>
            <thead>
              <tr>
                <th>File</th>
                <th className="num">Trovate</th>
                <th className="num">Nuove</th>
                <th className="num">Arricchite</th>
                <th className="num">Già presenti</th>
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
          {totalAdded > 0 && (
            <div className="row" style={{ marginTop: 14 }}>
              <button className="btn btn-primary" onClick={onDone}>
                Vai al logbook
              </button>
            </div>
          )}
        </div>
      )}

      <div className="card">
        <h2>Formati supportati</h2>
        <p className="card-sub">
          Il formato viene riconosciuto dal contenuto del file, non dall'estensione: un `.xml` può
          essere UDDF, Subsurface o Shearwater e vengono distinti correttamente.
        </p>
        <table>
          <thead>
            <tr>
              <th>Formato</th>
              <th>Estensioni</th>
              <th>Come ottenerlo</th>
            </tr>
          </thead>
          <tbody>
            {PARSERS.map((p) => (
              <tr key={p.format}>
                <td style={{ fontWeight: 550 }}>{p.label}</td>
                <td className="muted tabular">{p.extensions.join(' ')}</td>
                <td className="secondary">{HOWTO[p.format] ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Cosa aspettarsi da ciascuna fonte</h2>
        <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--text-secondary)', fontSize: 13 }}>
          <li>
            <b>Shearwater</b> (XML o UDDF): profilo completo, temperatura, tetto deco, PPO2. Nell'export
            UDDF il collegamento fra bombole e miscele è incompleto — un limite noto del formato — quindi
            verifica il gas nella scheda.
          </li>
          <li>
            <b>Garmin FIT</b>: profilo completo e pressione dai trasmettitori. Il volume della bombola non
            esiste nel formato: viene dedotto da <code>tank_summary</code> quando possibile, altrimenti va
            inserito a mano una volta.
          </li>
          <li>
            <b>Export FIT dell'app Suunto</b>: leggibile ma povero — manca il gas del trasmettitore e la
            composizione della miscela. Vanno completati nella scheda.
          </li>
          <li>
            <b>Scubapro LogTRAK</b>: profilo, temperatura, volume e pressioni della bombola, zavorra,
            fuso orario e condizioni. Il formato Uwatec non contiene dati di decompressione — né tetto né
            NDL — quindi le soste obbligatorie vengono riconosciute dal profilo e non dal file. Le
            immersioni inserite a mano in LogTRAK non hanno profilo: entrano con i soli dati di sintesi.
          </li>
          <li>
            <b>CSV</b>: nessun profilo, solo riepilogo. Utile per recuperare uno storico da foglio di
            calcolo; le metriche di assetto e risalita non saranno disponibili per quelle immersioni.
          </li>
        </ul>
      </div>

      {dives.length > 0 && (
        <div className="card">
          <h2>Azzera l'archivio</h2>
          <p className="card-sub">
            Cancella tutte le {dives.length} immersioni e i profili. Non è reversibile: i file di origine
            restano dove sono, quindi si può reimportare.
          </p>
          <button
            className="btn btn-danger"
            onClick={() => void azzera()}
            disabled={azzerando}
            aria-busy={azzerando}
          >
            {azzerando ? 'Cancellazione in corso…' : 'Cancella tutto'}
          </button>
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
