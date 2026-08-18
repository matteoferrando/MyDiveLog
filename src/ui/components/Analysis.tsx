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

  const configured = Boolean(aiCredentials?.apiKey && aiCredentials.model);
  const stale =
    stored && currentFingerprint !== undefined && stored.fingerprint !== currentFingerprint;

  const run = async () => {
    setBusy(true);
    setError(null);
    setStreamed('');
    try {
      await runAnalysis(kind, { dive, gasInput, deco }, setStreamed);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setStreamed('');
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
            <button className="btn" onClick={() => void clearAnalysis(kind, subject)}>
              Rimuovi
            </button>
          )}
          <button className="btn btn-primary" onClick={() => void run()} disabled={busy || !configured}>
            {busy ? 'Analisi in corso…' : stored ? 'Rigenera' : 'Analizza con Claude'}
          </button>
        </div>
      </div>

      {!configured && (
        <p className="muted" style={{ fontSize: 12, marginTop: 12, marginBottom: 0 }}>
          Serve la chiave API di Anthropic: la inserisci una volta in <b>Impostazioni</b>.
        </p>
      )}

      {error && <p style={{ color: 'var(--critical)', fontSize: 13, marginTop: 12 }}>{error}</p>}

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
