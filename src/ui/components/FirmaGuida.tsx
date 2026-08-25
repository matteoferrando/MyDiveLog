/**
 * Il riquadro dove la guida firma col dito.
 *
 * ► COSA CHIUDE. ◄ È la lettera o) del libretto delle immersioni (art. 12,
 * comma 8 della legge 70/2026), l'unica delle tredici che non si poteva
 * raccogliere in digitale. Con questa, il libretto si chiude senza stampare
 * niente — che è ciò che il testo di legge ammette espressamente.
 *
 * ► EVENTI DEL PUNTATORE, NON DEL MOUSE. ◄ `pointerdown/move/up` e non
 * `mousedown`: su un telefono il mouse non esiste, e questa è la superficie che
 * su un telefono serve DI PIÙ — la guida firma sul tuo iPhone, in barca, non
 * davanti a un Mac. `setPointerCapture` tiene il tratto attaccato al dito anche
 * quando esce dal riquadro, altrimenti una firma un po' larga si taglia da sola.
 *
 * ► `touch-action: none` NON BASTA, e l'iPhone lo dimostra. ◄ Quella riga di
 * CSS dichiara l'intenzione giusta — il primo movimento del dito deve
 * disegnare, non far scorrere la pagina — e sul Mac funziona. Dentro la
 * WKWebView di iOS no: firmando col dito la pagina scivolava via sotto il
 * tratto, e la firma usciva strappata.
 *
 * La ragione è che React registra `touchmove` in modo PASSIVO sulla radice, e
 * un ascoltatore passivo per definizione non può annullare lo scorrimento:
 * `preventDefault()` da lì dentro non ha nessun effetto e non dà nessun errore.
 * L'unico modo è agganciare l'ascoltatore a mano sull'elemento, con
 * `{ passive: false }`. Vedi `useEffect` più sotto.
 *
 * E lo si annulla SOLO MENTRE SI STA DISEGNANDO, non sempre. Bloccare ogni
 * movimento sul riquadro vorrebbe dire che chi appoggia il pollice lì per
 * scorrere la pagina — il riquadro è largo quanto lo schermo — si ritrova la
 * pagina incollata e pensa che l'applicazione sia bloccata. Un tratto di
 * troppo, invece, si toglie con «Rifai».
 *
 * ► NIENTE CANVAS. ◄ Si disegna in SVG, con una `path` per tratto, come tutti
 * gli altri grafici di questa applicazione: gli stessi punti che finiscono nel
 * record sono quelli che si vedono a schermo, quindi quello che firmi è
 * letteralmente quello che viene salvato — non una sua fotografia.
 */

import { useEffect, useRef, useState } from 'react';
import { firmaPath, firmaVuota, semplifica, type FirmaGuida, type Tratto } from '../../core/firma';
import { useLingua } from '../lingua';

/** Lo spazio di cattura. I punti si salvano in queste coordinate. */
const LARGHEZZA = 600;
const ALTEZZA = 200;

