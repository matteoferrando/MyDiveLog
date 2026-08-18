/**
 * Il generatore di tabelle di decompressione.
 *
 * Un pianificatore di deco è la cosa più pericolosa in un'app subacquea: produce
 * numeri credibili per qualunque input, e chi li legge non ha modo di accorgersi
 * che sono sbagliati finché non è in acqua. Qui i controlli sono di quattro tipi:
 *
 *  1. **Ordini di grandezza noti** — 30 m per 20 minuti in aria produce pochi
 *     minuti di sosta, 45 m per 25 minuti ne produce decine. Sono intervalli larghi
 *     presi dalla letteratura, non valori esatti: due implementazioni non danno mai
 *     la stessa tabella.
 *  2. **Monotonie che devono valere sempre** — più profondo, più lungo e gradient
 *     factor più stretti non possono mai accorciare la decompressione.
 *  3. **Coerenza interna** — il runtime è la somma dei segmenti, le soste salgono,
 *     il gas cambia solo dove è respirabile.
 *  4. **I casi in cui deve rifiutarsi di essere ottimista** — gas insufficiente,
 *     PPO2 fuori limite, controdiffusione.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DECO,
  barometric,
  bestGasAt,
  breathedAt,
  decoContingencies,
  planDeco,
  switchDepthOf,
  tissuesAtAltitude,
  afterSurfaceInterval,
  bailoutPlan,
  decoTableText,
  planSeries,
  type PlanGas,
} from '../src/core/analysis/deco';
import { gf99 } from '../src/core/analysis/buhlmann';

const AIR: PlanGas = { mix: { o2: 0.21, he: 0 }, role: 'bottom', tankL: 24, startBar: 200 };
const TX2135: PlanGas = { mix: { o2: 0.21, he: 0.35 }, role: 'bottom', tankL: 24, startBar: 200 };
const EAN50: PlanGas = { mix: { o2: 0.5, he: 0 }, role: 'deco', tankL: 11, startBar: 200 };
const OXY: PlanGas = { mix: { o2: 1, he: 0 }, role: 'deco', tankL: 11, startBar: 200 };
const GF = { gfLow: 0.4, gfHigh: 0.85 };

describe('immersioni in curva', () => {
  it('18 m per 40 minuti in aria non produce soste obbligate', () => {
    const r = planDeco([{ depthM: 18, minutes: 40 }], [AIR], GF);
    expect(r.noDeco).toBe(true);
    expect(r.decoMin).toBe(0);
    // Nessuna sosta IMPOSTA. Quella di sicurezza c'è, ma è una scelta ed è
    // marcata come tale: vedi il gruppo di test dedicato.
    expect(r.stops.filter((x) => x.mandatory)).toHaveLength(0);
  });

  it('il limite di non decompressione a 18 m sta nella fascia dei manuali', () => {
    const r = planDeco([{ depthM: 18, minutes: 10 }], [AIR], GF);
    expect(r.ndlMin).toBeGreaterThan(30);
    expect(r.ndlMin).toBeLessThan(70);
  });

  it('superato il limite compaiono le soste', () => {
    const corta = planDeco([{ depthM: 30, minutes: 10 }], [AIR], GF);
    const lunga = planDeco([{ depthM: 30, minutes: 30 }], [AIR], GF);
    expect(corta.noDeco).toBe(true);
    expect(lunga.noDeco).toBe(false);
    expect(lunga.stops.filter((x) => x.mandatory).length).toBeGreaterThan(0);
  });
});

describe('monotonie che devono valere sempre', () => {
  it('più profondo non può accorciare la decompressione', () => {
    const a = planDeco([{ depthM: 36, minutes: 25 }], [AIR, EAN50], GF);
    const b = planDeco([{ depthM: 42, minutes: 25 }], [AIR, EAN50], GF);
    expect(b.decoMin).toBeGreaterThanOrEqual(a.decoMin);
  });

  it('più lungo non può accorciare la decompressione', () => {
    const a = planDeco([{ depthM: 40, minutes: 20 }], [AIR, EAN50], GF);
    const b = planDeco([{ depthM: 40, minutes: 35 }], [AIR, EAN50], GF);
    expect(b.decoMin).toBeGreaterThan(a.decoMin);
  });

  it('gradient factor più stretti allungano', () => {
    const largo = planDeco([{ depthM: 40, minutes: 25 }], [AIR, EAN50], { gfLow: 0.5, gfHigh: 0.95 });
    const stretto = planDeco([{ depthM: 40, minutes: 25 }], [AIR, EAN50], { gfLow: 0.2, gfHigh: 0.7 });
    expect(stretto.decoMin).toBeGreaterThan(largo.decoMin);
    expect(stretto.firstStopM!).toBeGreaterThanOrEqual(largo.firstStopM!);
  });

  it('un gas ricco di ossigeno accorcia la decompressione', () => {
    const solaAria = planDeco([{ depthM: 40, minutes: 25 }], [AIR], GF);
    const conNitrox = planDeco([{ depthM: 40, minutes: 25 }], [AIR, EAN50, OXY], GF);
    expect(conNitrox.decoMin).toBeLessThan(solaAria.decoMin);
  });
});

describe('coerenza interna della tabella', () => {
  const r = planDeco([{ depthM: 45, minutes: 25 }], [TX2135, EAN50, OXY], {
    gfLow: 0.3,
    gfHigh: 0.8,
    lastStopM: 6,
  });

  it('il runtime è la somma dei segmenti', () => {
    const somma = r.segments.reduce((a, x) => a + x.minutes, 0);
    expect(Math.abs(somma - r.runtimeMin)).toBeLessThan(0.2);
  });

  it('il runtime di ogni riga cresce', () => {
    for (let i = 1; i < r.segments.length; i++) {
      expect(r.segments[i].runtimeMin).toBeGreaterThanOrEqual(r.segments[i - 1].runtimeMin);
    }
  });

  it('le soste risalgono, non scendono', () => {
    for (let i = 1; i < r.stops.length; i++) {
      expect(r.stops[i].depthM).toBeLessThan(r.stops[i - 1].depthM);
    }
  });

  it('l’ultima sosta è quella impostata e nessuna è più bassa', () => {
    expect(r.stops[r.stops.length - 1].depthM).toBe(6);
    for (const s of r.stops) expect(s.depthM).toBeGreaterThanOrEqual(6);
  });

  it('il CNS progressivo non diminuisce mai', () => {
    for (let i = 1; i < r.segments.length; i++) {
      expect(r.segments[i].cnsTotal).toBeGreaterThanOrEqual(r.segments[i - 1].cnsTotal);
    }
  });

  it('il GF99 all’uscita non supera il GF alto impostato', () => {
    // È la definizione stessa di gfHigh: se la tabella lo sfora, la risalita è
    // stata calcolata con un limite diverso da quello dichiarato.
    expect(r.gf99EndPct).toBeLessThanOrEqual(80 + 1);
  });
});

describe('scelta del gas', () => {
  it('la MOD si arrotonda al metro, così l’ossigeno serve a sei metri', () => {
    // Troncando in giù verrebbe 5 m e la sosta dei 6 m resterebbe senza ossigeno:
    // è successo, ed è il motivo per cui questo test esiste.
    expect(switchDepthOf(OXY, DEFAULT_DECO)).toBe(6);
    expect(bestGasAt(6, [AIR, EAN50, OXY], DEFAULT_DECO)).toBe(2);
  });

  it('a 21 metri si respira l’EAN50, a 40 no', () => {
    expect(bestGasAt(21, [AIR, EAN50, OXY], DEFAULT_DECO)).toBe(1);
    expect(bestGasAt(40, [AIR, EAN50, OXY], DEFAULT_DECO)).toBe(0);
  });

  it('il transito verso un livello più basso non anticipa il cambio gas', () => {
    // Il difetto trovato provando il motore: salendo da 40 a 20 metri il piano
    // passava all'EAN50 PRIMA di risalire, cioè prevedeva di respirarlo a
    // quaranta metri, a 2.5 bar di PPO2.
    const r = planDeco(
      [
        { depthM: 40, minutes: 15 },
        { depthM: 20, minutes: 20 },
      ],
      [AIR, EAN50],
      GF,
    );
    const profondi = r.segments.filter((x) => Math.max(x.fromM, x.toM) > 25);
    for (const seg of profondi) expect(seg.ppo2).toBeLessThan(1.7);
  });

  it('sul circuito chiuso la miscela respirata segue il setpoint', () => {
    const dil: PlanGas = { mix: { o2: 0.21, he: 0.35 }, role: 'bottom', setpointBar: 1.3 };
    const a6 = breathedAt(6, dil, 1.3, DEFAULT_DECO);
    const a45 = breathedAt(45, dil, 1.3, DEFAULT_DECO);
    // A sei metri il loop è quasi ossigeno puro; a quarantacinque è quasi diluente.
    expect(a6.o2).toBeGreaterThan(0.8);
    expect(a45.o2).toBeLessThan(0.3);
    expect(a45.he).toBeGreaterThan(a6.he);
  });
});

describe('quando deve rifiutarsi di essere ottimista', () => {
  it('dichiara il gas insufficiente invece di far finta di niente', () => {
    const piccola: PlanGas = { ...TX2135, tankL: 7, startBar: 150 };
    const r = planDeco([{ depthM: 45, minutes: 30 }], [piccola, EAN50, OXY], { gfLow: 0.3, gfHigh: 0.8 });
    expect(r.gasUsage[0].insufficient).toBe(true);
    expect(r.warnings.some((w) => w.level === 'critical')).toBe(true);
  });

  it('segnala la controdiffusione passando da un trimix ricco di elio al nitrox', () => {
    const tx1860: PlanGas = { mix: { o2: 0.18, he: 0.6 }, role: 'bottom', tankL: 24, startBar: 200 };
    const r = planDeco([{ depthM: 50, minutes: 25 }], [tx1860, EAN50, OXY], { gfLow: 0.3, gfHigh: 0.8 });
    expect(r.icd.length).toBeGreaterThan(0);
    expect(r.icd[0].n2RiseBar).toBeGreaterThan(r.icd[0].heDropBar / 5);
  });

  it('non segnala controdiffusione dove non ce n’è', () => {
    const r = planDeco([{ depthM: 40, minutes: 25 }], [AIR, EAN50], GF);
    expect(r.icd).toHaveLength(0);
  });

  it('l’ossigeno alla sosta dei sei metri non fa gridare al limite superato', () => {
    const r = planDeco([{ depthM: 45, minutes: 25 }], [TX2135, EAN50, OXY], {
      gfLow: 0.3,
      gfHigh: 0.8,
      lastStopM: 6,
    });
    // 1.61 bar è la PPO2 dell'ossigeno puro a sei metri: è la procedura standard,
    // e un avviso critico proprio lì insegnerebbe a ignorare tutti gli avvisi.
    expect(r.warnings.filter((w) => w.level === 'critical' && w.text.includes('PPO2'))).toHaveLength(0);
  });
});

describe('contingenze', () => {
  const list = decoContingencies([{ depthM: 45, minutes: 25 }], [TX2135, EAN50, OXY], {
    gfLow: 0.3,
    gfHigh: 0.8,
    lastStopM: 6,
  });

  it('copre più profondo, più lungo, entrambi e ogni gas perso', () => {
    const ids = list.map((c) => c.id);
    expect(ids).toContain('deeper');
    expect(ids).toContain('longer');
    expect(ids).toContain('both');
    expect(ids.filter((x) => x.startsWith('lost-'))).toHaveLength(2);
  });

  it('nessuna contingenza accorcia la decompressione', () => {
    for (const c of list) expect(c.extraDecoMin).toBeGreaterThanOrEqual(0);
  });

  it('più giù e più a lungo costa più di ciascuna delle due', () => {
    const d = list.find((c) => c.id === 'deeper')!;
    const l = list.find((c) => c.id === 'longer')!;
    const b = list.find((c) => c.id === 'both')!;
    expect(b.extraDecoMin).toBeGreaterThanOrEqual(Math.max(d.extraDecoMin, l.extraDecoMin));
  });

  it('perdere un gas di decompressione allunga la risalita', () => {
    const perso = list.find((c) => c.id.startsWith('lost-'))!;
    expect(perso.extraDecoMin).toBeGreaterThan(0);
  });
});

describe('quota e tempo di volo', () => {
  it('la formula barometrica dà valori noti', () => {
    expect(barometric(0)).toBeCloseTo(1.013, 2);
    // 2400 m è la quota di cabina di un aereo pressurizzato: ~0.75 bar.
    expect(barometric(2400)).toBeGreaterThan(0.73);
    expect(barometric(2400)).toBeLessThan(0.78);
  });

  it('un’immersione impegnativa allunga l’attesa prima del volo', () => {
    const leggera = planDeco([{ depthM: 15, minutes: 30 }], [AIR], GF);
    const pesante = planDeco([{ depthM: 45, minutes: 30 }], [TX2135, EAN50, OXY], {
      gfLow: 0.3,
      gfHigh: 0.8,
    });
    expect(pesante.timeToFlyH!).toBeGreaterThanOrEqual(leggera.timeToFlyH!);
  });
});

describe('il piano vuoto non esplode', () => {
  it('senza livelli restituisce un risultato vuoto', () => {
    const r = planDeco([], [AIR], GF);
    expect(r.runtimeMin).toBe(0);
    expect(r.segments).toHaveLength(0);
  });

  it('senza gas restituisce un risultato vuoto', () => {
    const r = planDeco([{ depthM: 30, minutes: 20 }], [], GF);
    expect(r.segments).toHaveLength(0);
  });
});

describe('quota e ripetitive', () => {
  it('a quota la stessa immersione produce più decompressione', () => {
    const mare = planDeco([{ depthM: 30, minutes: 30 }], [AIR], GF);
    const lago = planDeco([{ depthM: 30, minutes: 30 }], [AIR], {
      ...GF,
      salinity: 'fresh',
      surfacePressureBar: barometric(1500),
    });
    expect(lago.decoMin).toBeGreaterThan(mare.decoMin);
  });

  it('chi è appena salito in quota parte con dell’azoto in più', () => {
    const appena = tissuesAtAltitude(2000, 0);
    const acclimatato = tissuesAtAltitude(2000, 48);
    const surf = barometric(2000);
    // «Appena arrivato» significa tessuti ancora in equilibrio col livello del
    // mare, cioè più carichi di quanto la quota consenta.
    expect(appena.n2[0]).toBeGreaterThan(acclimatato.n2[0]);
    // NON si controlla il GF99: a duemila metri i tessuti del livello del mare
    // stanno a 0.75 bar contro 0.79 di ambiente, cioè non sono sovrasaturi e il
    // GF99 è zero per entrambi. È lo stesso equivoco del carico residuo fra due
    // immersioni — l'azoto in più c'è, ma si paga scendendo, non stando fermi.
    expect(gf99(appena, surf).percent).toBe(0);
    const conCarico = planDeco([{ depthM: 30, minutes: 30 }], [AIR], {
      ...GF,
      salinity: 'fresh',
      surfacePressureBar: surf,
      initial: appena,
    });
    const senza = planDeco([{ depthM: 30, minutes: 30 }], [AIR], {
      ...GF,
      salinity: 'fresh',
      surfacePressureBar: surf,
      initial: acclimatato,
    });
    // Dove si vede il carico: nella DURATA della decompressione, non nel GF99
    // all'uscita. La tabella decomprime finché il tetto non lascia salire, quindi
    // entrambe escono appena sotto il GF alto — chi è partito più carico ci
    // arriva otto minuti dopo. Cercare la differenza nel GF99 finale è l'errore
    // che questo commento esiste per evitare la prossima volta.
    expect(conCarico.decoMin).toBeGreaterThan(senza.decoMin);
    expect(conCarico.runtimeMin).toBeGreaterThan(senza.runtimeMin);
  });

  it('al livello del mare l’acclimatazione non cambia niente', () => {
    expect(tissuesAtAltitude(0, 0).n2[0]).toBeCloseTo(tissuesAtAltitude(0, 48).n2[0], 6);
  });

  it('una ripetitiva ha più decompressione della stessa immersione fatta da pulita', () => {
    const prima = planDeco([{ depthM: 35, minutes: 30 }], [AIR, EAN50], GF);
    const dopoUnOra = planDeco([{ depthM: 35, minutes: 30 }], [AIR, EAN50], {
      ...GF,
      initial: afterSurfaceInterval(prima.finalTissues, 60),
    });
    expect(dopoUnOra.decoMin).toBeGreaterThan(prima.decoMin);
  });

  it('più lungo è l’intervallo di superficie, meno costa la ripetitiva', () => {
    const prima = planDeco([{ depthM: 35, minutes: 30 }], [AIR, EAN50], GF);
    const deco = (min: number) =>
      planDeco([{ depthM: 35, minutes: 30 }], [AIR, EAN50], {
        ...GF,
        initial: afterSurfaceInterval(prima.finalTissues, min),
      }).decoMin;
    expect(deco(30)).toBeGreaterThanOrEqual(deco(120));
    expect(deco(120)).toBeGreaterThanOrEqual(deco(600));
  });
});

describe('circuito chiuso', () => {
  const DIL: PlanGas = { mix: { o2: 0.21, he: 0.35 }, role: 'bottom', tankL: 3, startBar: 200 };
  const BAIL: PlanGas = { mix: { o2: 0.18, he: 0.45 }, role: 'bailout', tankL: 11, startBar: 200 };
  const CCR = { gfLow: 0.3, gfHigh: 0.8, lastStopM: 6, ccrO2TankL: 3, ccrO2StartBar: 200 };
  const levels = [{ depthM: 60, minutes: 30, setpointBar: 1.3 }];

  it('l’ossigeno metabolico non dipende dalla profondità', () => {
    // Solo il fondo, senza risalita: è lì che l'invariante è pulita. Con la
    // risalita dentro, l'immersione profonda decomprime di più e consuma al ritmo
    // ridotto della deco, quindi il litri-al-minuto complessivo cambia — per una
    // ragione che non c'entra con la profondità.
    const soloFondo = { ...CCR, bottomOnly: true };
    const basso = planDeco([{ depthM: 20, minutes: 30, setpointBar: 1.3 }], [DIL, EAN50], soloFondo);
    const profondo = planDeco([{ depthM: 50, minutes: 30, setpointBar: 1.3 }], [DIL, EAN50], soloFondo);
    // A parità di MINUTO si consuma lo stesso ossigeno, comunque sia profonda
    // l'immersione: è la differenza fra un rebreather e un circuito aperto, e se
    // questo test fallisce il modello CCR sta contando la ventilazione. Il totale
    // invece differisce, ed è giusto: l'immersione profonda dura di più perché
    // decomprime.
    expect(basso.ccr!.o2Litres).toBeCloseTo(profondo.ccr!.o2Litres, 0);
    // Il diluente invece sì: riempire il circuito a cinquanta metri costa di più.
    expect(profondo.ccr!.diluentLitres).toBeGreaterThan(basso.ccr!.diluentLitres);
  });

  it('a circuito aperto la stessa immersione consuma un ordine di grandezza in più', () => {
    const chiuso = planDeco(levels, [DIL, EAN50], CCR);
    const aperto = planDeco([{ depthM: 60, minutes: 30 }], [{ ...DIL, tankL: 24 }, EAN50], CCR);
    const apertoL = aperto.gasUsage.reduce((a, u) => a + u.litres, 0);
    expect(apertoL).toBeGreaterThan((chiuso.ccr!.o2Litres + chiuso.ccr!.diluentLitres) * 10);
  });

  it('il bailout riparte dai tessuti di fine fondo e usa la bombola giusta', () => {
    const b = bailoutPlan(levels, [DIL, BAIL, EAN50], CCR)!;
    expect(b.runtimeMin).toBeGreaterThan(0);
    // La bombola da 11 L, non i 3 L del diluente: a parità di miscela vince la più
    // capiente, ed è il difetto che si vedeva come «servono 227 bar su 200».
    const used = b.gasUsage.filter((u) => u.litres > 0).map((u) => u.tankL);
    expect(used).not.toContain(3);
  });

  it('il bailout è più lungo del fondo perché parte dal momento peggiore', () => {
    const b = bailoutPlan(levels, [DIL, BAIL, EAN50], CCR)!;
    expect(b.decoMin).toBeGreaterThan(10);
    expect(b.stops.length).toBeGreaterThan(1);
  });

  it('senza livelli non produce un bailout finto', () => {
    expect(bailoutPlan([], [DIL], CCR)).toBeUndefined();
  });

  it('avvisa quando al fondo non c’è una miscela respirabile, anche se ci sono soste', () => {
    // Il difetto: bastava l'esistenza di una sosta perché il controllo sul limite
    // di lavoro smettesse di funzionare, e un fondo a 1.5 bar passava in silenzio.
    const r = planDeco([{ depthM: 60, minutes: 30 }], [{ ...DIL, tankL: 24 }, EAN50], CCR);
    expect(r.stops.length).toBeGreaterThan(0);
    expect(r.warnings.some((w) => w.text.includes('fase di lavoro'))).toBe(true);
  });
});

describe('il foglio da portare in acqua', () => {
  const levels = [{ depthM: 45, minutes: 25 }];
  const gases = [TX2135, EAN50, OXY];
  const opts = { gfLow: 0.3, gfHigh: 0.8, lastStopM: 6 };
  const text = decoTableText(planDeco(levels, gases, opts), levels, gases, opts);

  it('contiene le soste con il runtime, che è la ragione per cui esiste', () => {
    expect(text).toContain('SOSTE');
    expect(text).toMatch(/6 m\s+\d+\s+\d+\s+O₂/);
  });

  it('dice il gas in bar e quanto ne hai a bordo', () => {
    expect(text).toMatch(/Tx21\/35\s+\d+ bar su 200/);
  });

  it('non tace su un gas che non basta', () => {
    const piccola = { ...TX2135, tankL: 7, startBar: 150 };
    const t = decoTableText(
      planDeco(levels, [piccola, EAN50, OXY], opts),
      levels,
      [piccola, EAN50, OXY],
      opts,
    );
    expect(t).toContain('NON BASTA');
    expect(t).toContain('AVVISI');
  });

  it('l’ossigeno alla sosta dei sei metri non genera un avviso di PPO2 di lavoro', () => {
    // Il tratto finale 6 m → superficie è decompressione, non lavoro: classificarlo
    // per tipo invece che per momento faceva comparire «1.62 bar in fase di lavoro»
    // sulla sosta finale di qualunque procedura.
    expect(text).not.toContain('fase di lavoro');
  });

  it('su un piano in curva lo dice invece di stampare una tabella vuota', () => {
    const curva = [{ depthM: 18, minutes: 40 }];
    const senzaSosta = { ...GF, safetyStop: null };
    const t = decoTableText(planDeco(curva, [AIR], senzaSosta), curva, [AIR], senzaSosta);
    expect(t).toContain('SOSTE: nessuna');
    expect(t).toContain('resta in curva');
  });
});

describe('soste imposte da un altro modello', () => {
  const levels = [{ depthM: 45, minutes: 25 }];
  const gases = [TX2135, EAN50, OXY];
  const opts = { gfLow: 0.3, gfHigh: 0.8, lastStopM: 6 };

  it('esegue la tabella che riceve invece di calcolarne una propria', () => {
    // È il ponte fra VPM-B e tutto il resto: consumo, ossigeno e avvisi si
    // calcolano sulla tabella scelta, non su quella di Bühlmann. Senza, la pagina
    // mostrerebbe le soste di un modello e il gas di un altro.
    const imposte = [
      { depthM: 21, minutes: 2 },
      { depthM: 12, minutes: 4 },
      { depthM: 6, minutes: 10 },
    ];
    const r = planDeco(levels, gases, { ...opts, imposedStops: imposte });
    expect(r.stops.map((s) => [s.depthM, s.minutes])).toEqual([
      [21, 2],
      [12, 4],
      [6, 10],
    ]);
    expect(r.decoMin).toBe(16);
    expect(r.firstStopM).toBe(21);
    // E il resto della macchina ha comunque girato.
    expect(r.gasUsage.some((u) => u.litres > 0)).toBe(true);
    expect(r.oxygen.cnsPercent).toBeGreaterThan(0);
    expect(r.gf99EndPct).toBeGreaterThan(0);
  });

  it('una tabella più lunga lascia meno sovrasaturazione all’uscita', () => {
    const corta = planDeco(levels, gases, {
      ...opts,
      imposedStops: [{ depthM: 6, minutes: 5 }],
    });
    const lunga = planDeco(levels, gases, {
      ...opts,
      imposedStops: [
        { depthM: 12, minutes: 5 },
        { depthM: 6, minutes: 20 },
      ],
    });
    expect(lunga.gf99EndPct).toBeLessThan(corta.gf99EndPct);
  });

  it('le soste sotto la quota corrente si ignorano invece di far riscendere', () => {
    const r = planDeco([{ depthM: 12, minutes: 40 }], [AIR], {
      ...GF,
      imposedStops: [
        { depthM: 30, minutes: 5 },
        { depthM: 6, minutes: 3 },
      ],
    });
    expect(r.stops.map((s) => s.depthM)).toEqual([6]);
    expect(Math.max(...r.segments.map((s) => Math.max(s.fromM, s.toM)))).toBe(12);
  });
});

describe('la sosta di sicurezza, che è una scelta e non un obbligo', () => {
  it('su un’immersione in curva compare, ed è marcata come non obbligatoria', () => {
    const r = planDeco([{ depthM: 18, minutes: 40 }], [AIR], GF);
    expect(r.noDeco).toBe(true);
    expect(r.safetyStopMin).toBe(3);
    expect(r.decoMin).toBe(0);
    expect(r.stops).toHaveLength(1);
    expect(r.stops[0]).toMatchObject({ depthM: 5, minutes: 3, mandatory: false });
    // E non deve comparire fra le soste obbligate: `firstStopM` è la prima IMPOSTA.
    expect(r.firstStopM).toBeUndefined();
  });

  it('spegnendola il piano arriva in superficie senza fermarsi', () => {
    const con = planDeco([{ depthM: 18, minutes: 40 }], [AIR], GF);
    const senza = planDeco([{ depthM: 18, minutes: 40 }], [AIR], { ...GF, safetyStop: null });
    expect(senza.stops).toHaveLength(0);
    expect(senza.safetyStopMin).toBe(0);
    expect(con.runtimeMin - senza.runtimeMin).toBeCloseTo(3, 0);
  });

  it('vale anche sulle immersioni basse e lunghe, che sono il caso che la faceva sparire', () => {
    // È il motivo per cui questa opzione esiste: a dodici metri il modello non
    // impone niente, e il piano finiva in superficie senza tre minuti di gas.
    const r = planDeco([{ depthM: 12, minutes: 50 }], [AIR], GF);
    expect(r.safetyStopMin).toBe(3);
    expect(r.gasUsage[0].litres).toBeGreaterThan(
      planDeco([{ depthM: 12, minutes: 50 }], [AIR], { ...GF, safetyStop: null }).gasUsage[0].litres,
    );
  });

  it('non si aggiunge quando il modello impone già soste fino a quella quota', () => {
    // Il difetto visto provando: finiva IN MEZZO alle soste obbligate, fra i sei
    // metri e i tre, come se fosse un gradino della decompressione.
    const r = planDeco([{ depthM: 40, minutes: 25 }], [AIR, EAN50], GF);
    expect(r.decoMin).toBeGreaterThan(0);
    expect(r.safetyStopMin).toBe(0);
    for (const s of r.stops) expect(s.mandatory).toBe(true);
    // Le soste restano in ordine decrescente, senza gradini intrusi.
    for (let i = 1; i < r.stops.length; i++) {
      expect(r.stops[i].depthM).toBeLessThan(r.stops[i - 1].depthM);
    }
  });

  it('non si propone su un’immersione più alta della soglia ricreativa', () => {
    const r = planDeco([{ depthM: 6, minutes: 60 }], [AIR], GF);
    expect(r.safetyStopMin).toBe(0);
    expect(r.stops).toHaveLength(0);
  });

  it('profondità e durata si possono cambiare', () => {
    const r = planDeco([{ depthM: 20, minutes: 25 }], [AIR], {
      ...GF,
      safetyStop: { depthM: 6, minutes: 5 },
    });
    expect(r.stops[0]).toMatchObject({ depthM: 6, minutes: 5, mandatory: false });
    expect(r.safetyStopMin).toBe(5);
  });

  it('il foglio da portare in acqua la dichiara non obbligatoria', () => {
    const levels = [{ depthM: 18, minutes: 40 }];
    const r = planDeco(levels, [AIR], GF);
    const text = decoTableText(r, levels, [AIR], GF);
    expect(text).toContain('sicurezza, non obbligatoria');
    expect(text).toContain('3 di sosta di sicurezza');
  });
});

describe('la giornata, non l’immersione', () => {
  const air24: PlanGas = { mix: { o2: 0.21, he: 0 }, role: 'bottom', tankL: 15, startBar: 220 };
  const giornata = (surfaceIntervalMin: number) =>
    planSeries(
      [
        { levels: [{ depthM: 32, minutes: 40 }], gases: [air24], surfaceIntervalMin: 0 },
        { levels: [{ depthM: 24, minutes: 45 }], gases: [air24], surfaceIntervalMin },
      ],
      GF,
    );

  it('la prima immersione non cambia mai: è la seconda a pagare', () => {
    const corta = giornata(45);
    const lunga = giornata(240);
    expect(corta[0].decoMin).toBe(lunga[0].decoMin);
    expect(corta[1].decoMin).toBeGreaterThan(lunga[1].decoMin);
  });

  it('più lunga è la pausa, meno costa la seconda', () => {
    const deco = (si: number) => giornata(si)[1].decoMin;
    expect(deco(45)).toBeGreaterThan(deco(90));
    expect(deco(90)).toBeGreaterThan(deco(240));
  });

  it('una serie di una sola immersione è identica al piano singolo', () => {
    const singola = planDeco([{ depthM: 32, minutes: 40 }], [air24], GF);
    const serie = planSeries(
      [{ levels: [{ depthM: 32, minutes: 40 }], gases: [air24], surfaceIntervalMin: 0 }],
      GF,
    );
    expect(serie).toHaveLength(1);
    expect(serie[0].decoMin).toBe(singola.decoMin);
    expect(serie[0].runtimeMin).toBeCloseTo(singola.runtimeMin, 3);
  });

  it('la catena passa i tessuti, non li ricalcola da pulito', () => {
    const g = giornata(45);
    // Se la seconda ripartisse da tessuti puliti farebbe la stessa deco di
    // un'immersione isolata: è esattamente l'errore che questa funzione evita.
    const isolata = planDeco([{ depthM: 24, minutes: 45 }], [air24], GF);
    expect(g[1].decoMin).toBeGreaterThan(isolata.decoMin);
  });
});

describe('bailout da una quota qualunque', () => {
  const DIL: PlanGas = { mix: { o2: 0.21, he: 0.35 }, role: 'bottom', tankL: 3, startBar: 200 };
  const BAIL: PlanGas = { mix: { o2: 0.18, he: 0.45 }, role: 'bailout', tankL: 11, startBar: 200 };
  const CCR = { gfLow: 0.3, gfHigh: 0.8, lastStopM: 6 };
  const levels = [{ depthM: 60, minutes: 30, setpointBar: 1.3 }];
  const gases = [DIL, BAIL, EAN50];

  it('più in alto avviene il guasto, meno costa uscirne', () => {
    const dalFondo = bailoutPlan(levels, gases, CCR)!;
    const da21 = bailoutPlan(levels, gases, CCR, 21)!;
    const da9 = bailoutPlan(levels, gases, CCR, 9)!;
    expect(da21.decoMin).toBeLessThan(dalFondo.decoMin);
    expect(da9.decoMin).toBeLessThan(da21.decoMin);
    const litri = (r: typeof dalFondo) => r.gasUsage.reduce((a, u) => a + u.litres, 0);
    expect(litri(da9)).toBeLessThan(litri(dalFondo));
  });

  it('senza quota indicata si intende dal fondo, come prima', () => {
    const a = bailoutPlan(levels, gases, CCR)!;
    const b = bailoutPlan(levels, gases, CCR, 60)!;
    expect(a.decoMin).toBe(b.decoMin);
  });

  it('una quota più profonda del fondo non fa riscendere il piano', () => {
    const r = bailoutPlan(levels, gases, CCR, 90)!;
    expect(Math.max(...r.segments.map((s) => Math.max(s.fromM, s.toM)))).toBeLessThanOrEqual(60);
  });

  it('ogni tratto porta i tessuti con cui finisce', () => {
    // È quello che rende possibile ripartire da metà immersione senza rifare il
    // piano: rifacendolo si otterrebbero numeri diversi da quelli mostrati.
    const r = planDeco(levels, gases, CCR);
    for (const seg of r.segments) {
      expect(seg.tissues.n2).toHaveLength(16);
      expect(seg.tissues.n2[0]).toBeGreaterThan(0);
    }
  });
});

/**
 * I difetti trovati dalla revisione ostile del 18 agosto 2026.
 *
 * Ognuno di questi test è nato da una riproduzione, non da un sospetto: qui sotto
 * c'è, caso per caso, il numero sbagliato che l'app produceva prima.
 */
