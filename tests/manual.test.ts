/**
 * Immersioni inserite a mano, e la catena dei tessuti che ora le attraversa.
 *
 * Il test che conta davvero è l'ultimo blocco: un'immersione senza profilo NON
 * deve più spezzare la catena, altrimenti tutto il resto — il modulo di
 * inserimento, la validazione, il profilo quadro — serve solo a far comparire una
 * riga in elenco, e il buco che produceva il GF99 ottimista resta lì.
 */

import { describe, expect, it } from 'vitest';
import {
  buildManualDive,
  deviceOffsetMinutes,
  localToUtcIso,
  validateManualDive,
  type ManualDiveInput,
} from '../src/core/manual';
import { chainArchive, squareProfile } from '../src/core/analysis/tissues';
import { computeMetrics } from '../src/core/analysis/metrics';
import { diveIdFor, mergeDive } from '../src/core/dedupe';
import type { Dive, Sample } from '../src/core/model';
import { synthesise } from './fixtures';

const base = (over: Partial<ManualDiveInput> = {}): ManualDiveInput => ({
  localDateTime: '2026-06-14T09:30',
  utcOffsetMinutes: 120,
  durationMin: 42,
  maxDepthM: 31.5,
  avgDepthM: 18.2,
  ...over,
});

describe('validazione', () => {
  it('accetta quello che una persona sa dire davvero', () => {
    expect(validateManualDive(base())).toEqual([]);
  });

  it('rifiuta quello che rende l’immersione non collocabile o impossibile', () => {
    expect(validateManualDive({ ...base(), localDateTime: '' })[0]).toMatch(/data/i);
    expect(validateManualDive({ ...base(), durationMin: 0 })[0]).toMatch(/durata/i);
    expect(validateManualDive({ ...base(), maxDepthM: -3 })[0]).toMatch(/profondità massima/i);
    // La media più profonda della massima è la svista più comune di chi ricopia.
    expect(validateManualDive({ ...base(), avgDepthM: 40 })[0]).toMatch(/media/i);
    expect(validateManualDive({ ...base(), mix: { o2: 0.4, he: 0.7 } })[0]).toMatch(/miscela/i);
    expect(validateManualDive({ ...base(), startBar: 200, endBar: 220 })[0]).toMatch(/finale/i);
  });

  it('avvisa senza rifiutare quando manca un dato che serve alle statistiche', () => {
    // Un logbook di carta è pieno di righe incomplete. Rifiutarle vorrebbe dire
    // lasciarle fuori dall'archivio, cioè tornare al buco nella catena.
    const { warnings, dive } = buildManualDive(base({ avgDepthM: undefined }));
    expect(dive.maxDepth).toBe(31.5);
    expect(warnings.join(' ')).toMatch(/profondità media/i);
    expect(warnings.join(' ')).toMatch(/consumo/i);
  });

  it('segnala i refusi grossi invece di prenderli per buoni', () => {
    expect(buildManualDive(base({ durationMin: 600 })).warnings.join(' ')).toMatch(/battitura/);
    expect(buildManualDive(base({ maxDepthM: 130 })).warnings.join(' ')).toMatch(/battitura/);
  });
});

describe('orario e fuso', () => {
  it('interpreta l’ora nel fuso del LUOGO, non in quello della macchina', () => {
    // Le 9:30 alle Maldive (UTC+5) sono le 4:30 UTC, comunque sia messo
    // l'orologio di chi sta scrivendo. Questo test gira anche sotto
    // `npm run test:tz`, che è dove l'errore verrebbe fuori.
    expect(localToUtcIso('2026-06-14T09:30', 300)).toBe('2026-06-14T04:30:00.000Z');
    expect(localToUtcIso('2026-06-14T09:30', 0)).toBe('2026-06-14T09:30:00.000Z');
    expect(localToUtcIso('2026-06-14T09:30', -600)).toBe('2026-06-14T19:30:00.000Z');
  });

  it('registra lo scarto usato, così la scheda può dichiararlo', () => {
    const { dive } = buildManualDive(base({ utcOffsetMinutes: 300 }));
    expect(dive.utcOffsetMinutes).toBe(300);
    expect(dive.startTime).toBe('2026-06-14T04:30:00.000Z');
  });

  it('senza scarto dichiarato usa quello del dispositivo alla data giusta', () => {
    // Non «adesso»: fra il 25 e il 26 ottobre c'è un'ora di differenza, e
    // chiedere il fuso al momento sbagliato sposterebbe tutte le immersioni
    // estive inserite d'inverno.
    const estate = deviceOffsetMinutes('2026-07-14T09:30');
    const inverno = deviceOffsetMinutes('2026-01-14T09:30');
    expect(estate).toBeDefined();
    expect(inverno).toBeDefined();
    const { dive } = buildManualDive(base({ utcOffsetMinutes: undefined }));
    expect(dive.utcOffsetMinutes).toBe(deviceOffsetMinutes('2026-06-14T09:30'));
    expect(Number.isNaN(Date.parse(dive.startTime))).toBe(false);
  });
});