export function RiquadroFirma({
  firma,
  nomeProposto,
  onFirma,
  onAnnulla,
  onCancella,
}: {
  firma?: FirmaGuida;
  /** Chi ci si aspetta che firmi: la guida dell'immersione, se c'è. */
  nomeProposto?: string;
  onFirma: (firma: FirmaGuida) => void;
  /**
   * Chiudere senza firmare, lasciando l'immersione esattamente com'era.
   *
   * ► È UNA COSA DIVERSA DA `onCancella`. ◄ Quella toglie una firma già
   * raccolta e cambia il record; questa non tocca niente. Tenerle separate è
   * l'unico modo di avere una via d'uscita che non fa danni: se chiudere
   * volesse dire togliere, chi ha aperto il riquadro per sbaglio su
   * un'immersione già controfirmata perderebbe la firma della guida proprio
   * mentre cerca di non fare niente.
   */
  onAnnulla: () => void;
  onCancella: () => void;
}) {
  const { t } = useLingua();
  const [tratti, setTratti] = useState<Tratto[]>(firma?.tratti ?? []);
  const [nome, setNome] = useState(firma?.nome ?? nomeProposto ?? '');
  const [disegnando, setDisegnando] = useState(false);
  const svg = useRef<SVGSVGElement | null>(null);

  /** Dal punto sullo schermo al punto nello spazio di cattura. */
  const punto = (e: React.PointerEvent): { x: number; y: number } | null => {
    const box = svg.current?.getBoundingClientRect();
    if (!box || box.width === 0) return null;
    return {
      x: ((e.clientX - box.left) / box.width) * LARGHEZZA,
      y: ((e.clientY - box.top) / box.height) * ALTEZZA,
    };
  };

  /*
   * Lo stesso «sto disegnando», ma leggibile SUBITO.
   *
   * Lo stato di React si aggiorna al render successivo, e il primo `touchmove`
   * arriva prima: leggendo `disegnando` l'ascoltatore qui sotto troverebbe
   * ancora `false` proprio sul movimento che conta, cioè quello che fa partire
   * lo scorrimento. Il riferimento si scrive nello stesso istante del tocco.
   */
  const staDisegnando = useRef(false);

  /*
   * L'ascoltatore non passivo che tiene ferma la pagina.
   *
   * `addEventListener` a mano e non `onTouchMove`: React registra `touchmove`
   * come passivo, e da un ascoltatore passivo `preventDefault()` non fa niente
   * e non si lamenta. È il genere di riga che sembra superflua finché non la si
   * prova su un telefono vero.
   */
  useEffect(() => {
    const nodo = svg.current;
    if (!nodo) return;
    const fermaLoScorrimento = (e: TouchEvent) => {
      if (staDisegnando.current) e.preventDefault();
    };
    nodo.addEventListener('touchmove', fermaLoScorrimento, { passive: false });
    return () => nodo.removeEventListener('touchmove', fermaLoScorrimento);
  }, []);

  const giu = (e: React.PointerEvent) => {
    const p = punto(e);
    if (!p) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    staDisegnando.current = true;
    setDisegnando(true);
    setTratti((t) => [...t, [p]]);
  };

  const muovi = (e: React.PointerEvent) => {
    if (!disegnando) return;
    const p = punto(e);
    if (!p) return;
    setTratti((t) => {
      if (t.length === 0) return t;
      const ultimi = t.slice(0, -1);
      return [...ultimi, [...t[t.length - 1], p]];
    });
  };

  const su = () => {
    staDisegnando.current = false;
    if (!disegnando) return;
    setDisegnando(false);
    // Si semplifica alla fine del tratto e non a ogni punto: durante il
    // movimento serve la fedeltà, nel record serve la leggerezza.
    setTratti((t) => t.map(semplifica));
  };

  /*
   * L'uscita che non firma niente.
   *
   * ► PERCHÉ RIMETTE I CAMPI COM'ERANO invece di svuotarli. ◄ Il riquadro nasce
   * con dentro la firma già raccolta, se c'è: annullare deve riportare a
   * QUELLO, non a un foglio bianco. Se svuotasse, chi apre «Rifai la firma» su
   * un'immersione già firmata e poi ci ripensa si ritroverebbe il riquadro
   * vuoto — cioè vedrebbe sparire una firma che nel record c'è ancora, e da lì
   * in poi non saprebbe più a quale delle due credere.
   *
   * Finché chi ospita il riquadro lo SMONTA chiudendolo — è quello che fa la
   * scheda dell'immersione — questo ripristino è ridondante, perché lo stato
   * riparte comunque da `firma` alla riapertura. Sta qui lo stesso: un
   * componente che si comporta bene solo se chi lo usa lo tratta in un modo
   * preciso è una trappola per il prossimo che lo monta senza saperlo.
   */
  const annulla = () => {
    setTratti(firma?.tratti ?? []);
    setNome(firma?.nome ?? nomeProposto ?? '');
    onAnnulla();
  };

  const provvisoria: FirmaGuida = {
    tratti,
    larghezza: LARGHEZZA,
    altezza: ALTEZZA,
    quando: firma?.quando ?? '',
    nome: nome.trim() || undefined,
  };
  const vuota = firmaVuota(provvisoria);

  return (
    <div className="stack" style={{ gap: 10 }}>
      <svg
        ref={svg}
        className="riquadro-firma-schermo"
        viewBox={`0 0 ${LARGHEZZA} ${ALTEZZA}`}
        role="img"
        aria-label={t('Riquadro per la firma: disegna col dito o con il puntatore')}
        onPointerDown={giu}
        onPointerMove={muovi}
        onPointerUp={su}
        onPointerCancel={su}
      >
        {/* La riga su cui si firma, come sul foglio. */}
        <line x1="20" y1={ALTEZZA - 40} x2={LARGHEZZA - 20} y2={ALTEZZA - 40} className="riga-firma-svg" />
        <path d={firmaPath(provvisoria, LARGHEZZA, ALTEZZA)} className="tratto-firma" />
      </svg>

      <label className="stack" style={{ gap: 4, fontSize: 12 }}>
        <span className="muted">{t('Chi firma')}</span>
        <input
          type="text"
          value={nome}
          placeholder={t('nome e cognome della guida')}
          onChange={(e) => setNome(e.target.value)}
        />
      </label>

      {/*
        L'ordine è quello di `BottoniScheda` (vedi `components/moduli.tsx`), e per
        la stessa ragione: conferma e uscita vicine a sinistra, lo spazio
        elastico, e in fondo da solo quello che distrugge. Qui il distacco pesa
        più che altrove — «Annulla» e «Togli la firma» chiudono tutti e due il
        riquadro, ma uno lascia il record intatto e l'altro cancella la firma
        della guida. Attaccati, su un telefono tenuto in mano in barca, sono un
        dito storto di distanza.
      */}
      <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
        <button
          className="btn btn-primary"
          /*
           * Spento finché non c'è un segno: senza, sfiorare il riquadro e premere
           * salvare farebbe risultare firmata la lettera o) con niente dentro —
           * un'immersione che il libretto dà per controfirmata e che non lo è.
           */
          disabled={vuota}
          onClick={() =>
            onFirma({
              ...provvisoria,
              quando: new Date().toISOString(),
              // Il fuso di QUI, adesso: senza, la data della firma cambia a
              // seconda di dove viene riletta. Vedi `core/firma.ts`.
              offsetMinuti: -new Date().getTimezoneOffset(),
            })
          }
        >
          {t('Salva la firma')}
        </button>
        <button onClick={annulla}>{t('Annulla')}</button>
        <button onClick={() => setTratti([])} disabled={tratti.length === 0}>
          {t('Rifai')}
        </button>
        <span style={{ flex: 1 }} />
        {!firmaVuota(firma) && (
          <button onClick={onCancella} style={{ color: 'var(--critical)' }}>
            {t('Togli la firma')}
          </button>
        )}
      </div>
      <p className="muted" style={{ fontSize: 11, margin: 0 }}>
        {t(
          'È il segno di una persona raccolto su questo dispositivo, con nome e data accanto: l’equivalente della penna sul foglio. Non è una firma elettronica qualificata.',
        )}
      </p>
    </div>
  );
}
