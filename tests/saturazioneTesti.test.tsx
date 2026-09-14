// @vitest-environment jsdom
/**
 * LE DUE RIGHE DEL PANNELLO DELLA SATURAZIONE CHE DICEVANO UNA COSA STORTA.
 *
 * ► PERCHÉ ESISTE. ◄ Guardando una scheda vera, il 14 settembre 2026, il
 * riquadro del residuo diceva:
 *
 *   «Il residuo non ha inciso. 16 h 6 min di pausa sono bastati: da tessuti
 *    puliti saresti uscito al **69% invece del 69%**.»
 *
 * Una frase che dichiara una differenza fra un numero e se stesso. Il difetto
 * non è nella frase: quel ramo viene scelto **proprio perché** il costo è sotto
 * mezzo punto, e poi stampa i due numeri arrotondati all'intero, che a quel
 * punto sono quasi sempre identici. *La condizione guardava il delta grezzo
 * mentre il lettore vede i numeri arrotondati: il numero che decide dev'essere
 * il numero che si mostra.* È la stessa forma del difetto della profondità
 * media, dove chi decideva e chi mostrava leggevano due campi diversi.
 *
 * E accanto, la seconda: il compartimento che comanda era descritto come
 * «tessuto veloce» — il sesto di ZH-L16C, che ha un emitempo di **38,3
 * minuti**. Le soglie restano dove sono, perché dove finisca «veloce» è
 * opinabile comunque; ma adesso accanto all'aggettivo c'è il numero, che
 * opinabile non è.
 */

import { describe, expect, it, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SaturationCard } from '../src/ui/components/Saturation';
import { chainArchive } from '../src/core/analysis/tissues';
import { computeMetrics } from '../src/core/analysis/metrics';
import { AIR, type Dive, type Sample } from '../src/core/model';

const profilo = (): Sample[] =>
  Array.from({ length: 343 }, (_, i) => {
    const t = i * 10;
    const depth = t < 180 ? (40 * t) / 180 : t < 1300 ? 40 : Math.max(0, 40 * (1 - (t - 1300) / 2100));
    return { t, depth, tempC: 17 };
  });

function immersione(id: string, quando: string): Dive {
  const d: Dive = {
    id,
    startTime: quando,
    durationS: 3420,
    maxDepth: 40,
    mode: 'oc',
    salinity: 'salt',
    cylinders: [{ mix: AIR, sizeL: 15, startBar: 200, endBar: 80 }],
    source: { format: 'uddf', file: 'x', importedAt: quando },
    tags: [],
    samples: profilo(),
  };
  d.metrics = computeMetrics(d);
  return d;
}

let root: Root | undefined;
let host: HTMLDivElement | undefined;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
});

/** Monta la scheda su due immersioni a sedici ore di distanza e legge il testo. */
async function testoDelPannello(): Promise<string> {
  const prima = immersione('a', '2026-09-12T17:45:00.000Z');
  const dopo = immersione('b', '2026-09-13T09:51:00.000Z');
  const { dives } = await chainArchive([prima, dopo], async (id) =>
    id === 'a' ? prima.samples! : dopo.samples!,
  );
  const scheda = dives.find((d) => d.id === 'b')!;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(<SaturationCard dive={scheda} dives={dives} />);
  });
  return host.textContent ?? '';
}

describe('il riquadro del residuo', () => {
  it('non dichiara mai una differenza fra un numero e se stesso', async () => {
    /*
     * ► LA RIGA CHE RIPRODUCE LA SEGNALAZIONE, E LA PRIMA VERSIONE NON LA
     * RIPRODUCEVA. ◄ Cercava la stringa «N% invece del N%», cioè la
     * **formulazione vecchia**: cambiando la frase senza togliere il difetto —
     * «sei uscito al 133%, da tessuti puliti saresti uscito al 133%» — la prova
     * restava verde. *Una guardia scritta contro il testo di ieri non protegge
     * da quello di domani: va scritta contro il difetto.*
     *
     * Il difetto è: **nel riquadro del residuo la stessa percentuale compare
     * due volte**, come se fosse un confronto. Qualunque parola ci sia in mezzo.
     */
    const testo = await testoDelPannello();
    const riquadro = /(?:Il residuo non ha inciso|L’intervallo di superficie è costato)[^]{0,200}/.exec(
      testo,
    );
    expect(riquadro, 'il riquadro del residuo non è stato disegnato').not.toBeNull();
    const percentuali = [...riquadro![0].matchAll(/(\d+)%/g)].map((m) => m[1]);
    const ripetute = percentuali.filter((v, i) => percentuali.indexOf(v) !== i);
    expect(ripetute, `«${riquadro![0].slice(0, 120)}…» dice due volte lo stesso numero`).toEqual([]);
  });

  it('e quando il residuo non ha inciso lo dice per esteso', async () => {
    const testo = await testoDelPannello();
    if (!testo.includes('non ha inciso')) return; // l'altro ramo ha una prova sua
    expect(testo).toMatch(/sei uscito al \d+%/);
  });
});

describe('il compartimento che comanda', () => {
  it('porta il proprio emitempo, non solo un aggettivo', async () => {
    /*
     * «Tessuto veloce» su un compartimento da 38 minuti è una descrizione che
     * non regge; «38 min» regge sempre. Chi legge può dissentire
     * sull'etichetta e avere comunque il dato.
     */
    const testo = await testoDelPannello();
    expect(testo).toMatch(/semiperiodo \d+ min/);
  });
});
