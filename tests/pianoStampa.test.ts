/**
 * Il foglio del piano da stampare.
 *
 * Si prova come stringa, che è tutto il motivo per cui `pianoHtml` è una
 * funzione pura: l'impaginazione vera la decide il sistema al momento della
 * stampa, e non si può verificare da qui. Quello che si può verificare — e che
 * conta — è che il documento contenga i numeri giusti, che le soste
 * obbligatorie siano marcate, e che niente di quello che l'utente ha scritto
 * possa uscire dal testo ed essere eseguito dalla finestra che apriamo.
 */

import { describe, expect, it } from 'vitest';
import { pianoHtml, type FoglioPiano } from '../src/core/export/planPrint';
import { foglioDelPiano } from '../src/core/export/planSheet';
import { DEFAULT_PLAN, phaseGeometry, planGas, pressureSchedule } from '../src/core/analysis/gasPlan';
import { curveOfPlan } from '../src/core/analysis/tissues';
import { DEFAULT_DECO, planDeco } from '../src/core/analysis/deco';

const base: FoglioPiano = {
  titolo: 'Piano 30 m · 25 min di fondo · EAN32',
  sottotitolo: 'Ricreativo, Bühlmann ZH-L16C GF 40/85.',
  now: '2026-08-19T10:00:00Z',
  sezioni: [
    {
      titolo: 'Il piano',
      righe: [
        ['Profondità massima', '30 m'],
        ['Tempo di fondo', '25 min'],
      ],
    },
    {
      titolo: 'Run time schedule',
      colonne: ['Min', 'Quota', 'Azione', 'Durata'],
      numeriche: [0, 3],
      righe: [
        ['25', '30 m', 'fondo', '25 min'],
        ['28', '30 → 6 m', 'risalita', '2.4 min'],
        ['34', '6 m', 'SOSTA', '6 min'],
      ],
      forti: [2],
    },
  ],
};

describe('foglio del piano', () => {
  it('contiene i numeri e le intestazioni', () => {
    const html = pianoHtml(base);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('Piano 30 m');
    expect(html).toContain('Run time schedule');
    expect(html).toContain('>25 min<');
    expect(html).toContain('SOSTA');
  });

  it('marca le soste obbligatorie, perché su carta la differenza deve vedersi', () => {
    /*
     * Non è una scelta grafica: fra «sosta di sicurezza» e «obbligo
     * decompressivo» passa la differenza fra una cosa che puoi saltare e una
     * che non puoi. In barca, con le mani bagnate, quella differenza va vista
     * senza doverla leggere.
     */
    const html = pianoHtml(base);
    expect(html).toMatch(/<tr class="forte">.*SOSTA/s);
    // E il fondo delle righe forti deve sopravvivere alla stampa: i browser
    // tolgono gli sfondi «per risparmiare inchiostro» se non glielo si vieta.
    expect(html).toContain('print-color-adjust: exact');
  });

  it('le colonne numeriche vanno a destra, in entrambe le righe e le intestazioni', () => {
    const html = pianoHtml(base);
    expect(html).toContain('<th class="num">Min</th>');
    expect(html).toContain('<td class="num">25</td>');
  });

  it('le sezioni vuote non lasciano un titolo senza tabella', () => {
    const html = pianoHtml({ ...base, sezioni: [...base.sezioni, { titolo: 'Vuota', righe: [] }] });
    expect(html).not.toContain('Vuota');
  });

  it('il testo scritto a mano viene STAMPATO, non eseguito', () => {
    /*
     * Le note di un piano sono testo libero, e un piano può arrivare da un
     * archivio importato da qualcun altro. La finestra che apriamo esegue il
     * documento che le passiamo: qui dentro non deve poterci entrare niente
     * che non sia testo.
     */
    const html = pianoHtml({
      ...base,
      titolo: '<script>alert(1)</script>',
      note: 'occhio alla corrente <img src=x onerror=alert(1)>',
      avvisi: [{ livello: 'critical', testo: '</li><script>alert(2)</script>' }],
    });
    expect(html).not.toContain('<script>alert');
    // Il tag è diventato testo: resta leggibile e non è più un tag.
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('&lt;script&gt;');
  });

  it('la data di generazione si vede a schermo e sparisce in stampa', () => {
    const html = pianoHtml(base);
    expect(html).toContain('nostampa');
    expect(html.slice(html.indexOf('@media print'))).toContain('.nostampa { display: none');
  });

  it('senza data non si inventa un orologio', () => {
    // La funzione è pura: se chi chiama non passa l'istante, il foglio non lo
    // dichiara. Una data sbagliata su un piano stampato è peggio di nessuna data.
    const html = pianoHtml({ ...base, now: undefined });
    expect(html).not.toContain('Generato il');
  });
});

