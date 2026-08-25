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
import type { DiveGear, DiveMode, GasMix, GearRef, Salinity, Waves, Weather } from '../../core/model';
import { FASCE_VISIBILITA, WAVES_LABEL, WEATHER_LABEL } from '../../core/conditions';
import { ScegliAttrezzo, vocePerNome } from './ScegliAttrezzo';
import { pesoDelGav, type Equipment, type EquipmentKind } from '../../core/analysis/gear';
import { useLingua } from '../lingua';
import { usePortaInVista } from '../scorri';
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
  title: string;
  buddy: string;
  guide: string;
  weather: '' | Weather;
  waves: '' | Waves;
  /** Indice nella scala delle fasce, o stringa vuota. */
  visibilita: string;
  backplateKg: string;
  attrezzi: DiveGear;
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
  title: '',
  buddy: '',
  guide: '',
  weather: '',
  waves: '',
  visibilita: '',
  backplateKg: '',
  attrezzi: {},
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
  // La variabile si chiama `s` e non `t`: in questo file `t` è la funzione che
  // traduce, e due `t` diversi nello stesso modulo si confondono a colpo d'occhio.
  const s = v.trim();
  if (!s) return undefined;
  const n = Number(s.replace(',', '.'));
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
    title: d.title,
    buddy: d.buddy,
    guide: d.guide,
    conditions: {
      weather: d.weather || undefined,
      waves: d.waves || undefined,
    },
    gear: { ...d.attrezzi, backplateKg: num(d.backplateKg) },
    mode: d.mode,
    salinity: d.salinity,
    mix: d.mix,
    tankSizeL: num(d.tankSizeL),
    startBar: num(d.startBar),
    endBar: num(d.endBar),
    weightKg: num(d.weightKg),
    suit: d.suit,
    visibilityM: d.visibilita === '' ? num(d.visibilityM) : FASCE_VISIBILITA[Number(d.visibilita)]?.min,
    visibilityMaxM: d.visibilita === '' ? undefined : FASCE_VISIBILITA[Number(d.visibilita)]?.max,
    rating: num(d.rating),
    notes: d.notes,
  };
}