describe('l’immersione costruita', () => {
  it('è una fonte come le altre, dichiarata', () => {
    const { dive } = buildManualDive(base());
    expect(dive.source.format).toBe('manual');
    expect(dive.source.file).toBe('inserita a mano');
    expect(dive.samples).toBeUndefined();
  });

  it('mette da sé le etichette che dipendono dalla miscela', () => {
    expect(buildManualDive(base({ mix: { o2: 0.32, he: 0 } })).dive.tags).toContain('nitrox');
    expect(buildManualDive(base({ mix: { o2: 0.18, he: 0.45 } })).dive.tags).toContain('trimix');
    expect(buildManualDive(base()).dive.tags).not.toContain('nitrox');
  });

  it('le metriche si calcolano lo stesso, e dichiarano di non avere profilo', () => {
    const { dive } = buildManualDive(base({ tankSizeL: 12, startBar: 200, endBar: 60 }));
    const m = computeMetrics(dive);
    expect(m.quality.hasProfile).toBe(false);
    expect(m.quality.sampleCount).toBe(0);
  });

  it('l’id è la stessa firma dei parser, quindi il file che salta fuori dopo ARRICCHISCE invece di duplicare', () => {
    // È la proprietà che rende sensato inserire a mano anche quando si spera di
    // ritrovare il file: il lavoro fatto a tastiera non viene perso.
    const s = synthesise({ startTime: new Date('2026-06-14T07:30:00Z'), maxDepth: 31.5, durationS: 42 * 60 });
    const samples: Sample[] = s.samples.map((w) => ({ t: w.t, depth: w.depth }));
    const daFile: Dive = {
      id: '',
      startTime: '2026-06-14T07:30:00.000Z',
      durationS: 42 * 60,
      maxDepth: 31.5,
      mode: 'oc',
      cylinders: [{ mix: { o2: 0.21, he: 0 } }],
      source: { format: 'uddf', file: 'peregrine.uddf', importedAt: '2026-08-01T10:00:00Z' },
      tags: [],
      samples,
    };
    const { dive: aMano } = buildManualDive(
      base({ siteName: 'Punta Chiappa', buddy: 'Marco', notes: 'ricopiata dal libretto' }),
    );
    // Stesso minuto, stessa profondità, stessa durata → stesso id.
    expect(diveIdFor({ startTime: daFile.startTime, maxDepth: 31.5, durationS: 42 * 60 })).toBe(aMano.id);

    const fuso = mergeDive(aMano, { ...daFile, id: aMano.id });
    // Il profilo arriva…
    expect(fuso.samples?.length).toBeGreaterThan(10);
    // …e quello che era stato scritto a mano resta.
    expect(fuso.site?.name).toBe('Punta Chiappa');
    expect(fuso.buddy).toBe('Marco');
    expect(fuso.notes).toBe('ricopiata dal libretto');
  });
});

describe('profilo quadro', () => {
  it('sta nella durata dichiarata e non supera la media', () => {
    const { dive } = buildManualDive(base({ durationMin: 42, maxDepthM: 31.5, avgDepthM: 18.2 }));
    const q = squareProfile(dive);
    expect(q[0]).toEqual({ t: 0, depth: 0 });
    expect(q[q.length - 1].t).toBe(42 * 60);
    expect(q[q.length - 1].depth).toBe(0);
    expect(Math.max(...q.map((s) => s.depth))).toBeCloseTo(18.2, 5);
  });

  it('senza media usa il 70% della massima, che è il rapporto misurato sull’archivio', () => {
    const { dive } = buildManualDive(base({ avgDepthM: undefined, maxDepthM: 30 }));
    expect(Math.max(...squareProfile(dive).map((s) => s.depth))).toBeCloseTo(21, 5);
  });

  it('non produce una permanenza negativa su un’immersione cortissima e profonda', () => {
    const { dive } = buildManualDive(base({ durationMin: 3, maxDepthM: 40, avgDepthM: 40 }));
    const q = squareProfile(dive);
    expect(q.every((s) => Number.isFinite(s.depth) && s.depth >= 0)).toBe(true);
    for (let i = 1; i < q.length; i++) expect(q[i].t).toBeGreaterThan(q[i - 1].t);
  });
});

