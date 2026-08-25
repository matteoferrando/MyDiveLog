// @vitest-environment jsdom
/**
 * La via d'uscita dal riquadro della firma.
 *
 * ► DA DOVE VIENE QUESTO FILE. ◄ Il riquadro della firma si apriva e non si
 * chiudeva: le uniche uscite erano firmare — cioè compiere il gesto — o togliere
 * la firma, che su un'immersione già controfirmata cancella il record. Chi lo
 * apriva per sbaglio, o chi ci ripensava, poteva solo scegliere fra due cose che
 * non voleva. La lettera o) del libretto è l'unica delle tredici che non è un
 * dato ma un GESTO, e su un gesto l'unica via d'uscita non può essere farlo.
 *
 * ► COSA CONTROLLA, e sono le due metà dello stesso difetto. ◄ Che l'uscita
 * esista e non salvi niente; e che non sia diventata l'errore opposto, cioè che
 * chiudere non porti via una firma che nel record c'era già. Le due si guardano
 * insieme perché la correzione sbagliata della prima è esattamente la seconda.
 *
 * ► PERCHÉ SI MONTA LA SCHEDA INTERA e non solo il riquadro. ◄ Metà del difetto
 * sta nel riquadro (il bottone) e metà in chi lo apre (cosa fa quel bottone
 * quando arriva alla scheda dell'immersione). Un test sul solo riquadro
 * verificherebbe che la funzione viene chiamata, non che chiamandola
 * l'immersione resti firmata — che è la cosa che importa. L'archivio è finto:
 * qui non si verifica il salvataggio, solo che NON avvenga.
 */

import { describe, expect, it, vi, type Mock } from 'vitest';
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { RiquadroFirma } from '../src/ui/components/FirmaGuida';
import type { FirmaGuida } from '../src/core/firma';
import type { Dive } from '../src/core/model';

/**
 * L'archivio finto.
 *
 * Sta in `vi.hoisted` perché la fabbrica del mock viene issata sopra gli import:
 * il contenitore deve esistere prima, il contenuto glielo mette ogni test.
 */
const finto = vi.hoisted(() => ({ valore: {} as Record<string, unknown> }));
vi.mock('../src/ui/state', () => ({ useDiveLog: () => finto.valore }));

import { DiveDetail } from '../src/ui/pages/DiveDetail';

// ---------------------------------------------------------------------------
// Attrezzi
// ---------------------------------------------------------------------------

function monta(nodo: ReactNode) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(nodo));
  return { host, smonta: () => act(() => root.unmount()) };
}

/** Il bottone con quel testo, o un errore che dice cosa c'era davvero. */
function bottone(host: HTMLElement, testo: string): HTMLButtonElement {
  const tutti = [...host.querySelectorAll('button')];
  const trovato = tutti.find((b) => b.textContent?.trim() === testo);
  if (!trovato)
    throw new Error(`nessun bottone «${testo}» fra: ${tutti.map((b) => b.textContent).join(' | ')}`);
  return trovato;
}

const premi = (b: HTMLButtonElement) => act(() => void b.click());

/**
 * Disegna un tratto dentro il riquadro.
 *
 * Due cose non funzionano in un DOM finto e vanno messe a mano. La prima è
 * `getBoundingClientRect`, che in jsdom risponde tutto zero: il riquadro
 * converte il punto dello schermo nelle sue coordinate dividendo per la
 * larghezza, e con larghezza zero rinuncia — nessun tratto, e il test
 * proverebbe il contrario di quello che crede. La seconda è
 * `setPointerCapture`, che in jsdom non esiste affatto: serve a tenere il tratto
 * attaccato al dito quando esce dal riquadro, cosa che qui dentro non ha
 * nessun senso, ma senza la funzione il gestore cade al primo tocco.
 */
