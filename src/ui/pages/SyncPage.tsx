/**
 * Configurazione e uso del database condiviso (Turso / libSQL).
 *
 * Due cose, separate di proposito: l'accesso si fa una volta, la
 * sincronizzazione si lancia quando si vuole. Non c'è nessuna sincronizzazione
 * automatica all'avvio, e non è una mancanza: un logbook si apre anche in barca,
 * dove la rete non c'è, e un'app che all'apertura aspetta la rete è un'app che in
 * barca non si apre.
 *
 * L'ORDINE DELLA PAGINA È UNA DICHIARAZIONE. Prima l'accesso, poi il pulsante
 * per sincronizzare, e solo dopo — chiuso dentro «Avanzate» — il campo dove si
 * incollano indirizzo e token. Finché i due riquadri stavano affiancati
 * sembrava ci fosse una scelta da compiere; la scelta giusta invece è una sola,
 * e l'altra strada resta aperta per il giorno che la prima non funziona.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { conNumeri } from '../../core/numerazione';
import { localeCorrente } from '../../core/locale';
import { esporta } from '../esporta';
import { suIOS } from '../../piattaforma';
import { useDiveLog } from '../state';
import { useLingua } from '../lingua';
import {
  aggiornamentiQui,
  cercaAggiornamento,
  descriviScaricamento,
  installaAggiornamento,
  type StatoAggiornamento,
} from '../../aggiornamento/aggiornamento';
import { TRASH_DAYS, TRASH_SOFT_LIMIT, daysLeft, sortTrash } from '../../storage/trash';
import { formatDuration } from '../../core/units';
import { dateShort, imm, plural } from '../format';
import { campoModificato } from '../modificato';
import {
  backupFileName,
  checkBackup,
  planRestore,
  restoreBlockers,
  type BackupFile,
  type RestorePlan,
} from '../../core/export/backup';
import type { Fornitore } from '../../sync/account';
import { nomeImpostazione, traduciErroreSync, type StradaSync, type SyncReport } from '../../sync/turso';
import { frase } from '../../core/frase';
import { BottoneConferma } from '../components/Conferma';
import { Brevetti } from '../components/Brevetti';
import { CERT_LEVEL_LABEL, etichettaBrevetto, sortCertifications } from '../../core/analysis/gear';

/**
 * Quando questo dispositivo ha sincronizzato l'ultima volta.
 *
 * ► PERCHÉ SERVIVA. ◄ Non ne esisteva traccia da nessuna parte: il resoconto
 * compare dopo aver premuto il pulsante e sparisce al riavvio, quindi chi ha
 * fatto l'accesso una settimana fa e non ha mai sincronizzato vedeva esattamente
 * la stessa schermata di chi ha sincronizzato un'ora prima. È l'unica domanda
 * che si fa chi apre questa scheda senza un motivo preciso — «sono a posto?» — e
 * la pagina non aveva modo di rispondere.
 *
 * ► PERCHÉ NELL'ARCHIVIO DEL BROWSER E NON IN QUELLO DELLE IMMERSIONI. ◄ Perché
 * è un fatto di QUESTO dispositivo, come la lingua scelta (vedi `ui/lingua.tsx`,
 * che sta nello stesso posto per la stessa ragione). Conservarla insieme alle
 * immersioni la esporrebbe al giorno in cui qualcuno la aggiunge alle
 * impostazioni condivise, e da lì in poi il telefono direbbe «sincronizzato
 * un'ora fa» per una sincronizzazione fatta dal Mac: una data giusta accanto al
 * soggetto sbagliato è peggio di nessuna data.
 *
 * Il fallimento è previsto e silenzioso da entrambi i lati: un browser che nega
 * l'archivio locale non deve impedire una sincronizzazione, e una data che non
 * si è potuta rileggere si comporta come «non hai ancora sincronizzato», che è
 * la frase prudente delle due.
 *
 * ► LA DOMANDA È STATA RIAPERTA E CHIUSA: 28 agosto 2026. ◄ Era stata segnalata
 * come un ripiego — «il posto giusto sarebbe l'archivio delle immersioni» — e a
 * rileggere il ragionamento qui sopra la segnalazione era sbagliata: l'archivio
 * è proprio la cosa che viaggia fra i dispositivi, cioè il posto in cui questa
 * data diventerebbe falsa senza che nessuno rompa niente. **Decisione del
 * proprietario: resta dov'è.** Non è un rinvio, ed è già stata presa una volta.
 *
 * Quello che resta, e si accetta: questo cassettino è meno robusto
 * dell'archivio — iOS può svuotarlo quando lo spazio scarseggia, e si perde
 * cancellando i dati del sito. Allora l'app dirà «non hai ancora sincronizzato»
 * a chi invece l'ha fatto. È una frase falsa, ed è la più prudente delle due:
 * costa una riga sbagliata in una scheda informativa, e non perde niente.
 */
const CHIAVE_ULTIMA_SYNC = 'mydivelog.ultimaSincronizzazione';

type UltimaSync = { quando: string; quante: number };

function leggiUltimaSync(): UltimaSync | null {
  try {
    const grezzo = localStorage.getItem(CHIAVE_ULTIMA_SYNC);
    if (!grezzo) return null;
    const letto = JSON.parse(grezzo) as Partial<UltimaSync>;
    // Si controlla la FORMA, non solo la presenza: quella chiave la può aver
    // scritta una versione precedente, o una mano nella console del browser, e
    // una data invalida qui dentro diventa «Invalid Date» a schermo.
    if (typeof letto?.quando !== 'string' || Number.isNaN(Date.parse(letto.quando))) return null;
    return { quando: letto.quando, quante: typeof letto.quante === 'number' ? letto.quante : 0 };
  } catch {
    return null;
  }
}

function scriviUltimaSync(quante: number): UltimaSync {
  const appena: UltimaSync = { quando: new Date().toISOString(), quante };
  try {
    localStorage.setItem(CHIAVE_ULTIMA_SYNC, JSON.stringify(appena));
  } catch {
    // Non poterla scrivere non è un motivo per non mostrarla adesso: il valore
    // restituito vale comunque per questa sessione, si perde solo al riavvio.
  }
  return appena;
}

