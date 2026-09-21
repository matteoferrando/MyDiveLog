// @vitest-environment jsdom
/**
 * UNO ZERO SCRITTO IN ARCHIVIO NON DEVE DIVENTARE UN NUMERO SBAGLIATO A SCHERMO.
 *
 * ► COS'È SUCCESSO. ◄ `units.ts` ha `pressioneDiSuperficie()`, che filtra i
 * valori impossibili e ricade sull'atmosfera standard, e il suo commento dice
 * che «la chiamano tutti». Il 16 settembre 2026, misurando, due posti non la
 * chiamavano affatto: `analysis/metrics.ts` e la carta della saturazione.
 * Passavano `dive.surfacePressureBar` grezzo.
 *
 * Su un UDDF con `<surfacepressure>0</surfacepressure>` — quattro lettori
 * possono produrre quello zero, e `shearwaterPnf` lo fa con una divisione per
 * mille su un campo azzerato — 20 m × 40 min, 12 L, 200→80 bar:
 *
 *   - il **consumo** usciva 18.8 L/min invece di 12.3: **+53%**, e senza
 *     nessuna avvertenza, perché la guardia chiede `Number.isFinite(avgBar)` e
 *     con superficie zero `avgBar` è finito — solo sbagliato. Quel numero
 *     finisce in `measuredRmv()` e da lì decide quanti bar servono per
 *     un'immersione;
 *   - i **sedici compartimenti** uscivano TUTTI oltre il valore M — il primo al
 *     248%, il quinto al 328% — cioè il grafico rosso di un'immersione
 *     decompressiva grave su un'uscita tranquilla a venti metri.
 *
 * ► PERCHÉ LA PROVA È COSÌ. ◄ Non basta chiedere «con zero il risultato è
 * sano»: una correzione che ignorasse SEMPRE il campo e usasse sempre
 * l'atmosfera standard passerebbe, e sarebbe un altro difetto — in un lago
 * alpino la pressione vera è 0.795 bar, un valore che Shearwater scrive
 * davvero nei file, e buttarlo via sbaglia il consumo del 21% nell'altro verso.
 * Quindi ogni caso ha due metà: **l'implausibile ricade sullo standard, il
 * plausibile comanda e si vede che comanda.**
 */

