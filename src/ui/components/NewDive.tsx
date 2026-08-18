/**
 * Inserire un'immersione a mano.
 *
 * Il modulo è organizzato in tre fasce, e l'ordine non è estetico: in cima c'è
 * quello senza cui l'immersione non esiste (quando, quanto giù, quanto a lungo),
 * poi quello che rende utili le statistiche, poi il racconto. Chi ha fretta
 * compila la prima fascia e salva; chi sta ricopiando un libretto compila tutto.
 *
 * La profondità MEDIA sta nella prima fascia pur essendo facoltativa, e ha una
 * riga che spiega perché: è lei a decidere il profilo quadro con cui vengono
 * stimati i tessuti, quindi è lei a decidere quanto azoto passa all'immersione
 * successiva. È l'unico campo di questo modulo che cambia un numero di un'ALTRA
 * immersione, e lasciarlo in fondo fra gli optional lo farebbe saltare sempre.
 *
 * I campi con i decimali sono `type="text"` con `inputMode="decimal"`, non
 * `type="number"`. Non è una svista: un campo numerico HTML accetta come
 * separatore SOLO quello della lingua della webview, e su un sistema in inglese
 * — o su una WKWebView che non ha ereditato la lingua di sistema — la virgola
 * non è un carattere valido. Il browser non segnala niente: `e.target.value`
 * arriva vuoto o troncato, quindi chi scrive «27,5» salva un'immersione a 0 m o
 * a 275 m senza accorgersene. Con un campo di testo la stringa arriva intera e
 * la converte `num()`, che accetta entrambi i separatori. Si perde la
 * spinnerina, che qui non serve a nessuno.
 */

import { useMemo, useState } from 'react';
import {
  buildManualDive,
  deviceOffsetMinutes,
  validateManualDive,
  type ManualDiveInput,
} from '../../core/manual';
import { mixName, withFraction } from '../../core/units';
import type { DiveMode, GasMix, Salinity } from '../../core/model';
import { useDiveLog } from '../state';