/** Data e ora nel formato di chi guarda, senza secondi: è una data, non un cronometro. */
const quandoEsteso = (iso: string) =>
  new Date(iso).toLocaleString(localeCorrente(), {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

export function SyncPage() {
  const {
    dives,
    accountAttivo,
    syncCredentials,
    saveSyncCredentials,
    testSync,
    syncNow,
    exportArchive,
    numeri,
  } = useDiveLog();
  const { t, lingua } = useLingua();
  const [exporting, setExporting] = useState(false);
  /**
   * L'esito dell'ultima esportazione.
   *
   * `quante` è la frase INTERA — participio compreso — e non un numero, per due
   * ragioni che si sommano. La prima: le quattro esportazioni non contano la
   * stessa cosa. L'UDDF e il CSV contano immersioni, il KML conta SITI, e con un
   * numero solo la mappa dei sette siti confermava «7 immersioni esportate» su
   * un archivio di cinquanta — un numero giusto accanto alla parola sbagliata.
   * La seconda: in italiano il participio concorda con il genere, «7 siti
   * esportate» è sbagliato, e il pezzo che sa quale nome sta usando è chi compone
   * la frase, non chi la mostra.
   */
  const [exported, setExported] = useState<{ quante: string; omitted: string[]; dove: string } | null>(null);
  const [url, setUrl] = useState(syncCredentials?.url ?? '');
  const [token, setToken] = useState(syncCredentials?.authToken ?? '');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [report, setReport] = useState<SyncReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ultima, setUltima] = useState<UltimaSync | null>(leggiUltimaSync);

  const configured = Boolean(syncCredentials);
  /*
   * Il token si confronta RIPULITO, come viene salvato — vedi `save()` qui
   * sotto, che scrive `token.trim()`. Prima il confronto era `token !== salvato`
   * con `salvato` già ripulito: normalizzato da un lato solo. Bastava lo spazio
   * che il copia-e-incolla si porta dietro — cioè il caso normale, non quello
   * limite — perché i due non coincidessero mai, `dirty` restasse vero per
   * sempre e «Sincronizza» non si riaccendesse più, senza che niente a schermo
   * dicesse perché. La regola generale, e perché sta in una funzione sola, in
   * `ui/modificato.ts`.
   */
  const dirty =
    campoModificato(url, syncCredentials?.url) || campoModificato(token, syncCredentials?.authToken);
  /*
   * Si può sincronizzare per due strade, e all'interfaccia interessa solo se ce
   * n'è una aperta. L'account ha la precedenza (lo decide `syncNow`), quindi chi
   * è entrato con Google può premere Sincronizza anche con il campo manuale
   * vuoto — che è esattamente il caso normale da quando l'accesso esiste.
   */
  const pronto = accountAttivo || configured;
  /*
   * PER QUALE DELLE DUE STRADE si sta sincronizzando, e serve a una cosa sola:
   * dare il rimedio giusto quando la chiave del database non viene accettata.
   *
   * Il messaggio nasce lontano da qui — `state.tsx` avvolge entrambe le strade
   * nella stessa riga — e da lì non c'è modo di sapere quale sia. Qui invece si
   * sa, ed è l'unico punto della catena in cui si sa: mandare a rigenerare un
   * token su Turso qualcuno che è entrato con Google significa mandarlo a fare
   * una cosa che non può fare. L'ordine è lo stesso di `syncNow`, che all'account
   * dà la precedenza.
   */
  const strada: StradaSync = accountAttivo ? 'account' : configured ? 'manuale' : 'ignota';

  const save = async () => {
    setTestResult(null);
    const trimmed = url.trim();
    if (!trimmed || !token.trim()) {
      await saveSyncCredentials(null);
      return;
    }
    await saveSyncCredentials({ url: trimmed, authToken: token.trim() });
  };

  const test = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testSync({ url: url.trim(), authToken: token.trim() });
      setTestResult(result.ok ? { ok: true } : { ok: false, error: result.error });
    } finally {
      setTesting(false);
    }
  };

  /**
   * Il giro di ogni esportazione, scritto una volta.
   *
   * Le quattro esportazioni facevano la stessa danza — accendi «preparo»,
   * azzera l'esito, prova, scrivi l'errore, spegni — e la copiavano ognuna per
   * sé. Non è solo ripetizione: il `void` più il `catch` sono lì per un motivo
   * preciso, e in una copia dimenticata un export fallito diventa una promessa
   * scartata, cioè un pulsante che sembra non fare niente.
   */
  const scarica = (lavoro: () => Promise<{ quante: string; omitted: string[]; dove: string }>) => {
    void (async () => {
      setExporting(true);
      setExported(null);
      setError(null);
      try {
        setExported(await lavoro());
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setExporting(false);
      }
    })();
  };

  const run = async () => {
    setBusy(true);
    setLog([]);
    setReport(null);
    setError(null);
    try {
      const result = await syncNow((m) => setLog((prev) => [...prev, m]));
      setReport(result);
      // Si segna solo dopo che è ANDATA BENE: un tentativo fallito non è una
      // sincronizzazione, e datarlo direbbe «sei a posto» a chi non lo è.
      setUltima(scriviUltimaSync(result.total));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <div className="page-title-row">
        <h1 className="page-title">{t('Impostazioni')}</h1>
        {/*
         * QUI SI DICE QUANTE, NON DOVE.
         *
         * Accanto al conteggio c'era anche il nome del motore d'archiviazione —
         * «File SQLite nella cartella dati dell'app» — cioè la frase più tecnica
         * dell'intera pagina messa nel punto in cui l'occhio arriva per primo.
         * Non è sbagliata e non è stata tolta: è scesa dove serve, in fondo alla
         * carta del backup, dove la domanda «e questo dov'è?» viene davvero. In
         * un'intestazione era solo rumore fra chi guarda e la sua prima riga.
         */}
        <span className="muted" style={{ fontSize: 12 }}>
          {imm(dives.length, t)} {t('in archivio')}
        </span>
      </div>

      <AccountCard />

      <AggiornamentoCard />

      <LibrettoCard />

      {/*
       * I brevetti stanno QUI, sotto, e non in Attrezzatura dov'erano nati: il
       * campo «Brevetto» della carta sopra sceglie da questo elenco, e mettere
       * la tendina in una scheda e la sua sorgente in un'altra significava
       * chiedere a chi compila di andare avanti e indietro fra due pagine per
       * capire perché la tendina è vuota.
       */}
      <Brevetti />

      <div className="card">
        <h2>{t('Sincronizza ora')}</h2>
        {/*
         * COSA FA DAVVERO IL GIRO, detto qui e non a schermo: prima scarica e
         * poi carica, e non cancella mai niente. Le due copie si completano a
         * vicenda campo per campo — vince il riepilogo più recente e il profilo
         * più ricco, anche quando arrivano da dispositivi diversi. A chi preme
         * il pulsante serve sapere che non perde niente; il come è affare di
         * `syncNow`.
         */}
        {/* La riga descrive il giro che fa il pulsante: senza il pulsante è la
         * didascalia di una cosa che non c'è, e l'elenco qui sotto la ridice
         * meglio e per esteso. */}
        {pronto && <p className="card-sub">{t('Prima scarica, poi carica. Niente viene cancellato.')}</p>}

        {/*
         * ► SENZA ACCESSO NON C'È NESSUN PULSANTE, E NON È UN PASSO SALTATO. ◄
         *
         * Qui c'era il pulsante spento più la riga «Accedi qui sopra e il
         * pulsante si accende». Nelle impostazioni di chi non ha fatto l'accesso
         * — cioè di tutti, il primo giorno — quella coppia è una carta morta che
         * si legge come una cosa da completare, e contraddice il «Non è
         * obbligatorio» scritto due carte più su. Un comando disattivato promette
         * che prima o poi lo si dovrà usare.
         *
         * La scelta di fondo dell'applicazione è che il logbook funzioni senza
         * account e che la sincronizzazione sia facoltativa: dove non c'è niente
         * da premere si dice quello, e si dice che va bene così.
         */}
        {pronto ? (
          <>
            <div className="row">
              <button
                className="btn btn-primary"
                onClick={() => void run()}
                disabled={busy || (!accountAttivo && dirty)}
              >
                {busy ? t('Sincronizzazione in corso…') : t('Sincronizza')}
              </button>
              {/*
               * L'avviso sulle credenziali non salvate riguarda SOLO chi sincronizza
               * col campo manuale. A chi è entrato con l'account non si parla di
               * credenziali da salvare: non ne ha, e sarebbe un avviso su una cosa
               * che non lo tocca.
               */}
              {!accountAttivo && configured && dirty && (
                <span className="muted" style={{ fontSize: 12 }}>
                  {t('Salva le credenziali prima di sincronizzare.')}
                </span>
              )}
            </div>

            {/*
             * L'ULTIMA VOLTA, e quante ce n'erano quando ha finito.
             *
             * «Mai» è un'informazione quanto una data, ed è quella che mancava:
             * chi ha fatto l'accesso e non ha mai premuto il pulsante vedeva la
             * stessa identica carta di chi aveva appena sincronizzato.
             */}
            <p className="muted" style={{ fontSize: 12, margin: '10px 0 0' }}>
              {ultima
                ? frase(
                    t,
                    'Ultima sincronizzazione: {0}, con {1} in archivio.',
                    quandoEsteso(ultima.quando),
                    imm(ultima.quante, t),
                  )
                : t('Da questo dispositivo non hai ancora sincronizzato.')}
            </p>
          </>
        ) : (
          <p style={{ fontSize: 13, margin: 0, color: 'var(--text-secondary)' }}>
            <b>{t('Non c’è niente da fare qui, e va bene così.')}</b>{' '}
            {t(
              'Le tue immersioni sono già salvate su questo dispositivo. La sincronizzazione serve solo se vuoi ritrovarle anche su un altro: in quel caso fai l’accesso qui sopra.',
            )}
          </p>
        )}

        {log.length > 0 && (
          <ul style={{ margin: '14px 0 0', paddingLeft: 18, fontSize: 12, color: 'var(--text-secondary)' }}>
            {log.map((line, i) => (
              <li key={`${i}-${line}`}>{line}</li>
            ))}
          </ul>
        )}

        {/*
         * L'errore si RISCRIVE qui, e non si mostra come arriva.
         *
         * Arriva composto da `state.tsx`, che avvolge tutte e due le strade e
         * quindi può solo dare un consiglio buono per entrambe; e arriva in
         * italiano, perché lì un traduttore non c'è. Questo è l'unico punto che
         * sa che cosa ha davanti, e `traduciErroreSync` fa le due cose insieme:
         * traduce, e sostituisce il rimedio con quello eseguibile da chi guarda.
         * Un messaggio che non riconosce lo lascia passare intatto.
         */}
        {error && (
          <p role="alert" style={{ marginTop: 12, fontSize: 13, color: 'var(--critical)' }}>
            {traduciErroreSync(error, t, strada)}
          </p>
        )}

        {report && (
          <table style={{ marginTop: 14 }}>
            <tbody>
              {/*
               * Le etichette restano in italiano qui e si traducono dentro
               * `Row`: sono frasi fisse, tradurle nel punto di disegno tiene le
               * chiamate leggibili — si vede cosa c'è scritto in tabella senza
               * saltare da nessuna parte — e concentra la traduzione in un
               * punto solo. Il `value` no: è un numero, o un numero più una
               * parola, e va composto qui.
               */}
              <Row label="Caricate" value={report.pushed} />
              <Row label="Scaricate" value={report.pulled} />
              <Row label="Profili caricati" value={report.pushedProfiles} />
              <Row label="Profili scaricati" value={report.pulledProfiles} />
              <Row label="Già allineate" value={report.plan.unchanged} />
              <Row
                label="Impostazioni condivise"
                value={`${report.settingsPushed} ${t('caricate')}, ${report.settingsPulled} ${t('scaricate')}`}
              />
              <Row label="Immersioni in archivio" value={report.total} />
              <Row label="Durata" value={`${(report.durationMs / 1000).toFixed(1)} s`} />
            </tbody>
          </table>
        )}
        {/*
         * QUALI, non solo quante.
         *
         * «Impostazioni condivise: 3 caricate, 0 scaricate» dice che qualcosa è
         * successo e non dice a che cosa — e le nove chiavi che viaggiano non si
         * assomigliano per niente: l'attrezzatura, i brevetti, il periodo delle
         * statistiche, fin dove si era arrivati con ogni computer. Chi legge quel
         * numero si sta chiedendo se è arrivato il pezzo che gli interessa.
         *
         * Sta SOTTO la tabella e non dentro: sono nomi lunghi, e una cella che si
         * allarga rompe l'allineamento di tutte le altre righe.
         */}
        {report && (report.settingsPushedKeys.length > 0 || report.settingsPulledKeys.length > 0) && (
          <p className="muted" style={{ fontSize: 12, margin: '8px 0 0' }}>
            {report.settingsPushedKeys.length > 0 && (
              <>
                {t('Caricate')}: {report.settingsPushedKeys.map((k) => nomeImpostazione(k, t)).join(', ')}
                .{' '}
              </>
            )}
            {report.settingsPulledKeys.length > 0 && (
              <>
                {t('Scaricate')}: {report.settingsPulledKeys.map((k) => nomeImpostazione(k, t)).join(', ')}.
              </>
            )}
          </p>
        )}
        {/*
         * Le impostazioni che non si sono allineate si DICHIARANO.
         *
         * Un'impostazione che non viaggia assomiglia in tutto e per tutto a
         * un'impostazione che non è mai cambiata: senza questa riga, la
         * differenza fra i due dispositivi si scopre settimane dopo, guardando
         * un numero che non torna.
         */}
        {report && report.settingsErrors.length > 0 && (
          <div className="notice notice-error" role="alert" style={{ marginTop: 12 }}>
            <b>{t('Queste impostazioni non si sono allineate.')}</b>{' '}
            {t(
              'Le immersioni sì. Riprova più tardi: finché non si allineano, i due dispositivi mostrano numeri diversi.',
            )}
            <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
              {report.settingsErrors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/*
       * ► QUESTA CARTA STA QUI PERCHÉ DESCRIVE IL PULSANTE QUI SOPRA. ◄
       *
       * Era in fondo alla pagina, tre schermate sotto, e si intitolava «Cosa fa
       * e cosa non fa»: un titolo senza soggetto, lontano dall'unica cosa di cui
       * parla. Chi si ferma prima di premere «Sincronizza» — cioè chi ha proprio
       * il dubbio a cui questo elenco risponde — non scorreva fin laggiù, e chi
       * ci arrivava scorrendo non aveva più in mente il pulsante.
       */}
      <div className="card">
        <h2>{t('Cosa succede quando premi Sincronizza')}</h2>
        {/*
         * QUESTO ELENCO ERA UN SAGGIO, ed è il posto giusto per tenerne le
         * ragioni. Quello che si è spostato qui dentro:
         *
         *  - il cestino non viaggia perché finché un'immersione è lì ripescarla
         *    dev'essere sempre possibile. Svuotandolo nasce la lapide — «questa
         *    è stata cancellata, e quando» — che è l'unica informazione capace
         *    di distinguere «non ce l'ho ancora» da «l'ho buttata via», e
         *    quella sì che si propaga;
         *  - non duplica perché l'identificativo dipende dal CONTENUTO
         *    dell'immersione, non da chi l'ha importata;
         *  - attrezzatura, brevetti, piani e analisi sono le uniche cose che
         *    nessun file di importazione porta con sé: cioè le uniche che
         *    altrimenti si ricompilano su ogni dispositivo. Le raccolte si
         *    fondono pezzo per pezzo, e a parità di pezzo vince la modifica più
         *    recente;
         *  - il segnalibro dello scarico Bluetooth si allinea IN FONDO al giro,
         *    dopo le immersioni: prima sarebbe una promessa che l'archivio non
         *    ha ancora mantenuto, e il collegamento dopo salterebbe immersioni
         *    mai arrivate;
         *  - le credenziali no: un token che viaggia dentro il proprio stesso
         *    database sarebbe un cerchio sciocco oltre che pericoloso. Quel punto
         *    è SCESO dentro «Avanzate»: parlava di «token del database» a chi
         *    quel pannello non l'ha mai aperto, cioè quasi tutti, e in un elenco
         *    di cose comprensibili era l'unica riga da manuale. Dove i token si
         *    incollano davvero, invece, è la frase più utile che ci sia.
         */}
        <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--text-secondary)', fontSize: 13 }}>
          <li>
            <b>{t('Le cancellazioni viaggiano, il cestino no.')}</b>{' '}
            {t('Finché un’immersione è nel cestino resta solo qui. Svuotandolo, sparisce ovunque.')}
          </li>
          <li>
            <b>{t('Non duplica.')}</b> {t('La stessa immersione importata su due dispositivi resta una.')}
          </li>
          <li>
            <b>{t('Viaggia anche quello che hai scritto a mano.')}</b>{' '}
            {t('Attrezzatura, brevetti, piani e analisi si fondono; a parità di voce vince la più recente.')}
          </li>
          <li>
            <b>{t('Viaggia anche fin dove sei arrivato con ogni computer.')}</b>{' '}
            {t(
              'Se hai già scaricato un computer da un dispositivo, gli altri prendono solo le immersioni nuove.',
            )}
          </li>
          <li>
            <b>{t('Riepilogo e profilo viaggiano separati.')}</b>{' '}
            {t('Dopo la sincronizzazione ogni dispositivo ha tutti e due.')}
          </li>
          <li>
            <b>{t('Sincronizzare due volte di fila non fa niente la seconda volta.')}</b>
          </li>
        </ul>
      </div>

      {/*
       * IL CAMPO MANUALE È FINITO QUI SOTTO, E NON È STATO TOLTO.
       *
       * Da quando c'è l'accesso, incollare indirizzo e token è la strada di
       * pochi: chi entra con Google un database ce l'ha già, creato dal
       * servizio. Tenere due riquadri di pari dignità faceva sembrare che ci
       * fosse una scelta da compiere, quando la scelta giusta è una sola.
       *
       * Ma toglierlo del tutto sarebbe stato un errore diverso e peggiore: il
       * giorno che il servizio di accesso è irraggiungibile e la sessione è
       * scaduta, senza questo campo non si sincronizza in nessun modo, e
       * l'unico rimedio sarebbe ricompilare l'applicazione. Una via di scampo
       * che costa una riga di codice e un clic non si butta via per ordine.
       */}
      <details className="card">
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
          {t('Avanzate: collegare un database a mano')}
        </summary>
        {/*
         * Non è detto a schermo, ma è il motivo per cui i campi si lasciano
         * vuoti dopo l'accesso: le credenziali dell'account hanno comunque la
         * precedenza (lo decide `syncNow`), quindi quello che si incolla qui
         * verrebbe semplicemente ignorato.
         */}
        <p className="card-sub" style={{ marginTop: 12 }}>
          {t('Solo se il database te lo sei creato tu su Turso.')}{' '}
          <b>{t('Se hai fatto l’accesso, lascia questi campi vuoti.')}</b>
        </p>

        <div style={{ display: 'grid', gap: 12, maxWidth: 620 }}>
          <label style={{ display: 'grid', gap: 5, fontSize: 12, color: 'var(--text-secondary)' }}>
            {t('Indirizzo del database')}
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="libsql://nome-database-utente.regione.turso.io"
              spellCheck={false}
              autoComplete="off"
            />
          </label>

          <label style={{ display: 'grid', gap: 5, fontSize: 12, color: 'var(--text-secondary)' }}>
            {t('Token di accesso')}
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={t('incolla qui il token di Turso')}
              spellCheck={false}
              autoComplete="off"
            />
            {/* Il token non è nel codice dell'applicazione e non passa da
             * nessun nostro servizio: dal campo va al negozio dei segreti di
             * questo dispositivo, e da lì solo a Turso. */}
            <span className="muted" style={{ fontSize: 11 }}>
              {t('Resta su questo dispositivo: va solo a Turso.')}
            </span>
          </label>
          <DoveStannoLeCredenziali />
          {/*
           * ► SCESO QUI DALL'ELENCO «COSA SUCCEDE QUANDO PREMI SINCRONIZZA». ◄
           *
           * Lassù era l'unica riga scritta per chi conosce già il meccanismo:
           * «Le credenziali no. Il token del database resta su ogni
           * dispositivo» non vuol dire niente a chi «Avanzate» non l'ha mai
           * aperto, e chi non l'ha mai aperto un token non ce l'ha. Qui invece è
           * la risposta alla domanda che si fa proprio adesso chi sta per
           * incollarne uno: «e sull'altro dispositivo?».
           */}
          <p className="muted" style={{ fontSize: 11, margin: 0 }}>
            <b>{t('Il token non viaggia con le immersioni.')}</b>{' '}
            {t('Su ogni altro dispositivo va incollato di nuovo, qui.')}
          </p>

          <div className="row">
            <button className="btn btn-primary" onClick={() => void save()} disabled={!dirty}>
              {configured ? t('Aggiorna credenziali') : t('Salva credenziali')}
            </button>
            <button
              className="btn"
              onClick={() => void test()}
              disabled={testing || !url.trim() || !token.trim()}
            >
              {testing ? t('Verifica…') : t('Prova la connessione')}
            </button>
            {configured && (
              <button
                className="btn btn-danger"
                onClick={() => {
                  setUrl('');
                  setToken('');
                  void saveSyncCredentials(null);
                }}
              >
                {t('Dimentica')}
              </button>
            )}
          </div>

          {testResult?.ok && (
            <p className="muted" style={{ margin: 0, fontSize: 12 }}>
              {t('Connessione riuscita.')}
            </p>
          )}
          {/* Qui la strada è nota per costruzione: questa prova esiste solo dentro
           * «Avanzate» e prova quello che c'è scritto nei due campi qui sopra.
           * Chi la preme un token ce l'ha, ed è quello il rimedio giusto. */}
          {testResult && !testResult.ok && (
            <p style={{ margin: 0, fontSize: 12, color: 'var(--critical)' }}>
              {traduciErroreSync(testResult.error ?? '', t, 'manuale')}
            </p>
          )}
        </div>

        <h3 style={{ marginTop: 18 }}>{t('Come ottenere le credenziali')}</h3>
        {/* Un token per dispositivo è il consiglio giusto — se ne perdi uno
         * revochi solo quello — ma è un dettaglio da manuale: chi arriva qui la
         * prima volta ne genera comunque uno. */}
        <ol style={{ margin: 0, paddingLeft: 18, color: 'var(--text-secondary)', fontSize: 13 }}>
          <li>
            {t('Su turso.tech apri il database e copia l’indirizzo')} <code>libsql://…</code>
          </li>
          <li>{t('Sempre lì, «Create Token»: compare una volta sola, copialo e incollalo qui sopra.')}</li>
          <li>{t('La prima sincronizzazione carica l’archivio; sugli altri dispositivi lo scarica.')}</li>
        </ol>
      </details>

      <TrashCard />

      <BackupCard />

      <div className="card">
        <h2>{t('Esporta l’archivio')}</h2>
        {/*
         * PERCHÉ L'UDDF NON È UN BACKUP, e perché lo diciamo qui in una riga.
         *
         * Il formato è lo standard che gli altri programmi leggono ed è lo
         * stesso che questa app importa: il giro si chiude e l'archivio non è
         * prigioniero di nessuno. Ma UDDF non sa esprimere una quindicina di
         * campi — modalità, compagno, voto, zavorra, muta, fuso, valori del
         * computer — e non porta niente di quello che sta fuori dalle
         * immersioni (attrezzatura, brevetti, piani, analisi). Chi vuole poter
         * tornare indietro usa il backup completo, non questo file.
         */}
        {/*
         * ► CON L'ARCHIVIO VUOTO NON SI OFFRONO QUATTRO PULSANTI SPENTI. ◄
         *
         * Diceva «Tre strade per portare fuori le tue 0 immersioni» sopra quattro
         * comandi disattivati: una frase che si contraddice da sola — non esiste
         * nessuna strada per portare fuori zero cose — e una fila di pulsanti che
         * non si possono premere. Il primo giorno di chiunque, questa carta era
         * la più affollata e la più inutile della pagina.
         *
         * L'elenco dei formati resta, perché sapere che ci sono è utile anche
         * prima di averne bisogno; sparisce la promessa di un gesto impossibile.
         */}
        {dives.length === 0 ? (
          <p className="card-sub">
            <b>{t('Non c’è ancora niente da esportare.')}</b>{' '}
            {t(
              'Quando avrai la prima immersione in archivio troverai qui tre formati: UDDF per un altro programma di immersioni, CSV per un foglio di calcolo, KML per una mappa.',
            )}
          </p>
        ) : (
          <>
            <p className="card-sub">
              {t('Tre strade per portare fuori le tue')} {imm(dives.length, t)}:{' '}
              {t(
                'UDDF per un altro programma di immersioni, CSV per un foglio di calcolo, KML per una mappa.',
              )}{' '}
              <b>{t('Non sono un backup')}</b>:{' '}
              {t('lasciano fuori parecchi campi. Per una copia completa usa il backup.')}
            </p>
            <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
              <button
                className="btn btn-primary"
                disabled={exporting || dives.length === 0}
                onClick={() =>
                  scarica(async () => {
                    const result = await exportArchive();
                    const dove = await esporta(
                      `mydivelog-${new Date().toISOString().slice(0, 10)}.uddf`,
                      result.xml,
                    );
                    return {
                      quante: `${imm(result.dives, t)} ${t('esportate')}`,
                      omitted: result.omitted,
                      dove: dove.dove,
                    };
                  })
                }
              >
                {exporting ? t('Preparazione…') : t('Scarica UDDF')}
              </button>
              <button
                disabled={exporting || dives.length === 0}
                onClick={() =>
                  scarica(async () => {
                    const result = await exportArchive({ includeProfiles: false });
                    const dove = await esporta(
                      `mydivelog-riepiloghi-${new Date().toISOString().slice(0, 10)}.uddf`,
                      result.xml,
                    );
                    return {
                      quante: `${imm(result.dives, t)} ${t('esportate')}`,
                      omitted: result.omitted,
                      dove: dove.dove,
                    };
                  })
                }
              >
                {t('Solo riepiloghi')}
              </button>
              {/*
               * CSV e KML stanno accanto all'UDDF, e non è disordine.
               *
               * Sono tre risposte a tre domande diverse: l'UDDF porta le immersioni
               * in un altro programma del settore, il CSV le porta in un foglio di
               * calcolo dove si può fare quello che questo programma non fa, il KML
               * porta i siti su una mappa vera. Metterli in tre schede separate
               * costringerebbe a cercare, quando la domanda di chi arriva qui è una
               * sola: «come porto fuori i miei dati».
               */}
              <button
                disabled={exporting || dives.length === 0}
                onClick={() =>
                  scarica(async () => {
                    const { esportaCsv } = await import('../../core/export/csv');
                    /*
                     * Il separatore segue la lingua dell'interfaccia, e con lui il
                     * separatore decimale. Chi usa l'app in italiano ha quasi certamente
                     * un foglio italiano, che vuole il punto e virgola e la virgola nei
                     * decimali; chi la usa in inglese ha l'altra coppia. Sbagliare
                     * coppia non dà nessun errore: apre il file in una colonna sola,
                     * oppure fa entrare i numeri come testo.
                     */
                    // Il numero è la posizione nel logbook: sul foglio di calcolo
                    // deve essere il tuo, non quello della fonte da cui è arrivata.
                    const { csv, righe } = esportaCsv(conNumeri(dives, numeri), {
                      separatore: lingua === 'it' ? ';' : ',',
                      lingua,
                    });
                    const dove = await esporta(
                      `mydivelog-${new Date().toISOString().slice(0, 10)}.csv`,
                      csv,
                      'text/csv;charset=utf-8',
                    );
                    return { quante: `${imm(righe, t)} ${t('esportate')}`, omitted: [], dove: dove.dove };
                  })
                }
              >
                {t('Foglio di calcolo (CSV)')}
              </button>
              <button
                disabled={exporting || dives.length === 0}
                onClick={() =>
                  scarica(async () => {
                    const { esportaKml } = await import('../../core/export/kml');
                    const { kml, siti, senzaCoordinate } = esportaKml(dives, { lingua });
                    const dove = await esporta(
                      `mydivelog-siti-${new Date().toISOString().slice(0, 10)}.kml`,
                      kml,
                      'application/vnd.google-earth.kml+xml',
                    );
                    /*
                     * I siti senza coordinate entrano in `omitted`, cioè nella
                     * stessa riga che l'UDDF usa per dire cosa non è entrato. Senza,
                     * una mappa con quattro segnaposti su dodici siti sembra un
                     * difetto del programma invece che un dato che i formati di
                     * origine non contengono.
                     */
                    return {
                      quante: `${plural(siti, 'sito', 'siti', t)} ${t('esportati')}`,
                      omitted: senzaCoordinate.length
                        ? [`${t('siti senza coordinate')}: ${senzaCoordinate.join(', ')}`]
                        : [],
                      dove: dove.dove,
                    };
                  })
                }
              >
                {t('Siti su mappa (KML)')}
              </button>
            </div>
          </>
        )}
        {exported && (
          <div className="notice" style={{ marginTop: 12 }}>
            <b>
              {exported.quante}, {exported.dove}.
            </b>{' '}
            {exported.omitted.length > 0 && (
              <>
                {t('Restano fuori')}: {exported.omitted.join('; ')}.
              </>
            )}
          </div>
        )}
      </div>

      <RiconoscimentiCard />
    </div>
  );
}

/**
 * I riconoscimenti, e perché stanno DENTRO l'applicazione e non solo nel README.
 *
 * ► LA RAGIONE È PRECISA, NON DECORATIVA. ◄
 *
 * Da questa versione l'applicazione **contiene** libdivecomputer, che è
 * LGPL-2.1. Chi la riceve dall'App Store non vede il repository, non vede il
 * README, e non ha nessun altro posto in cui scoprire che parte di quello che
 * sta usando l'ha scritta qualcun altro in vent'anni di reverse engineering.
 * Un'attribuzione che vive solo dove il pubblico non arriva non è
 * un'attribuzione.
 *
 * Dice anche dove trovare il sorgente, ed è l'altra metà: la LGPL regge in
 * questo progetto proprio perché chi riceve il programma può ricostruirlo
 * tutto, libreria compresa. Se quel collegamento non è raggiungibile
 * dall'applicazione, quella possibilità resta teorica.
 */
function RiconoscimentiCard() {
  const { t } = useLingua();
  return (
    <div className="card">
      <h2>{t('Riconoscimenti')}</h2>
      <p className="card-sub">
        {t(
          'MyDiveLog legge i computer subacquei grazie al lavoro di chi ha decifrato i loro protocolli e lo ha reso pubblico.',
        )}
      </p>
      <p style={{ fontSize: 13 }}>
        <b>libdivecomputer</b> — {t('di Jef Driesen e collaboratori, licenza')}{' '}
        {/*
          IL NOME DELLA LICENZA È IL COLLEGAMENTO AL SUO TESTO, e non è un vezzo:
          la LGPL-2.1 chiede al §1 che la libreria sia accompagnata da una copia
          della licenza. Il sorgente ce l'ha (`COPYING` dentro il tarball
          versionato), ma chi riceve l'app dal negozio il sorgente non lo apre:
          per lui la copia è questa. Il testo sta su gnu.org, che è la fonte, e
          non una nostra trascrizione che potrebbe divergere.
        */}
        <a href="https://www.gnu.org/licenses/old-licenses/lgpl-2.1.html" target="_blank" rel="noreferrer">
          LGPL-2.1
        </a>
        .{' '}
        {t(
          'È inclusa in questa applicazione ed è quello che legge i computer subacquei che l’app non sa leggere da sé.',
        )}{' '}
        <a href="https://libdivecomputer.org" target="_blank" rel="noreferrer">
          libdivecomputer.org
        </a>
      </p>
      <p className="muted" style={{ fontSize: 12 }}>
        {t(
          'Il sorgente di MyDiveLog è pubblico sotto licenza MIT, e il sorgente esatto di libdivecomputer usato per compilare questa versione è dentro il repository: chiunque può ricostruire l’applicazione, libreria compresa.',
        )}{' '}
        <a href="https://github.com/matteoferrando/MyDiveLog" target="_blank" rel="noreferrer">
          github.com/matteoferrando/MyDiveLog
        </a>
      </p>
    </div>
  );
}

/**
 * Una riga del resoconto: etichetta a sinistra, numero a destra.
 *
 * L'ETICHETTA SI TRADUCE QUI, non nel punto di chiamata. Arriva sempre come
 * frase italiana scritta a mano nel JSX — mai come dato — quindi passarla dentro
 * `t()` in un posto solo è sicuro, tiene le otto chiamate leggibili a colpo
 * d'occhio e non lascia a nessuno la possibilità di dimenticarsene una. Il
 * `value` invece resta compito di chi chiama: è un numero, o un numero con una
 * parola, e va composto dove i pezzi ci sono.
 */
function Row({ label, value }: { label: string; value: number | string }) {
  const { t } = useLingua();
  return (
    <tr>
      <td>{t(label)}</td>
      <td className="num tabular">{value}</td>
    </tr>
  );
}

/**
 * Salvataggio di un file dal browser.
 *
 * Funziona sia nel browser sia dentro la webview di Tauri, dove il download passa
 * per il gestore del sistema. L'URL temporaneo va revocato: senza, il testo
 * dell'intero archivio resta in memoria fino alla chiusura dell'app.
 */
/**
 * Backup e ripristino.
 *
 * È una carta a parte e non il posto dell'export UDDF, perché rispondono a due
 * domande diverse: «voglio i miei dati altrove» e «voglio poter tornare
 * indietro». Averle confuse è il motivo per cui la carta dell'UDDF prometteva un
 * backup che non era, e per cui adesso dice in chiaro che backup non è.
 *
 * Il ripristino mostra il piano PRIMA di eseguirlo. Un'operazione che si lancia
 * quando le cose sono già andate male non può chiedere fiducia: deve dire quante
 * immersioni aggiunge, quante ne aggiorna e quante ne lascia dove sono.
 */
/**
 * Dove stanno le credenziali, detto e non lasciato intendere.
 *
 * Una riga sola, accanto ai campi in cui si incollano. Sta qui e non in una
 * pagina di documentazione perché è nel momento in cui incolli un token che ti
 * interessa sapere dove finirà, e perché la risposta cambia col dispositivo:
 * sull'app desktop è il portachiavi di macOS, nel browser è l'archivio locale in
 * chiaro. Dichiarare il caso peggiore quando è quello vero è l'unico modo di far
 * valere qualcosa la dichiarazione nel caso buono.
 *
 * La frase lunga di `describePlace()` non si usa più qui: spiegava PERCHÉ nel
 * browser non si cifra (una chiave che sta nella stessa pagina sarebbe teatro),
 * che è una ragione da codice e non una cosa che serve a chi sta incollando un
 * token. Quella funzione resta dov'è, per chi la vuole altrove.
 */
function DoveStannoLeCredenziali() {
  const { secretPlace } = useDiveLog();
  const { t } = useLingua();
  return (
    <p className="muted" style={{ fontSize: 11, marginTop: 12, marginBottom: 0 }}>
      <b>{secretPlace === 'keychain' ? t('Portachiavi di sistema.') : t('Archivio locale, in chiaro.')}</b>{' '}
      {secretPlace === 'keychain'
        ? t('Le legge solo questa app, e non finiscono nei backup.')
        : t('Nel browser non c’è un portachiavi. Sull’app desktop ci finiscono.')}
    </p>
  );
}

/**
 * L'accesso: la strada normale per avere un database condiviso.
 *
 * PERCHÉ STA IN CIMA E DA SOLA. Perché è quella che si sceglie: l'account crea
 * e gestisce il database per conto di chi accede, senza che nessuno debba aprire
 * la console di Turso e generare un token. L'altra strada — indirizzo e token
 * scritti a mano — non è stata tolta, è finita sotto «Avanzate», dove sta bene
 * una via di scampo che serve raramente e serve moltissimo quando serve.
 *
 * E soprattutto: **l'accesso non è obbligatorio per usare l'app.** Il logbook si
 * apre, importa e analizza senza, perché l'archivio è sul dispositivo. Questa
 * carta offre una comodità, non un cancello.
 */
function AccountCard() {
  const { accountAttivo, accountEmail, accediConAccount, esciDallAccount, cancellaAccount } = useDiveLog();
  const { t } = useLingua();
  // Quale dei due pulsanti sta lavorando, non «sto lavorando»: con un solo
  // stato entrambi i pulsanti direbbero «Accesso in corso…», e chi guarda non
  // saprebbe più quale ha premuto.
  const [lavoro, setLavoro] = useState<'idle' | 'apple' | 'google' | 'chiusura'>('idle');
  const [errore, setErrore] = useState<string | null>(null);

  const accedi = (fornitore: Fornitore) => {
    void (async () => {
      setLavoro(fornitore);
      setErrore(null);
      try {
        await accediConAccount(fornitore);
      } catch (err) {
        setErrore(err instanceof Error ? err.message : String(err));
      } finally {
        setLavoro('idle');
      }
    })();
  };

  return (
    <div className="card">
      <h2>{t('Accesso')}</h2>
      {/* Il logbook si apre, importa e analizza anche senza account, perché
       * l'archivio sta sul dispositivo: questa carta offre una comodità, non un
       * cancello, e il «non è obbligatorio» è lì per dirlo subito. */}
      <p className="card-sub">
        {t(
          'Con un account Apple o Google l’app crea un database tuo: gli altri dispositivi si allineano con lo stesso account.',
        )}{' '}
        <b>{t('Non è obbligatorio')}</b>: {t('il logbook funziona anche senza.')}
      </p>

      {accountAttivo ? (
        <>
          {/*
           * Con l'email si dice chi sei, senza si dice soltanto che sei
           * entrato. L'alternativa — nascondere tutto finché non si conosce
           * l'indirizzo — lascerebbe la pagina a mostrare «Accedi» a chi ha
           * appena fatto l'accesso, che è la bugia peggiore delle due.
           */}
          <p style={{ fontSize: 13, margin: '0 0 12px' }}>
            {accountEmail ? (
              <>
                {t('Sei entrato come')} <b>{accountEmail}</b>.
              </>
            ) : (
              t('Sei entrato. L’app sincronizza sul database del tuo account.')
            )}
          </p>
          <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
            <button onClick={() => void esciDallAccount()}>{t('Esci')}</button>
            {/*
             * Cancellare l'account è distruttivo e irreversibile, quindi passa
             * dalla conferma armata come tutte le altre cose che non si possono
             * disfare. Quello che cancella è il database REMOTO: l'archivio su
             * questo dispositivo resta dov'è, ed è scritto qui sotto perché è
             * esattamente la domanda che si fa chi sta per premere.
             */}
            {/*
             * ► LE DUE COSE CHE LA DOMANDA NON DICEVA. ◄
             *
             * Diceva già bene cosa muore e cosa resta, e mancavano i due dubbi
             * che restano addosso a chi legge «cancella l'account»:
             *
             *  - gli ALTRI dispositivi. Ognuno ha la sua copia intera, e nessuno
             *    la perde: la cancellazione tocca lo spazio condiviso, non le
             *    copie. Chi non lo sa immagina un pulsante che svuota il
             *    telefono da lontano, e non preme;
             *  - l'account Apple o Google. Non è nostro e non lo tocchiamo:
             *    quello che sparisce è il database creato per te. Il timore
             *    opposto — «mi cancella l'account Google?» — è irragionevole
             *    solo per chi sa come è fatta questa cosa dentro.
             */}
            <BottoneConferma
              etichetta={t('Cancella l’account')}
              domanda={t(
                'Cancella il database remoto e le immersioni che contiene. Quelle su questo dispositivo restano, e anche quelle sugli altri dispositivi dove le hai già sincronizzate. Il tuo account Apple o Google non viene toccato.',
              )}
              conferma={t('Sì, cancella il database remoto')}
              onConferma={() => {
                setLavoro('chiusura');
                void cancellaAccount()
                  .catch((err) => setErrore(err instanceof Error ? err.message : String(err)))
                  .finally(() => setLavoro('idle'));
              }}
            />
          </div>
          <p className="muted" style={{ fontSize: 11, marginTop: 10, marginBottom: 0 }}>
            {t('Uscire smette solo di sincronizzare. Le immersioni di questo dispositivo')}{' '}
            <b>{t('restano')}</b> {t('in tutti e due i casi.')}
          </p>
        </>
      ) : (
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          {/*
           * APPLE PER PRIMO, e non è cortesia: la linea guida 4.8 dell'App
           * Store vuole che Sign in with Apple sia offerto in modo equivalente
           * agli altri accessi, e «equivalente» comprende la posizione. Metterlo
           * secondo, più piccolo o più scolorito è una delle cose che la
           * revisione guarda.
           *
           * L'ASPETTO LO DETTA APPLE, non noi. Sfondo nero (o bianco), il
           * marchio della mela, e la dicitura «Sign in with Apple» — che **non
           * si traduce**: è un marchio registrato, e nelle linee guida di Apple
           * la versione italiana è «Accedi con Apple» solo se si usa la loro
           * localizzazione ufficiale. Scriverne una nostra sarebbe una
           * traduzione del marchio di qualcun altro, quindi resta in inglese e
           * non passa dal dizionario.
           */}
          <button
            className="btn bottone-apple"
            onClick={() => accedi('apple')}
            disabled={lavoro !== 'idle'}
            aria-label="Sign in with Apple"
          >
            {/* `aria-hidden`: il marchio è decorativo, il nome del pulsante lo
                dice già il testo accanto. */}
            <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" focusable="false">
              <path
                fill="currentColor"
                d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.53 4.08zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"
              />
            </svg>
            {lavoro === 'apple' ? t('Accesso in corso…') : 'Sign in with Apple'}
          </button>
          <button className="btn btn-primary" onClick={() => accedi('google')} disabled={lavoro !== 'idle'}>
            {lavoro === 'google' ? t('Accesso in corso…') : t('Accedi con Google')}
          </button>
          {/*
           * ► LA COSA PIÙ IMPORTANTE VA DETTA QUI, NON SOLO SUL SITO. ◄
           *
           * C'era mezza frase: la password si scrive al fornitore. Vera, e non è
           * quella che si sta chiedendo chi ha il dito sul pulsante. La domanda è
           * dove finiscono le IMMERSIONI, e la risposta — «non passano dal
           * servizio di accesso, viaggiano fra l'applicazione e il database» — è
           * dichiarata nella pagina della privacy del sito e in nessun punto
           * dell'applicazione. Una garanzia che vive dove nessuno la legge nel
           * momento in cui decide non è una garanzia: è documentazione.
           *
           * La riga occupa lo spazio di due, e va bene: è l'unico punto di questa
           * pagina in cui si chiede di fidarsi.
           */}
        </div>
      )}

      {/* Sta SOTTO i pulsanti e non di fianco: schiacciata nella riga si spezzava
       * in tre colonne strette accanto ai due pulsanti, cioè la frase più
       * importante della carta nella forma più faticosa da leggere. */}
      {!accountAttivo && (
        <p className="muted" style={{ fontSize: 11, margin: '10px 0 0' }}>
          {t('Si apre il browser di sistema: la password la scrivi al fornitore, non a noi.')}{' '}
          <b>{t('Le immersioni non passano dal servizio di accesso')}</b>:{' '}
          {t('viaggiano fra questa app e il tuo database.')}
        </p>
      )}

      {errore && (
        <div className="notice notice-error" role="alert" style={{ marginTop: 12 }}>
          {errore}
        </div>
      )}
    </div>
  );
}

function BackupCard() {
  const { dives, buildFullBackup, restoreBackup, storeLocation } = useDiveLog();
  const { t } = useLingua();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [lavoro, setLavoro] = useState<'idle' | 'export' | 'restore'>('idle');
  const [errore, setErrore] = useState<string | null>(null);
  const [avvisi, setAvvisi] = useState<string[]>([]);
  const [candidato, setCandidato] = useState<BackupFile | null>(null);
  const [piano, setPiano] = useState<RestorePlan | null>(null);
  const [modo, setModo] = useState<'merge' | 'replace'>('merge');
  const [esito, setEsito] = useState<string | null>(null);

  const scarica = () => {
    void (async () => {
      setLavoro('export');
      setErrore(null);
      setEsito(null);
      try {
        const file = await buildFullBackup();
        /*
         * `esporta` LANCIA quando non scrive, ed è tutto il punto.
         *
         * Prima qui c'era un `download()` che non poteva fallire: dentro la
         * WKWebView di iOS non scriveva niente e non lo diceva, quindi la riga
         * qui sotto dichiarava «Backup scritto» a un utente che non aveva
         * nessun backup. La frase adesso arriva DOPO una scrittura riuscita, e
         * dice anche dove è finito il file — che su iPhone non è ovvio.
         */
        const dove = await esporta(backupFileName(), JSON.stringify(file), 'application/json');
        setEsito(
          `${t('Backup scritto')} ${dove.dove}: ${imm(file.summary.dives, t)}, ${file.summary.samples.toLocaleString(localeCorrente())} ${t('campioni')}, ${file.summary.settings.length} ${t('impostazioni')}.`,
        );
      } catch (err) {
        setErrore(err instanceof Error ? err.message : String(err));
      } finally {
        setLavoro('idle');
      }
    })();
  };

  const leggi = (input: HTMLInputElement) => {
    const f = input.files?.[0];
    input.value = '';
    if (!f) return;
    setErrore(null);
    setEsito(null);
    setCandidato(null);
    setPiano(null);
    void (async () => {
      try {
        const check = checkBackup(JSON.parse(await f.text()));
        setAvvisi(check.warnings);
        if (!check.ok || !check.file) {
          setErrore(check.errors.join(' '));
          return;
        }
        setCandidato(check.file);
        setPiano(planRestore(check.file, dives, modo));
      } catch (err) {
        setErrore(
          `${t('Il file non è JSON valido')}: ${err instanceof Error ? err.message : String(err)}. ${t('Se è un UDDF, va nella scheda Importa.')}`,
        );
      }
    })();
  };

  const cambiaModo = (m: 'merge' | 'replace') => {
    setModo(m);
    if (candidato) setPiano(planRestore(candidato, dives, m));
  };

  /*
   * Quello che il modo scelto rende impossibile, ricalcolato a ogni cambio.
   *
   * Non è un avviso: finché c'è, il bottone resta spento. Vedi
   * `restoreBlockers` per il perché un backup vuoto in «ricostruisci da zero»
   * non sia una scelta legittima da lasciar prendere.
   */
  const impedimenti = candidato ? restoreBlockers(candidato, modo, dives.length) : [];

  const ripristina = () => {
    if (!candidato || impedimenti.length) return;
    void (async () => {
      setLavoro('restore');
      setErrore(null);
      try {
        const r = await restoreBackup(candidato, modo);
        setEsito(
          `${t('Ripristino fatto')}: ${r.added} ${t('aggiunte')}, ${r.merged} ${t('aggiornate')}, ${r.settings} ${t('impostazioni riscritte')}.` +
            (r.onlyLocal > 0 ? ` ${r.onlyLocal} ${t('che avevi solo qui sono rimaste dov’erano.')}` : ''),
        );
        setCandidato(null);
        setPiano(null);
      } catch (err) {
        setErrore(err instanceof Error ? err.message : String(err));
      } finally {
        setLavoro('idle');
      }
    })();
  };

  return (
    <div className="card">
      <h2>{t('Backup completo e ripristino')}</h2>
      {/*
       * IL BACKUP NON LO LEGGE NESSUN ALTRO PROGRAMMA, ed è voluto: quel
       * mestiere lo fa l'UDDF: qui in cambio non si perde niente — immersioni
       * con i profili e i secondi profili, attrezzatura, brevetti, piani
       * salvati, analisi generate, obiettivo e periodo.
       *
       * Le credenziali di sincronizzazione e la chiave API restano fuori di
       * proposito: un backup finisce su un disco esterno, in una cartella
       * condivisa o nell'app File, e non deve portarsi dietro i segreti di chi
       * lo ha fatto.
       */}
      <p className="card-sub">
        {t('Un file JSON con')} <b>{t('tutto')}</b>:{' '}
        {t('immersioni, profili, attrezzatura, brevetti, piani e analisi. Le credenziali restano fuori.')}
      </p>
      {suIOS() && (
        // Su iOS le app non hanno una cartella Download: il file finisce nella
        // cartella dell'app dentro File, e da lì l'utente lo sposta su iCloud o
        // lo passa al Mac. Detto qui perché non è ovvio e non è colpa nostra.
        <p className="card-sub">
          {t('Su iPhone il file va nell’app File, in «Sul mio iPhone → MyDiveLog».')}
        </p>
      )}

      <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
        <button
          className="btn btn-primary"
          disabled={lavoro !== 'idle' || dives.length === 0}
          onClick={scarica}
        >
          {lavoro === 'export' ? t('Preparazione…') : t('Scarica il backup')}
        </button>
        <button disabled={lavoro !== 'idle'} onClick={() => fileRef.current?.click()}>
          {t('Ripristina da un file…')}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          aria-label={t('File di backup da ripristinare')}
          style={{ display: 'none' }}
          onChange={(e) => leggi(e.currentTarget)}
        />
      </div>

      {errore && (
        <div className="notice notice-error" role="alert" style={{ marginTop: 12 }}>
          {errore}
        </div>
      )}
      {avvisi.length > 0 && (
        <div className="notice" style={{ marginTop: 12 }}>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {avvisi.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </div>
      )}

      {candidato && piano && (
        <div className="notice" style={{ marginTop: 12 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>
            {t('Backup del')} {dateShort(candidato.createdAt)} · {imm(candidato.summary.dives, t)} ·{' '}
            {candidato.summary.samples.toLocaleString(localeCorrente())} {t('campioni')}
          </div>
          {/* Il piano PRIMA dell'esecuzione: senza, «ripristina» è un salto nel buio. */}
          <ul style={{ margin: '0 0 10px', paddingLeft: 18 }}>
            <li>
              <b>{piano.added.length}</b> {t('immersioni verranno aggiunte')}
            </li>
            <li>
              <b>{piano.merged.length}</b> {t('già presenti verranno')}{' '}
              {modo === 'merge'
                ? t('arricchite, senza perdere quello che hai scritto tu')
                : t('sostituite con la versione del file')}
            </li>
            <li>
              <b>{piano.onlyLocal}</b> {t('che hai solo qui')}{' '}
              {modo === 'merge' ? t('resteranno dove sono') : <b>{t('verranno cancellate')}</b>}
            </li>
            <li>
              <b>{Object.keys(piano.settings).length}</b> {t('impostazioni verranno riscritte')}
            </li>
          </ul>
          <div className="row" style={{ gap: 14, flexWrap: 'wrap', marginBottom: 10 }}>
            <label className="planner-check" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="radio" checked={modo === 'merge'} onChange={() => cambiaModo('merge')} />
              <span>{t('Fondi con quello che c’è (consigliato)')}</span>
            </label>
            <label className="planner-check" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="radio" checked={modo === 'replace'} onChange={() => cambiaModo('replace')} />
              <span style={{ color: modo === 'replace' ? 'var(--critical)' : undefined }}>
                {t('Ricostruisci da zero')}
              </span>
            </label>
          </div>
          {impedimenti.length > 0 && (
            <div className="notice notice-error" role="alert" style={{ marginBottom: 10 }}>
              {impedimenti.join(' ')}
            </div>
          )}
          <div className="row" style={{ gap: 8 }}>
            {modo === 'replace' ? (
              <BottoneConferma
                className="btn"
                disabled={lavoro !== 'idle' || impedimenti.length > 0}
                etichetta={lavoro === 'restore' ? t('Ripristino…') : t('Ripristina')}
                conferma={t('Sì, ricostruisci da zero')}
                domanda={
                  <>
                    {t('Cancella le')} {imm(dives.length, t)} {t('che hai adesso,')}{' '}
                    <b>{t('comprese quelle che il backup non contiene')}</b>.{' '}
                    {t('Non passano dal cestino e non si torna indietro.')}
                  </>
                }
                onConferma={ripristina}
              />
            ) : (
              <button className="btn" disabled={lavoro !== 'idle'} onClick={ripristina}>
                {lavoro === 'restore' ? t('Ripristino…') : t('Ripristina')}
              </button>
            )}
            <button
              onClick={() => {
                setCandidato(null);
                setPiano(null);
                setAvvisi([]);
              }}
            >
              {t('Annulla')}
            </button>
          </div>
        </div>
      )}

      {esito && (
        <div className="notice" role="status" style={{ marginTop: 12 }}>
          {esito}
        </div>
      )}

      {/* Il senso di un backup è che stia ALTROVE: sullo stesso disco
       * dell'archivio non protegge da niente. */}
      <p className="muted" style={{ fontSize: 11, marginTop: 12, marginBottom: 0 }}>
        {t('L’archivio vive')} {t(storeLocation)}. {t('Il backup è una copia da tenere altrove.')}
      </p>
    </div>
  );
}

/**
 * Il cestino.
 *
 * Sta nelle impostazioni e non nel logbook perché non è un posto in cui si passa:
 * è un posto in cui si va quando ci si accorge di aver sbagliato. La cifra che
 * conta in ogni riga è quanti giorni restano, perché è l'unica informazione con
 * una scadenza.
 */
function TrashCard() {
  const { trash, restoreDive, restoreDives, purgeDive, emptyTrash } = useDiveLog();
  const { t } = useLingua();
  const items = sortTrash(trash);

  if (!items.length) {
    return (
      <div className="card">
        <h2>{t('Cestino')}</h2>
        {/* Finché è nel cestino un'immersione sparisce dall'archivio e non si
         * sincronizza, ma non è perduta: è lo stato intermedio che rende
         * riparabile un errore. Passati i giorni, la cancellazione diventa
         * definitiva su tutti i dispositivi. */}
        <p className="card-sub" style={{ marginBottom: 0 }}>
          {t('Vuoto. Quello che cancelli resta qui')} {TRASH_DAYS}{' '}
          {t('giorni, poi la cancellazione diventa definitiva su tutti i dispositivi.')}
        </p>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="spread" style={{ alignItems: 'flex-start' }}>
        <div>
          <h2 style={{ margin: 0 }}>{t('Cestino')}</h2>
          <p className="card-sub" style={{ marginBottom: 0 }}>
            {plural(items.length, 'immersione cancellata', 'immersioni cancellate', t)},{' '}
            {t('col loro profilo. Finché sono qui, «Rimetti a posto» le riporta com’erano.')}
          </p>
        </div>
        <span className="row" style={{ gap: 8 }}>
          {/*
           * «Rimetti a posto tutte» non è una comodità: senza, riparare un
           * errore di valutazione fatto in blocco costa un clic per immersione.
           * È successo davvero — cinquantadue immersioni cancellate insieme
           * perché sembravano doppioni, e poi non lo erano.
           */}
          {items.length > 1 && (
            <BottoneConferma
              etichetta={t('Rimetti a posto tutte')}
              conferma={`${t('Sì, rimetti')} ${imm(items.length, t)}`}
              domanda={
                <>
                  {t('Rimettere in archivio')} {imm(items.length, t)}?{' '}
                  {t('Tornano com’erano, profilo compreso.')}
                </>
              }
              onConferma={() => void restoreDives(items.map((i) => i.dive.id))}
            />
          )}
          <BottoneConferma
            etichetta={t('Svuota il cestino')}
            conferma={`${t('Sì, cancella')} ${imm(items.length, t)}`}
            domanda={
              <>
                {t('Cancellare definitivamente')} {imm(items.length, t)}? {t('La cancellazione si propaga a')}{' '}
                <b>{t('tutti i dispositivi')}</b> {t('e non si torna indietro.')}
              </>
            }
            onConferma={() => void emptyTrash()}
          />
        </span>
      </div>

      {items.length > TRASH_SOFT_LIMIT && (
        <div className="notice" style={{ marginTop: 12 }}>
          {t('Il cestino contiene')} {imm(items.length, t)}{' '}
          {t('con i loro profili: svuotarlo libera spazio e rende definitive le cancellazioni.')}
        </div>
      )}

      <div className="table-scroll" style={{ marginTop: 12 }}>
        <table>
          <thead>
            <tr>
              <th>{t('Immersione')}</th>
              <th className="num">{t('Cancellata')}</th>
              <th className="num">{t('Definitiva fra')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.dive.id}>
                <td>
                  <div style={{ fontWeight: 550 }}>
                    {item.dive.site?.name ?? t('senza sito')}{' '}
                    <span className="muted" style={{ fontWeight: 400 }}>
                      {dateShort(item.dive.startTime, item.dive.utcOffsetMinutes)}
                    </span>
                  </div>
                  <div className="muted" style={{ fontSize: 11 }}>
                    {item.dive.maxDepth.toFixed(1)} m · {formatDuration(item.dive.durationS)} ·{' '}
                    {item.samples?.length
                      ? `${item.samples.length} ${t('campioni conservati')}`
                      : t('senza profilo')}
                  </div>
                </td>
                <td className="num tabular muted">{dateShort(item.at)}</td>
                <td
                  className="num tabular"
                  style={{ color: daysLeft(item) <= 3 ? 'var(--warning-text)' : undefined }}
                >
                  {daysLeft(item)} {t('giorni')}
                </td>
                <td style={{ textAlign: 'right' }}>
                  <span className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                    <button
                      style={{ fontSize: 11, padding: '3px 8px' }}
                      onClick={() => void restoreDive(item.dive.id)}
                    >
                      {t('Rimetti a posto')}
                    </button>
                    <BottoneConferma
                      style={{ fontSize: 11, padding: '3px 8px' }}
                      etichetta={t('Elimina')}
                      conferma={t('Sì, cancella')}
                      domanda={t(
                        'Cancellare questa immersione su tutti i dispositivi? Non si torna indietro.',
                      )}
                      onConferma={() => void purgeDive(item.dive.id)}
                    />
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * L'aggiornamento dell'applicazione, sul Mac.
 *
 * ► NON COMPARE DOVE NON HA SENSO. ◄ Nel browser e su iPhone questa carta non
 * si disegna affatto: là gli aggiornamenti li distribuisce l'App Store, e una
 * carta che dice «sei aggiornato» in un posto dove non aggiorniamo niente è una
 * bugia gentile. Meglio il silenzio.
 *
 * ► CERCA DA SÉ, INSTALLA SU RICHIESTA. ◄ La ricerca parte all'apertura della
 * pagina: è una richiesta piccola, senza conseguenze, e serve a far sapere che
 * esiste una versione nuova a chi non andrebbe mai a controllare. Scaricare e
 * installare, invece, parte da un pulsante — come la sincronizzazione. Un
 * programma che si sostituisce da solo sotto le mani di chi lo sta usando è una
 * cosa che si subisce, non che si sceglie.
 *
 * La ricerca automatica NON mostra i propri errori. Se la rete manca, chi ha
 * aperto le impostazioni per tutt'altro non deve leggere un errore rosso su una
 * cosa che non ha chiesto. Quando invece è lui a premere «Controlla», l'errore
 * si vede eccome: ha fatto una domanda e ha diritto alla risposta vera, invece
 * di un «sei aggiornato» che non abbiamo verificato.
 */
function AggiornamentoCard() {
  const { t } = useLingua();
  const [stato, setStato] = useState<StatoAggiornamento>({ fase: 'fermo' });

  const cerca = useCallback((dichiaraErrori: boolean) => {
    setStato({ fase: 'cerco' });
    void cercaAggiornamento()
      .then((trovato) => setStato(trovato ? { fase: 'trovato', ...trovato } : { fase: 'nessuno' }))
      .catch((err) => {
        if (!dichiaraErrori) {
          setStato({ fase: 'fermo' });
          return;
        }
        setStato({ fase: 'errore', messaggio: err instanceof Error ? err.message : String(err) });
      });
  }, []);

  /*
   * Una volta sola all'apertura della pagina. `suComputer()` è già stato controllato
   * da chi disegna la carta, ma la guardia resta anche qui: questo effetto non
   * deve dipendere da chi lo monta.
   */
  useEffect(() => {
    // `cerca` interroga il servizio degli aggiornamenti, cioè la rete: è un sistema esterno, ed
    // è precisamente il mestiere di un effetto. Lo stato che ne esce non si può derivare dal
    // render, perché prima della risposta non esiste.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (aggiornamentiQui()) cerca(false);
  }, [cerca]);

  const installa = () => {
    setStato({ fase: 'scarico', fatti: 0 });
    void installaAggiornamento((fatti, totali) => setStato({ fase: 'scarico', fatti, totali }))
      .then(() => setStato({ fase: 'installato' }))
      .catch((err) =>
        setStato({ fase: 'errore', messaggio: err instanceof Error ? err.message : String(err) }),
      );
  };

  /*
    Nella copia del Mac App Store la carta non c'è proprio: `aggiornamentiQui()`
    è falsa e qui si esce. Mostrarla spenta, o con scritto «aggiorna dal
    negozio», vorrebbe dire occupare spazio per dire che qualcosa non si fa —
    mentre chi ha installato dal negozio gli aggiornamenti li riceve comunque,
    solo da un'altra parte.
  */
  if (!aggiornamentiQui()) return null;

  return (
    <div className="card">
      <h2>{t('Aggiornamenti')}</h2>
      <p className="card-sub">
        {t('L’app controlla se c’è una versione nuova. Scaricarla e installarla lo decidi tu.')}
      </p>

      {stato.fase === 'cerco' && <p style={{ fontSize: 13, margin: 0 }}>{t('Controllo…')}</p>}

      {stato.fase === 'nessuno' && (
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13 }}>{t('Sei alla versione più recente.')}</span>
          <button onClick={() => cerca(true)}>{t('Controlla di nuovo')}</button>
        </div>
      )}

      {stato.fase === 'fermo' && <button onClick={() => cerca(true)}>{t('Controlla')}</button>}

      {stato.fase === 'trovato' && (
        <>
          <div className="notice" role="status" style={{ marginBottom: 12 }}>
            {t('C’è la versione')} <b>{stato.versione}</b>.
          </div>
          {/*
           * Le note di versione le scrive chi pubblica e arrivano dalla rete:
           * si mostrano come TESTO, mai come markup, e in uno spazio limitato
           * con lo scorrimento — una nota lunga non deve spingere il pulsante
           * fuori dallo schermo.
           */}
          {stato.note && (
            <pre
              style={{
                fontSize: 12,
                whiteSpace: 'pre-wrap',
                maxHeight: 160,
                overflow: 'auto',
                margin: '0 0 12px',
                color: 'var(--text-secondary)',
              }}
            >
              {stato.note}
            </pre>
          )}
          <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
            <button className="btn btn-primary" onClick={installa}>
              {t('Installa e riavvia')}
            </button>
            <span className="muted" style={{ fontSize: 11, alignSelf: 'center' }}>
              {t('L’applicazione si chiude e si riapre da sola.')}
            </span>
          </div>
        </>
      )}

      {stato.fase === 'scarico' && (
        <p style={{ fontSize: 13, margin: 0 }} role="status">
          {descriviScaricamento(stato.fatti, stato.totali, t)}
        </p>
      )}

      {stato.fase === 'installato' && (
        <p style={{ fontSize: 13, margin: 0 }} role="status">
          {t('Installato. L’applicazione si sta riavviando.')}
        </p>
      )}

      {stato.fase === 'errore' && (
        <div className="notice notice-error" role="alert">
          {stato.messaggio}
        </div>
      )}
    </div>
  );
}

/**
 * Chi tiene il libretto: nome e brevetto.
 *
 * ► PERCHÉ ESISTE UNA CARTA APPOSTA. ◄ L'art. 12, comma 8 della legge 7 maggio
 * 2026, n. 70 elenca tredici dati che il libretto delle immersioni deve
 * contenere — «anche in formato digitale», dice il testo. Undici li sa già
 * l'applicazione, perché stanno nell'immersione. Due no: **le generalità del
 * subacqueo e il brevetto posseduto**, che non cambiano a ogni immersione e
 * quindi non hanno senso dentro la scheda di una singola. Cambiano una volta
 * ogni qualche anno, e stanno qui.
 *
 * ► NON È UN ADEMPIMENTO, E NON DEVE SEMBRARLO. ◄ Niente campi obbligatori,
 * niente avvisi, niente rosso. Chi non li compila continua a usare
 * l'applicazione esattamente come prima: perde solo due righe sulla stampa del
 * libretto. Due ragioni: le altre lettere presuppongono un centro e una guida, e
 * un'immersione fra amici non li ha; e il comma 8 sta dentro l'articolo sui
 * centri, quindi se l'obbligo valga anche per chi si immerge per conto proprio
 * il testo non lo chiarisce. Trasformare un'ambiguità in un errore rosso
 * significherebbe dare un parere legale al posto di un avvocato.
 *
 * ► RESTANO SUL DISPOSITIVO. ◄ Come tutto il resto dell'archivio. Escono solo se
 * si fa l'accesso e si preme Sincronizza, o se si stampa il libretto — che è
 * esattamente il punto: un documento da mostrare a qualcuno.
 */
function LibrettoCard() {
  const { subacqueo, saveSubacqueo, gear } = useDiveLog();
  const { t } = useLingua();
  const [nome, setNome] = useState(subacqueo.nome ?? '');

  /*
   * ► IL BREVETTO NON SI SCRIVE PIÙ A MANO. ◄
   *
   * Era un campo di testo libero, e sembrava la scelta comoda: una riga, la
   * scrivi come vuoi. Il risultato è che l'applicazione aveva DUE verità sullo
   * stesso fatto — l'elenco dei brevetti registrati e questa riga — che non si
   * parlavano. Chi scriveva «Advanced PADI» qui e registrava «Advanced Open
   * Water Diver» nell'elenco stampava sul libretto una cosa che nel suo archivio
   * non esisteva, e nessuna delle due parti sapeva dell'altra. Peggio: la riga
   * restava com'era anche dopo aver preso un brevetto nuovo, perché niente la
   * collegava a niente.
   *
   * Ora si SCEGLIE, e le voci sono i brevetti registrati qui sotto. Un dato
   * solo, in un posto solo.
   */
  const brevetti = useMemo(() => sortCertifications(gear.certifications), [gear.certifications]);
  /*
   * Ogni voce ha una CHIAVE e un TESTO, e non sono la stessa cosa.
   *
   * La chiave è quella che si salva e che finisce sul libretto: italiana
   * sempre, perché è una chiave d'archivio (vedi `etichettaBrevetto`). Il testo
   * è quello che si legge nella tendina, e passa dal dizionario come tutto il
   * resto. `<option>` permette esattamente questo — un valore e un'etichetta
   * diversi — ed è il motivo per cui cambiare lingua non fa perdere la scelta.
   *
   * I doppioni si scartano perché due voci identiche nella stessa tendina non
   * si possono distinguere: due brevetti della stessa didattica allo stesso
   * livello sono, per il libretto, la stessa riga.
   */
  const scelte = useMemo(() => {
    const viste = new Set<string>();
    const voci: { chiave: string; testo: string }[] = [];
    for (const c of brevetti) {
      const chiave = etichettaBrevetto(c);
      if (!chiave || viste.has(chiave)) continue;
      viste.add(chiave);
      voci.push({
        chiave,
        /*
         * Il testo segue la STESSA regola della chiave, o le due si
         * scollegherebbero: quando il brevetto viene dal catalogo il nome è già
         * un nome proprio — «Deep Diver», «3° Grado AR» — e non si traduce,
         * quindi testo e chiave coincidono. Quando è scritto a mano si ripiega
         * sul livello, che invece passa dal dizionario.
         */
        testo:
          c.didatticaId && c.name.trim()
            ? chiave
            : [c.agency.trim(), t(CERT_LEVEL_LABEL[c.level])].filter(Boolean).join(' '),
      });
    }
    return voci;
  }, [brevetti, t]);
  const brevetto = subacqueo.brevetto ?? '';
  /*
   * Quello che c'era scritto prima può non corrispondere a nessuna voce.
   * Cancellarlo di nascosto sarebbe la cosa peggiore: è un dato che una persona
   * ha scritto, e sparirebbe dal libretto senza che nessuno glielo dica. Resta
   * come voce della tendina, con una riga che spiega da dove viene, finché non
   * ne sceglie un'altra.
   */
  const fuoriElenco = brevetto !== '' && !scelte.some((v) => v.chiave === brevetto);

  // Stesso difetto di `dirty`, stessa cura: `salvaNome` scrive `nome.trim()`,
  // quindi il confronto deve ripulire tutti e due i lati. Qui il sintomo era più
  // discreto — un pulsante «Salva» che non spariva più dopo aver salvato — ma la
  // causa è identica: normalizzare da un lato solo del confronto.
  const nomeSporco = campoModificato(nome, subacqueo.nome);
  const salvaNome = () => {
    void saveSubacqueo({ ...subacqueo, nome: nome.trim() || undefined });
  };
  const salvaBrevetto = (scelto: string) => {
    void saveSubacqueo({ ...subacqueo, brevetto: scelto || undefined });
  };

  return (
    <div className="card">
      <h2>{t('Dati per il LogBook')}</h2>
      <p className="card-sub">
        {t(
          'Nome e brevetto finiscono sulla stampa del libretto, che è l’unico posto dove servono. Non sono obbligatori.',
        )}
      </p>
      <div className="grid grid-2" style={{ marginBottom: 12 }}>
        <label className="stack" style={{ gap: 4, fontSize: 12 }}>
          <span className="muted">{t('Nome e cognome')}</span>
          <input type="text" value={nome} onChange={(e) => setNome(e.target.value)} onBlur={salvaNome} />
        </label>
        <label className="stack" style={{ gap: 4, fontSize: 12 }}>
          <span className="muted">{t('Brevetto')}</span>
          {/* Una tendina si salva al cambio e non alla perdita di fuoco: non c'è
              niente da digitare, quindi non c'è un momento in cui la scelta è
              «a metà». */}
          <select
            value={brevetto}
            onChange={(e) => salvaBrevetto(e.target.value)}
            disabled={scelte.length === 0 && !fuoriElenco}
          >
            <option value="">
              {scelte.length === 0 ? t('nessun brevetto registrato') : t('— scegli —')}
            </option>
            {fuoriElenco && <option value={brevetto}>{brevetto}</option>}
            {scelte.map((voce) => (
              <option key={voce.chiave} value={voce.chiave}>
                {voce.testo}
              </option>
            ))}
          </select>
        </label>
      </div>
      {nomeSporco && (
        <button className="btn" onClick={salvaNome}>
          {t('Salva')}
        </button>
      )}
      {scelte.length === 0 && !fuoriElenco && (
        <p className="muted" style={{ fontSize: 11, margin: '0 0 10px' }}>
          {t('La tendina si riempie con i brevetti che registri qui sotto.')}
        </p>
      )}
      {fuoriElenco && (
        <p className="muted" style={{ fontSize: 11, margin: '0 0 10px' }}>
          {t(
            'Il brevetto scelto è scritto a mano e non è fra quelli registrati. Continua a valere sul libretto; se lo aggiungi qui sotto, resta legato al tuo elenco.',
          )}
        </p>
      )}
      <p className="muted" style={{ fontSize: 11, margin: '10px 0 0' }}>
        {t(
          'Servono alle lettere a) e b) del libretto delle immersioni previsto dall’art. 12, comma 8 della legge 70/2026, che ammette espressamente il formato digitale.',
        )}
      </p>
    </div>
  );
}