import { describe, expect, it, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { computeMetrics } from '../src/core/analysis/metrics';
import { chainArchive } from '../src/core/analysis/tissues';
import { SaturationCard } from '../src/ui/components/Saturation';
import { AIR, type Dive, type Sample } from '../src/core/model';

/** 20 m per 40 minuti, 12 L da 200 a 80 bar: l'immersione della misura. */
function profilo(): Sample[] {
  const out: Sample[] = [];
  for (let t = 0; t <= 2400; t += 10) {
    const depth = t < 120 ? (t / 120) * 20 : t > 2280 ? ((2400 - t) / 120) * 20 : 20;
    out.push({ t, depth, pressureBar: [200 - (120 * t) / 2400] });
  }
  return out;
}

function immersione(superficie: number | undefined): Dive {
  return {
    id: 'x',
    startTime: '2026-06-14T10:38:00.000Z',
    durationS: 2400,
    maxDepth: 20,
    mode: 'oc',
    salinity: 'salt',
    surfacePressureBar: superficie,
    cylinders: [{ mix: AIR, sizeL: 12, startBar: 200, endBar: 80 }],
    source: { format: 'uddf', file: 'test', importedAt: '2026-06-14T12:00:00.000Z' },
    tags: [],
    samples: profilo(),
  };
}

/*
 * I valori che un file può davvero contenere e che una pressione non è: lo zero
 * di una divisione andata male, il `NaN` di un campo illeggibile, il numero di
 * chi ha scritto i pascal al posto dei bar, il negativo di un segno perso.
 */
const IMPOSSIBILI = [0, Number.NaN, 3, -1, 101325];

describe('metriche: la pressione di superficie passa dalla regola', () => {
  const sano = computeMetrics(immersione(undefined));

  it('un consumo sano esiste, altrimenti la prova non sta misurando niente', () => {
    // Senza questa riga tutti i confronti qui sotto potrebbero essere
    // `undefined === undefined`, cioè verdi su un calcolo che non è avvenuto.
    expect(sano.rmvLpm).toBeGreaterThan(11);
    expect(sano.rmvLpm).toBeLessThan(14);
    expect(Number.isFinite(sano.avgAta)).toBe(true);
  });

  for (const valore of IMPOSSIBILI) {
    it(`con superficie ${valore} ricade sull'atmosfera standard`, () => {
      const m = computeMetrics(immersione(valore));
      expect(m.rmvLpm).toBe(sano.rmvLpm);
      expect(m.avgAta).toBe(sano.avgAta);
      expect(m.maxPpo2).toBe(sano.maxPpo2);
    });
  }

  it('una pressione plausibile invece comanda, e si vede che comanda', () => {
    // 0.795 bar: un lago a circa 2000 m. Se la correzione fosse «usa sempre
    // 1.01325» questa riga sarebbe rossa, ed è l'unica che può accorgersene.
    const lago = computeMetrics(immersione(0.795));
    expect(lago.rmvLpm).not.toBe(sano.rmvLpm);
    expect(lago.avgAta!).toBeGreaterThan(sano.avgAta! + 0.4);
    expect(lago.maxPpo2!).toBeLessThan(sano.maxPpo2!);
  });
});

let root: Root | undefined;
let host: HTMLDivElement | undefined;

/** Due montaggi nello stesso `it` vogliono un smontaggio in mezzo. */
function smonta() {
  act(() => root?.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
}
afterEach(smonta);

/**
 * Monta la carta e legge la descrizione testuale del grafico dei sedici.
 *
 * Passa da `chainArchive` perché è da lì che arriva `tissuesEnd`, e perché è
 * **esattamente** il punto del difetto: la catena dei tessuti la pressione la
 * filtrava già (`tissues.ts:94`), il disegno delle barre no. Lo stato era
 * calcolato a un'atmosfera e le tacche del valore M a un'altra: due metà dello
 * stesso grafico che non parlavano della stessa immersione.
 */
async function descrizioneDeiCompartimenti(superficie: number | undefined): Promise<string> {
  const d = immersione(superficie);
  const { dives } = await chainArchive([d], async () => d.samples!);
  const scheda = dives[0]!;
  if (!scheda.metrics?.tissuesEnd) throw new Error('la catena dei tessuti non ha prodotto nulla');
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(<SaturationCard dive={scheda} dives={dives} />);
  });
  const desc = host.querySelector('desc');
  if (!desc) throw new Error('il grafico dei compartimenti non è stato disegnato');
  return desc.textContent ?? '';
}

describe('saturazione: i sedici compartimenti con una superficie impossibile', () => {
  /*
   * Si legge la percentuale del gradiente ammesso del compartimento che comanda
   * e l'elenco di quelli oltre il limite. Sono i due numeri che decidono il
   * colore del disegno, cioè quello che un lettore ci vede.
   */
  const comanda = (d: string) => Number(/— (\d+)% /.exec(d)?.[1] ?? '-1');
  const oltre = (d: string) => /Oltre il limite: ([\d, ]+)/.exec(d)?.[1]?.trim() ?? '';

  it('con una superficie impossibile il grafico è identico a quello senza il campo', async () => {
    const mare = await descrizioneDeiCompartimenti(undefined);
    smonta();
    const zero = await descrizioneDeiCompartimenti(0);

    /*
     * ► LA RIGA CHE MISURA DAVVERO. ◄ Prima della correzione, con lo zero,
     * comandava il compartimento 1 al **248%** e tutti e sedici erano oltre il
     * limite; senza il campo, l'87% che si legge qui. Un'uguaglianza fra i due
     * è il modo più stretto di dire che lo zero non conta più.
     */
    expect(comanda(zero)).toBe(comanda(mare));
    expect(oltre(zero)).toBe(oltre(mare));

    // E un limite assoluto, perché un giorno i due potrebbero diventare uguali
    // e sbagliati insieme: il 248% non deve poter tornare da nessuna porta.
    expect(comanda(mare)).toBeGreaterThan(0);
    expect(comanda(mare)).toBeLessThan(150);
  });

  it('ma in quota il carico si vede davvero più alto', async () => {
    // La metà che impedisce di «correggere» buttando via il campo: a 0.795 bar
    // la percentuale del gradiente ammesso DEVE salire.
    const mare = comanda(await descrizioneDeiCompartimenti(undefined));
    smonta();
    const lago = comanda(await descrizioneDeiCompartimenti(0.795));
    expect(mare).toBeGreaterThan(0);
    expect(lago).toBeGreaterThan(mare);
  });
});