/*
 * IL FOGLIO PRIMA DELL'HTML: `foglioDelPiano`.
 *
 * `pianoHtml` era coperto, la funzione che DECIDE cosa ci va dentro no — e i due
 * difetti peggiori della stampa stavano lì: il sottotitolo che prometteva la
 * decompressione su un foglio che stampa una risalita diretta, e l'avviso «questo
 * profilo prende un obbligo» che spariva proprio dalla modalità in cui il run
 * time schedule non c'è. Un modulo senza test è il posto in cui i difetti
 * aspettano.
 */
describe('cosa finisce sul foglio, prima di diventare HTML', () => {
  const input = {
    ...DEFAULT_PLAN,
    depthM: 40,
    avgDepthM: 34,
    bottomMin: 30,
    rmvLpm: 18,
    tankL: 24,
    startBar: 200,
  };
  const contesto = (mode: 'rec' | 'tec') => {
    const plan = planGas(input);
    const curve = curveOfPlan(
      phaseGeometry(plan.planned).map((seg) => ({
        fromM: seg.fromM,
        toM: seg.toM,
        minutes: seg.phase.minutes,
      })),
      {
        mix: input.mix,
        avgDepthM: input.avgDepthM,
        maxDepthM: input.depthM,
        gfLow: 0.4,
        gfHigh: 0.85,
        salinity: input.salinity,
      },
    );
    const soste =
      mode === 'rec' && curve.leavesCurveAtMin !== undefined
        ? planDeco(
            [{ depthM: input.avgDepthM, minutes: input.bottomMin }],
            [{ mix: input.mix, role: 'bottom' as const, tankL: input.tankL, startBar: input.startBar }],
            { ...DEFAULT_DECO, gfLow: 0.4, gfHigh: 0.85 },
          )
        : undefined;
    return foglioDelPiano({
      plan,
      schedule: pressureSchedule(plan),
      curve,
      soste,
      contingenze: [],
      mode,
      gf: { low: 40, high: 85 },
    });
  };

  it('in modalità tecnica non promette una decompressione che non stampa', () => {
    const f = contesto('tec');
    expect(f.sottotitolo).not.toMatch(/con decompressione/);
    expect(f.sezioni.some((s) => s.titolo === 'Run time schedule')).toBe(false);
  });

  it('e l’avviso dell’obbligo c’è in ENTRAMBE le modalità', () => {
    for (const mode of ['rec', 'tec'] as const) {
      const f = contesto(mode);
      expect(
        (f.avvisi ?? []).some((a) => a.livello === 'critical' && /decompressione/.test(a.testo)),
        `modalità ${mode}`,
      ).toBe(true);
    }
  });

  it('con le soste, la durata totale è quella dello schedule', () => {
    const f = contesto('rec');
    const durata = f.sezioni[0].righe?.find((r) => r[0] === 'Durata totale')?.[1] ?? '';
    expect(durata).toMatch(/soste comprese/);
    /*
     * E deve COINCIDERE con l'ultima riga dello schedule, non con la risalita
     * diretta: sullo stesso foglio si leggeva «45 min» sopra uno schedule la cui
     * ultima riga era al minuto 59.
     */
    const schedule = f.sezioni.find((s) => s.titolo === 'Run time schedule');
    const ultimoMinuto = Number(schedule?.righe?.[schedule.righe.length - 1]?.[0]);
    expect(ultimoMinuto).toBeGreaterThan(0);
    // La durata è scritta come «1 h 02 min» o «59 min»: si confrontano i minuti.
    const minutiScritti = durata.match(/(\d+)\s*h/)
      ? Number(durata.match(/(\d+)\s*h/)![1]) * 60 + Number(durata.match(/h\s*(\d+)/)?.[1] ?? 0)
      : Number(durata.match(/(\d+)/)?.[1]);
    expect(Math.abs(minutiScritti - ultimoMinuto)).toBeLessThanOrEqual(1);
  });

  it('e la tabella delle pressioni dichiara di descrivere la risalita diretta', () => {
    const f = contesto('rec');
    const pressioni = f.sezioni.find((s) => s.titolo === 'Pressione attesa');
    expect(pressioni?.descrizione).toMatch(/risalita DIRETTA/);
  });
});
