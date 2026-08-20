/**
 * Dal piano al foglio da stampare: dove i numeri hanno ancora un significato.
 *
 * PERCHÉ È UN MODULO A PARTE. `planPrint.ts` sa impaginare e non deve sapere
 * niente di decompressione; il pianificatore sa di decompressione e non deve
 * sapere niente di CSS. In mezzo serve qualcuno che conosca le unità di misura,
 * gli arrotondamenti giusti e la differenza fra una sosta di sicurezza e un
 * obbligo — ed è questo file.
 *
 * PERCHÉ NON STA DENTRO LA PAGINA. Ci stava, ed era impossibile guardarlo:
 * l'unico modo di vedere il foglio impaginato era aprire l'applicazione,
 * compilare un piano e premere «Stampa». Da qui invece si genera con un comando,
 * si trasforma in PDF e lo si guarda — che è come sono venuti fuori i due
 * difetti che una prova sulla stringa non poteva mostrare: le pagine sprecate
 * dalle sezioni non spezzabili, e tredici righe identiche che dicevano «SOSTA ·
 * 3 m · 1.0 min» dove un run time schedule vero scrive una riga sola.
 */

import { formatRuntime, mixName } from '../units';
import type { Contingency, GasPlan, SchedulePoint } from '../analysis/gasPlan';
import type { DecoResult, DecoSegment } from '../analysis/deco';
import type { PlanCurve } from '../analysis/tissues';
import type { FoglioPiano, SezionePiano } from './planPrint';

/**
 * Il piano tradotto in un foglio da stampare.
 *
 * Sta qui e non in `planPrint.ts` perché è QUI che i numeri hanno un significato:
 * l'unità di misura, l'arrotondamento giusto, la differenza fra una sosta di
 * sicurezza e un obbligo. Il modulo di stampa sa impaginare e non deve sapere
 * niente di decompressione; questa funzione sa di decompressione e non sa
 * niente di CSS. È la stessa divisione che c'è fra `logbookPrint` e la scheda
 * immersione, e regge per la stessa ragione: le due cose cambiano per motivi
 * diversi.
 */
