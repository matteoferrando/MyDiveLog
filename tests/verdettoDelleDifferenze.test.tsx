// @vitest-environment jsdom
/**
 * ► IN «CONFRONTA», IL VERDETTO LO DICEVA SOLO IL COLORE. ◄
 *
 * La colonna «Differenza» stampava il numero col segno e lo tingeva di verde o
 * di ocra. **Il segno da solo non dice se è un miglioramento**, perché il verso
 * lo decide la misura: su «Consumo di superficie» meno è meglio, su «Sosta di
 * sicurezza» è più, e su «Profondità massima» un meglio non esiste affatto. Lo
 * stesso «−2.0» era quindi un progresso su una riga e un peggioramento su
 * quella sotto, e l'unica cosa che le distingueva era la tinta.
 *
 * Misurato sul tema chiaro: `--good-text #006300` e `--warning-text #845206`
 * stanno a **1.15:1** di luminanza. In bianco e nero, con un daltonismo
 * rosso-verde, o semplicemente con lo schermo al sole, sono lo stesso colore.
 *
 * `format.ts` dichiara la regola del progetto — *accanto al pallino c'è sempre
 * l'etichetta testuale* — e Statistiche la rispetta da sempre con le sue
 * pastiglie. Questo file la fa rispettare anche qui.
 *
 * ► COME È FATTA LA PROVA, E PERCHÉ COSÌ. ◄ Non guarda i colori e non cerca le
 * parole «meglio» o «peggio»: rende la tabella e legge il **testo** delle celle,
 * che è esattamente quello che resta quando il colore non arriva. Due righe con
 * la differenza dello **stesso segno** e verdetto **opposto** devono leggersi
 * diverse a colore spento — se tornassero a leggersi uguali, l'informazione
 * sarebbe di nuovo solo nella tinta. Riscrivendo le due parole in qualunque
 * altro modo la prova resta accesa; togliendole, cade.
 */

import { describe, expect, it, vi } from 'vitest';
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';

const finto = vi.hoisted(() => ({ valore: {} as Record<string, unknown> }));
vi.mock('../src/ui/state', () => ({ useDiveLog: () => finto.valore }));

import { AIR, type Dive } from '../src/core/model';
import { Compare } from '../src/ui/pages/Compare';

function metriche(m: Record<string, unknown>): Dive['metrics'] {
  return {
    quality: { sampleCount: 240, sampleIntervalS: 10, hasProfile: true },
    ...m,
  } as unknown as Dive['metrics'];
}

function immersione(id: string, giorno: string, maxDepth: number, m: Record<string, unknown>): Dive {
  return {
    id,
    startTime: `${giorno}T09:00:00Z`,
    durationS: 2400,
    maxDepth,
    mode: 'oc',
    cylinders: [{ mix: AIR }],
    source: { format: 'uddf', file: 'prova', importedAt: 'x' },
    tags: [],
    metrics: metriche(m),
  } as Dive;
}

function monta(nodo: ReactNode) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(nodo));
  return {
    host,
    smonta: () => {
      act(() => root.unmount());
      host.remove();
    },
  };
}

/**
 * Le due immersioni del confronto, scelte perché producano il caso che il
 * colore non sa raccontare:
 *
 *  - **consumo** 18.0 → 15.0 L/min: differenza **−3.0**, e meno consumo è meglio;
 *  - **sosta di sicurezza** 3 → 1 minuti: differenza **−2.0**, e meno sosta è peggio.
 *
 * Stesso segno, verdetti opposti. Prima, a colore spento, erano due numeri
 * negativi identici in tutto tranne la cifra.
 *
 *  - **CNS** 12.00 → 12.02%: differenza **0.0**, cioè nessuna differenza vera;
 *  - **profondità massima** 30 → 25 m: differenza **−5.0**, e qui un meglio non esiste.
 */
const SINISTRA = immersione('sx', '2026-06-01', 30, { rmvLpm: 18, safetyStopS: 180, cnsPct: 12.0 });
const DESTRA = immersione('dx', '2026-06-02', 25, { rmvLpm: 15, safetyStopS: 60, cnsPct: 12.02 });

async function montaConfronto() {
  finto.valore = { dives: [SINISTRA, DESTRA], loadSamples: async () => [] };
  const vista = monta(<Compare onOpen={() => undefined} />);
  await act(async () => {
    await Promise.resolve();
  });
  return vista;
}

/** La cella «Differenza» della riga che porta quell'etichetta. */
function cellaDifferenza(host: HTMLElement, etichetta: string): Element {
  const riga = [...host.querySelectorAll('tbody tr')].find(
    (r) => (r.querySelector('td')?.textContent ?? '').trim() === etichetta,
  );
  if (!riga) throw new Error(`nessuna riga «${etichetta}»`);
  const celle = [...riga.querySelectorAll('td')];
  if (celle.length !== 4) throw new Error(`la riga «${etichetta}» non ha quattro celle`);
  return celle[3]!;
}

