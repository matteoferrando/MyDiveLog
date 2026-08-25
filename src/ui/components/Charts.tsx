/**
 * Grafici.
 *
 * Costruiti in SVG a mano invece che con una libreria per tre ragioni:
 * il profilo di profondità (asse Y invertito, sovrapposizione del tetto deco)
 * nessuna libreria lo fa bene; il bundle resta leggero, che su iOS conta; e le
 * regole di stile (tratti sottili, spaziature, etichette selettive) si applicano
 * una volta qui invece di combattere i default di qualcun altro.
 *
 * Regole rispettate in tutti i grafici:
 *  - un solo asse Y per grafico, sempre. Due misure con scale diverse = due
 *    grafici affiancati, mai due scale sullo stesso disegno.
 *  - etichette selettive: il valore compare sull'estremo o sul massimo, non su
 *    ogni punto.
 *  - tooltip al passaggio del mouse su ogni grafico, non come extra.
 *  - griglia e assi in tono recessivo; il dato è l'unica cosa che urla.
 *  - il colore non è mai l'unico canale: legenda o etichette dirette sempre
 *    presenti quando ci sono due o più serie.
 *  - **ogni disegno si può anche leggere.** Un SVG senza nome accessibile è, per
 *    chi usa uno screen reader, un buco nella pagina: metà di questa applicazione
 *    sono grafici, e senza nome e descrizione quella metà semplicemente non
 *    esiste. Quindi ogni grafico porta `role="img"`, un `aria-label` che dice CHE
 *    COSA mostra, e una descrizione CALCOLATA dai dati veri — mai una frase
 *    scritta a mano, che il giorno dopo descrive un grafico diverso da quello
 *    disegnato. Dove la tabella è corta, accanto al disegno c'è anche la tabella
 *    equivalente, invisibile ma leggibile.
 */

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
// Il coefficiente di Pearson è già scritto e già testato in `analysis`: riscriverlo
// qui darebbe due implementazioni che possono divergere, e la descrizione a voce
// direbbe un numero diverso da quello stampato accanto al grafico.
import { correlation } from '../../core/analysis/aggregate';
import { localeCorrente } from '../../core/locale';
import { useLingua } from '../lingua';
import { imm, plural, type Traduci } from '../format';

/**
 * Il ripiego quando chi chiama non passa una traduzione.
 *
 * Le funzioni di riassunto sono pure ed esportate: le usano i test e — in
 * futuro — le esportazioni, dove non esiste nessun contesto React da cui tirare
 * fuori `t`. Restituire la chiave italiana è esattamente ciò che fa `t()` su una
 * frase non tradotta, quindi il ripiego non è un caso speciale.
 */
const comeSta: Traduci = (s) => s;

// ---------------------------------------------------------------------------
// Misura del contenitore: serve per disegnare in pixel reali invece di
// deformare i tratti con preserveAspectRatio.
// ---------------------------------------------------------------------------

/**
 * Larghezza reale del contenitore.
 *
 * `ref` è una FUNZIONE, non un oggetto, e non è un dettaglio stilistico: era un
 * bug vero. Con `useRef` più un effetto a dipendenze vuote, un componente che al
 * primo render NON monta il contenitore — il profilo di un'immersione i cui
 * campioni non sono ancora stati caricati mostra una frase e nient'altro — non
 * aveva niente da misurare, l'effetto usciva subito, e quando poi il contenitore
 * compariva l'effetto non veniva più eseguito. Risultato: il grafico restava
 * disegnato alla larghezza predefinita di 640 px dentro una carta larga il doppio,
 * disallineato rispetto ai grafici sotto, che invece si erano montati subito.
 *
 * Con un ref di callback l'effetto si riesegue nel momento in cui l'elemento
 * arriva, perché l'elemento è nello stato.
 */
export function useWidth<T extends HTMLElement>() {
  const [el, setEl] = useState<T | null>(null);
  const [width, setWidth] = useState(640);

  useLayoutEffect(() => {
    if (!el) return;
    const update = () => {
      // `getBoundingClientRect` invece di `clientWidth`: dà la frazione di pixel e
      // non si perde con lo zoom della pagina.
      const measured = el.getBoundingClientRect().width || el.clientWidth;
      setWidth(Math.max(240, Math.round(measured)));
    };
    update();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update);
      return () => window.removeEventListener('resize', update);
    }
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);

  return { ref: setEl, width };
}

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------

export interface TooltipState {
  x: number;
  y: number;
  title: string;
  rows: { label: string; value: string }[];
}

/**
 * Il riquadro informativo, e come si fa comparire COL DITO.
 *
 * IL PROBLEMA. I grafici reagivano a `onMouseEnter` e `onMouseMove`, che su iOS
 * non arrivano mai: il riquadro con i numeri — cioè l'unico modo di leggere un
 * valore preciso da un grafico — semplicemente non esisteva sul telefono, e
 * nulla lo segnalava.
 *
 * COME SI RISOLVE. Gli eventi del PUNTATORE (`pointer*`) arrivano da mouse,
 * dito e pennino, quindi il codice è uno solo. Restano due differenze di
 * comportamento che vanno gestite, altrimenti col dito il riquadro lampeggia:
 *
 *  - col mouse il riquadro sparisce uscendo dall'elemento, col dito no —
 *    `pointerleave` arriva subito dopo il sollevamento, cioè mentre si sta
 *    ancora leggendo. Quindi col dito non si nasconde all'uscita: si nasconde da
 *    solo dopo qualche secondo, o al tocco successivo;
 *  - trascinare il dito su un grafico deve poter leggere i valori SENZA
 *    bloccare lo scorrimento verticale della pagina: `touch-action: pan-y` sul
 *    grafico dà entrambe le cose.
 */
const TEMPO_RIQUADRO_MS = 3500;

export function useTooltip() {
  const [tip, setTip] = useState<TooltipState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Il timer va spento smontando: un `setTip` su un componente smontato è un
  // avviso in console, e su una pagina che cambia scheda succede sempre.
  useEffect(() => () => clearTimeout(timer.current), []);

  const mostra = (stato: TooltipState, tocco: boolean) => {
    clearTimeout(timer.current);
    setTip(stato);
    if (tocco) timer.current = setTimeout(() => setTip(null), TEMPO_RIQUADRO_MS);
  };
  const nascondi = (tocco: boolean) => {
    if (tocco) return; // col dito lo chiude il timer, non l'uscita
    clearTimeout(timer.current);
    setTip(null);
  };
  /*
   * SCORRERE LA PAGINA NON DEVE APRIRE NIENTE.
   *
   * `pointercancel` è il momento in cui iOS decide che quel dito non sta
   * toccando un elemento ma sta scorrendo la pagina, e da lì in poi non
   * arriverà nessun altro evento su questo elemento. Senza gestirlo, scorrere
   * le statistiche con il dito che passa sopra una barra lasciava il riquadro
   * aperto per tre secondi e mezzo, sopra il grafico, senza che nessuno lo
   * avesse chiesto: dal punto di vista di chi guarda, una scritta comparsa da
   * sola. Qui si chiude subito, e il timer si spegne.
   */
  const annulla = () => {
    clearTimeout(timer.current);
    setTip(null);
  };

  /**
   * Da spargere sull'elemento sensibile: sostituisce `onMouseEnter`/`onMouseLeave`.
   *
   * `pointerenter` apre il riquadro SOLO col mouse. Col dito l'ingresso in un
   * elemento avviene anche mentre si scorre — il dito attraversa mezza pagina —
   * e aprire lì è esattamente il difetto descritto sopra. Col dito serve un
   * `pointerdown`, cioè un tocco deliberato.
   */
  const perElemento = (costruisci: () => TooltipState) => ({
    onPointerEnter: (e: React.PointerEvent) => {
      if (e.pointerType !== 'touch') mostra(costruisci(), false);
    },
    onPointerDown: (e: React.PointerEvent) => mostra(costruisci(), e.pointerType === 'touch'),
    onPointerLeave: (e: React.PointerEvent) => nascondi(e.pointerType === 'touch'),
    onPointerCancel: annulla,
  });

  /** Per i grafici che seguono il puntatore lungo l'asse invece di avere zone. */
  const perScorrimento = (costruisci: (e: React.PointerEvent) => TooltipState) => ({
    onPointerMove: (e: React.PointerEvent) => mostra(costruisci(e), e.pointerType === 'touch'),
    onPointerDown: (e: React.PointerEvent) => mostra(costruisci(e), e.pointerType === 'touch'),
    onPointerLeave: (e: React.PointerEvent) => nascondi(e.pointerType === 'touch'),
    onPointerCancel: annulla,
  });

  return { tip, setTip, perElemento, perScorrimento };
}

