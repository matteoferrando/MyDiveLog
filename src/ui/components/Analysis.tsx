/**
 * Carta dell'analisi generata con Claude.
 *
 * Tre principi, che sono anche il motivo per cui questa carta non è un semplice
 * "chiedi a un modello":
 *
 *  - **è esplicita.** L'analisi si genera premendo un pulsante, e il pulsante dice
 *    che parte una richiesta a pagamento. Niente chiamate automatiche all'apertura
 *    di una scheda.
 *  - **è conservata.** Una volta generata resta nell'archivio locale con la data,
 *    il modello e i token consumati. Riaprire la scheda non rigenera niente.
 *  - **dichiara quando è vecchia.** Se i dati sono cambiati dopo la generazione,
 *    lo dice invece di far passare per attuale un testo scritto su altri numeri.
 */

import { useState } from 'react';
import { Markdown } from './Markdown';
import { int, plural } from '../format';
import { useDiveLog, type AnalysisKind, type DecoAnalysisInput } from '../state';
import type { Dive } from '../../core/model';
import type { GasPlanInput } from '../../core/analysis/gasPlan';

export function AnalysisCard({
  kind,
  dive,
  gasInput,
  deco,
  title,
  description,
  currentFingerprint,
}: {
  kind: AnalysisKind;
  dive?: Dive;
  /** Il piano da analizzare, per la modalità `gas`. */
  gasInput?: GasPlanInput;
  /** La tabella di decompressione da far rileggere, per la modalità `deco`. */
  deco?: DecoAnalysisInput;
  title: string;
  description: string;
  /** Impronta dei dati adesso: se differisce, l'analisi salvata è vecchia. */
  currentFingerprint?: string;
}) {
  const { aiCredentials, analysis, runAnalysis, clearAnalysis } = useDiveLog();
  const subject = kind === 'dive' ? dive?.id : kind === 'gas' ? 'gas' : kind === 'deco' ? 'deco' : undefined;
  const stored = analysis(kind, subject);
  const [busy, setBusy] = useState(false);
  const [streamed, setStreamed] = useState('');
  const [error, setError] = useState<string | null>(null);
  /**
   * L'analisi raccontata a chi non guarda lo schermo.
   *
   * È il caso peggiore di tutta l'applicazione: si preme un pulsante, parte una
   * richiesta di rete che dura mezzo minuto, il testo arriva a pezzi e alla fine
   * compare in fondo alla carta. Guardando lo schermo si vede il flusso crescere;
   * senza guardarlo, fra la pressione del pulsante e la fine non succede
   * assolutamente niente, e non c'è modo di distinguere «sta scrivendo» da «non
   * ha funzionato».
   *
   * Qui NON finisce il testo in streaming. Un'analisi è un migliaio di parole che
   * arrivano una manciata di caratteri alla volta: in una regione live sarebbero
   * centinaia di annunci al secondo, ognuno che interrompe il precedente, e il
   * risultato pratico è una voce che balbetta e non dice mai una frase intera. Si
   * annunciano i tre momenti — parte, finisce, fallisce — e il testo si legge
   * dove sta, con i comandi di lettura.
   */
  const [annuncio, setAnnuncio] = useState('');

  const configured = Boolean(aiCredentials?.apiKey && aiCredentials.model);
  const stale =
    stored && currentFingerprint !== undefined && stored.fingerprint !== currentFingerprint;

  const run = async () => {
    setBusy(true);
    setError(null);
    setStreamed('');
    setAnnuncio(
      `${title}: richiesta inviata${aiCredentials?.model ? ` al modello ${aiCredentials.model}` : ''}. ` +
        'La risposta arriva a pezzi e può richiedere qualche decina di secondi.',
    );
    try {
      const generata = await runAnalysis(kind, { dive, gasInput, deco }, setStreamed);
      // Quanto è lunga e quanto è costata: sono i due numeri che l'interfaccia
      // mostra sotto il testo — è arrivata mezza pagina o tre — e sono già qui,
      // nell'analisi appena salvata. «Analisi completata» non direbbe né se vale
      // la pena mettersi a leggerla né quanto si è speso.
      const parole = generata.text.trim().split(/\s+/).filter(Boolean).length;
      setAnnuncio(
        `${title}: analisi pronta, ${plural(parole, 'parola', 'parole')}` +
          (generata.inputTokens !== undefined
            ? `, ${int(generata.inputTokens)} token in ingresso e ${int(generata.outputTokens ?? 0)} in uscita`
            : '') +
          '. Il testo è qui sotto, sotto il titolo della carta.',
      );
    } catch (err) {
      // Il motivo del fallimento lo dice la regione assertiva insieme al
      // paragrafo visibile: qui si azzera il racconto tranquillo, altrimenti
      // resterebbe appeso un «richiesta inviata» che è diventato falso.
      setAnnuncio('');
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setStreamed('');
    }
  };

  const rimuovi = async () => {
    setAnnuncio(`${title}: rimozione dell'analisi salvata…`);
    try {
      await clearAnalysis(kind, subject);
      setAnnuncio(
        `${title}: analisi rimossa dall'archivio locale. Il pulsante torna a «Analizza con Claude».`,
      );
    } catch (err) {
      setAnnuncio('');
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="card">
      <div className="spread" style={{ alignItems: 'flex-start', gap: 12 }}>
        <div>
          <h2>{title}</h2>
          <p className="card-sub" style={{ marginBottom: 0 }}>
            {description}
          </p>
        </div>
        <div className="row" style={{ flexShrink: 0 }}>
          {stored && !busy && (
            <button className="btn" onClick={() => void rimuovi()}>
              Rimuovi
            </button>
          )}
          {/*
            Il testo del pulsante cambia già in «Analisi in corso…», ma quel testo
            nessuno lo rilegge: chi ha premuto Invio è rimasto sul pulsante e
            l'etichetta di un elemento che ha già il fuoco non viene riannunciata
            quando cambia. `aria-busy` sì: è lo stato del comando, e viene letto a
            chi ci torna sopra per capire se deve ripremere.
          */}
          <button
            className="btn btn-primary"
            onClick={() => void run()}
            disabled={busy || !configured}
            aria-busy={busy}
          >
            {busy ? 'Analisi in corso…' : stored ? 'Rigenera' : 'Analizza con Claude'}
          </button>
        </div>
      </div>

      {/*
        Il racconto dei tre momenti, invisibile perché sarebbe la ripetizione a
        parole di ciò che la carta già mostra: il pulsante che dice «Analisi in
        corso…», il flusso che cresce, il testo che compare.
      */}
      <div className="solo-lettori" role="status" aria-live="polite" aria-atomic="true">
        {annuncio}
      </div>

      {!configured && (
        <p className="muted" style={{ fontSize: 12, marginTop: 12, marginBottom: 0 }}>
          Serve la chiave API di Anthropic: la inserisci una volta in <b>Impostazioni</b>.
        </p>
      )}

      {/*
        L'errore sta DENTRO la regione assertiva, invece di essere copiato in una
        seconda regione nascosta: il messaggio è già scritto qui in rosso, e un
        doppione invisibile lo farebbe leggere due volte di fila a chi usa lo
        screen reader — l'errore tipico di questo genere di aggiunte. Il
        contenitore c'è sempre, anche senza errore: una regione live che nasce
        insieme al suo contenuto non viene annunciata da diversi screen reader, e
        un `div` vuoto senza stile non occupa un pixel.

        Assertivo e non `role="status"` perché un'analisi fallita cambia cosa si
        sta per fare: senza saperlo si resta ad aspettare un testo che non
        arriverà, o si crede che sia stato speso un pagamento che non c'è stato.
      */}
      <div role="alert" aria-live="assertive" aria-atomic="true">
        {error && <p style={{ color: 'var(--critical)', fontSize: 13, marginTop: 12 }}>{error}</p>}
      </div>

      {busy && (
        <div style={{ marginTop: 14 }}>
          {streamed ? (
            <div className="streaming">
              <Markdown text={streamed} />
            </div>
          ) : (
            <p className="muted" style={{ fontSize: 12, margin: 0 }}>
              Invio i dati e attendo la prima risposta…
            </p>
          )}
        </div>
      )}

      {!busy && stored && (
        <div style={{ marginTop: 14 }}>
          {stale && (
            <div className="notice" style={{ marginBottom: 12 }}>
              I dati sono cambiati dopo questa analisi: rigenerala per tenerne conto.
            </div>
          )}
          <Markdown text={stored.text} />
          <div className="ai-meta">
            <span>{new Date(stored.at).toLocaleString('it-IT')}</span>
            <span>{stored.model}</span>
            {stored.inputTokens !== undefined && (
              <span>
                {stored.inputTokens.toLocaleString('it-IT')} token in ingresso ·{' '}
                {(stored.outputTokens ?? 0).toLocaleString('it-IT')} in uscita
              </span>
            )}
            <span>Generata da un modello: i numeri vengono dai tuoi dati, le conclusioni no.</span>
          </div>
        </div>
      )}
    </div>
  );
}