export function NewDive({ onDone }: { onDone: (id: string) => void }) {
  const { createDive, dives, gear, saveGear } = useDiveLog();
  const { t } = useLingua();
  /*
   * L'inventario si aggiorna in locale mentre si compila: `saveGear` passa dallo
   * storage, e aspettarlo farebbe sparire e ricomparire la voce appena aggiunta.
   */
  const [attrezziLocali, setAttrezziLocali] = useState<Equipment[]>(gear.equipment);
  const aggiungiAllInventario = (kind: EquipmentKind, name: string): string => {
    const voce = vocePerNome(kind, name);
    const prossimo = [...attrezziLocali, voce];
    setAttrezziLocali(prossimo);
    void saveGear({ ...gear, equipment: prossimo });
    return voce.id;
  };
  const [aperto, setAperto] = useState(false);
  /*
   * Il modulo prende il posto della riga di invito, quindi il riquadro NON
   * rinasce: senza `quando` l'effetto sarebbe partito una volta sola, al primo
   * disegno della pagina, quando non c'era ancora niente da vedere. Il modulo è
   * lungo — venti campi — e chi lo apre da metà pagina se lo ritrovava a
   * cavallo dello schermo.
   */
  const rif = usePortaInVista<HTMLDivElement>({ quando: aperto });
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
            <h2 style={{ margin: 0 }}>{t("Aggiungi un'immersione a mano")}</h2>
            {/*
              Perché conviene inserirla anche senza file, e non lo diciamo più a
              schermo: la saturazione residua si calcola sull'ARCHIVIO, quindi
              un'immersione che manca fa risultare più pulita quella che la
              segue. All'utente basta sapere quando usare questo pulsante.
            */}
            <p className="card-sub" style={{ marginBottom: 0 }}>
              {t('Per quelle senza file: computer a noleggio, batteria scarica, libretto di carta.')}
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
            {t('Nuova immersione')}
          </button>
        </div>
        {esito && <Esito esito={esito} onDone={onDone} />}
      </div>
    );
  }

  return (
    <div className="card" ref={rif}>
      <div className="spread" style={{ alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
        <div style={{ flex: '1 1 320px', minWidth: 0 }}>
          <h2 style={{ margin: 0 }}>{t('Nuova immersione')}</h2>
          <p className="card-sub" style={{ marginBottom: 0 }}>
            {t('I primi tre campi bastano per salvare. Il resto migliora i calcoli.')}
          </p>
        </div>
        <button
          onClick={() => {
            setAperto(false);
            setD(vuoto());
          }}
        >
          {t('Chiudi')}
        </button>
      </div>

      {/* --- senza questi l'immersione non esiste ---------------------------- */}
      <div className="finding-section-label">{t('Quando, quanto giù, quanto a lungo')}</div>
      <div className="grid grid-3" style={{ marginBottom: 6 }}>
        <Campo etichetta={t('Data e ora del posto')}>
          <input
            type="datetime-local"
            value={d.localDateTime}
            onChange={(e) => set('localDateTime', e.target.value)}
          />
        </Campo>
        <Campo etichetta={t('Durata')} unita="min">
          <input
            type="number"
            min={1}
            value={d.durationMin}
            onChange={(e) => set('durationMin', e.target.value)}
          />
        </Campo>
        <Campo etichetta={t('Profondità massima')} unita="m">
          <input
            type="text"
            inputMode="decimal"
            value={d.maxDepthM}
            onChange={(e) => set('maxDepthM', e.target.value)}
          />
        </Campo>
      </div>

      <div className="grid grid-3" style={{ marginBottom: 6 }}>
        <Campo etichetta={t('Profondità media')} unita="m">
          <input
            type="text"
            inputMode="decimal"
            value={d.avgDepthM}
            onChange={(e) => set('avgDepthM', e.target.value)}
          />
        </Campo>
        <Campo etichetta={t('Acqua')}>
          <select value={d.salinity} onChange={(e) => set('salinity', e.target.value as Salinity)}>
            <option value="salt">{t('salata')}</option>
            <option value="fresh">{t('dolce (lago)')}</option>
          </select>
        </Campo>
        <Campo etichetta={t('Modalità')}>
          <select value={d.mode} onChange={(e) => set('mode', e.target.value as DiveMode)}>
            <option value="oc">{t('circuito aperto')}</option>
            <option value="ccr">rebreather (CCR)</option>
            <option value="scr">rebreather (SCR)</option>
            <option value="gauge">{t('profondimetro')}</option>
            <option value="freedive">{t('apnea')}</option>
          </select>
        </Campo>
      </div>
      {/*
        La media è facoltativa ma decide il profilo quadro con cui si stimano i
        tessuti, e quindi il carico che passa all'immersione successiva. Il 70%
        è il rapporto mediano delle immersioni con profilo di questo archivio:
        dettaglio da manutentori, non da schermo.
      */}
      <p className="planner-hint" style={{ marginTop: 0 }}>
        {t(
          'Se te la ricordi, scrivila: decide quanto azoto passa all’immersione dopo. Senza, si usa il 70% della massima.',
        )}
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
        <span>{t("L'immersione era in un altro fuso orario")}</span>
      </label>
      {d.fusoDichiarato && (
        <div className="grid grid-3" style={{ marginBottom: 10 }}>
          <Campo etichetta={t('Scarto da UTC')} unita={t('ore')}>
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
            {/*
              Senza scarto l'orario viene letto nel fuso di QUESTO dispositivo, e
              due immersioni della stessa giornata fatta lontano possono finire
              in ordine sbagliato nella catena delle ripetitive.
            */}
            <p className="planner-hint" style={{ marginTop: 22 }}>
              {t("Serve a mettere l'immersione nell'ora giusta del posto.")}
            </p>
          </div>
        </div>
      )}

      {/* --- quello che rende utili le statistiche --------------------------- */}
      <div className="finding-section-label">{t('Gas e consumo')}</div>
      <div className="grid grid-3" style={{ marginBottom: 6 }}>
        <Campo etichetta={`${t('Ossigeno')} (${mixName(d.mix)})`} unita="%">
          <input
            type="number"
            min={5}
            max={100}
            value={Math.round(d.mix.o2 * 100)}
            onChange={(e) => set('mix', withFraction(d.mix, 'o2', (num(e.target.value) ?? 21) / 100))}
          />
        </Campo>
        <Campo etichetta={t('Elio')} unita="%">
          <input
            type="number"
            min={0}
            max={90}
            value={Math.round(d.mix.he * 100)}
            onChange={(e) => set('mix', withFraction(d.mix, 'he', (num(e.target.value) ?? 0) / 100))}
          />
        </Campo>
        <Campo etichetta={t('Volume bombola')} unita="L">
          <input
            type="text"
            inputMode="decimal"
            value={d.tankSizeL}
            onChange={(e) => set('tankSizeL', e.target.value)}
          />
        </Campo>
      </div>
      <div className="grid grid-3" style={{ marginBottom: 6 }}>
        <Campo etichetta={t('Pressione iniziale')} unita="bar">
          <input type="number" min={0} value={d.startBar} onChange={(e) => set('startBar', e.target.value)} />
        </Campo>
        <Campo etichetta={t('Pressione finale')} unita="bar">
          <input type="number" min={0} value={d.endBar} onChange={(e) => set('endBar', e.target.value)} />
        </Campo>
        <Campo etichetta={t('Temperatura minima')} unita="°C">
          <input
            type="text"
            inputMode="text"
            value={d.minTempC}
            onChange={(e) => set('minTempC', e.target.value)}
          />
        </Campo>
      </div>
      {/*
        Volume più le due pressioni danno l'RMV, l'unico consumo confrontabile
        fra bombole e profondità diverse. Se ne manca uno, l'immersione esce da
        tutte le statistiche sul consumo — ed è questo che va detto a schermo.
      */}
      <p className="planner-hint" style={{ marginTop: 0 }}>
        {t(
          'Volume e le due pressioni danno l’RMV, il consumo riportato alla superficie. Se ne manca uno, questa immersione resta fuori dalle statistiche sul consumo.',
        )}
      </p>

      {/* --- il racconto ---------------------------------------------------- */}
      <div className="finding-section-label">{t("Dove, con chi, com'è andata")}</div>
      <div className="grid grid-3" style={{ marginBottom: 6 }}>
        <Campo etichetta={t('Titolo')}>
          <input
            type="text"
            placeholder={t('notturna al relitto')}
            value={d.title}
            onChange={(e) => set('title', e.target.value)}
          />
        </Campo>
        <Campo etichetta={t('Sito')}>
          <input type="text" value={d.siteName} onChange={(e) => set('siteName', e.target.value)} />
        </Campo>
        <Campo etichetta={t('Compagno')}>
          <input type="text" value={d.buddy} onChange={(e) => set('buddy', e.target.value)} />
        </Campo>
        <Campo etichetta={t('Guida sub')}>
          <input type="text" value={d.guide} onChange={(e) => set('guide', e.target.value)} />
        </Campo>
      </div>

      {/*
       * L'ATTREZZATURA SI SCEGLIE DALL'INVENTARIO ANCHE QUI.
       *
       * È lo stesso campo della scheda di un'immersione già in archivio, non una
       * copia: due copie divergono al primo ritocco, e la prima cosa che
       * diverge è il riconoscimento senza maiuscole — senza il quale «apeks
       * xtx50» e «Apeks XTX50» diventano due erogatori e il conto delle
       * immersioni per attrezzo smette di tornare.
       */}
      <div className="grid grid-3" style={{ marginBottom: 6 }}>
        <ScegliAttrezzo
          kind="suit"
          etichetta={t('Muta')}
          valore={d.attrezzi.suit ?? (d.suit ? { name: d.suit } : undefined)}
          attrezzi={attrezziLocali}
          onChange={(v) => {
            set('attrezzi', { ...d.attrezzi, suit: v });
            set('suit', v?.name ?? '');
          }}
          onAggiungiAllInventario={aggiungiAllInventario}
        />
        <ScegliAttrezzo
          kind="bcd"
          etichetta={t('GAV o sacco')}
          valore={d.attrezzi.bcd}
          attrezzi={attrezziLocali}
          onChange={(v) => {
            // Come nella scheda: la piastra del GAV scelto si propone se il
            // campo è vuoto. Vedi `pesoDelGav`.
            const peso = pesoDelGav(attrezziLocali.find((a) => a.id === v?.id));
            set('attrezzi', { ...d.attrezzi, bcd: v });
            if (!d.backplateKg && peso !== undefined) set('backplateKg', String(peso));
          }}
          onAggiungiAllInventario={aggiungiAllInventario}
        />
        <ScegliAttrezzo
          kind="regulator"
          etichetta={t('Erogatore principale')}
          valore={d.attrezzi.regulators?.[0]}
          attrezzi={attrezziLocali}
          onChange={(v) =>
            set('attrezzi', {
              ...d.attrezzi,
              regulators: [v, d.attrezzi.regulators?.[1]].filter((x): x is GearRef => !!x),
            })
          }
          onAggiungiAllInventario={aggiungiAllInventario}
        />
        <ScegliAttrezzo
          kind="regulator"
          etichetta={t('Secondo erogatore')}
          valore={d.attrezzi.regulators?.[1]}
          attrezzi={attrezziLocali}
          onChange={(v) =>
            set('attrezzi', {
              ...d.attrezzi,
              regulators: [d.attrezzi.regulators?.[0], v].filter((x): x is GearRef => !!x),
            })
          }
          onAggiungiAllInventario={aggiungiAllInventario}
        />
      </div>

      <div className="grid grid-3" style={{ marginBottom: 6 }}>
        <Campo etichetta={t('Zavorra')} unita="kg">
          <input
            type="text"
            inputMode="decimal"
            value={d.weightKg}
            onChange={(e) => set('weightKg', e.target.value)}
          />
        </Campo>
        <Campo etichetta={t('Piastra o schienalino')} unita="kg">
          <input
            type="text"
            inputMode="decimal"
            value={d.backplateKg}
            onChange={(e) => set('backplateKg', e.target.value)}
          />
        </Campo>
        <Campo etichetta={t('Meteo')}>
          <select value={d.weather} onChange={(e) => set('weather', e.target.value as '' | Weather)}>
            <option value="">{t('non registrato')}</option>
            {/*
              `WEATHER_LABEL` e `WAVES_LABEL` sono tabelle di costanti del core:
              restano in italiano là — sono le chiavi del dizionario — e si
              traducono qui, al disegno.
            */}
            {Object.entries(WEATHER_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {t(v)}
              </option>
            ))}
          </select>
        </Campo>
        <Campo etichetta={t('Mare')}>
          <select value={d.waves} onChange={(e) => set('waves', e.target.value as '' | Waves)}>
            <option value="">{t('non registrato')}</option>
            {Object.entries(WAVES_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {t(v)}
              </option>
            ))}
          </select>
        </Campo>
        <Campo etichetta={t('Visibilità')}>
          <select value={d.visibilita} onChange={(e) => set('visibilita', e.target.value)}>
            <option value="">{t('non registrata')}</option>
            {FASCE_VISIBILITA.map((f, i) => (
              <option key={f.etichetta} value={i}>
                {t(f.etichetta)}
              </option>
            ))}
          </select>
        </Campo>
        <Campo etichetta={t('Voto')} unita="1-5">
          <input
            type="number"
            min={1}
            max={5}
            value={d.rating}
            onChange={(e) => set('rating', e.target.value)}
          />
        </Campo>
      </div>
      <Campo etichetta={t('Note')}>
        <textarea rows={3} value={d.notes} onChange={(e) => set('notes', e.target.value)} />
      </Campo>

      {/* --- che cosa succede se salvo -------------------------------------- */}
      {errori.length > 0 && !esito && (
        <div className="notice notice-error" style={{ marginTop: 14 }}>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {/*
              Errori e avvisi nascono in `core/manual.ts`, in italiano: quelle
              frasi sono le chiavi, e si traducono qui dove c'è il contesto React.
            */}
            {errori.map((e) => (
              <li key={e}>{t(e)}</li>
            ))}
          </ul>
        </div>
      )}
      {anteprima && anteprima.warnings.length > 0 && (
        <div className="notice" style={{ marginTop: 14 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{t('Si può salvare lo stesso, ma:')}</div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {anteprima.warnings.map((w) => (
              <li key={w}>{t(w)}</li>
            ))}
          </ul>
        </div>
      )}
      {giaPresente && (
        <div className="notice" style={{ marginTop: 14 }}>
          {t(
            "C'è già un'immersione con questo orario, profondità e durata. Salvando, i tuoi dati riempiono i campi vuoti di quella.",
          )}
        </div>
      )}

      {errore && (
        <div className="notice notice-error" role="alert" style={{ marginTop: 14 }}>
          {t('Salvataggio non riuscito:')} {errore}. {t('Quello che hai scritto è ancora qui.')}
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
          {salvando ? t('Salvo…') : giaPresente ? t('Unisci a quella esistente') : t('Salva immersione')}
        </button>
        <button
          onClick={() => {
            setD(vuoto());
            setEsito(null);
            setErrore(null);
          }}
        >
          {t('Svuota il modulo')}
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
  const { t } = useLingua();
  return (
    <div className="notice" role="status" style={{ marginTop: 12 }}>
      {esito.merged
        ? t('Era già in archivio: i tuoi dati hanno riempito i campi vuoti di quella.')
        : t('Immersione aggiunta.')}{' '}
      <button className="btn" style={{ marginLeft: 8 }} onClick={() => onDone(esito.id)}>
        {t('Aprila')}
      </button>
    </div>
  );
}

/**
 * Etichetta e unità sopra al campo, come nel resto dell'applicazione.
 *
 * `etichetta` arriva GIÀ TRADOTTA da chi chiama: alcune la compongono con un
 * pezzo variabile — «Ossigeno (EAN32)» — e una chiave costruita con
 * l'interpolazione non si troverebbe mai nel dizionario. `unita` sono sigle
 * (m, bar, °C) e non si traducono.
 */
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