function disegna(svg: SVGSVGElement, punti: { x: number; y: number }[]) {
  svg.getBoundingClientRect = () =>
    ({
      left: 0,
      top: 0,
      width: 600,
      height: 200,
      right: 600,
      bottom: 200,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
  (svg as unknown as { setPointerCapture: (id: number) => void }).setPointerCapture = () => {};
  const evento = (tipo: string, p: { x: number; y: number }) =>
    new MouseEvent(tipo, { bubbles: true, clientX: p.x, clientY: p.y });
  act(() => void svg.dispatchEvent(evento('pointerdown', punti[0])));
  for (const p of punti.slice(1)) act(() => void svg.dispatchEvent(evento('pointermove', p)));
  act(() => void svg.dispatchEvent(evento('pointerup', punti[punti.length - 1])));
}

const riquadro = (host: HTMLElement) =>
  host.querySelector<SVGSVGElement>('svg.riquadro-firma-schermo') as SVGSVGElement;

const FIRMA: FirmaGuida = {
  tratti: [
    [
      { x: 10, y: 100 },
      { x: 50, y: 40 },
      { x: 90, y: 120 },
    ],
    [
      { x: 120, y: 60 },
      { x: 200, y: 60 },
    ],
  ],
  larghezza: 600,
  altezza: 200,
  quando: '2026-07-11T10:30:00Z',
  offsetMinuti: 120,
  nome: 'Anna Bianchi',
};

const IMMERSIONE = {
  id: 'firma-1',
  startTime: '2026-07-11T09:24:00Z',
  durationS: 3300,
  maxDepth: 31.2,
  mode: 'oc',
  cylinders: [{ mix: { o2: 0.21, he: 0 } }],
  source: { kind: 'manual' },
  tags: [],
} as unknown as Dive;

/** La scheda dell'immersione con un archivio finto attorno. */
function schedaCon(dive: Dive): { host: HTMLElement; salva: Mock } {
  const salva = vi.fn(async () => {});
  finto.valore = {
    dives: [dive],
    loadProfiles: async () => ({ samples: undefined, altSamples: undefined }),
    saveDive: salva,
    removeDive: async () => {},
    gear: { equipment: [], sets: [] },
    saveGear: async () => {},
    subacqueo: {},
    numeri: new Map([[dive.id, 1]]),
  };
  const { host } = monta(<DiveDetail id={dive.id} onBack={() => {}} />);
  return { host, salva };
}

// ---------------------------------------------------------------------------

describe('si esce dal riquadro della firma senza firmare', () => {
  it('su un’immersione mai firmata, annullare non salva niente e richiude', () => {
    const { host, salva } = schedaCon(IMMERSIONE);
    premi(bottone(host, 'Fai firmare'));
    expect(riquadro(host)).toBeTruthy();

    premi(bottone(host, 'Annulla'));

    // Niente scritto sull'archivio: chi ci ripensa non lascia traccia.
    expect(salva).not.toHaveBeenCalled();
    // E si torna esattamente all'invito di prima, non a un riquadro aperto.
    expect(riquadro(host)).toBeNull();
    expect(bottone(host, 'Fai firmare')).toBeTruthy();
  });

  it('i tratti disegnati e poi abbandonati non finiscono da nessuna parte', () => {
    /*
     * L'errore facile è chiudere lasciando lo stato del riquadro dov'era: alla
     * riapertura si ritroverebbero i tratti di chi aveva rinunciato, e basterebbe
     * un «Salva la firma» dato per buono per attribuire all'immersione una firma
     * che nessuno ha voluto dare.
     */
    const { host } = schedaCon(IMMERSIONE);
    premi(bottone(host, 'Fai firmare'));
    disegna(riquadro(host), [
      { x: 10, y: 10 },
      { x: 60, y: 90 },
      { x: 140, y: 30 },
      { x: 220, y: 120 },
    ]);
    expect(bottone(host, 'Salva la firma').disabled).toBe(false);

    premi(bottone(host, 'Annulla'));
    premi(bottone(host, 'Fai firmare'));

    expect(riquadro(host).querySelector('path.tratto-firma')?.getAttribute('d')).toBe('');
    expect(bottone(host, 'Salva la firma').disabled).toBe(true);
  });

  it('su un’immersione GIÀ firmata, annullare non porta via la firma', () => {
    /*
     * ► È l'errore opposto, ed è peggiore di quello di partenza. ◄ Una via
     * d'uscita che per chiudere svuota il campo trasformerebbe un ripensamento
     * nella perdita della lettera o) — un'immersione che risultava controfirmata
     * e che di colpo non lo è più, senza che nessuno l'abbia chiesto.
     */
    const { host, salva } = schedaCon({ ...IMMERSIONE, firmaGuida: FIRMA });
    premi(bottone(host, 'Rifai la firma'));
    premi(bottone(host, 'Annulla'));

    expect(salva).not.toHaveBeenCalled();
    // La firma è di nuovo lì, con la sua riga di accompagnamento.
    expect(host.querySelector('svg.firma-mostrata')).toBeTruthy();
    expect(host.textContent).toContain('Anna Bianchi');
    expect(bottone(host, 'Rifai la firma')).toBeTruthy();
  });

  it('annullare rimette nel riquadro la firma salvata, non un foglio bianco', () => {
    /*
     * Il riquadro montato da solo, perché è qui che si vede: se annullare
     * svuotasse i tratti invece di riportarli a quelli salvati, chi lo ospita
     * senza smontarlo mostrerebbe un riquadro vuoto su un'immersione firmata —
     * due versioni della stessa cosa, e nessun modo di sapere quale vale.
     */
    const onFirma = vi.fn();
    const onAnnulla = vi.fn();
    const onCancella = vi.fn();
    const { host } = monta(
      <RiquadroFirma firma={FIRMA} onFirma={onFirma} onAnnulla={onAnnulla} onCancella={onCancella} />,
    );
    const svg = riquadro(host);
    const partenza = svg.querySelector('path.tratto-firma')?.getAttribute('d');
    expect(partenza).toContain('M10.0,100.0');

    disegna(svg, [
      { x: 300, y: 10 },
      { x: 340, y: 90 },
      { x: 380, y: 20 },
    ]);
    expect(svg.querySelector('path.tratto-firma')?.getAttribute('d')).not.toBe(partenza);

    premi(bottone(host, 'Annulla'));

    expect(onAnnulla).toHaveBeenCalledTimes(1);
    // Le due che cambierebbero il record restano ferme: annullare non è né
    // firmare né togliere la firma.
    expect(onFirma).not.toHaveBeenCalled();
    expect(onCancella).not.toHaveBeenCalled();
    expect(svg.querySelector('path.tratto-firma')?.getAttribute('d')).toBe(partenza);
  });
});

describe('non si salva una firma vuota', () => {
  it('«Salva la firma» è spento finché il riquadro è intonso', () => {
    const onFirma = vi.fn();
    const { host } = monta(<RiquadroFirma onFirma={onFirma} onAnnulla={() => {}} onCancella={() => {}} />);
    const salva = bottone(host, 'Salva la firma');
    expect(salva.disabled).toBe(true);
    // Anche premendolo comunque, che è ciò che farebbe un clic andato a segno
    // su un bottone spento solo per finta.
    premi(salva);
    expect(onFirma).not.toHaveBeenCalled();
  });

  it('un tocco solo non basta ad accenderlo', () => {
    /*
     * Il riquadro è largo quanto lo schermo: appoggiarci il pollice per scorrere
     * la pagina lascia un puntino. Se quel puntino accendesse «Salva la firma»,
     * un tocco per sbaglio più un tocco distratto darebbero all'immersione una
     * firma fatta di niente — e il libretto la darebbe per controfirmata.
     */
    const { host } = monta(<RiquadroFirma onFirma={vi.fn()} onAnnulla={() => {}} onCancella={() => {}} />);
    disegna(riquadro(host), [{ x: 42, y: 42 }]);
    expect(bottone(host, 'Salva la firma').disabled).toBe(true);
  });

  it('con un segno vero si accende', () => {
    // Il contrappeso dei due sopra: un bottone sempre spento passerebbe quei
    // test e renderebbe la firma impossibile.
    const { host } = monta(<RiquadroFirma onFirma={vi.fn()} onAnnulla={() => {}} onCancella={() => {}} />);
    disegna(riquadro(host), [
      { x: 10, y: 10 },
      { x: 60, y: 90 },
      { x: 140, y: 30 },
      { x: 220, y: 120 },
    ]);
    expect(bottone(host, 'Salva la firma').disabled).toBe(false);
  });
});