/** Il momento «adesso» arrotondato all'ora, nel formato di `datetime-local`. */
function nowLocal(): string {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

type Draft = {
  localDateTime: string;
  fusoDichiarato: boolean;
  utcOffsetMinutes: number;
  durationMin: string;
  maxDepthM: string;
  avgDepthM: string;
  minTempC: string;
  siteName: string;
  buddy: string;
  mode: DiveMode;
  salinity: Salinity;
  mix: GasMix;
  tankSizeL: string;
  startBar: string;
  endBar: string;
  weightKg: string;
  suit: string;
  visibilityM: string;
  rating: string;
  notes: string;
};

const vuoto = (): Draft => ({
  localDateTime: nowLocal(),
  fusoDichiarato: false,
  utcOffsetMinutes: deviceOffsetMinutes(nowLocal()) ?? 0,
  durationMin: '',
  maxDepthM: '',
  avgDepthM: '',
  minTempC: '',
  siteName: '',
  buddy: '',
  mode: 'oc',
  salinity: 'salt',
  mix: { o2: 0.21, he: 0 },
  tankSizeL: '',
  startBar: '',
  endBar: '',
  weightKg: '',
  suit: '',
  visibilityM: '',
  rating: '',
  notes: '',
});

/** Da casella di testo a numero: la stringa vuota è «non lo so», non zero. */
const num = (v: string): number | undefined => {
  const t = v.trim();
  if (!t) return undefined;
  const n = Number(t.replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
};

function toInput(d: Draft): ManualDiveInput {
  return {
    localDateTime: d.localDateTime,
    utcOffsetMinutes: d.fusoDichiarato ? d.utcOffsetMinutes : undefined,
    durationMin: num(d.durationMin) ?? 0,
    maxDepthM: num(d.maxDepthM) ?? 0,
    avgDepthM: num(d.avgDepthM),
    minTempC: num(d.minTempC),
    siteName: d.siteName,
    buddy: d.buddy,
    mode: d.mode,
    salinity: d.salinity,
    mix: d.mix,
    tankSizeL: num(d.tankSizeL),
    startBar: num(d.startBar),
    endBar: num(d.endBar),
    weightKg: num(d.weightKg),
    suit: d.suit,
    visibilityM: num(d.visibilityM),
    rating: num(d.rating),
    notes: d.notes,
  };
}

export function NewDive({ onDone }: { onDone: (id: string) => void }) {
  const { createDive, dives } = useDiveLog();
  const [aperto, setAperto] = useState(false);
  const [d, setD] = useState<Draft>(vuoto);
  const [salvando, setSalvando] = useState(false);
  const [esito, setEsito] = useState<{ merged: boolean; id: string } | null>(null);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    setD((p) => ({ ...p, [k]: v }));
    setEsito(null);
  };

  const input = useMemo(() => toInput(d), [d]);
  const errori = useMemo(() => validateManualDive(input), [input]);
  // Gli avvisi si costruiscono solo quando il modulo è valido: prima sarebbero
  // un elenco di rimproveri su campi che la persona non ha ancora raggiunto.
  const anteprima = useMemo(() => (errori.length ? null : buildManualDive(input)), [errori.length, input]);
  const giaPresente = anteprima ? dives.some((x) => x.id === anteprima.dive.id) : false;

  const [errore, setErrore] = useState<string | null>(null);

  /*
   * `void salva()` e non `onClick={salva}`.
   *
   * React scarta la promessa restituita da un gestore `async`: se il salvataggio
   * fallisce — quota dell'archivio locale esaurita, database chiuso — l'errore
   * diventa una unhandled rejection che nessuno vede, e per chi ha premuto il
   * bottone l'effetto è che il bottone non fa niente. In un'applicazione che
   * scrive su SQLite è il modo in cui un salvataggio perso passa inosservato.
   * Quindi: il `catch` è obbligatorio e il motivo si mostra.
   */
  const salva = async () => {
    if (!anteprima) return;
    setSalvando(true);
    setErrore(null);
    try {
      const { merged } = await createDive(anteprima.dive);
      setEsito({ merged, id: anteprima.dive.id });
      setD(vuoto());
    } catch (err) {
      setErrore(err instanceof Error ? err.message : String(err));
    } finally {
      setSalvando(false);
    }
  };

  if (!aperto) {
    return (
      <div className="card">
        <div className="spread" style={{ alignItems: 'center', gap: 12 }}>
          <div style={{ flex: '1 1 320px', minWidth: 0 }}>
            <h2 style={{ margin: 0 }}>Aggiungi un'immersione a mano</h2>
            <p className="card-sub" style={{ marginBottom: 0 }}>
              Per quelle senza file: computer a noleggio, batteria scarica, il libretto di carta. Non è solo
              una riga in più in elenco — la saturazione residua si calcola sull'archivio, e un'immersione che
              manca fa risultare più pulita quella che la segue.
            </p>
          </div>
          <button
            className="btn"
            onClick={() => {
              setEsito(null);
              setErrore(null);
              setAperto(true);
            }}
          >
            Nuova immersione
          </button>
        </div>
        {esito && <Esito esito={esito} onDone={onDone} />}
      </div>
    );
  }

  return (
    <div className="card">
      <div className="spread" style={{ alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
        <div style={{ flex: '1 1 320px', minWidth: 0 }}>
          <h2 style={{ margin: 0 }}>Nuova immersione</h2>
          <p className="card-sub" style={{ marginBottom: 0 }}>
            I primi tre campi bastano per salvare. Tutto il resto migliora i numeri che l'app sa calcolare, e
            ogni campo dice quali.
          </p>
        </div>
        <button
          onClick={() => {
            setAperto(false);
            setD(vuoto());
          }}
        >
          Chiudi
        </button>
      </div>

      {/* --- senza questi l'immersione non esiste ---------------------------- */}
      <div className="finding-section-label">Quando, quanto giù, quanto a lungo</div>
      <div className="grid grid-3" style={{ marginBottom: 6 }}>
        <Campo etichetta="Data e ora (locali del posto)">
          <input
            type="datetime-local"
            value={d.localDateTime}
            onChange={(e) => set('localDateTime', e.target.value)}
          />
        </Campo>
        <Campo etichetta="Durata" unita="min">
          <input
            type="number"
            min={1}
            value={d.durationMin}
            onChange={(e) => set('durationMin', e.target.value)}
          />
        </Campo>
        <Campo etichetta="Profondità massima" unita="m">
          <input
            type="text"
            inputMode="decimal"
            value={d.maxDepthM}
            onChange={(e) => set('maxDepthM', e.target.value)}
          />
        </Campo>
      </div>

      <div className="grid grid-3" style={{ marginBottom: 6 }}>
        <Campo etichetta="Profondità media" unita="m">
          <input
            type="text"
            inputMode="decimal"
            value={d.avgDepthM}
            onChange={(e) => set('avgDepthM', e.target.value)}
          />
        </Campo>
        <Campo etichetta="Acqua">
          <select value={d.salinity} onChange={(e) => set('salinity', e.target.value as Salinity)}>
            <option value="salt">salata</option>
            <option value="fresh">dolce (lago)</option>
          </select>
        </Campo>
        <Campo etichetta="Modalità">
          <select value={d.mode} onChange={(e) => set('mode', e.target.value as DiveMode)}>
            <option value="oc">circuito aperto</option>
            <option value="ccr">rebreather (CCR)</option>
            <option value="scr">rebreather (SCR)</option>
            <option value="gauge">profondimetro</option>
            <option value="freedive">apnea</option>
          </select>
        </Campo>
      </div>
      <p className="planner-hint" style={{ marginTop: 0 }}>
        La media è facoltativa ma è il campo più importante di questa fascia: da lei si ricostruisce il
        profilo con cui vengono stimati i tessuti, cioè quanto azoto risulta ancora in circolo quando cominci
        l'immersione dopo. Senza, si assume il 70% della massima — il rapporto mediano delle tue immersioni
        con profilo.
      </p>

      <label
        className="planner-check"
        style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}
      >
        <input
          type="checkbox"
          data-check="fuso"
          checked={d.fusoDichiarato}
          onChange={(e) => set('fusoDichiarato', e.target.checked)}
        />
        <span>L'immersione era in un altro fuso orario</span>
      </label>
      {d.fusoDichiarato && (
        <div className="grid grid-3" style={{ marginBottom: 10 }}>
          <Campo etichetta="Scarto da UTC" unita="ore">
            <input
              type="number"
              step="0.5"
              min={-12}
              max={14}
              value={d.utcOffsetMinutes / 60}
              onChange={(e) => set('utcOffsetMinutes', Math.round((num(e.target.value) ?? 0) * 60))}
            />
          </Campo>
          <div style={{ gridColumn: 'span 2' }}>
            <p className="planner-hint" style={{ marginTop: 22 }}>
              Serve a mettere l'immersione nell'ora giusta: senza, l'orario viene letto nel fuso di questo
              computer, e due immersioni di una giornata alle Maldive inserite da casa potrebbero risultare
              nell'ordine sbagliato.
            </p>
          </div>
        </div>
      )}

      {/* --- quello che rende utili le statistiche --------------------------- */}
      <div className="finding-section-label">Gas e consumo</div>
      <div className="grid grid-3" style={{ marginBottom: 6 }}>
        <Campo etichetta={`Ossigeno (${mixName(d.mix)})`} unita="%">
          <input
            type="number"
            min={5}
            max={100}
            value={Math.round(d.mix.o2 * 100)}
            onChange={(e) => set('mix', withFraction(d.mix, 'o2', (num(e.target.value) ?? 21) / 100))}
          />
        </Campo>
        <Campo etichetta="Elio" unita="%">
          <input
            type="number"
            min={0}
            max={90}
            value={Math.round(d.mix.he * 100)}
            onChange={(e) => set('mix', withFraction(d.mix, 'he', (num(e.target.value) ?? 0) / 100))}
          />
        </Campo>
        <Campo etichetta="Volume bombola" unita="L">
          <input
            type="text"
            inputMode="decimal"
            value={d.tankSizeL}
            onChange={(e) => set('tankSizeL', e.target.value)}
          />
        </Campo>
      </div>
      <div className="grid grid-3" style={{ marginBottom: 6 }}>
        <Campo etichetta="Pressione iniziale" unita="bar">
          <input type="number" min={0} value={d.startBar} onChange={(e) => set('startBar', e.target.value)} />
        </Campo>
        <Campo etichetta="Pressione finale" unita="bar">
          <input type="number" min={0} value={d.endBar} onChange={(e) => set('endBar', e.target.value)} />
        </Campo>
        <Campo etichetta="Temperatura minima" unita="°C">
          <input
            type="text"
            inputMode="text"
            value={d.minTempC}
            onChange={(e) => set('minTempC', e.target.value)}
          />
        </Campo>
      </div>
      <p className="planner-hint" style={{ marginTop: 0 }}>
        Volume e le due pressioni insieme danno il consumo in litri al minuto riportato alla superficie, che è
        l'unico numero confrontabile fra bombole e profondità diverse. Mancandone anche uno solo, questa
        immersione resta fuori da tutte le statistiche sul consumo.
      </p>

      {/* --- il racconto ---------------------------------------------------- */}
      <div className="finding-section-label">Dove, con chi, com'è andata</div>
      <div className="grid grid-3" style={{ marginBottom: 6 }}>
        <Campo etichetta="Sito">
          <input type="text" value={d.siteName} onChange={(e) => set('siteName', e.target.value)} />
        </Campo>
        <Campo etichetta="Compagno">
          <input type="text" value={d.buddy} onChange={(e) => set('buddy', e.target.value)} />
        </Campo>
        <Campo etichetta="Muta">
          <input type="text" value={d.suit} onChange={(e) => set('suit', e.target.value)} />
        </Campo>
      </div>
      <div className="grid grid-3" style={{ marginBottom: 6 }}>
        <Campo etichetta="Zavorra" unita="kg">
          <input
            type="text"
            inputMode="decimal"
            value={d.weightKg}
            onChange={(e) => set('weightKg', e.target.value)}
          />
        </Campo>
        <Campo etichetta="Visibilità" unita="m">
          <input
            type="number"
            min={0}
            value={d.visibilityM}
            onChange={(e) => set('visibilityM', e.target.value)}
          />
        </Campo>
        <Campo etichetta="Voto" unita="1-5">
          <input
            type="number"
            min={1}
            max={5}
            value={d.rating}
            onChange={(e) => set('rating', e.target.value)}
          />
        </Campo>
      </div>
      <Campo etichetta="Note">
        <textarea rows={3} value={d.notes} onChange={(e) => set('notes', e.target.value)} />
      </Campo>

      {/* --- che cosa succede se salvo -------------------------------------- */}
      {errori.length > 0 && !esito && (
        <div className="notice notice-error" style={{ marginTop: 14 }}>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {errori.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}
      {anteprima && anteprima.warnings.length > 0 && (
        <div className="notice" style={{ marginTop: 14 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Si può salvare lo stesso, ma sappi che:</div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {anteprima.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}
      {giaPresente && (
        <div className="notice" style={{ marginTop: 14 }}>
          In archivio c'è già un'immersione con questo orario, questa profondità e questa durata. Salvando non
          ne nasce una seconda: i campi che hai compilato riempiranno quelli vuoti di quella esistente, e il
          suo profilo resta dov'è.
        </div>
      )}

      {errore && (
        <div className="notice notice-error" role="alert" style={{ marginTop: 14 }}>
          Non è stato possibile salvare: {errore}. L'immersione non è in archivio, e quello che hai scritto è
          ancora qui nel modulo.
        </div>
      )}

      {esito && <Esito esito={esito} onDone={onDone} />}

      <div className="row" style={{ gap: 8, marginTop: 14 }}>
        <button
          className="btn"
          disabled={!anteprima || salvando}
          aria-busy={salvando || undefined}
          onClick={() => void salva()}
        >
          {salvando ? 'Salvo…' : giaPresente ? 'Unisci a quella esistente' : 'Salva immersione'}
        </button>
        <button
          onClick={() => {
            setD(vuoto());
            setEsito(null);
            setErrore(null);
          }}
        >
          Svuota il modulo
        </button>
      </div>
    </div>
  );
}

/**
 * La conferma del salvataggio.
 *
 * Sta in una funzione perché va mostrata in DUE posti: sotto al modulo aperto —
 * dove resta chi ne inserisce cinque di fila — e sulla scheda chiusa, per chi
 * chiude subito. Prima esisteva solo il secondo caso, e siccome il salvataggio
 * non chiude il modulo, l'unica cosa che compariva dopo un salvataggio RIUSCITO
 * era il riquadro ROSSO degli errori del modulo appena svuotato: la conferma non
 * si vedeva da nessuna parte e l'ultimo messaggio in pagina diceva il contrario
 * di quello che era appena successo.
 *
 * `role="status"` e non `role="alert"`: è una buona notizia, non deve
 * interrompere chi sta già scrivendo la riga successiva.
 */
function Esito({ esito, onDone }: { esito: { merged: boolean; id: string }; onDone: (id: string) => void }) {
  return (
    <div className="notice" role="status" style={{ marginTop: 12 }}>
      {esito.merged
        ? 'Quell’immersione era già in archivio: invece di duplicarla, i dati che hai scritto hanno riempito i campi vuoti di quella esistente.'
        : 'Immersione aggiunta.'}{' '}
      <button className="btn" style={{ marginLeft: 8 }} onClick={() => onDone(esito.id)}>
        Aprila
      </button>
    </div>
  );
}

/** Etichetta e unità sopra al campo, come nel resto dell'applicazione. */
function Campo({
  etichetta,
  unita,
  children,
}: {
  etichetta: string;
  unita?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="stack" style={{ gap: 4, fontSize: 12 }}>
      <span className="muted">
        {etichetta} {unita && <span className="muted">({unita})</span>}
      </span>
      {children}
    </label>
  );
}