export function Tooltip({ state, containerWidth }: { state: TooltipState | null; containerWidth: number }) {
  if (!state) return null;
  // Evita che il riquadro esca dal bordo: sopra 80% della larghezza si ancora a destra.
  const clampedX = Math.min(Math.max(state.x, 70), containerWidth - 70);
  return (
    <div className="tooltip" style={{ left: clampedX, top: Math.max(state.y - 8, 34) }}>
      <b>{state.title}</b>
      {state.rows.map((r) => (
        <div className="tooltip-row" key={r.label}>
          <span className="muted">{r.label}</span>
          <span>{r.value}</span>
        </div>
      ))}
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string; kind?: 'line' | 'area' }[] }) {
  return (
    <div className="chart-legend">
      {items.map((i) => (
        <span key={i.label}>
          <span
            className="legend-key"
            style={{
              background: i.color,
              height: i.kind === 'area' ? 10 : 3,
              opacity: i.kind === 'area' ? 0.35 : 1,
            }}
          />
          {i.label}
        </span>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Accessibilità: lo stesso grafico, letto invece che guardato
// ---------------------------------------------------------------------------

/**
 * Nascosto agli occhi, non agli screen reader.
 *
 * `display:none` e `visibility:hidden` tolgono l'elemento anche dall'albero di
 * accessibilità: chi legge con la voce si ritrova esattamente al punto di prima,
 * cioè senza niente. La ritagliatura a un pixel invece lascia l'elemento nel
 * documento e nell'albero, e lo toglie solo dal disegno — è il trucco con cui si
 * mette una tabella accanto a un grafico senza raddoppiare la pagina.
 *
 * Sta qui come oggetto di stile in linea e non come regola in `styles.css`
 * perché così viaggia con il componente che la usa: una classe che vive in un
 * altro file si può cancellare per sbaglio durante una ripulitura del CSS, e il
 * risultato sarebbe una tabella di duecento numeri che ricompare in mezzo alla
 * scheda. La classe `.solo-lettori` resta sull'elemento come appiglio per chi
 * volesse un giorno spostare la regola nel foglio di stile.
 */
export const STILE_SOLO_LETTORI: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
};

/**
 * La tabella equivalente al disegno.
 *
 * Il riassunto in una frase dice la forma; questa dice i numeri. Serve dove le
 * righe sono poche e ognuna è una risposta — le colonne di un istogramma, le
 * barre dei siti, i quartili di una dispersione: lì l'elenco completo è ciò che
 * un vedente ottiene guardando, e negarlo sarebbe dare meno, non di più.
 *
 * NON va messa sui profili campionati: duemila righe lette a voce non sono una
 * tabella, sono una punizione. Lì il riassunto è tutto ciò che serve.
 */
export function TabellaEquivalente({
  didascalia,
  intestazioni,
  righe,
}: {
  didascalia: string;
  intestazioni: string[];
  righe: (string | number)[][];
}) {
  if (righe.length === 0) return null;
  return (
    <div className="solo-lettori" style={STILE_SOLO_LETTORI}>
      <table>
        <caption>{didascalia}</caption>
        <thead>
          <tr>
            {intestazioni.map((h) => (
              <th key={h} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {righe.map((r, i) => (
            <tr key={`${r[0]}-${i}`}>
              {r.map((c, j) => (
                <td key={j}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Il testo che annuncia il valore sotto il cursore mosso da tastiera.
 *
 * `role="status"` e non `aria-live="assertive"`: muovendosi con la freccia si
 * generano dieci annunci al secondo, e la modalità assertiva interromperebbe sé
 * stessa a ogni tasto lasciando sentire solo l'ultimo pezzo di ogni frase. Con
 * la modalità cortese lo screen reader aspetta la pausa e legge una frase
 * intera, che è l'unica utile.
 */
export function AnnuncioCursore({ testo }: { testo: string }) {
  return (
    <div className="solo-lettori" style={STILE_SOLO_LETTORI} role="status" aria-live="polite">
      {testo}
    </div>
  );
}

/**
 * Il contorno del fuoco, in linea.
 *
 * Un contenitore che si può raggiungere con il tabulatore e non mostra dove si
 * trova il fuoco è peggio di uno non raggiungibile: chi naviga da tastiera senza
 * screen reader si perde. Il contorno è in linea perché `styles.css` non ha —
 * oggi — nessuna regola di fuoco su cui appoggiarsi.
 */
export const contornoFuoco = (attivo: boolean): CSSProperties =>
  attivo ? { outline: '2px solid var(--series-1)', outlineOffset: 2 } : {};

// ---------------------------------------------------------------------------
// Riassunti: che cosa dice il disegno, in una frase
// ---------------------------------------------------------------------------

/**
 * Perché queste funzioni sono pure, esportate e fuori dai componenti.
 *
 * Perché la descrizione di un grafico è un'affermazione sui dati, e le
 * affermazioni sui dati vanno verificate. Scritta a mano dentro il JSX —
 * «andamento del consumo, in miglioramento» — resterebbe lì per sempre, vera il
 * giorno in cui è stata scritta e falsa alla prima importazione successiva:
 * l'errore peggiore possibile, perché chi la sente non ha modo di accorgersene.
 * Calcolata dai punti che vengono disegnati, invece, non può divergere dal
 * disegno; ed essendo una funzione pura, il test le passa dei numeri e controlla
 * la frase senza montare mezza applicazione.
 */

/** Interi senza decimali, il resto con uno: «12» e «17.4», mai «12.0». */
export function numeroBreve(v: number): string {
  const r = Math.round(v * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

export interface Quartili {
  min: number;
  q1: number;
  mediana: number;
  q3: number;
  max: number;
}

/**
 * Quartili con interpolazione lineare (lo stesso metodo dei fogli di calcolo).
 *
 * Servono nella tabella equivalente delle dispersioni: minimo e massimo da soli
 * descrivono le code e nascondono dove sta il grosso dei punti, che su una nuvola
 * è proprio ciò che si vede a colpo d'occhio e che a voce andrebbe altrimenti
 * perso.
 */
export function quartili(valori: number[]): Quartili | undefined {
  const v = valori.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return undefined;
  const a = (p: number) => {
    const pos = p * (v.length - 1);
    const basso = Math.floor(pos);
    const alto = Math.ceil(pos);
    return v[basso] + (v[alto] - v[basso]) * (pos - basso);
  };
  return { min: v[0], q1: a(0.25), mediana: a(0.5), q3: a(0.75), max: v[v.length - 1] };
}

/** Media aritmetica; `undefined` su un elenco vuoto, che è diverso da zero. */
export function media(valori: number[]): number | undefined {
  if (valori.length === 0) return undefined;
  return valori.reduce((a, b) => a + b, 0) / valori.length;
}

/**
 * Verso di una tendenza, con una zona morta.
 *
 * Senza la zona morta qualunque rumore diventa «in aumento»: due decimali di
 * differenza su una serie che oscilla di dieci sono niente, e annunciarli come
 * una direzione sarebbe raccontare a chi non vede il grafico una cosa che chi lo
 * vede non ci legge. La soglia è il 5% dell'escursione della serie stessa,
 * perché una soglia assoluta non può valere sia per i bar che per i m/min.
 */
export function versoTendenza(
  prima: number,
  dopo: number,
  escursione: number,
): 'aumento' | 'diminuzione' | 'stabile' {
  const soglia = Math.abs(escursione) * 0.05;
  if (Math.abs(dopo - prima) <= soglia) return 'stabile';
  return dopo > prima ? 'aumento' : 'diminuzione';
}

/**
 * Data estesa nella lingua scelta: «12 luglio 2026», «12 July 2026».
 *
 * Il locale viene dal registro (`core/locale.ts`) e non da `useLingua()` perché
 * questa non è una funzione di componente: la chiamano anche i riassunti
 * testuali dei grafici, che girano fuori da qualunque render.
 */
export const dataLunga = (ms: number) =>
  new Date(ms).toLocaleDateString(localeCorrente(), { day: 'numeric', month: 'long', year: 'numeric' });

/**
 * Riassunto di un istogramma o di un elenco di barre.
 *
 * Dice il totale, dove sta il picco e dove sta il buco: sono le tre cose che un
 * vedente ricava dalla forma in mezzo secondo. Le colonne a zero sono nominate a
 * parte perché in questo archivio significano qualcosa — un mese senza
 * immersioni è un'informazione, non un dato mancante.
 */
export function riassuntoDistribuzione(
  dati: ColumnDatum[],
  { unita = '', elemento = 'colonne' }: { unita?: string; elemento?: string } = {},
  t: Traduci = comeSta,
): string {
  if (dati.length === 0) return t('Nessun dato da mostrare.');
  const valori = dati.map((d) => d.value);
  const totale = valori.reduce((a, b) => a + b, 0);
  const alto = dati.reduce((a, b) => (b.value > a.value ? b : a));
  const basso = dati.reduce((a, b) => (b.value < a.value ? b : a));
  // `unita` NON passa da `t()`: è un'unità di misura (`L/min`, `m`) o un
  // sostantivo che sceglie chi disegna il grafico, e chi lo sceglie lo traduce
  // a casa sua. `elemento` sì: le due sole parole possibili — «colonne» e
  // «voci» — sono scritte qui sotto e stanno nel dizionario.
  const u = unita ? ` ${unita}` : '';
  const parti = [
    `${dati.length} ${t(elemento)}, ${t('totale')} ${numeroBreve(totale)}${u}, ${t('media')} ${numeroBreve(totale / dati.length)}${u}.`,
    `${t('Massimo')} ${alto.label} ${t('con')} ${numeroBreve(alto.value)}${u}, ${t('minimo')} ${basso.label} ${t('con')} ${numeroBreve(basso.value)}${u}.`,
  ];
  // «A zero: 2 su 24» e non «2 colonne a zero»: la forma con il denominatore si
  // accorda con qualunque parola passata in `elemento` e dice anche quanto pesa.
  const vuote = valori.filter((v) => v === 0).length;
  if (vuote > 0) parti.push(`${t('A zero')}: ${vuote} ${t('su')} ${dati.length}.`);
  return parti.join(' ');
}

/**
 * Riassunto di una serie temporale.
 *
 * L'ordine delle informazioni non è casuale: prima quante misure e su quale arco
 * di tempo (senza le quali i numeri seguenti non si sanno pesare), poi il valore
 * tipico e l'escursione, poi la direzione. È l'ordine in cui le legge chi guarda
 * il grafico, e chi ascolta non deve tenere a mente niente per capire la frase
 * dopo.
 */
export function riassuntoSerie(
  punti: TimePoint[],
  {
    unita,
    formato = (v: number) => v.toFixed(1),
    riferimento,
    etichettaRiferimento,
  }: {
    unita: string;
    formato?: (v: number) => string;
    riferimento?: number;
    etichettaRiferimento?: string;
  },
  t: Traduci = comeSta,
): string {
  if (punti.length === 0) return t('Nessun dato disponibile per questa serie.');
  const ordinati = [...punti].sort((a, b) => a.at - b.at);
  const valori = ordinati.map((p) => p.value);
  const q = quartili(valori)!;
  const ultimo = ordinati[ordinati.length - 1];
  const parti = [
    `${plural(punti.length, 'rilevazione', 'rilevazioni', t)} ${t('dal')} ${dataLunga(ordinati[0].at)} ${t('al')} ${dataLunga(ultimo.at)}.`,
    `${t('Mediana')} ${formato(q.mediana)} ${unita}, ${t('da')} ${formato(q.min)} ${t('a')} ${formato(q.max)}; ${t('ultimo valore')} ${formato(ultimo.value)}.`,
  ];
  // Le due metà invece della retta dei minimi quadrati: la pendenza di una retta
  // in unità al millisecondo non si può dire a voce, «prima 18.5, poi 15.9» sì.
  const metà = Math.floor(ordinati.length / 2);
  if (metà >= 2) {
    const prima = media(valori.slice(0, metà))!;
    const dopo = media(valori.slice(valori.length - metà))!;
    const verso = versoTendenza(prima, dopo, q.max - q.min);
    parti.push(
      `${t('Prima metà')} ${formato(prima)}, ${t('seconda metà')} ${formato(dopo)}: ` +
        (verso === 'stabile' ? t('stabile') : verso === 'aumento' ? t('in aumento') : t('in diminuzione')) +
        '.',
    );
  }
  if (riferimento !== undefined) {
    const sopra = valori.filter((v) => v > riferimento).length;
    // `etichettaRiferimento` arriva già tradotta da chi disegna il grafico: è
    // una sua etichetta, non una frase di questo modulo.
    const nome = etichettaRiferimento ?? `${t('riferimento')} ${formato(riferimento)}`;
    parti.push(`${sopra} ${t('su')} ${valori.length} ${t('sopra')} ${nome}.`);
  }
  return parti.join(' ');
}

/**
 * Una serie temporale ridotta a righe che si possono ascoltare.
 *
 * Un archivio serio ha centinaia di immersioni: la tabella equivalente punto per
 * punto sarebbe tecnicamente completa e praticamente inservibile — nessuno
 * ascolta trecento date. Raggruppando per mese si ottiene la stessa cosa che
 * l'occhio prende dalla curva (dove sale, dove scende, dove non c'è niente); e
 * quando anche i mesi diventano troppi si sale di un livello, agli anni, invece
 * di troncare l'elenco: un elenco troncato mente sulla fine della serie, che è
 * proprio la parte che interessa.
 */
export function aggregaPerPeriodo(
  punti: TimePoint[],
  { maxPeriodi = 24 }: { maxPeriodi?: number } = {},
): { periodo: string; conteggio: number; mediana: number }[] {
  if (punti.length === 0) return [];
  const perMese = raggruppa(punti, (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  const scelto = perMese.length <= maxPeriodi ? perMese : raggruppa(punti, (d) => String(d.getFullYear()));
  return scelto;
}

function raggruppa(
  punti: TimePoint[],
  chiave: (d: Date) => string,
): { periodo: string; conteggio: number; mediana: number }[] {
  const mappa = new Map<string, number[]>();
  for (const p of punti) {
    const k = chiave(new Date(p.at));
    const lista = mappa.get(k);
    if (lista) lista.push(p.value);
    else mappa.set(k, [p.value]);
  }
  return [...mappa.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([periodo, valori]) => ({
      periodo,
      conteggio: valori.length,
      mediana: quartili(valori)!.mediana,
    }));
}

/**
 * Riassunto di una nuvola di punti.
 *
 * La correlazione è l'unica cosa che qui vale la pena dire per prima, ed è anche
 * l'unica che chi guarda non legge con precisione: a occhio si distingue «salgono
 * insieme» da «niente», non un 0.31 da un 0.62. Resta dichiarata per quello che
 * è, una correlazione su questo archivio — la stessa cautela che sta scritta
 * nella scheda per chi legge con gli occhi.
 */
export function riassuntoDispersione(
  punti: { x: number; y: number }[],
  {
    xLabel,
    yLabel,
    xFormat = (v: number) => v.toFixed(0),
    yFormat = (v: number) => v.toFixed(1),
  }: {
    xLabel: string;
    yLabel: string;
    xFormat?: (v: number) => string;
    yFormat?: (v: number) => string;
  },
  t: Traduci = comeSta,
): string {
  if (punti.length === 0) return t('Nessun punto da confrontare.');
  const qx = quartili(punti.map((p) => p.x))!;
  const qy = quartili(punti.map((p) => p.y))!;
  // `xLabel` e `yLabel` sono etichette d'asse scelte da chi disegna il grafico:
  // arrivano già nella lingua giusta e non vanno tradotte una seconda volta.
  const parti = [
    `${imm(punti.length, t)}.`,
    `${t('In orizzontale')} ${xLabel} ${t('da')} ${xFormat(qx.min)} ${t('a')} ${xFormat(qx.max)}, ${t('metà dei punti fra')} ${xFormat(qx.q1)} ${t('e')} ${xFormat(qx.q3)}.`,
    `${t('In verticale')} ${yLabel} ${t('da')} ${yFormat(qy.min)} ${t('a')} ${yFormat(qy.max)}, ${t('metà dei punti fra')} ${yFormat(qy.q1)} ${t('e')} ${yFormat(qy.q3)}.`,
  ];
  const r = correlation(punti);
  if (r === undefined) {
    parti.push(t('Correlazione non calcolabile su così pochi punti.'));
  } else {
    const forza = Math.abs(r) >= 0.7 ? t('forte') : Math.abs(r) >= 0.4 ? t('moderata') : t('debole');
    parti.push(
      `${t('Correlazione')} ${r > 0 ? '+' : ''}${r.toFixed(2)}, ${forza}: ${t('al crescere di')} ${xLabel} ${yLabel} ` +
        (r > 0 ? t('tende a crescere') : t('tende a calare')) +
        '.',
    );
  }
  return parti.join(' ');
}

/**
 * Riassunto di una curva su asse X numerico.
 *
 * Di una curva conta la PENDENZA, non i punti: «da 24 minuti a 30 m si scende a
 * 9 minuti a 45 m» è tutto ciò che il grafico dice, e dirlo con gli estremi e il
 * punto marcato è più fedele che elencare quaranta coppie di numeri.
 */
export function riassuntoCurva(
  punti: { x: number; y: number }[],
  {
    xLabel,
    yLabel,
    xFormat = (v: number) => v.toFixed(0),
    yFormat = (v: number) => v.toFixed(0),
    marcatore,
  }: {
    xLabel: string;
    yLabel: string;
    xFormat?: (v: number) => string;
    yFormat?: (v: number) => string;
    marcatore?: { x: number; y: number };
  },
  t: Traduci = comeSta,
): string {
  if (punti.length < 2) return t('Dati insufficienti per disegnare la curva.');
  const ordinati = [...punti].sort((a, b) => a.x - b.x);
  const primo = ordinati[0];
  const ultimo = ordinati[ordinati.length - 1];
  const ys = ordinati.map((p) => p.y);
  const q = quartili(ys)!;
  const verso = versoTendenza(primo.y, ultimo.y, q.max - q.min);
  const parti = [
    `${yLabel} ${t('al variare di')} ${xLabel}, ${t('da')} ${xFormat(primo.x)} ${t('a')} ${xFormat(ultimo.x)}.`,
    `${t('Si va da')} ${yFormat(primo.y)} ${t('a')} ${yFormat(ultimo.y)} ` +
      `(${verso === 'stabile' ? t('curva piatta') : verso === 'aumento' ? t('in aumento') : t('in diminuzione')}).`,
    `${t('Minimo')} ${yFormat(q.min)}, ${t('massimo')} ${yFormat(q.max)}.`,
  ];
  if (marcatore) parti.push(`${t('Nel punto marcato')}, ${xFormat(marcatore.x)}: ${yFormat(marcatore.y)}.`);
  return parti.join(' ');
}

// ---------------------------------------------------------------------------
// Tessere numeriche
// ---------------------------------------------------------------------------

export function StatTile({
  label,
  value,
  note,
  children,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="tile">
      <div className="tile-label">{label}</div>
      <div className="tile-value">{value}</div>
      {note && <div className="tile-note">{note}</div>}
      {children}
    </div>
  );
}

export function Meter({ value, max = 1 }: { value: number; max?: number }) {
  const pct = Math.max(0, Math.min(1, value / max));
  const color = pct >= 0.85 ? 'var(--good)' : pct >= 0.5 ? 'var(--warning)' : 'var(--serious)';
  return (
    <div
      className="meter"
      role="progressbar"
      aria-valuenow={Math.round(pct * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div style={{ width: `${pct * 100}%`, background: color }} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Istogramma a colonne
// ---------------------------------------------------------------------------

export interface ColumnDatum {
  key: string;
  label: string;
  value: number;
}

export function ColumnChart({
  data,
  height = 160,
  unit = '',
  /** Mostra un'etichetta ogni N colonne, per non affollare l'asse. */
  labelEvery,
  titolo,
}: {
  data: ColumnDatum[];
  height?: number;
  unit?: string;
  /** Se omesso, il passo delle etichette si adatta alla larghezza disponibile. */
  labelEvery?: number;
  /**
   * Nome accessibile del grafico. È opzionale e non obbligatorio di proposito:
   * ogni istogramma di questa applicazione sta già dentro una carta con il suo
   * titolo visibile, e rendere la proprietà obbligatoria avrebbe significato
   * toccare tutte le pagine per ripetere una parola che c'è già. Quando la carta
   * non basta a capire di cosa si tratta, si passa qui.
   */
  titolo?: string;
}) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const { tip, perElemento } = useTooltip();
  const { t } = useLingua();
  const uid = useId();

  const pad = { top: 24, right: 4, bottom: 22, left: 30 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const max = Math.max(1, ...data.map((d) => d.value));
  const ticks = niceTicks(0, max, 3);
  const yMax = ticks[ticks.length - 1];
  const band = data.length ? plotW / data.length : plotW;
  // Marca sottile: mai più di 24px e mai tutta la banda, il resto è aria.
  const barW = Math.max(3, Math.min(24, band - Math.max(2, band * 0.3)));
  const peak = data.reduce((a, b) => (b.value > a.value ? b : a), data[0]);
  // Un'etichetta ogni quanto: serve almeno ~46px per non farle collidere.
  const labelStep = labelEvery ?? Math.max(1, Math.ceil(46 / Math.max(1, band)));

  const nome = titolo ?? `${t('Istogramma a colonne')}${unit ? ` — ${unit}` : ''}`;
  const descrizione = riassuntoDistribuzione(data, { unita: unit }, t);

  return (
    <div className="chart" ref={ref}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={nome}
        aria-describedby={`${uid}-desc`}
      >
        <title>{nome}</title>
        <desc id={`${uid}-desc`}>{descrizione}</desc>
        {/* `tacca` e non `t`: `t` qui è la funzione che traduce, e un parametro
            con lo stesso nome la coprirebbe dentro tutto il blocco. */}
        {ticks.map((tacca) => {
          const y = pad.top + plotH - (tacca / yMax) * plotH;
          return (
            // La griglia è arredamento: senza `aria-hidden` uno screen reader
            // annuncia una lista di nodi vuoti lunga quanto le tacche, prima ancora
            // di arrivare al dato.
            <g key={tacca} aria-hidden="true">
              <line x1={pad.left} x2={width - pad.right} y1={y} y2={y} stroke="var(--grid)" strokeWidth={1} />
              <text className="axis-label" x={pad.left - 6} y={y + 3} textAnchor="end">
                {tacca}
              </text>
            </g>
          );
        })}
        {data.map((d, i) => {
          const h = (d.value / yMax) * plotH;
          const x = pad.left + i * band + (band - barW) / 2;
          const y = pad.top + plotH - h;
          return (
            <g key={d.key} aria-hidden="true">
              {/* Bersaglio di hover più grande della marca. */}
              <rect
                x={pad.left + i * band}
                y={pad.top}
                width={band}
                height={plotH}
                fill="transparent"
                {...perElemento(() => ({
                  x: x + barW / 2,
                  y: Math.max(y, pad.top + 10),
                  title: d.label,
                  rows: [{ label: unit || t('valore'), value: String(d.value) }],
                }))}
              />
              {d.value > 0 && <path d={roundedTopBar(x, y, barW, h, 4)} fill="var(--series-1)" />}
              {i % labelStep === 0 && (
                <text
                  className="axis-label"
                  x={pad.left + i * band + band / 2}
                  y={height - 6}
                  textAnchor="middle"
                >
                  {d.label}
                </text>
              )}
            </g>
          );
        })}
        {/* Etichetta diretta solo sul massimo: il resto lo legge l'asse. */}
        {peak && peak.value > 0 && (
          <text
            aria-hidden="true"
            x={pad.left + data.indexOf(peak) * band + band / 2}
            y={pad.top + plotH - (peak.value / yMax) * plotH - 5}
            textAnchor="middle"
            fontSize={10}
            fontWeight={650}
            fill="var(--text-secondary)"
          >
            {peak.value}
          </text>
        )}
        <line
          aria-hidden="true"
          x1={pad.left}
          x2={width - pad.right}
          y1={pad.top + plotH}
          y2={pad.top + plotH}
          stroke="var(--axis)"
          strokeWidth={1}
        />
      </svg>
      {/* Le colonne sono poche e ognuna è una risposta: qui la tabella completa
          vale più del riassunto, ed è corta abbastanza da poterla ascoltare. */}
      <TabellaEquivalente
        didascalia={nome}
        intestazioni={[t('Colonna'), unit || t('Valore')]}
        righe={data.map((d) => [d.label, numeroBreve(d.value)])}
      />
      <Tooltip state={tip} containerWidth={width} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Barre orizzontali (siti, fasce di profondità)
// ---------------------------------------------------------------------------

export function BarChart({
  data,
  unit = '',
  maxRows = 10,
  titolo,
}: {
  data: ColumnDatum[];
  unit?: string;
  maxRows?: number;
  titolo?: string;
}) {
  const rows = data.slice(0, maxRows);
  const max = Math.max(1, ...rows.map((d) => d.value));
  const { ref, width } = useWidth<HTMLDivElement>();
  const { tip, perElemento } = useTooltip();
  const { t } = useLingua();
  const uid = useId();

  const labelW = Math.min(160, Math.max(70, width * 0.32));
  const valueW = 40;
  const trackW = Math.max(20, width - labelW - valueW - 12);
  const rowH = 26;
  const barH = 14;

  const nome = titolo ?? `${t('Barre orizzontali')}${unit ? ` — ${unit}` : ''}`;
  // Il riassunto descrive le righe DISEGNATE, non tutte quelle ricevute: se
  // `maxRows` ne taglia via metà, dire il totale di tutte racconterebbe un grafico
  // che non è quello sullo schermo. Il taglio viene dichiarato a parte.
  const descrizione =
    riassuntoDistribuzione(rows, { unita: unit, elemento: 'voci' }, t) +
    (data.length > rows.length
      ? ` ${t('Mostrate le prime')} ${rows.length} ${t('voci su')} ${data.length}.`
      : '');

  return (
    <div className="chart" ref={ref}>
      <svg
        width={width}
        height={rows.length * rowH + 4}
        viewBox={`0 0 ${width} ${rows.length * rowH + 4}`}
        role="img"
        aria-label={nome}
        aria-describedby={`${uid}-desc`}
      >
        <title>{nome}</title>
        <desc id={`${uid}-desc`}>{descrizione}</desc>
        {rows.map((d, i) => {
          const y = i * rowH + 4;
          const w = (d.value / max) * trackW;
          return (
            <g
              key={d.key}
              aria-hidden="true"
              {...perElemento(() => ({
                x: labelW + w,
                y: y + barH,
                title: d.label,
                rows: [{ label: unit || t('valore'), value: String(d.value) }],
              }))}
            >
              <rect x={0} y={y - 3} width={width} height={rowH - 2} fill="transparent" />
              <text x={0} y={y + barH - 2} fontSize={12} fill="var(--text-secondary)">
                {truncate(d.label, Math.floor(labelW / 6.6))}
              </text>
              <path d={roundedRightBar(labelW, y, Math.max(2, w), barH, 4)} fill="var(--series-1)" />
              <text
                x={labelW + Math.max(2, w) + 7}
                y={y + barH - 2}
                fontSize={12}
                fontWeight={600}
                fill="var(--text-secondary)"
                className="tabular"
              >
                {d.value}
              </text>
            </g>
          );
        })}
      </svg>
      {/* Le etichette qui sono TRONCATE nel disegno per stare nella colonna: la
          tabella porta il nome intero del sito, che è proprio il dato che un
          troncamento a metà parola rende inservibile. */}
      <TabellaEquivalente
        didascalia={nome}
        intestazioni={[t('Voce'), unit || t('Valore')]}
        righe={rows.map((d) => [d.label, numeroBreve(d.value)])}
      />
      <Tooltip state={tip} containerWidth={width} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Serie temporale con punti
// ---------------------------------------------------------------------------

export interface TimePoint {
  at: number;
  value: number;
  id?: string;
}

export function TimeSeriesChart({
  points,
  height = 180,
  unit,
  /** Linea di riferimento orizzontale, es. l'obiettivo. */
  reference,
  referenceLabel,
  format = (v: number) => v.toFixed(1),
  onPick,
  titolo,
}: {
  points: TimePoint[];
  height?: number;
  unit: string;
  reference?: number;
  referenceLabel?: string;
  format?: (v: number) => string;
  onPick?: (id: string) => void;
  titolo?: string;
}) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const { tip, perElemento } = useTooltip();
  const { t } = useLingua();
  // `useId` PRIMA del return anticipato qui sotto, e non è pignoleria: React conta
  // gli hook a ogni render, e una serie che al primo giro è vuota e al secondo no
  // cambierebbe il conteggio facendo cadere il componente. È lo stesso incidente
  // documentato in `DepthProfile`, e questo è il punto in cui si ripeterebbe.
  const uid = useId();

  if (points.length === 0) {
    return (
      <p className="muted" style={{ fontSize: 12, margin: 0 }}>
        {t('Nessun dato disponibile per questa serie.')}
      </p>
    );
  }

  const pad = { top: 16, right: 44, bottom: 22, left: 36 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const xs = points.map((p) => p.at);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const spanX = maxX - minX || 1;
  const values = points.map((p) => p.value);
  const lo = Math.min(...values, reference ?? Infinity);
  const hi = Math.max(...values, reference ?? -Infinity);
  const ticks = niceTicks(Math.max(0, lo - (hi - lo) * 0.15), hi + (hi - lo) * 0.15 || hi + 1, 3);
  const yLo = ticks[0];
  const yHi = ticks[ticks.length - 1];

  const px = (at: number) => pad.left + ((at - minX) / spanX) * plotW;
  const py = (v: number) => pad.top + plotH - ((v - yLo) / (yHi - yLo || 1)) * plotH;

  const path = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${px(p.at).toFixed(1)} ${py(p.value).toFixed(1)}`)
    .join(' ');
  const last = points[points.length - 1];
  // Oltre ~24 punti i pallini si toccano e la linea sembra tratteggiata: li
  // nascondiamo, ma il bersaglio invisibile per il tooltip resta su ognuno.
  const showDots = points.length <= 24;

  const nome = titolo ?? `${t('Andamento nel tempo')} — ${unit}`;
  const descrizione = riassuntoSerie(
    points,
    {
      unita: unit,
      formato: format,
      riferimento: reference,
      etichettaRiferimento: referenceLabel,
    },
    t,
  );
  const periodi = aggregaPerPeriodo(points);

  return (
    <div className="chart" ref={ref}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={nome}
        aria-describedby={`${uid}-desc`}
      >
        <title>{nome}</title>
        <desc id={`${uid}-desc`}>{descrizione}</desc>
        {/* `tacca` e non `t`: il nome `t` è preso dalla funzione che traduce. */}
        {ticks.map((tacca) => (
          <g key={tacca} aria-hidden="true">
            <line
              x1={pad.left}
              x2={width - pad.right}
              y1={py(tacca)}
              y2={py(tacca)}
              stroke="var(--grid)"
              strokeWidth={1}
            />
            <text className="axis-label" x={pad.left - 6} y={py(tacca) + 3} textAnchor="end">
              {format(tacca)}
            </text>
          </g>
        ))}

        {reference !== undefined && (
          <g aria-hidden="true">
            <line
              x1={pad.left}
              x2={width - pad.right}
              y1={py(reference)}
              y2={py(reference)}
              stroke="var(--series-2)"
              strokeWidth={2}
              strokeDasharray="0"
              opacity={0.5}
            />
            {referenceLabel && (
              <text x={width - pad.right + 4} y={py(reference) + 3} fontSize={10} fill="var(--text-muted)">
                {referenceLabel}
              </text>
            )}
          </g>
        )}

        <path
          aria-hidden="true"
          d={path}
          fill="none"
          stroke="var(--series-1)"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {points.map((p) => (
          <g key={`${p.at}-${p.value}`} aria-hidden="true">
            {showDots && (
              <circle
                cx={px(p.at)}
                cy={py(p.value)}
                r={4}
                fill="var(--series-1)"
                stroke="var(--surface-1)"
                strokeWidth={2}
              />
            )}
            {/* L'anello in colore superficie fa parte del bersaglio di hover. */}
            <circle
              cx={px(p.at)}
              cy={py(p.value)}
              r={11}
              fill="transparent"
              style={{ cursor: onPick && p.id ? 'pointer' : 'default' }}
              {...perElemento(() => ({
                x: px(p.at),
                y: py(p.value),
                title: new Date(p.at).toLocaleDateString(localeCorrente(), {
                  day: '2-digit',
                  month: 'short',
                  year: 'numeric',
                }),
                rows: [{ label: unit, value: format(p.value) }],
              }))}
              onClick={() => onPick && p.id && onPick(p.id)}
            />
          </g>
        ))}

        {/* Etichetta diretta solo sull'ultimo punto, con la sua marca. */}
        <g aria-hidden="true">
          <circle
            cx={px(last.at)}
            cy={py(last.value)}
            r={4}
            fill="var(--series-1)"
            stroke="var(--surface-1)"
            strokeWidth={2}
          />
          <text
            x={px(last.at) + 8}
            y={py(last.value) + 4}
            fontSize={11}
            fontWeight={650}
            fill="var(--text-secondary)"
          >
            {format(last.value)}
          </text>

          <line
            x1={pad.left}
            x2={width - pad.right}
            y1={pad.top + plotH}
            y2={pad.top + plotH}
            stroke="var(--axis)"
            strokeWidth={1}
          />
          <text className="axis-label" x={pad.left} y={height - 6}>
            {shortDate(minX)}
          </text>
          <text className="axis-label" x={width - pad.right} y={height - 6} textAnchor="end">
            {shortDate(maxX)}
          </text>
        </g>
      </svg>
      {/* Non un punto per riga: una serie di trecento immersioni letta a voce
          punto per punto è inutilizzabile. Raggruppata per mese — o per anno
          quando i mesi sono troppi — resta la stessa informazione che si legge
          guardando la forma della curva, e sta in venti righe. */}
      <TabellaEquivalente
        didascalia={`${nome}: ${t('valori raggruppati per periodo')}`}
        intestazioni={[t('Periodo'), t('Rilevazioni'), `${t('Mediana')} (${unit})`]}
        righe={periodi.map((p) => [p.periodo, p.conteggio, format(p.mediana)])}
      />
      <Tooltip state={tip} containerWidth={width} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Geometria e formattazione
// ---------------------------------------------------------------------------

/** Colonna con l'estremo del dato arrotondato di 4px e la base quadrata. */
export function roundedTopBar(x: number, y: number, w: number, h: number, r: number): string {
  const radius = Math.min(r, w / 2, h);
  return [
    `M${x} ${y + h}`,
    `L${x} ${y + radius}`,
    `Q${x} ${y} ${x + radius} ${y}`,
    `L${x + w - radius} ${y}`,
    `Q${x + w} ${y} ${x + w} ${y + radius}`,
    `L${x + w} ${y + h}`,
    'Z',
  ].join(' ');
}

/** Barra orizzontale con l'estremo destro arrotondato. */
export function roundedRightBar(x: number, y: number, w: number, h: number, r: number): string {
  const radius = Math.min(r, h / 2, w);
  return [
    `M${x} ${y}`,
    `L${x + w - radius} ${y}`,
    `Q${x + w} ${y} ${x + w} ${y + radius}`,
    `L${x + w} ${y + h - radius}`,
    `Q${x + w} ${y + h} ${x + w - radius} ${y + h}`,
    `L${x} ${y + h}`,
    'Z',
  ].join(' ');
}

/**
 * Tacche su numeri tondi: 0 / 5 / 10, non 0 / 4.3 / 8.6.
 *
 * L'ultima tacca DEVE essere >= `hi`: se si fermasse sotto, il valore massimo
 * cadrebbe fuori dall'area di disegno e la curva uscirebbe dal grafico. È un
 * errore silenzioso e si vede solo guardando il risultato — motivo per cui
 * `tests/charts.test.ts` lo verifica.
 */
export function niceTicks(lo: number, hi: number, count = 4): number[] {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0, 1];
  // Serie a valore costante: senza questo, `hi <= lo` faceva ripiegare su [0, 1]
  // e il punto finiva a migliaia di pixel fuori dal riquadro, con l'asse
  // etichettato 0–1 e il grafico apparentemente vuoto. Si apre un intervallo
  // attorno al valore invece di inventarne uno che non lo contiene.
  if (hi <= lo) {
    const pad = Math.max(Math.abs(hi) * 0.1, 0.5);
    lo = hi - pad;
    hi = hi + pad;
  }
  const raw = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag;
  const start = Math.floor(lo / step) * step;
  const stop = Math.ceil(hi / step) * step;
  const out: number[] = [];
  for (let v = start; v <= stop + step * 0.001; v += step) {
    out.push(Math.round(v * 1000) / 1000);
  }
  return out.length >= 2 ? out : [lo, hi];
}

const shortDate = (ms: number) =>
  new Date(ms).toLocaleDateString(localeCorrente(), { month: 'short', year: '2-digit' });

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, Math.max(1, max - 1))}…`;
}

/** Hook per la chiusura del tooltip quando il puntatore lascia la finestra. */
export function useDismissOnLeave(clear: () => void) {
  const cb = useCallback(clear, [clear]);
  useEffect(() => {
    window.addEventListener('blur', cb);
    return () => window.removeEventListener('blur', cb);
  }, [cb]);
}

// ---------------------------------------------------------------------------
// Dispersione: due misure una contro l'altra
// ---------------------------------------------------------------------------

/**
 * Le intestazioni della tabella equivalente della dispersione.
 *
 * Restano in italiano nella costante — l'italiano È la chiave del dizionario —
 * e si traducono al disegno con `t(...)`. Fuori dal componente perché sono sei
 * stringhe fisse: dentro, rinascerebbero a ogni render.
 */
const INTESTAZIONI_QUARTILI = ['Misura', 'Minimo', 'Primo quartile', 'Mediana', 'Terzo quartile', 'Massimo'];

/**
 * Grafico a dispersione con retta di tendenza opzionale.
 *
 * È l'unico modo onesto di mostrare una relazione fra due misure: una media non
 * la mostra, e una curva che le sovrappone su due assi Y la suggerisce senza
 * mostrarla. Ogni punto è un'immersione e si può cliccare per aprirla — un valore
 * strano deve portare al dato, non restare un puntino.
 */
export function ScatterChart({
  points,
  xLabel,
  yLabel,
  height = 240,
  xFormat = (v: number) => v.toFixed(0),
  yFormat = (v: number) => v.toFixed(1),
  onPick,
  showFit = true,
  titolo,
}: {
  points: { x: number; y: number; diveId: string; label: string }[];
  xLabel: string;
  yLabel: string;
  height?: number;
  xFormat?: (v: number) => string;
  yFormat?: (v: number) => string;
  onPick?: (id: string) => void;
  showFit?: boolean;
  titolo?: string;
}) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const { tip, perElemento } = useTooltip();
  const { t } = useLingua();
  const uid = useId();

  if (points.length < 3) {
    return (
      <p className="muted" style={{ fontSize: 12, margin: 0 }}>
        {t('Servono almeno tre immersioni con entrambe le misure.')}
      </p>
    );
  }

  const pad = { top: 14, right: 16, bottom: 34, left: 46 };
  const plotW = Math.max(10, width - pad.left - pad.right);
  const plotH = height - pad.top - pad.bottom;

  const xTicks = niceTicks(Math.min(...points.map((p) => p.x)), Math.max(...points.map((p) => p.x)), 4);
  const yTicks = niceTicks(Math.min(...points.map((p) => p.y)), Math.max(...points.map((p) => p.y)), 3);
  const xLo = xTicks[0];
  const xHi = xTicks[xTicks.length - 1];
  const yLo = yTicks[0];
  const yHi = yTicks[yTicks.length - 1];

  const px = (v: number) => pad.left + ((v - xLo) / (xHi - xLo || 1)) * plotW;
  const py = (v: number) => pad.top + plotH - ((v - yLo) / (yHi - yLo || 1)) * plotH;

  // Retta dei minimi quadrati: descrive la tendenza, non predice niente.
  let fit: { x1: number; y1: number; x2: number; y2: number } | null = null;
  if (showFit) {
    const n = points.length;
    const mx = points.reduce((a, p) => a + p.x, 0) / n;
    const my = points.reduce((a, p) => a + p.y, 0) / n;
    let num = 0;
    let den = 0;
    for (const p of points) {
      num += (p.x - mx) * (p.y - my);
      den += (p.x - mx) ** 2;
    }
    if (den > 0) {
      const slope = num / den;
      const intercept = my - slope * mx;
      fit = {
        x1: px(xLo),
        y1: py(slope * xLo + intercept),
        x2: px(xHi),
        y2: py(slope * xHi + intercept),
      };
    }
  }

  const nome = titolo ?? `${t('Dispersione')}: ${yLabel} ${t('in funzione di')} ${xLabel}`;
  const descrizione = riassuntoDispersione(points, { xLabel, yLabel, xFormat, yFormat }, t);
  const qx = quartili(points.map((p) => p.x))!;
  const qy = quartili(points.map((p) => p.y))!;

  return (
    <div className="chart" ref={ref}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={nome}
        aria-describedby={`${uid}-desc`}
        style={{ display: 'block' }}
      >
        <title>{nome}</title>
        <desc id={`${uid}-desc`}>{descrizione}</desc>
        {/* `tacca` e non `t`: il nome `t` è preso dalla funzione che traduce. */}
        {yTicks.map((tacca) => (
          <g key={`y${tacca}`} aria-hidden="true">
            <line
              x1={pad.left}
              x2={width - pad.right}
              y1={py(tacca)}
              y2={py(tacca)}
              stroke="var(--grid)"
              strokeWidth={1}
            />
            <text className="axis-label" x={pad.left - 8} y={py(tacca) + 3.5} textAnchor="end">
              {yFormat(tacca)}
            </text>
          </g>
        ))}
        {xTicks.map((tacca) => (
          <text
            aria-hidden="true"
            key={`x${tacca}`}
            className="axis-label"
            x={px(tacca)}
            y={height - 16}
            textAnchor="middle"
          >
            {xFormat(tacca)}
          </text>
        ))}

        {fit && (
          <line
            aria-hidden="true"
            x1={fit.x1}
            y1={fit.y1}
            x2={fit.x2}
            y2={fit.y2}
            stroke="var(--series-2)"
            strokeWidth={1.5}
            strokeDasharray="5 4"
          />
        )}

        {points.map((p) => (
          <circle
            aria-hidden="true"
            key={`${p.diveId}-${p.x}-${p.y}`}
            cx={px(p.x)}
            cy={py(p.y)}
            r={3.4}
            fill="var(--series-1)"
            opacity={0.65}
            style={{ cursor: onPick ? 'pointer' : 'default' }}
            {...perElemento(() => ({
              x: px(p.x),
              y: py(p.y),
              title: p.label,
              rows: [
                { label: xLabel, value: xFormat(p.x) },
                { label: yLabel, value: yFormat(p.y) },
              ],
            }))}
            onClick={() => onPick?.(p.diveId)}
          />
        ))}

        <g aria-hidden="true">
          <line
            x1={pad.left}
            x2={width - pad.right}
            y1={pad.top + plotH}
            y2={pad.top + plotH}
            stroke="var(--axis)"
            strokeWidth={1}
          />
          <text className="axis-label" x={width - pad.right} y={height - 3} textAnchor="end">
            {xLabel}
          </text>
          <text className="axis-label" x={pad.left} y={height - 3} textAnchor="start">
            {yLabel} ↑
          </text>
        </g>
      </svg>
      {/* Sulla nuvola la tabella non può essere l'elenco dei punti — sono decine e
          in ordine sparso non dicono niente — ma i quartili sì: sono la forma
          della nuvola detta in cinque numeri per asse. */}
      <TabellaEquivalente
        didascalia={`${nome}: ${t('distribuzione dei due assi')}`}
        intestazioni={INTESTAZIONI_QUARTILI.map((h) => t(h))}
        righe={[
          [xLabel, xFormat(qx.min), xFormat(qx.q1), xFormat(qx.mediana), xFormat(qx.q3), xFormat(qx.max)],
          [yLabel, yFormat(qy.min), yFormat(qy.q1), yFormat(qy.mediana), yFormat(qy.q3), yFormat(qy.max)],
        ]}
      />
      <Tooltip state={tip} containerWidth={width} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Curva su asse X numerico (non temporale)
// ---------------------------------------------------------------------------

/**
 * Una funzione disegnata: come cambia un risultato al variare di un parametro.
 *
 * Serve alle viste di pianificazione, dove il numero singolo dice poco e la
 * *pendenza* dice tutto: sapere che il tempo di fondo consentito è 24 minuti a 30 m
 * è utile, vedere che a 35 m diventano 15 lo è di più. Il punto pianificato è
 * marcato ed etichettato, così la curva non è un'astrazione accanto al risultato:
 * è il risultato, in contesto.
 */
export function CurveChart({
  points,
  height = 170,
  xLabel,
  yLabel,
  xFormat = (v: number) => v.toFixed(0),
  yFormat = (v: number) => v.toFixed(0),
  marker,
  markerLabel,
  reference,
  referenceLabel,
  color = 'var(--series-1)',
  fill = true,
  titolo,
}: {
  points: { x: number; y: number }[];
  height?: number;
  xLabel: string;
  yLabel: string;
  xFormat?: (v: number) => string;
  yFormat?: (v: number) => string;
  /** Ascissa da marcare: il valore attualmente pianificato. */
  marker?: number;
  markerLabel?: string;
  reference?: number;
  referenceLabel?: string;
  color?: string;
  fill?: boolean;
  titolo?: string;
}) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const { tip, setTip, perScorrimento } = useTooltip();
  const { t } = useLingua();
  const uid = useId();
  useDismissOnLeave(() => setTip(null));

  if (points.length < 2) {
    return (
      <p className="muted" style={{ fontSize: 12, margin: 0 }}>
        {t('Dati insufficienti per disegnare la curva.')}
      </p>
    );
  }

  const pad = { top: 16, right: 14, bottom: 30, left: 40 };
  const plotW = Math.max(10, width - pad.left - pad.right);
  const plotH = height - pad.top - pad.bottom;

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  if (reference !== undefined) ys.push(reference);
  // Lo zero resta nell'asse: su una curva di consumo, tagliarlo esagera le
  // differenze fra due profondità vicine.
  const yTicks = niceTicks(Math.min(0, ...ys), Math.max(...ys), 3);
  const xLo = Math.min(...xs);
  const xHi = Math.max(...xs);
  const yLo = yTicks[0];
  const yHi = yTicks[yTicks.length - 1];

  const px = (v: number) => pad.left + ((v - xLo) / (xHi - xLo || 1)) * plotW;
  const py = (v: number) => pad.top + plotH - ((v - yLo) / (yHi - yLo || 1)) * plotH;

  const line = points.map((p, i) => `${i ? 'L' : 'M'}${px(p.x).toFixed(1)},${py(p.y).toFixed(1)}`).join(' ');
  const area = `${line} L${px(xHi).toFixed(1)},${py(yLo).toFixed(1)} L${px(xLo).toFixed(1)},${py(yLo).toFixed(1)} Z`;
  const nearest = (clientX: number, box: DOMRect) => {
    const x = clientX - box.left;
    let best = points[0];
    for (const p of points) if (Math.abs(px(p.x) - x) < Math.abs(px(best.x) - x)) best = p;
    return best;
  };
  const at = (x: number) => {
    let best = points[0];
    for (const p of points) if (Math.abs(p.x - x) < Math.abs(best.x - x)) best = p;
    return best;
  };
  const markPoint = marker !== undefined ? at(marker) : undefined;

  const nome = titolo ?? `${t('Curva')}: ${yLabel} ${t('al variare di')} ${xLabel}`;
  const descrizione = riassuntoCurva(points, { xLabel, yLabel, xFormat, yFormat, marcatore: markPoint }, t);
  // Sei righe campionate a passo regolare invece dell'intera curva: la curva è
  // fitta per essere liscia da guardare, non perché ogni suo punto sia un dato.
  const campioni = campionaCurva(points, 6);

  return (
    <div className="chart" ref={ref}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={nome}
        aria-describedby={`${uid}-desc`}
        {...perScorrimento((e) => {
          const p = nearest(e.clientX, e.currentTarget.getBoundingClientRect());
          return {
            x: px(p.x),
            y: py(p.y),
            title: `${xLabel} ${xFormat(p.x)}`,
            rows: [{ label: yLabel, value: yFormat(p.y) }],
          };
        })}
      >
        <title>{nome}</title>
        <desc id={`${uid}-desc`}>{descrizione}</desc>
        {/* `tacca` e non `t`: il nome `t` è preso dalla funzione che traduce. */}
        {yTicks.map((tacca) => (
          <g key={tacca} aria-hidden="true">
            <line
              x1={pad.left}
              x2={width - pad.right}
              y1={py(tacca)}
              y2={py(tacca)}
              stroke="var(--grid)"
              strokeWidth={1}
            />
            <text className="axis-label" x={pad.left - 6} y={py(tacca) + 3} textAnchor="end">
              {yFormat(tacca)}
            </text>
          </g>
        ))}

        {reference !== undefined && (
          <g aria-hidden="true">
            <line
              x1={pad.left}
              x2={width - pad.right}
              y1={py(reference)}
              y2={py(reference)}
              stroke="var(--text-muted)"
              strokeWidth={1}
              strokeDasharray="4 3"
            />
            {referenceLabel && (
              // A sinistra, non a destra: il marcatore del valore pianificato porta
              // già la sua etichetta e le due si sovrapponevano quando cadevano
              // vicine.
              <text className="axis-label" x={pad.left + 2} y={py(reference) - 4} textAnchor="start">
                {referenceLabel}
              </text>
            )}
          </g>
        )}

        {fill && <path aria-hidden="true" d={area} fill={color} opacity={0.12} />}
        <path aria-hidden="true" d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />

        {markPoint && (
          <g aria-hidden="true">
            <line
              x1={px(markPoint.x)}
              x2={px(markPoint.x)}
              y1={pad.top}
              y2={pad.top + plotH}
              stroke="var(--series-2)"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
            <circle cx={px(markPoint.x)} cy={py(markPoint.y)} r={4} fill="var(--series-2)" />
            <text
              x={Math.min(width - pad.right, px(markPoint.x) + 6)}
              y={Math.max(pad.top + 9, py(markPoint.y) - 7)}
              fontSize={10}
              fontWeight={650}
              fill="var(--text-primary)"
              textAnchor={px(markPoint.x) > width - pad.right - 60 ? 'end' : 'start'}
            >
              {markerLabel ?? yFormat(markPoint.y)}
            </text>
          </g>
        )}

        {[xLo, (xLo + xHi) / 2, xHi].map((tacca) => (
          <text
            aria-hidden="true"
            key={tacca}
            className="axis-label"
            x={px(tacca)}
            y={height - 14}
            textAnchor="middle"
          >
            {xFormat(tacca)}
          </text>
        ))}
        <g aria-hidden="true">
          <line
            x1={pad.left}
            x2={width - pad.right}
            y1={pad.top + plotH}
            y2={pad.top + plotH}
            stroke="var(--axis)"
            strokeWidth={1}
          />
          <text className="axis-label" x={width - pad.right} y={height - 2} textAnchor="end">
            {xLabel}
          </text>
        </g>
      </svg>
      <TabellaEquivalente
        didascalia={`${nome}: ${t('valori campionati')}`}
        intestazioni={[xLabel, yLabel]}
        righe={campioni.map((p) => [xFormat(p.x), yFormat(p.y)])}
      />
      <Tooltip state={tip} containerWidth={width} />
    </div>
  );
}

/**
 * Prende `quanti` punti equidistanti lungo una curva, estremi compresi.
 *
 * Gli estremi devono esserci sempre: sono i due valori che il riassunto nomina,
 * e una tabella che comincia dal secondo punto e finisce sul penultimo
 * contraddirebbe la frase letta un attimo prima.
 */
export function campionaCurva(punti: { x: number; y: number }[], quanti = 6): { x: number; y: number }[] {
  const ordinati = [...punti].sort((a, b) => a.x - b.x);
  if (ordinati.length <= quanti) return ordinati;
  const passo = (ordinati.length - 1) / (quanti - 1);
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < quanti; i++) out.push(ordinati[Math.round(i * passo)]);
  return out;
}