export function foglioDelPiano(ctx: {
  plan: GasPlan;
  schedule: SchedulePoint[];
  curve: PlanCurve;
  soste?: DecoResult;
  contingenze: Contingency[];
  mode: 'rec' | 'tec';
  turnAt?: number;
  /** I gradient factor con cui è stata calcolata la curva, per scriverli nel foglio. */
  gf: { low: number; high: number };
}): FoglioPiano {
  const { plan, schedule, curve, soste, contingenze, mode, turnAt, gf } = ctx;
  const i = plan.input;
  const m1 = (v: number) => `${Math.round(v * 10) / 10}`;

  const sezioni: SezionePiano[] = [];

  sezioni.push({
    titolo: 'Il piano',
    righe: [
      ['Profondità massima', `${m1(i.depthM)} m`],
      ['Profondità media del fondo', `${m1(i.avgDepthM)} m`],
      ['Tempo di fondo', formatRuntime(i.bottomMin)],
      ['Durata totale', formatRuntime(plan.totalRuntimeMin)],
      ['Miscela', mixName(i.mix)],
      ['Bombola', `${m1(i.tankL)} L a ${i.startBar} bar`],
      ['Consumo usato', `${m1(plan.planningRmvLpm)} L/min${plan.buddyDrivesPlan ? ' (del compagno)' : ''}`],
      ['Acqua', i.salinity === 'fresh' ? 'dolce' : 'salata'],
    ],
  });

  /*
   * IL RUN TIME SCHEDULE, che è il motivo per cui questo foglio esiste.
   *
   * Le colonne sono quelle della lavagnetta: a che minuto ci arrivi, a che
   * quota, cosa stai facendo. Con le soste in mezzo quando ci sono, e le
   * obbligatorie in grassetto — perché su carta, con le mani bagnate, la
   * differenza fra «sosta di sicurezza» e «obbligo» deve saltare all'occhio
   * senza doverla leggere.
   */
  if (soste?.segments.length) {
    /*
     * LE SOSTE CONSECUTIVE ALLA STESSA QUOTA DIVENTANO UNA RIGA SOLA.
     *
     * Il motore produce un tratto per minuto: tredici minuti a tre metri sono
     * tredici righe identiche che dicono «SOSTA · 3 m · 1.0 min». A schermo si
     * scorrono, su carta riempiono una pagina e nascondono le due righe che
     * contano. E soprattutto non è così che si scrive un run time schedule: la
     * lavagnetta dice «3 m, 13 minuti, riparti al 55», che è quello che si
     * guarda con la maschera addosso.
     *
     * Il minuto della riga è quello in cui si LASCIA la sosta, che è la
     * domanda vera — «fino a quando devo restare qui».
     */
    const raggruppati: { seg: DecoSegment; minuti: number; litri: number }[] = [];
    for (const seg of soste.segments) {
      const ultimo = raggruppati[raggruppati.length - 1];
      if (ultimo && seg.kind === 'stop' && ultimo.seg.kind === 'stop' && ultimo.seg.toM === seg.toM) {
        ultimo.minuti += seg.minutes;
        ultimo.litri += seg.litres;
        ultimo.seg = seg; // il runtime della riga è quello di quando si riparte
        continue;
      }
      raggruppati.push({ seg, minuti: seg.minutes, litri: seg.litres });
    }

    /*
     * Quali soste sono OBBLIGATORIE, per quota.
     *
     * Prima il confronto era `stops.find(x => x.runtimeMin === seg.runtimeMin)`:
     * il runtime di una sosta è quello di quando la si lascia, mentre i tratti
     * sono al minuto, quindi non combaciava quasi mai e nessuna riga finiva in
     * grassetto. Il grassetto è l'unica cosa che, su carta e con le mani
     * bagnate, distingue un obbligo da una sosta di sicurezza.
     */
    const obbligatoriaA = new Map(soste.stops.map((x) => [x.depthM, x.mandatory]));
    const forti: number[] = [];
    const righe = raggruppati.map(({ seg, minuti, litri }, idx) => {
      if (seg.kind === 'stop' && obbligatoriaA.get(seg.toM)) forti.push(idx);
      return [
        /*
         * Il minuto si scrive INTERO.
         *
         * È la colonna che si legge con la maschera addosso e le mani occupate:
         * «33.8» non è più preciso di «34», è solo più difficile da leggere. E
         * un run time schedule sulla lavagnetta i decimi non li ha mai avuti.
         */
        String(Math.round(seg.runtimeMin)),
        seg.fromM === seg.toM ? `${m1(seg.toM)} m` : `${m1(seg.fromM)} → ${m1(seg.toM)} m`,
        seg.kind === 'stop' && !obbligatoriaA.get(seg.toM) ? 'sosta di sicurezza' : AZIONE[seg.kind],
        formatRuntime(minuti),
        `${Math.round(litri)} L`,
      ];
    });
    sezioni.push({
      titolo: 'Run time schedule',
      descrizione:
        'Il minuto è il tempo trascorso dall’ingresso in acqua, a fine tratto. Le righe in grassetto sono soste obbligatorie: non si saltano.',
      colonne: ['Min', 'Quota', 'Azione', 'Durata', 'Gas'],
      numeriche: [0, 3, 4],
      righe,
      forti,
    });
  } else {
    sezioni.push({
      titolo: 'Le fasi',
      colonne: ['Fase', 'Durata', 'Prof. media', 'Litri'],
      numeriche: [1, 2, 3],
      righe: plan.planned.map((f) => [
        f.label,
        formatRuntime(f.minutes),
        `${m1(f.meanDepthM)} m`,
        `${Math.round(f.litres)}`,
      ]),
    });
  }

  sezioni.push({
    titolo: 'Gas',
    righe: [
      ['Da portare', `${Math.round(plan.plannedL)} L · ${plan.plannedBar} bar`],
      [
        plan.input.reserveRule === 'rockBottom' ? 'Gas minimo (rock bottom)' : 'Riserva fissa',
        `${plan.reserveBar} bar`,
      ],
      ['Utilizzabile', `${plan.usableBar} bar`],
      ['Uscita prevista', `${plan.expectedEndBar} bar`],
      ...(plan.turnBar !== undefined
        ? ([
            [
              'Pressione di rientro',
              `${plan.turnBar} bar${turnAt !== undefined ? `, intorno al minuto ${turnAt.toFixed(0)}` : ''}`,
            ],
          ] as string[][])
        : []),
      ['MOD in fase di lavoro', `${m1(plan.modWorkM)} m a 1.4 bar`],
      ['MOD in decompressione', `${m1(plan.modDecoM)} m a 1.6 bar`],
      ['PPO2 al fondo', `${plan.ppo2AtDepth.toFixed(2)} bar`],
      ['END al fondo', `${m1(plan.endM)} m`],
      ['CNS / OTU', `${plan.oxygen.cnsPercent.toFixed(0)} % · ${plan.oxygen.otu.toFixed(0)}`],
    ],
  });

  /*
   * Le pressioni attese si stampano RADE, una ogni cinque minuti più i confini
   * di fase. A schermo la tabella fitta si scorre; su un foglio A4 quaranta
   * righe di pressioni mangiano la pagina delle soste, che è quella che serve
   * davvero sott'acqua.
   */
  const radi = schedule.filter((p, idx) => p.boundary || idx === 0 || Math.round(p.runMin) % 5 === 0);
  if (radi.length > 1) {
    sezioni.push({
      titolo: 'Pressione attesa',
      descrizione:
        'Quello che dovresti leggere sul manometro se respiri al consumo pianificato e stai sul profilo. Serve ad accorgersi di uno scostamento mentre puoi ancora rimediare.',
      colonne: ['Min', 'Quota', 'Bar'],
      numeriche: [0, 1, 2],
      righe: radi.map((p) => [m1(p.runMin), `${m1(p.depthM)} m`, `${Math.round(p.bar)}`]),
    });
  }

  if (contingenze.length) {
    sezioni.push({
      titolo: 'E se…',
      descrizione:
        'Gli scenari da avere in tasca prima di entrare. La domanda «e se resto giù cinque minuti in più» va fatta adesso, non a quaranta metri.',
      colonne: ['Scenario', 'Uscita prevista', 'Differenza'],
      numeriche: [1, 2],
      righe: contingenze.map((c) => [
        `${c.label} — ${c.change}`,
        `${c.plan.expectedEndBar} bar${c.fits ? '' : ' — non ci sta'}`,
        `${c.endBarDelta >= 0 ? '+' : ''}${c.endBarDelta} bar`,
      ]),
    });
  }

  const avvisi: FoglioPiano['avvisi'] = plan.warnings.map((w) => ({
    livello: w.level === 'critical' ? 'critical' : 'warning',
    testo: w.text,
  }));
  for (const w of soste?.warnings ?? []) avvisi.push({ livello: w.level, testo: w.text });
  if (mode === 'rec' && curve.leavesCurveAtMin !== undefined) {
    avvisi.unshift({
      livello: 'critical',
      testo: `Questo piano NON è ricreativo: al minuto ${curve.leavesCurveAtMin.toFixed(0)} prende un obbligo di decompressione, e da lì risalire dritti non è più un'opzione.`,
    });
  }

  const quando = new Date().toISOString();
  return {
    titolo: `Piano ${m1(i.depthM)} m · ${formatRuntime(i.bottomMin)} di fondo · ${mixName(i.mix)}`,
    sottotitolo:
      mode === 'rec'
        ? `Ricreativo, Bühlmann ZH-L16C GF ${gf.low}/${gf.high}. Curva alla media: ${curve.ndlAtAvgMin.toFixed(0)} min.`
        : 'Tecnico, con decompressione.',
    now: quando,
    sezioni,
    avvisi,
  };
}

const AZIONE: Record<string, string> = {
  descent: 'discesa',
  level: 'fondo',
  ascent: 'risalita',
  stop: 'SOSTA',
  switch: 'cambio gas',
};
