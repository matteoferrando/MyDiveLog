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
 * ► `touch-action: none` NON È UN DETTAGLIO. ◄ Senza, il primo movimento del
 * dito fa scorrere la pagina invece di disegnare, e il riquadro sembra rotto. È
 * la riga che fa la differenza fra una firma e una pagina che scivola via.
 *
 * ► NIENTE CANVAS. ◄ Si disegna in SVG, con una `path` per tratto, come tutti
 * gli altri grafici di questa applicazione: gli stessi punti che finiscono nel
 * record sono quelli che si vedono a schermo, quindi quello che firmi è
 * letteralmente quello che viene salvato — non una sua fotografia.
 */

import { useRef, useState } from 'react';
import { firmaPath, firmaVuota, semplifica, type FirmaGuida, type Tratto } from '../../core/firma';
import { useLingua } from '../lingua';

/** Lo spazio di cattura. I punti si salvano in queste coordinate. */
const LARGHEZZA = 600;
const ALTEZZA = 200;

export function RiquadroFirma({
  firma,
  nomeProposto,
  onFirma,
  onCancella,
}: {
  firma?: FirmaGuida;
  /** Chi ci si aspetta che firmi: la guida dell'immersione, se c'è. */
  nomeProposto?: string;
  onFirma: (firma: FirmaGuida) => void;
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

  const giu = (e: React.PointerEvent) => {
    const p = punto(e);
    if (!p) return;
    e.currentTarget.setPointerCapture(e.pointerId);
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
    if (!disegnando) return;
    setDisegnando(false);
    // Si semplifica alla fine del tratto e non a ogni punto: durante il
    // movimento serve la fedeltà, nel record serve la leggerezza.
    setTratti((t) => t.map(semplifica));
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

      <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
        <button
          className="btn btn-primary"
          disabled={vuota}
          onClick={() => onFirma({ ...provvisoria, quando: new Date().toISOString() })}
        >
          {t('Salva la firma')}
        </button>
        <button onClick={() => setTratti([])} disabled={tratti.length === 0}>
          {t('Rifai')}
        </button>
        {!firmaVuota(firma) && <button onClick={onCancella}>{t('Togli la firma')}</button>}
      </div>
      <p className="muted" style={{ fontSize: 11, margin: 0 }}>
        {t(
          'È il segno di una persona raccolto su questo dispositivo, con nome e data accanto: l’equivalente della penna sul foglio. Non è una firma elettronica qualificata.',
        )}
      </p>
    </div>
  );
}