/** Il numero della differenza, per quello che è: un numero col suo segno. */
function numeroDifferenza(host: HTMLElement, etichetta: string): number {
  const testo = cellaDifferenza(host, etichetta).textContent ?? '';
  const trovato = testo.match(/[-+]?\d+(?:\.\d+)?/);
  if (!trovato) throw new Error(`nessun numero in «${testo}»`);
  return Number(trovato[0]);
}

/**
 * Quello che la cella dice OLTRE al numero e all'unità: il verdetto a parole.
 *
 * È la cella come la legge chi non riceve il colore — uno screen reader, una
 * stampa in bianco e nero, uno schermo al sole. Se qui resta una stringa vuota,
 * quella riga il suo verdetto lo affida alla sola tinta.
 */
function verdettoScritto(host: HTMLElement, etichetta: string, unita: string): string {
  return (cellaDifferenza(host, etichetta).textContent ?? '')
    .replace(/[-+]?\d+(?:\.\d+)?/, '')
    .replace(unita, '')
    .replace(/\s+/g, ' ')
    .trim();
}

describe('la colonna «Differenza» dice il verso anche senza il colore', () => {
  it('due differenze dello stesso segno e di verso opposto si leggono diverse', async () => {
    const vista = await montaConfronto();
    const host = vista.host;

    // Il presupposto del difetto, verificato e non dato per buono: i due numeri
    // hanno lo stesso segno. Se un giorno non ce l'avessero più, il confronto
    // qui sotto non proverebbe più niente e questa riga lo direbbe.
    expect(numeroDifferenza(host, 'Consumo di superficie')).toBeLessThan(0);
    expect(numeroDifferenza(host, 'Sosta di sicurezza')).toBeLessThan(0);

    const consumo = verdettoScritto(host, 'Consumo di superficie', 'L/min');
    const sosta = verdettoScritto(host, 'Sosta di sicurezza', 'min');

    expect(consumo, 'meno consumo è un miglioramento, e la cella non lo dice').not.toBe('');
    expect(sosta, 'meno sosta di sicurezza è un peggioramento, e la cella non lo dice').not.toBe('');
    /*
     * Il cuore della prova. `textContent` non porta con sé nessuno stile: queste
     * sono le due celle come le riceve chi il colore non lo vede. Se tornassero
     * a leggersi uguali, il verdetto sarebbe di nuovo affidato alla sola tinta —
     * e le due tinte stanno a 1.15:1 di luminanza.
     */
    expect(
      consumo,
      'a colore spento le due celle dicono la stessa cosa, e il verso lo sa solo la tinta',
    ).not.toBe(sosta);
    vista.smonta();
  });

  it('dove un verso migliore non esiste, la cella non lo inventa', async () => {
    /*
     * Su profondità massima, profondità media, durata e temperatura minima
     * `lower` è `null`: un meglio non è definito, e scriverci «meglio» o
     * «peggio» sarebbe un giudizio finto — più dannoso di un giudizio assente,
     * perché chi legge non ha modo di sapere che è stato inventato.
     */
    const vista = await montaConfronto();
    expect(numeroDifferenza(vista.host, 'Profondità massima')).toBe(-5);
    expect(verdettoScritto(vista.host, 'Profondità massima', 'm')).toBe('');
    vista.smonta();
  });

  it('una differenza che non c’è lo dice a parole, dove il colore è grigio', async () => {
    /*
     * 12.00 e 12.02 di CNS si stampano tutt'e due «12.0»: la differenza è zero e
     * il colore diventa grigio, cioè lo stesso grigio delle righe senza verso.
     * È il caso in cui la tinta non porta proprio nessuna informazione, e la
     * parola è l'unico canale rimasto.
     */
    const vista = await montaConfronto();
    expect(numeroDifferenza(vista.host, 'CNS calcolato')).toBe(0);
    const parola = verdettoScritto(vista.host, 'CNS calcolato', '%');
    expect(parola, 'differenza nulla su una misura con un verso: va detto che sono pari').not.toBe('');
    // E non dev'essere la stessa parola dei due verdetti veri, altrimenti
    // «uguale» e «meglio» si confonderebbero.
    expect(parola).not.toBe(verdettoScritto(vista.host, 'Consumo di superficie', 'L/min'));
    vista.smonta();
  });

  it('il numero resta il primo della cella, e resta quello delle due colonne accanto', async () => {
    /*
     * La parola si aggiunge, non sostituisce: la colonna continua a essere la
     * sottrazione delle due che ha di fianco, ed è la proprietà che
     * `statisticheCoerenti.test.tsx` tiene dal suo lato. Qui si controlla che
     * l'aggiunta non abbia spostato il numero né cambiato il conto.
     */
    const vista = await montaConfronto();
    expect(numeroDifferenza(vista.host, 'Consumo di superficie')).toBe(-3);
    expect(numeroDifferenza(vista.host, 'Sosta di sicurezza')).toBe(-2);
    vista.smonta();
  });
});