describe('difetti trovati dalla revisione', () => {
  const AIR24: PlanGas = { mix: { o2: 0.21, he: 0 }, role: 'bottom', tankL: 24, startBar: 200 };

  it('il bailout multilivello riparte dalla risalita, non dalla discesa', () => {
    // Prima: su «20 m poi 60 m», il bailout da 30 m prendeva i tessuti del primo
    // passaggio a 30 metri — la DISCESA, al minuto 1.1 — e rispondeva «zero
    // obbligo, 11 bar» dove servono decine di minuti e oltre cento bar.
    const dil: PlanGas = { mix: { o2: 0.21, he: 0.35 }, role: 'bottom', tankL: 3, startBar: 200 };
    const bail: PlanGas = { mix: { o2: 0.18, he: 0.45 }, role: 'bailout', tankL: 11, startBar: 200 };
    const levels = [
      { depthM: 20, minutes: 5, setpointBar: 1.3 },
      { depthM: 60, minutes: 25, setpointBar: 1.3 },
    ];
    const gases = [dil, bail, EAN50];
    const opts = { gfLow: 0.3, gfHigh: 0.8, lastStopM: 6 };
    const dalFondo = bailoutPlan(levels, gases, opts)!;
    const da30 = bailoutPlan(levels, gases, opts, 30)!;
    expect(da30.decoMin).toBeGreaterThan(10);
    expect(da30.decoMin).toBeLessThan(dalFondo.decoMin);
    expect(da30.gf99EndPct).toBeGreaterThan(50);
  });

  it('il gas perso rimappa gli indici dei livelli invece di far respirare altro', () => {
    // Prima: togliere l'EAN50 dall'elenco spostava gli indici, e il livello che
    // dichiarava il trimix si ritrovava a respirare ossigeno puro a 60 metri —
    // oppure il programma cadeva con un TypeError.
    const gases: PlanGas[] = [
      { mix: { o2: 0.21, he: 0 }, role: 'bottom', tankL: 24, startBar: 200 },
      { mix: { o2: 0.5, he: 0 }, role: 'deco', tankL: 11, startBar: 200 },
      { mix: { o2: 0.18, he: 0.45 }, role: 'bottom', tankL: 24, startBar: 200 },
      { mix: { o2: 1, he: 0 }, role: 'deco', tankL: 11, startBar: 200 },
    ];
    const levels = [{ depthM: 60, minutes: 20, gasIndex: 2 }];
    const list = decoContingencies(levels, gases, { gfLow: 0.3, gfHigh: 0.8, lastStopM: 6 });
    const perso = list.find((c) => c.id === 'lost-1')!;
    const ppo2Fondo = Math.max(
      ...perso.result.segments.filter((s) => Math.max(s.fromM, s.toM) > 55).map((s) => s.ppo2),
    );
    expect(ppo2Fondo).toBeLessThan(2);

    // E con tre soli gas non deve più cadere.
    const tre = [gases[0], gases[1], gases[2]];
    expect(() => decoContingencies([{ depthM: 60, minutes: 20, gasIndex: 2 }], tre, {})).not.toThrow();
  });

  it('il limite in curva parte dai tessuti con cui si entra', () => {
    // Prima: `ndlMin` veniva sempre da tessuti puliti. Su una ripetitiva a venti
    // minuti dalla prima il riquadro diceva 42 minuti dove ce n'erano 20, e lo
    // stesso numero finiva sul foglio da portare in acqua.
    const prima = planDeco([{ depthM: 35, minutes: 25 }], [AIR24], GF);
    const pulita = planDeco([{ depthM: 18, minutes: 15 }], [AIR24], GF);
    const ripetitiva = planDeco([{ depthM: 18, minutes: 15 }], [AIR24], {
      ...GF,
      initial: afterSurfaceInterval(prima.finalTissues, 20),
    });
    expect(ripetitiva.ndlMin).toBeLessThan(pulita.ndlMin);
    // E il numero che finisce sul foglio è quello vero, non quello da puliti.
    expect(decoTableText(ripetitiva, [{ depthM: 18, minutes: 15 }], [AIR24], GF)).toContain(
      `limite ${ripetitiva.ndlMin.toFixed(0)} min`,
    );
  });

  it('una bombola dichiarata vuota non fa dire che il gas basta', () => {
    // `0` era falsy e passava per «bombola sconosciuta».
    const vuota: PlanGas = { mix: { o2: 0.21, he: 0 }, role: 'bottom', tankL: 0, startBar: 0 };
    const r = planDeco([{ depthM: 40, minutes: 25 }], [vuota], GF);
    expect(r.gasUsage[0].insufficient).toBe(true);
    expect(r.warnings.some((w) => w.level === 'critical')).toBe(true);
    // Mentre «non lo so» resta «non lo so».
    const ignota: PlanGas = { mix: { o2: 0.21, he: 0 }, role: 'bottom' };
    expect(planDeco([{ depthM: 40, minutes: 25 }], [ignota], GF).gasUsage[0].insufficient).toBe(false);
  });

  it('la somma delle soste stampate fa il totale stampato', () => {
    // Prima le righe si arrotondavano per difetto e il totale no: «16 minuti di
    // soste» sopra «di cui 17 di decompressione», sullo stesso foglio.
    const imposte = [
      { depthM: 9, minutes: 2.4 },
      { depthM: 6, minutes: 2.4 },
      { depthM: 3, minutes: 12.4 },
    ];
    const r = planDeco([{ depthM: 40, minutes: 25 }], [AIR24, EAN50], { ...GF, imposedStops: imposte });
    expect(r.stops.reduce((a, s) => a + s.minutes, 0)).toBe(r.decoMin + r.safetyStopMin);
  });

  it('avvisa quando il piano arriva in superficie oltre il valore M', () => {
    // Con soste imposte incoerenti il piano si dichiarava perfino «in curva».
    const r = planDeco([{ depthM: 40, minutes: 25 }], [AIR24], {
      ...GF,
      imposedStops: [{ depthM: 100, minutes: 5 }],
    });
    expect(r.gf99EndPct).toBeGreaterThan(100);
    expect(r.warnings.some((w) => w.level === 'critical' && w.text.includes('valore M'))).toBe(true);
  });

  it('dichiara che sopra 1.6 bar il CNS è una sottostima', () => {
    const ricco: PlanGas = {
      mix: { o2: 1, he: 0 },
      role: 'bottom',
      tankL: 11,
      startBar: 200,
      switchDepthM: 30,
    };
    const r = planDeco([{ depthM: 30, minutes: 20 }], [ricco], GF);
    expect(r.warnings.some((w) => w.text.includes('SOTTOSTIMA'))).toBe(true);
  });

  it('un passo fra le soste a zero non produce una tabella vuota', () => {
    const r = planDeco([{ depthM: 40, minutes: 25 }], [AIR24], { ...GF, stopIntervalM: 0, lastStopM: 0 });
    expect(r.stops.filter((s) => s.mandatory).length).toBeGreaterThan(0);
    expect(Number.isFinite(r.runtimeMin)).toBe(true);
  });
});
