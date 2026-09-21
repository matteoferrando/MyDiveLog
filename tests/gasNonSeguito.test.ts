/**
 * QUANDO LA DECOMPRESSIONE È RICALCOLATA SULLA BOMBOLA SBAGLIATA.
 *
 * ► PERCHÉ ESISTE. ◄ Una scheda vera, il 14 settembre 2026: immersione a 40,6 m
 * con **EAN28 da 15 L e EAN33 da 7 L**, tutte e due respirate — 120 bar dalla
 * prima, 130 dalla seconda. Il pannello della saturazione mostrava un tetto di
 * **15 m** contro i 6-9 m che il computer aveva registrato, con gli stessi
 * gradient factor 20/85.
 *
 * La causa non è nel modello: `analyseProfile` rilegge il profilo con
 * `dive.cylinders[s.gasIndex ?? 0]`. Quel profilo era stato scaricato **prima
 * della 1.8.18**, quando il cambio di gas veniva buttato via, quindi nessun
 * campione dichiarava la miscela e tutta la decompressione — compresa quella
 * fatta sull'EAN33 — è stata ricalcolata sull'EAN28.
 *
 * ► ED È L'UNICA AVVERTENZA CHE NON PARLA DI UN NUMERO MANCANTE. ◄ Le altre
 * dicono «questo non si può calcolare»: il lettore vede un trattino e sa di non
 * sapere. Questa dice «questi numeri ci sono e poggiano su un'assunzione che
 * non regge», e il tetto sbagliato è più profondo del vero — cioè dalla parte
 * che spaventa, mentre l'obbligo mostrato è più lungo di quello che hai fatto.
 * *Un numero che nessuno mette in dubbio è peggio di un numero che manca.*
 */

import { describe, expect, it } from 'vitest';
import { computeMetrics } from '../src/core/analysis/metrics';
import { avvertenzeComposte } from '../src/core/analysis/avvertenze';
import { type Cylinder, type Dive, type Sample } from '../src/core/model';

const EAN28 = { o2: 0.28, he: 0 };
const EAN33 = { o2: 0.33, he: 0 };

/** Quaranta metri, poi una risalita lenta: la forma della scheda vera. */
const profilo = (conIndice: boolean): Sample[] => {
  const s: Sample[] = [];
  for (let t = 0; t <= 3420; t += 10) {
    const depth = t < 180 ? (40.6 * t) / 180 : t < 1330 ? 40.6 : Math.max(0, 40.6 * (1 - (t - 1330) / 2090));
    // Sotto i 12 m si respira la miscela da decompressione: è il cambio che il
    // profilo o dichiara o no.
    const gasIndex = conIndice ? (depth <= 12 ? 1 : 0) : undefined;
    s.push(gasIndex === undefined ? { t, depth } : { t, depth, gasIndex });
  }
  return s;
};

function scheda(cylinders: Cylinder[], conIndice = false): Dive {
  return {
    id: 'x',
    startTime: '2026-09-13T09:51:00.000Z',
    durationS: 3420,
    maxDepth: 40.6,
    mode: 'oc',
    salinity: 'salt',
    cylinders,
    source: { format: 'libdivecomputer', file: 'bluetooth:x', importedAt: '2026-09-13T20:00:00.000Z' },
    tags: [],
    samples: profilo(conIndice),
  };
}

const DUE_BOMBOLE: Cylinder[] = [
  { mix: EAN28, sizeL: 15, startBar: 200, endBar: 80 },
  { mix: EAN33, sizeL: 7, startBar: 200, endBar: 70 },
];

const avvertenze = (d: Dive) => avvertenzeComposte(computeMetrics(d).quality.caveats, (x) => x).join(' | ');

describe('due bombole respirate e un profilo che non dice quando hai cambiato', () => {
  it('lo dice, invece di dare per buoni tetto e TTS', () => {
    expect(avvertenze(scheda(DUE_BOMBOLE))).toContain('non dice quando hai cambiato');
  });

  it('e dice da che parte sbaglia, non solo che sbaglia', () => {
    /*
     * «Il dato è parziale» lascerebbe credere che il numero sia comunque una
     * stima ragionevole. Il verso conta: il tetto mostrato è più PROFONDO del
     * vero, e chi rilegge la propria immersione deve poterlo sapere senza
     * rifare il conto.
     */
    const testo = avvertenze(scheda(DUE_BOMBOLE));
    expect(testo).toContain('PRIMA bombola');
    expect(testo).toContain('meno profondo');
  });
});

describe('e quando non serve, sta zitta', () => {
  it('col cambio di gas nel profilo non dice niente', () => {
    expect(avvertenze(scheda(DUE_BOMBOLE, true))).not.toContain('non dice quando hai cambiato');
  });

  it('con una bombola sola nemmeno', () => {
    expect(avvertenze(scheda([DUE_BOMBOLE[0]!]))).not.toContain('non dice quando hai cambiato');
  });

  it('e una stage portata e non toccata non conta come respirata', () => {
    /*
     * Due bombole in scheda, ma la seconda esce con la pressione con cui è
     * entrata: il ricalcolo sulla prima è **corretto**, non un ripiego.
     * Avvisare qui sarebbe rumore, e un'avvertenza che compare quando non serve
     * insegna a non leggerle.
     */
    const intatta: Cylinder[] = [DUE_BOMBOLE[0]!, { mix: EAN33, sizeL: 7, startBar: 200, endBar: 200 }];
    expect(avvertenze(scheda(intatta))).not.toContain('non dice quando hai cambiato');
  });

  it('e senza profilo non c’è nessun ricalcolo da mettere in dubbio', () => {
    const senzaProfilo: Dive = { ...scheda(DUE_BOMBOLE), samples: [] };
    expect(avvertenze(senzaProfilo)).not.toContain('non dice quando hai cambiato');
  });
});