describe('la catena dei tessuti non si spezza più', () => {
  const senzaProfilo = (id: string, startTime: string): Dive => {
    const { dive } = buildManualDive(base({ localDateTime: '2026-06-14T09:30', utcOffsetMinutes: 0 }));
    return { ...dive, id, startTime, metrics: computeMetrics({ ...dive, id, startTime }) };
  };

  it('una ripetitiva dietro a un’immersione inserita a mano eredita il carico', async () => {
    const prima = senzaProfilo('a', '2026-06-14T07:00:00.000Z');
    const dopo = senzaProfilo('b', '2026-06-14T09:30:00.000Z');
    const { dives, report } = await chainArchive([prima, dopo], async () => []);

    const b = dives.find((d) => d.id === 'b')!;
    expect(b.metrics?.residualN2Bar).toBeGreaterThan(0);
    expect(b.metrics?.surfaceIntervalMin).toBeGreaterThan(60);
    // E il prezzo dell'intervallo è misurato, non affermato: la stessa
    // immersione da tessuti puliti esce con un GF99 più basso.
    expect(b.metrics!.gf99Pct!).toBeGreaterThan(b.metrics!.gf99CleanPct!);
    expect(report.withoutProfile).toBe(2);
  });

  it('dichiara che quei tessuti sono una STIMA', () => {
    // È la regola di tutto il progetto: un numero ricostruito non si confonde
    // con uno misurato, e chi lo mostra deve poterlo dire.
    return chainArchive([senzaProfilo('a', '2026-06-14T07:00:00.000Z')], async () => []).then(({ dives }) => {
      expect(dives[0].metrics?.tissuesEstimated).toBe(true);
    });
  });

  it('un’immersione VERA non viene marcata come stimata', async () => {
    const s = synthesise({ startTime: new Date('2026-06-14T07:00:00Z') });
    const vera: Dive = {
      id: 'vera',
      startTime: '2026-06-14T07:00:00.000Z',
      durationS: s.spec.durationS,
      maxDepth: Math.max(...s.samples.map((w) => w.depth)),
      mode: 'oc',
      cylinders: [{ mix: { o2: 0.21, he: 0 } }],
      salinity: 'salt',
      source: { format: 'uddf', file: 'x', importedAt: 'x' },
      tags: [],
      samples: s.samples.map((w) => ({ t: w.t, depth: w.depth })),
    };
    vera.metrics = computeMetrics(vera);
    const { dives } = await chainArchive([vera], async () => []);
    expect(dives[0].metrics?.tissuesEstimated).toBeUndefined();
    expect(dives[0].metrics?.gf99Pct).toBeGreaterThan(0);
  });

  it('il buco che c’era prima: senza la stima la ripetitiva risultava più pulita del vero', async () => {
    // Ricostruzione del difetto. Con la vecchia regola l'immersione senza
    // profilo azzerava `previous`, e la successiva ripartiva da tessuti puliti:
    // il suo GF99 era quello di una prima immersione della giornata. Qui si
    // verifica che i due numeri ora differiscano davvero, cioè che la stima
    // stia facendo il suo lavoro invece di essere una decorazione.
    const prima = senzaProfilo('a', '2026-06-14T07:00:00.000Z');
    const dopo = senzaProfilo('b', '2026-06-14T09:30:00.000Z');
    const conCatena = await chainArchive([prima, dopo], async () => []);
    const daSola = await chainArchive([dopo], async () => []);
    const conResiduo = conCatena.dives.find((d) => d.id === 'b')!.metrics!.gf99Pct!;
    const pulita = daSola.dives[0].metrics!.gf99Pct!;
    expect(conResiduo).toBeGreaterThan(pulita);
  });
});
