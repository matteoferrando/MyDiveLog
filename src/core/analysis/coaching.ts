/**
 * Motore dei piani di miglioramento.
 *
 * Ogni regola è una funzione pura che riceve le aggregate (e le immersioni) e
 * restituisce zero o un `Finding`. Aggiungere una regola significa scrivere
 * una funzione e metterla nell'array `RULES`: nessun'altra modifica.
 *
 * Tre principi, perché un consiglio sbagliato è peggio di nessun consiglio:
 *
 *  1. NIENTE DIAGNOSI SENZA DATI. Ogni regola dichiara un numero minimo di
 *     immersioni valide (`basis`) sotto il quale non si pronuncia. Dire "il tuo
 *     assetto peggiora" su tre immersioni è rumore travestito da analisi.
 *  2. OGNI GIUDIZIO PORTA IL SUO NUMERO. `evidence` contiene i valori che hanno
 *     generato il giudizio, così è verificabile e contestabile.
 *  3. NIENTE CONSIGLI MEDICI O DI SICUREZZA CHE SOSTITUISCANO UN ISTRUTTORE.
 *     Le soglie sono riferimenti didattici diffusi, non protocolli: dove conta
 *     (deco, progressione in profondità) il testo rimanda all'istruttore.
 *
 * ► COME PARLA DUE LINGUE. ◄ Come `nextDive.ts`: `buildPlan` e `debriefDive`
 * prendono `t` come ULTIMO parametro, con l'identità come valore predefinito, e
 * lo passano alle regole. Le frasi con dentro un numero passano da `frase()`,
 * che traduce PRIMA e riempie DOPO — vedi `core/frase.ts` per il perché non si
 * possono spezzare in pezzi. `AREA_LABEL`, `SEVERITY_LABEL` e `GOALS` restano
 * italiane qui: sono costanti di modulo, e chi le mostra le passa già da `t()`.
 */

import { LIMITS, type Dive } from '../model';
import { formatDuration } from '../units';
import { localeCorrente } from '../locale';
import { comeSta, type Traduci } from '../traduci';
import { frase } from '../frase';
import { medianOf, type Aggregates } from './aggregate';

export type CoachArea = 'gas' | 'buoyancy' | 'ascent' | 'safety' | 'deco' | 'experience' | 'data';

export type Severity = 'critical' | 'serious' | 'warning' | 'good';

export interface Finding {
  id: string;
  area: CoachArea;
  severity: Severity;
  headline: string;
  detail: string;
  /** I numeri su cui si basa il giudizio. Sempre presenti. */
  evidence: string[];
  /** Obiettivo misurabile, per poter dire "fatto". */
  target?: string;
  /** Esercizi concreti da fare in acqua. */
  drills: string[];
  /** 0–100, per ordinare il piano. */
  priority: number;
  /** Su quante immersioni si basa il calcolo. */
  basis: number;
}

export const AREA_LABEL: Record<CoachArea, string> = {
  gas: 'Consumo gas',
  buoyancy: 'Assetto',
  ascent: 'Risalita',
  safety: 'Sicurezza',
  deco: 'Decompressione',
  experience: 'Esperienza e continuità',
  data: 'Qualità dei dati',
};

export const SEVERITY_LABEL: Record<Severity, string> = {
  critical: 'Da correggere subito',
  serious: 'Priorità alta',
  warning: 'Da migliorare',
  good: 'Punto di forza',
};

// ---------------------------------------------------------------------------
// Obiettivi
// ---------------------------------------------------------------------------

export type GoalId = 'tec' | 'deep-recreational' | 'general';

export interface Goal {
  id: GoalId;
  label: string;
  description: string;
}

/*
 * I NOMI SONO QUELLI DELLA DIDATTICA, non descrizioni nostre.
 *
 * «Passaggio al tecnico» e «Profondo ricreativo» erano frasi inventate qui
 * dentro: descrivevano bene la cosa, ma non sono come le chiama nessuno. Chi si
 * immerge riconosce **Subacquea Tecnica** e **Avanzato Ricreativo**, che sono i
 * nomi dei percorsi formativi — e un obiettivo che porta il nome giusto si
 * sceglie senza doverci pensare.
 *
 * Gli `id` restano quelli: finiscono nelle impostazioni salvate e nei backup, e
 * rinominarli farebbe ripartire da «Miglioramento generale» chi aveva scelto
 * altro. Un'etichetta si cambia, una chiave d'archivio no.
 */
export const GOALS: Goal[] = [
  {
    id: 'tec',
    label: 'Subacquea Tecnica',
    description:
      'Immersioni con decompressione pianificata, configurazione hogarthiana, gestione di più miscele.',
  },
  {
    id: 'deep-recreational',
    label: 'Avanzato Ricreativo',
    description: 'Consolidare la fascia 30–40 m in curva, con margini di gas ampi.',
  },
  {
    id: 'general',
    label: 'Miglioramento generale',
    description: 'Assetto, consumo e ripetibilità, senza un traguardo specifico.',
  },
];

export interface ReadinessItem {
  label: string;
  /**
   * Il valore attuale, oppure `undefined` quando l'archivio non lo contiene.
   *
   * La distinzione conta: un consumo sconosciuto non è un consumo di zero, e
   * scriverlo come zero significherebbe mostrare un criterio «0 L/min» che
   * sembra ottimo mentre in realtà non è mai stato misurato.
   */
  have: number | undefined;
  need: number;
  unit: string;
  met: boolean;
  /** Vero se il criterio è "non superare" invece di "raggiungere". */
  lowerIsBetter?: boolean;
  note?: string;
}

export interface Readiness {
  goal: Goal;
  /** Frazione di criteri soddisfatti, 0..1. */
  score: number;
  items: ReadinessItem[];
  verdict: string;
}

export interface Plan {
  generatedAt: string;
  goal: Goal;
  /** Tutti i risultati, ordinati per priorità. */
  findings: Finding[];
  /** I tre su cui lavorare adesso. */
  focus: Finding[];
  /** Ciò che funziona e va mantenuto. */
  strengths: Finding[];
  readiness: Readiness;
}

// ---------------------------------------------------------------------------
// Soglie di riferimento
// ---------------------------------------------------------------------------

const BENCHMARK = {
  /** Consumo di superficie, L/min. Riferimenti diffusi nella didattica tecnica. */
  rmvExcellent: 15,
  rmvGood: 20,
  rmvHigh: 25,
  /** Metri verticali sprecati al minuto nei tratti a quota tenuta. */
  trimGood: LIMITS.goodTrimMpm,
  trimPoor: 4,
  /** Frazione massima accettabile di immersioni con risalite fuori limite. */
  fastAscentRate: 0.1,
  /** Frazione minima di soste di sicurezza completate. */
  safetyStopRate: 0.9,
  /** Frazione massima di immersioni chiuse sotto i 50 bar. */
  lowReserveRate: 0.05,
  /** Immersioni al mese per considerarsi "in allenamento". */
  perMonth: 2,
  /** Giorni oltre i quali la manualità si degrada in modo percepibile. */
  layoffDays: 60,
  /** Minimo di immersioni con profilo per fidarsi delle metriche derivate. */
  minBasis: 6,
};

// ---------------------------------------------------------------------------
// Regole
// ---------------------------------------------------------------------------

type Rule = (agg: Aggregates, dives: Dive[], t: Traduci) => Finding | null;

const ruleGasLevel: Rule = (agg, _dives, t) => {
  const n = agg.rmv.length;
  if (n < BENCHMARK.minBasis || agg.avgRmv === undefined) return null;
  const rmv = agg.avgRmv;
  const recent = mean(agg.rmv.slice(-10).map((p) => p.value));

  const evidence = [
    frase(
      t,
      'Consumo medio di superficie {0} L/min su {1} immersioni con pressione e volume bombola.',
      rmv.toFixed(1),
      n,
    ),
    // "Ultime 10" solo quando sono davvero dieci: con sei immersioni la frase
    // mostrava la media di sei chiamandola dieci, ed era identica alla riga sopra.
    recent !== undefined && agg.rmv.length > 10
      ? frase(t, 'Ultime 10 immersioni: {0} L/min.', recent.toFixed(1))
      : '',
    agg.rmvTrend
      ? frase(
          t,
          'Tendenza: {0} → {1} L/min fra prima e seconda metà dello storico.',
          rmv2(agg.rmvTrend.firstHalf),
          rmv2(agg.rmvTrend.secondHalf),
        )
      : '',
  ].filter(Boolean);

  if (rmv <= BENCHMARK.rmvExcellent) {
    return {
      id: 'gas-level-excellent',
      area: 'gas',
      severity: 'good',
      headline: frase(t, 'Consumo basso e utilizzabile per la pianificazione: {0} L/min', rmv.toFixed(1)),
      detail: t(
        'A questo livello il consumo è abbastanza stabile per essere usato nei calcoli di gas con un margine ragionevole. Continua a registrare pressione iniziale e finale a ogni immersione: un consumo affidabile vale più di uno basso.',
      ),
      evidence,
      drills: [t('Verifica il valore su miscele e profondità diverse prima di usarlo per pianificare.')],
      priority: 15,
      basis: n,
    };
  }

  const severity: Severity = rmv > BENCHMARK.rmvHigh ? 'serious' : 'warning';
  return {
    id: 'gas-level',
    area: 'gas',
    severity,
    headline: frase(t, "Consumo di superficie {0} L/min: c'è margine", rmv.toFixed(1)),
    detail:
      rmv > BENCHMARK.rmvHigh
        ? t(
            "Sopra i 25 L/min il gas diventa il vincolo dominante dell'immersione e riduce i margini nella pianificazione tecnica. Nella maggior parte dei casi la causa non è polmonare: è assetto, pinneggiata e sovra-zavorra.",
          )
        : t(
            "Un consumo in questa fascia è normale ma comprimibile. Il guadagno più rapido viene dall'assetto, non dalla respirazione.",
          ),
    evidence,
    target: frase(t, 'Portare la media sotto {0} L/min nelle prossime 10 immersioni.', BENCHMARK.rmvGood),
    drills: [
      t(
        'Prova di zavorra a fine immersione con 50 bar: devi restare fermo a 5 m con polmoni a metà. Togli piombo finché non ci riesci.',
      ),
      t(
        'Sospensione statica: 5 minuti a 6 m senza toccare il jacket e senza usare le pinne. In piscina o su un fondale basso.',
      ),
      t(
        "Pinneggiata a rana per tutta la fase di fondo di un'immersione: riduce la spinta parassita e il consumo con essa.",
      ),
      t(
        'Ripeti lo stesso sito due volte a un mese di distanza e confronta il consumo: elimina la variabile "immersione diversa".',
      ),
    ],
    priority: rmv > BENCHMARK.rmvHigh ? 78 : 58,
    basis: n,
  };
};

const ruleGasTrend: Rule = (agg, _dives, t) => {
  const tr = agg.rmvTrend;
  if (!tr || tr.direction !== 'worsening' || tr.n < 8) return null;
  return {
    id: 'gas-trend',
    area: 'gas',
    severity: 'warning',
    headline: t('Il consumo sta salendo nel tempo'),
    detail: t(
      'La tendenza è in crescita. Prima di lavorare sulla tecnica, controlla le cause banali: cambio di muta o di zavorra, acqua più fredda, immersioni più profonde o più impegnative, erogatore da regolare.',
    ),
    evidence: [
      frase(
        t,
        'Da {0} a {1} L/min fra prima e seconda metà ({2} immersioni).',
        tr.firstHalf.toFixed(1),
        tr.secondHalf.toFixed(1),
        tr.n,
      ),
      frase(t, "Variazione stimata {0} L/min all'anno.", signed(tr.slopePerYear)),
    ],
    target: t('Riportare la media delle prossime 10 immersioni al livello della prima metà dello storico.'),
    drills: [
      t(
        'Confronta il consumo su immersioni allo stesso sito e stagione: se il delta sparisce, è la condizione e non la tecnica.',
      ),
      t("Controlla la regolazione dell'erogatore: uno sforzo inspiratorio alto si paga in consumo."),
    ],
    priority: 62,
    basis: tr.n,
  };
};

const ruleBuoyancy: Rule = (agg, _dives, t) => {
  const n = agg.trim.length;
  if (n < BENCHMARK.minBasis || agg.avgTrim === undefined) return null;
  const trim = agg.avgTrim;
  const evidence = [
    frase(
      t,
      '{0} m verticali "sprecati" al minuto mentre tieni la quota, media su {1} immersioni.',
      trim.toFixed(1),
      n,
    ),
    agg.trimTrend
      ? frase(
          t,
          'Tendenza: {0} → {1} m/min.',
          agg.trimTrend.firstHalf.toFixed(1),
          agg.trimTrend.secondHalf.toFixed(1),
        )
      : '',
  ].filter(Boolean);

  if (trim <= BENCHMARK.trimGood) {
    return {
      id: 'buoyancy-good',
      area: 'buoyancy',
      severity: 'good',
      headline: frase(t, 'Assetto solido: {0} m/min di oscillazione', trim.toFixed(1)),
      detail: t(
        'Tieni la quota con precisione. È il prerequisito che rende possibile tutto il resto: soste di deco stabili, riprese fotografiche, lavoro in coppia.',
      ),
      evidence,
      drills: [t('Mantieni il livello aggiungendo un compito: bobina, dSMB, gestione stage.')],
      priority: 12,
      basis: n,
    };
  }

  const severity: Severity = trim > BENCHMARK.trimPoor ? 'serious' : 'warning';
  return {
    id: 'buoyancy',
    area: 'buoyancy',
    severity,
    headline: frase(t, 'Oscillazione verticale di {0} m/min a quota tenuta', trim.toFixed(1)),
    detail: t(
      'Nei tratti in cui dovresti tenere la quota, la profondità cambia più del necessario. È la prima causa di consumo elevato e, in immersione con decompressione, rende imprecise le soste. Le cause tipiche in ordine di frequenza: sovra-zavorra, assetto non orizzontale, uso del jacket al posto del respiro per le correzioni piccole.',
    ),
    evidence,
    target: frase(t, 'Scendere sotto {0} m/min di oscillazione media.', BENCHMARK.trimGood),
    drills: [
      t(
        'Prova di zavorra corretta (fine immersione, 50 bar, fermo a 5 m). Quasi sempre si scopre di portare 2 kg di troppo.',
      ),
      t('Hover a testa in giù e poi orizzontale per 3 minuti ciascuno: rivela dove è concentrato il peso.'),
      t(
        'Riposiziona la zavorra: se le gambe cadono, spostane una parte verso le spalle o usa una piastra più pesante.',
      ),
      t('Correzioni piccole col respiro, il jacket solo per i cambi di quota veri.'),
      t(
        "Passa un'immersione a seguire una parete a quota costante e guarda il profilo dopo: il grafico è il giudice.",
      ),
    ],
    priority: trim > BENCHMARK.trimPoor ? 82 : 66,
    basis: n,
  };
};

const ruleAscentRate: Rule = (agg, dives, t) => {
  const withProfile = dives.filter((d) => (d.metrics?.quality?.sampleCount ?? 0) > 2);
  if (withProfile.length < BENCHMARK.minBasis || agg.fastAscentRate === undefined) return null;
  const rate = agg.fastAscentRate;
  const offenders = withProfile.filter(
    (d) => (d.metrics?.fastAscentS ?? 0) + (d.metrics?.fastShallowAscentS ?? 0) >= 30,
  );

  if (rate <= 0.02) {
    return {
      id: 'ascent-good',
      area: 'ascent',
      severity: 'good',
      headline: t('Velocità di risalita sotto controllo'),
      detail: t(
        'Le risalite rispettano i limiti in modo costante, anche nella fascia finale, che è quella che conta di più.',
      ),
      evidence: [
        frase(t, '{0} immersioni su {1} con almeno 30 s fuori limite.', offenders.length, withProfile.length),
      ],
      drills: [],
      priority: 10,
      basis: withProfile.length,
    };
  }

  const severity: Severity =
    rate > 0.3 ? 'critical' : rate > BENCHMARK.fastAscentRate ? 'serious' : 'warning';
  const shallow = offenders.filter((d) => (d.metrics?.fastShallowAscentS ?? 0) >= 30).length;
  return {
    id: 'ascent-rate',
    area: 'ascent',
    severity,
    headline: frase(t, 'Risalite oltre il limite nel {0} delle immersioni', pct(rate)),
    detail:
      frase(
        t,
        'Il limite di riferimento è {0} m/min sotto i 10 m e {1} m/min sopra.',
        LIMITS.ascentRateDeepMpm,
        LIMITS.ascentRateShallowMpm,
      ) +
      ' ' +
      (shallow > offenders.length / 2
        ? t(
            "Le violazioni sono concentrate negli ultimi metri, dove l'espansione del gas è massima e il controllo è più difficile: è lì che serve rallentare, non sul fondo.",
          )
        : t(
            'Rallentare la risalita è il singolo intervento con il miglior rapporto fra sforzo e riduzione del rischio.',
          )),
    evidence: [
      frase(
        t,
        '{0} immersioni su {1} con almeno 30 s sopra il limite.',
        offenders.length,
        withProfile.length,
      ),
      frase(t, 'Di queste, {0} con violazioni sopra i 10 m.', shallow),
      frase(
        t,
        'Picco registrato: {0} m/min.',
        Math.max(...withProfile.map((d) => d.metrics?.maxAscentRateMpm ?? 0)).toFixed(0),
      ),
    ],
    target: frase(t, 'Portare le immersioni con violazioni sotto il {0}.', pct(BENCHMARK.fastAscentRate)),
    drills: [
      t(
        'Risali contando: 3 m ogni 20 secondi sotto i 10 m, 3 m ogni 30 secondi sopra. Cronometra, non stimare.',
      ),
      t(
        'Usa la cima o la parete come riferimento visivo: senza riferimenti la percezione della velocità è inaffidabile.',
      ),
      t('Guarda il grafico di profondità dopo ogni immersione: la pendenza della risalita è la verifica.'),
      t('Se risali con dSMB, lancia la boa e poi risali sulla sagola: dà un riferimento e impone un ritmo.'),
    ],
    priority: severity === 'critical' ? 95 : severity === 'serious' ? 85 : 60,
    basis: withProfile.length,
  };
};

const ruleSafetyStop: Rule = (agg, _dives, t) => {
  if (agg.safetyStopEligible < BENCHMARK.minBasis || agg.safetyStopRate === undefined) return null;
  const rate = agg.safetyStopRate;
  if (rate >= 0.95) {
    return {
      id: 'safety-stop-good',
      area: 'safety',
      severity: 'good',
      headline: t('Sosta di sicurezza sistematica'),
      detail: t(
        "La sosta di sicurezza è un'abitudine, non un'eccezione. È esattamente la disciplina che serve quando le soste diventano obbligatorie.",
      ),
      evidence: [
        frase(
          t,
          'Completata nel {0} delle {1} immersioni in curva sopra i 10 m.',
          pct(rate),
          agg.safetyStopEligible,
        ),
      ],
      drills: [],
      priority: 10,
      basis: agg.safetyStopEligible,
    };
  }
  return {
    id: 'safety-stop',
    area: 'safety',
    severity: rate < 0.6 ? 'serious' : 'warning',
    headline: frase(t, 'Sosta di sicurezza completata nel {0} delle immersioni', pct(rate)),
    detail:
      frase(
        t,
        'Consideriamo completata una sosta di almeno {0} minuti fra 3 e 6 m.',
        Math.round(LIMITS.safetyStopMinS / 60),
      ) +
      ' ' +
      t(
        'Al di là del beneficio decompressivo, è il momento in cui si allena il controllo di quota a bassa profondità: la stessa abilità che serve per una sosta di deco.',
      ),
    evidence: [
      frase(
        t,
        '{0} soste complete su {1} immersioni valutabili.',
        Math.round(rate * agg.safetyStopEligible),
        agg.safetyStopEligible,
      ),
      t('Valutate solo le immersioni in curva oltre i 10 m con profilo campionato.'),
    ],
    target: frase(t, 'Superare il {0} nelle prossime 15 immersioni.', pct(BENCHMARK.safetyStopRate)),
    drills: [
      t('Programma la sosta come parte del profilo, non come extra: pianifica il gas per 5 m/5 min.'),
      t(
        'Se il problema è tenere la quota a 5 m con la bombola scarica, torna alla prova di zavorra: è quella la causa.',
      ),
    ],
    priority: rate < 0.6 ? 80 : 55,
    basis: agg.safetyStopEligible,
  };
};

const ruleCeilingViolations: Rule = (agg, dives, t) => {
  if (agg.ceilingViolations === 0) return null;
  const worst = dives
    .filter((d) => (d.metrics?.ceilingViolationS ?? 0) > 10)
    .sort((a, b) => (b.metrics!.ceilingViolationS ?? 0) - (a.metrics!.ceilingViolationS ?? 0))
    .slice(0, 3);
  return {
    id: 'ceiling-violation',
    area: 'deco',
    severity: 'critical',
    headline:
      agg.ceilingViolations === 1
        ? t("Un'immersione con violazione del tetto di decompressione")
        : frase(t, '{0} immersioni con violazione del tetto di decompressione', agg.ceilingViolations),
    detail: t(
      "Il profilo è salito sopra il tetto imposto dal computer. È il tipo di errore che va chiuso prima di aggiungere complessità, e vale la pena rivederlo con l'istruttore guardando i profili insieme.",
    ),
    evidence: worst.map((d) =>
      frase(
        t,
        '{0}: {1} sopra il tetto (max {2} m).',
        // Data e nome del sito stanno insieme fuori dal dizionario: sono un nome
        // proprio e una data già formattata, non pezzi di frase da tradurre.
        `${formatDate(d.startTime)}${d.site?.name ? ` · ${d.site.name}` : ''}`,
        formatDuration(d.metrics!.ceilingViolationS),
        d.metrics!.maxCeilingM?.toFixed(1) ?? '—',
      ),
    ),
    target: t('Zero violazioni. Non è un obiettivo da migliorare gradualmente.'),
    drills: [
      t("Rivedi i profili con l'istruttore: capire perché è successo conta più di sapere che è successo."),
      t(
        'Verifica di leggere il tetto e non la profondità della prossima tappa: sono due numeri diversi sullo stesso schermo.',
      ),
      t('Allena il mantenimento della quota a 6 e 3 m con un compito in mano.'),
    ],
    priority: 100,
    basis: agg.ceilingEligible,
  };
};

const ruleGasReserve: Rule = (agg, dives, t) => {
  if (agg.lowReserveEligible < BENCHMARK.minBasis || agg.lowReserveRate === undefined) return null;
  const rate = agg.lowReserveRate;
  if (rate <= 0.02) {
    return {
      id: 'reserve-good',
      area: 'safety',
      severity: 'good',
      headline: t('Riserva di gas rispettata'),
      detail: t('Chiudi le immersioni con margine. È la premessa della pianificazione a regola dei terzi.'),
      evidence: [
        frase(
          t,
          "Solo il {0} delle {1} immersioni sotto i 50 bar all'uscita.",
          pct(rate),
          agg.lowReserveEligible,
        ),
      ],
      drills: [],
      priority: 8,
      basis: agg.lowReserveEligible,
    };
  }
  const low = dives
    .filter((d) => (d.metrics?.endPressureBar ?? 999) < 50)
    .sort((a, b) => (a.metrics!.endPressureBar ?? 0) - (b.metrics!.endPressureBar ?? 0))
    .slice(0, 3);
  return {
    id: 'reserve',
    area: 'safety',
    severity: rate > 0.2 ? 'serious' : 'warning',
    headline: frase(t, 'Uscita sotto i 50 bar nel {0} delle immersioni', pct(rate)),
    detail: t(
      'Una riserva sottile funziona finché tutto va secondo previsione. Nella Subacquea Tecnica la logica cambia: il gas di riserva non è "quello che resta" ma una quantità calcolata prima di entrare in acqua.',
    ),
    evidence: low.map((d) =>
      frase(
        t,
        '{0}: uscita a {1} bar da {2} m.',
        formatDate(d.startTime),
        d.metrics!.endPressureBar!,
        d.maxDepth.toFixed(0),
      ),
    ),
    target: t(
      "Nessuna immersione sotto i 50 bar; risalita iniziata alla pressione decisa prima dell'ingresso.",
    ),
    drills: [
      t(
        'Fissa la pressione di risalita prima di entrare e comunicala al compagno. Poi rispettala anche se "c\'era ancora tempo".',
      ),
      t(
        'Con il consumo che hai, calcola il gas necessario per risalire in due da profondità massima: è quella la riserva minima.',
      ),
      t('Passa alla regola dei terzi sulle immersioni in cui non puoi risalire in verticale.'),
    ],
    priority: rate > 0.2 ? 76 : 52,
    basis: agg.lowReserveEligible,
  };
};

const ruleCurrency: Rule = (agg, _dives, t) => {
  // La finestra scelta nell'interfaccia entra anche nelle parole.
  //
  // Prima la regola diceva sempre «negli ultimi 12 mesi» leggendo un conteggio
  // che la finestra aveva già ridotto a sei: su «Ultimi 6 mesi» accusava di
  // scarsa frequenza chi ne fa 2.6 al mese, con una cifra falsa nell'evidenza.
  const mesi = agg.spanMonths;
  const periodo =
    mesi >= 11.5
      ? t('negli ultimi 12 mesi')
      : frase(t, 'negli ultimi {0} mesi', mesi.toFixed(mesi < 2 ? 1 : 0));
  if (agg.count < 5) return null;
  const days = agg.daysSinceLastDive ?? 0;
  const perMonth = agg.perMonthLast12m;

  if (days > BENCHMARK.layoffDays) {
    return {
      id: 'currency-layoff',
      area: 'experience',
      severity: days > 180 ? 'serious' : 'warning',
      headline: frase(t, '{0} giorni dall’ultima immersione', days),
      detail: t(
        'Dopo una pausa lunga la manualità si degrada in modo prevedibile: assetto, gestione della zavorra, procedure di emergenza. La rientrata è più utile se è deliberata invece che "la prima immersione della stagione".',
      ),
      evidence: [
        frase(t, 'Ultima immersione: {0}.', agg.lastDive ? formatDate(agg.lastDive) : '—'),
        frase(t, '{0} immersioni {1} ({2}/mese).', agg.divesLast12m, periodo, perMonth),
      ],
      target: t('Una prima immersione di rientro bassa e semplice, con ripasso di assetto e procedure.'),
      drills: [
        t('Prima immersione di rientro entro i 18 m, su sito conosciuto, con prova di zavorra.'),
        t('Ripasso a secco: monta e smonta l’attrezzatura, e prova a raggiungere i rubinetti della bombola.'),
        t('Una sessione in piscina prima del mare, se possibile.'),
      ],
      priority: days > 180 ? 74 : 48,
      basis: agg.count,
    };
  }

  if (perMonth < BENCHMARK.perMonth) {
    return {
      id: 'currency-frequency',
      area: 'experience',
      severity: 'warning',
      headline: frase(t, '{0} immersioni al mese: poche per consolidare', perMonth),
      detail: t(
        'A questa frequenza ogni immersione serve in parte a recuperare quello che si è perso dalla precedente, e i progressi si accumulano lentamente. Non è un problema di sicurezza: è un problema di velocità di apprendimento.',
      ),
      evidence: [
        frase(t, '{0} immersioni {1}.', agg.divesLast12m, periodo),
        frase(t, '{0} negli ultimi 90 giorni.', agg.divesLast90d),
      ],
      target: t('Quattro immersioni al mese nella stagione, con un obiettivo dichiarato per ciascuna.'),
      drills: [
        t('Un obiettivo per immersione, scritto prima: assetto, consumo, o una procedura.'),
        t(
          'Le uscite in lago valgono come allenamento anche fuori stagione: acqua fredda, visibilità corta, e nessuna scusa per non curare l’assetto.',
        ),
      ],
      priority: 44,
      basis: agg.count,
    };
  }

  if (perMonth >= 3 && days <= 30) {
    return {
      id: 'currency-good',
      area: 'experience',
      severity: 'good',
      headline: frase(t, 'In allenamento: {0} immersioni al mese', perMonth),
      detail: t(
        'La frequenza è quella giusta per far attecchire i miglioramenti tecnici invece di ricominciare ogni volta.',
      ),
      evidence: [frase(t, '{0} immersioni {1}, ultima {2} giorni fa.', agg.divesLast12m, periodo, days)],
      drills: [],
      priority: 6,
      basis: agg.count,
    };
  }
  return null;
};

const ruleDataQuality: Rule = (agg, dives, t) => {
  if (agg.count < 5) return null;
  const noProfile = agg.count - agg.withProfile;
  const noGas = dives.filter((d) => d.metrics?.rmvLpm === undefined).length;
  const missingVolume = dives.filter(
    (d) => d.metrics?.quality?.hasTankPressure && !d.metrics.quality.hasCylinderVolume,
  ).length;
  /*
   * LE PRESSIONI MANCANTI SI CONTANO, non si ricavano per sottrazione.
   *
   * `noGas - missingVolume` veniva descritto come «immersioni che non hanno
   * affatto le pressioni», ma `noGas` comprende anche quelle che hanno pressioni
   * E volume e a cui manca la profondità media. Su sei immersioni senza profilo
   * ma con 12 L, 200 → 60 bar, la scheda diceva «6 su 6 non hanno affatto le
   * pressioni» e consigliava di compilare i volumi — che c'erano già, e che non
   * sbloccavano niente. La causa vera, la profondità media ignota, `metrics` la
   * scrive già nel caveat giusto.
   */
  const senzaPressioni = dives.filter((d) => !d.metrics?.quality?.hasTankPressure).length;
  const altraCausa = noGas - senzaPressioni - missingVolume;

  if (noGas / agg.count < 0.3 && noProfile / agg.count < 0.3) return null;

  const evidence = [
    frase(t, '{0} immersioni su {1} hanno un profilo campionato.', agg.withProfile, agg.count),
    frase(t, '{0} immersioni su {1} permettono di calcolare il consumo.', agg.count - noGas, agg.count),
  ];
  if (missingVolume > 0) {
    evidence.push(
      frase(t, '{0} immersioni hanno la pressione ma non il volume della bombola.', missingVolume),
    );
  }
  if (senzaPressioni > 0) evidence.push(frase(t, '{0} immersioni non hanno le pressioni.', senzaPressioni));
  if (altraCausa > 0) {
    evidence.push(
      frase(
        t,
        '{0} hanno pressioni e volume ma manca la profondità media, che serve al calcolo.',
        altraCausa,
      ),
    );
  }

  return {
    id: 'data-coverage',
    area: 'data',
    severity: 'warning',
    headline: t("Una parte dell'analisi è bloccata da dati mancanti"),
    // «Manca soprattutto il volume» era una frase comoda che i numeri smentivano:
    // sull'archivio vero 33 immersioni su 35 sono senza consumo perché manca la
    // PRESSIONE, e compilare i volumi ne sbloccava due. Adesso la causa dichiarata
    // è quella che pesa davvero, e il guadagno promesso è quantificato.
    // La causa dichiarata è quella che pesa davvero, contata e non dedotta, e il
    // guadagno promesso è quantificato: consigliare di compilare i volumi
    // quando i volumi ci sono già è un consiglio che non sblocca niente.
    detail:
      altraCausa >= senzaPressioni && altraCausa >= missingVolume
        ? frase(
            t,
            "Manca soprattutto la profondità media: {0} immersioni hanno pressioni e volume ma nessun profilo da cui ricavarla, e senza quella il consumo in L/min non si può calcolare. Si può scriverla a mano nella scheda dell'immersione.",
            altraCausa,
          )
        : missingVolume >= senzaPressioni
          ? frase(
              t,
              'Manca soprattutto il volume delle bombole: {0} immersioni hanno le pressioni ma non il volume. È un campo che si compila una volta per configurazione, e su quelle sblocca il consumo in L/min — senza, il logbook può dire solo bar/min, che non è confrontabile fra bombole diverse.',
              missingVolume,
            )
          : frase(
              t,
              'Mancano soprattutto le pressioni: {0} immersioni su {1} non le hanno, e senza pressione iniziale e finale il consumo non esiste.',
              senzaPressioni,
              agg.count,
            ) +
            (missingVolume > 0
              ? ' ' +
                frase(
                  t,
                  "Compilare i volumi sbloccherebbe le {0} che le pressioni ce l'hanno già.",
                  missingVolume,
                )
              : ''),
    evidence,
    target: t('Volume bombola e pressione iniziale/finale su tutte le immersioni future.'),
    drills: [
      t('Compila il volume nella scheda bombola: si fa una volta per configurazione.'),
      t('Se il computer non registra la pressione, annota pressione iniziale e finale a fine immersione.'),
      t(
        'Se hai i file esportati dal programma che usavi prima, reimportali: spesso contengono più dati di quanti quel programma ne mostrasse.',
      ),
    ],
    priority: 40,
    basis: agg.count,
  };
};

const ruleDecoExposure: Rule = (agg, dives, t) => {
  const decoDives = dives.filter(
    (d) => (d.metrics?.decoS ?? 0) >= 60 || (d.reported?.maxDecoObligationS ?? 0) >= 60,
  );
  if (decoDives.length === 0) return null;
  const totalDeco = decoDives.reduce(
    (a, d) => a + Math.max(d.metrics?.decoS ?? 0, d.reported?.maxDecoObligationS ?? 0),
    0,
  );
  const violations = agg.ceilingViolations;
  if (violations > 0) return null; // già coperto dalla regola critica

  return {
    id: 'deco-exposure',
    area: 'deco',
    severity: 'good',
    headline: frase(
      t,
      '{0} immersioni con obbligo decompressivo, gestite senza violazioni',
      decoDives.length,
    ),
    detail: t(
      "L'esposizione alla decompressione sta crescendo e i profili sono stati rispettati. Il passo successivo è rendere ripetibile la parte noiosa: soste stabili al metro, tempi rispettati anche quando fa freddo e il gas scarseggia.",
    ),
    evidence: [
      frase(
        t,
        '{0} di obbligo decompressivo cumulato su {1} immersioni.',
        formatDuration(totalDeco),
        decoDives.length,
      ),
      frase(
        t,
        'Obbligo massimo su una singola immersione: {0}.',
        formatDuration(
          Math.max(
            ...decoDives.map((d) => Math.max(d.metrics?.decoS ?? 0, d.reported?.maxDecoObligationS ?? 0)),
          ),
        ),
      ),
      t('Nessuna violazione del tetto registrata.'),
    ],
    drills: [t('Soste con compito in mano: bobina, dSMB, cambio gas simulato.')],
    priority: 14,
    basis: decoDives.length,
  };
};

/**
 * GF99 all'uscita: quanto si esce sovrasaturi rispetto al gradiente ammesso.
 *
 * Va maneggiata con cautela e la regola lo riflette. Un GF99 vicino al GF alto
 * impostato NON è un errore: è esattamente ciò che accade seguendo il computer
 * fino in superficie. L'informazione utile non è "è troppo alto", è "quanto
 * margine resta" — e l'unica leva che lo abbassa senza cambiare le impostazioni è
 * fermarsi più a lungo negli ultimi metri. Quindi qui si riportano i numeri e si
 * rimanda all'istruttore per l'interpretazione, senza prescrivere niente.
 */
const ruleGf99: Rule = (agg, dives, t) => {
  const n = agg.gf99.length;
  if (n < BENCHMARK.minBasis || agg.avgGf99 === undefined) return null;
  const median = medianOf(agg.gf99.map((p) => p.value))!;
  // Il margine si misura rispetto al GF alto IMPOSTATO, non contro un 75 fisso.
  //
  // La regola stessa scrive che «quanto sia accettabile dipende dai gradient
  // factor che hai impostato», e poi ne usava uno fisso: sull'archivio vero
  // segnalava la settima immersione per margine — l'unica fatta con il computer a
  // 95 — e taceva sulle sei che di margine ne avevano lasciato meno. Un
  // ottantacinque per cento del proprio limite è la soglia: è una frazione, non
  // un valore assoluto, e vale con qualunque impostazione.
  // Il gradient factor alto è per immersione, non per archivio: si risale dal
  // `diveId` della serie, perché l'archivio è passato da 45/95 a 20/85 e
  // confrontare i due periodi con la stessa soglia è confrontare due cose diverse.
  /*
   * IL GF ALTO È SPESSO IGNOTO, e la frase diceva il contrario.
   *
   * Questa riga risale al gradient factor di quella immersione e, quando non
   * c'è, assume 85. L'assunzione è ragionevole — è il valore più comune — ma la
   * prova stampata sotto diceva «oltre l'85% del gradient factor alto IMPOSTATO
   * SU QUEL COMPUTER», cioè presentava come misurato un numero che su
   * quarantasette immersioni su quarantotto era stato indovinato. E lo stesso
   * risultato invita, due righe più giù, a «verificare quali gradient factor hai
   * impostato»: un conteggio costruito su un'assunzione, che chiede di
   * verificare l'assunzione, senza dire che c'è.
   *
   * Il conteggio resta com'era — cambiarlo vorrebbe dire tacere su quasi tutto
   * l'archivio — ma adesso si conta anche su quante immersioni il valore era
   * davvero scritto, e la prova lo dichiara.
   */
  const GF_ALTO_ASSUNTO = 85;
  const gfHighDi = (diveId: string) => dives.find((d) => d.id === diveId)?.computer?.gfHigh;
  const gfHighOf = (diveId: string) => gfHighDi(diveId) ?? GF_ALTO_ASSUNTO;
  const high = agg.gf99.filter((p) => p.value / gfHighOf(p.diveId) >= 0.85).length;
  const conGfNoto = agg.gf99.filter((p) => gfHighDi(p.diveId) !== undefined).length;

  const evidence = [
    frase(
      t,
      "GF99 mediano all'uscita {0}%, massimo {1}%, su {2} immersioni.",
      median.toFixed(0),
      agg.maxGf99!.toFixed(0),
      n,
    ),
    high === 1
      ? t("Un'immersione chiusa oltre l'85% del proprio gradient factor alto.")
      : frase(t, "{0} immersioni chiuse oltre l'85% del proprio gradient factor alto.", high),
    conGfNoto === n
      ? t('Il gradient factor alto è quello registrato dal computer su tutte le immersioni.')
      : frase(
          t,
          'Attenzione: il gradient factor alto è registrato solo su {0} immersioni su {1}; sulle altre è stato assunto {2}, che è il valore più diffuso ma non è il tuo dato.',
          conGfNoto,
          n,
          GF_ALTO_ASSUNTO,
        ),
    t(
      'Calcolato dal profilo con Bühlmann ZH-L16C, carico residuo compreso: c’è su tutte le immersioni con profilo, anche quando il computer non lo registra.',
    ),
  ];

  // Il ramo "buono" chiede sia una mediana bassa sia nessun caso oltre il 75%.
  // Quando la mediana è bassa ma un singolo caso sfora, il titolo che segue
  // attribuiva alla MEDIANA un giudizio prodotto da quel caso: qui si dice quello
  // che è successo davvero.
  if (median <= 65 && high > 0) {
    return {
      id: 'gf99-outlier',
      area: 'deco',
      severity: 'warning',
      // «immersione»/«immersioni» sono già due voci del dizionario: qui entrano
      // come valore, così la frase resta una chiave sola invece di due.
      headline: frase(
        t,
        'Di solito esci con margine, ma {0} {1} vicine al tuo limite',
        high,
        high === 1 ? t('immersione') : t('immersioni'),
      ),
      detail: t(
        "La mediana dice che il margine c'è quasi sempre; il caso isolato è quello da guardare, perché nasce da una circostanza specifica e non da un'abitudine.",
      ),
      evidence,
      drills: [
        t(
          'Apri le immersioni vicine al limite e confronta la risalita con quella delle altre: di solito la differenza sta lì.',
        ),
      ],
      target: t("Riportare anche i casi isolati sotto l'85% del gradient factor impostato."),
      priority: 30,
      basis: n,
    };
  }
  if (median <= 65 && high === 0) {
    return {
      id: 'gf99-good',
      area: 'deco',
      severity: 'good',
      headline: frase(t, 'Esci con margine: GF99 mediano {0}%', median.toFixed(0)),
      detail: t(
        "Il gradiente residuo all'uscita lascia spazio rispetto al limite impostato sul computer. È la condizione che rende ripetibili le immersioni multiple e le giornate consecutive.",
      ),
      evidence,
      drills: [],
      priority: 13,
      basis: n,
    };
  }

  return {
    id: 'gf99',
    area: 'deco',
    severity: 'warning',
    headline: frase(t, "GF99 mediano all'uscita {0}%: margine ridotto", median.toFixed(0)),
    detail: t(
      "Esci con una sovrasaturazione vicina a quella che il tuo computer ammette. Non è una violazione — il computer te lo consente — ma significa usare quasi tutto il margine, e su immersioni ripetitive o giornate consecutive il margine è ciò che si accumula. Quanto sia accettabile dipende dai gradient factor che hai impostato: verifica quali sono e parlane con l'istruttore prima di cambiare qualcosa.",
    ),
    evidence,
    target: t('Abbassare il GF99 mediano allungando la sosta negli ultimi metri, a impostazioni invariate.'),
    drills: [
      t('Allunga la sosta fra 3 e 6 m: è la leva che abbassa il GF99 senza toccare le impostazioni.'),
      t("Risali gli ultimi 6 metri in almeno un minuto: è il tratto dove l'espansione conta di più."),
      t('Guarda il GF99 sul computer appena riemergi e annotalo: diventa un numero su cui lavorare.'),
      t(
        'Verifica quali gradient factor hai impostato — molti non lo sanno, e senza quel dato il GF99 non si interpreta.',
      ),
    ],
    priority: 50,
    basis: n,
  };
};

/**
 * Velocità sull'ultimo tratto, dalla sosta alla superficie.
 *
 * È il difetto che nessuna metrica su finestra mobile può vedere, e DAN lo misura
 * come diffuso: la media reale su quel tratto è 60 m/min (TDI Advanced Nitrox
 * 2013, p. 38). Cinque metri percorsi in cinque secondi sono un'accelerazione
 * proprio dove la sovrasaturazione è massima.
 */
const ruleFinalAscent: Rule = (agg, _dives, t) => {
  const n = agg.finalAscent.length;
  if (n < BENCHMARK.minBasis) return null;
  const median = medianOf(agg.finalAscent.map((p) => p.value))!;
  const fast = agg.fastFinalAscents;
  const overLimit = agg.finalAscent.filter((p) => p.value > LIMITS.ascentRateShallowMpm).length;

  const evidence = [
    frase(t, "Velocità mediana sull'ultimo tratto {0} m/min, su {1} immersioni.", median.toFixed(0), n),
    frase(
      t,
      '{0} immersioni sopra i {1} m/min raccomandati nei metri finali{2}.',
      overLimit,
      LIMITS.ascentRateShallowMpm,
      fast ? frase(t, ', di cui {0} sopra i 60 m/min', fast) : '',
    ),
    t(
      'Misurata dalla sosta alla superficie, punto per punto: è un tratto troppo breve perché la velocità media dell’immersione lo mostri.',
    ),
  ];

  if (median <= LIMITS.ascentRateShallowMpm && fast === 0) {
    return {
      id: 'final-ascent-good',
      area: 'ascent',
      severity: 'good',
      headline: frase(t, 'Ultimi metri controllati: {0} m/min di mediana', median.toFixed(0)),
      detail: t(
        'Il tratto fra la sosta e la superficie è quello dove si accelera senza accorgersene, ed è anche quello dove la sovrasaturazione è massima. Qui non succede.',
      ),
      evidence,
      drills: [],
      priority: 12,
      basis: n,
    };
  }

  return {
    id: 'final-ascent',
    area: 'ascent',
    severity: fast > 0 ? 'serious' : 'warning',
    headline: frase(t, 'Gli ultimi metri li fai a {0} m/min', median.toFixed(0)),
    detail: t(
      'Dalla sosta di sicurezza alla superficie la velocità sale, perché il tratto è corto e sembra finito. È il punto in cui il gradiente fra tessuti e ambiente è più alto, quindi è il tratto in cui la velocità conta di più, non di meno.',
    ),
    evidence,
    target: frase(
      t,
      'Ultimi metri sotto i {0} m/min: dalla sosta alla superficie ci vuole quasi un minuto.',
      LIMITS.ascentRateShallowMpm,
    ),
    drills: [
      t('Conta: da 5 metri alla superficie devono passare almeno 50 secondi.'),
      t(
        'Sgonfia il jacket PRIMA di lasciare la sosta: la maggior parte delle risalite veloci finali è aria che si espande, non pinneggiata.',
      ),
      t("Guarda il computer nell'ultimo tratto, non la barca."),
    ],
    priority: fast > 0 ? 62 : 42,
    basis: n,
  };
};

/**
 * Esposizione all'ossigeno sulla giornata.
 *
 * Il CNS guarda la singola giornata e perdona — metà ogni novanta minuti in
 * superficie — mentre le OTU si accumulano e basta. La regola guarda la giornata
 * peggiore, non la media: è il picco che conta.
 */
const ruleOxygen: Rule = (agg, _dives, t) => {
  const o = agg.oxygen;
  if (o.eligible < BENCHMARK.minBasis || !o.worstCnsDay) return null;
  const cns = o.worstCnsDay.peakCnsPercent;
  const otu = o.worstOtuDay?.otu ?? 0;

  const evidence = [
    frase(
      t,
      'Giornata peggiore per il CNS: {0}% il {1} su {2} immersioni, limite 100%.',
      cns,
      o.worstCnsDay.date,
      o.worstCnsDay.dives,
    ),
    frase(
      t,
      'Giornata peggiore per le OTU: {0}, su una dose di riferimento di 300 al giorno quando si fanno più giorni di fila.',
      otu,
    ),
    frase(
      t,
      "Calcolato dall'app sul profilo con le tabelle NOAA, su {0} immersioni. Il computer usa un modello suo e può dare numeri diversi.",
      o.eligible,
    ),
  ];

  if (cns < 50 && otu <= 300) {
    return {
      id: 'oxygen-good',
      area: 'deco',
      severity: 'good',
      headline: frase(t, "Esposizione all'ossigeno larga: {0}% di CNS nella giornata peggiore", cns),
      detail: t(
        "C'è margine per aggiungere immersioni in giornata o giorni consecutivi senza avvicinarsi ai limiti di tossicità.",
      ),
      evidence,
      drills: [],
      priority: 8,
      basis: o.eligible,
    };
  }

  return {
    id: 'oxygen',
    area: 'deco',
    severity: cns >= 80 || otu > 850 ? 'serious' : 'warning',
    // Il titolo nomina la grandezza che ha fatto scattare la regola.
    //
    // Prima diceva «10 OTU nella giornata peggiore» quando a scattare era il CNS
    // al 55%: un avviso intitolato a un numero trenta volte sotto il proprio
    // riferimento, mentre quello che contava non compariva.
    headline:
      cns >= 50
        ? frase(t, 'Orologio CNS al {0}% in una giornata', cns)
        : frase(t, '{0} OTU nella giornata peggiore', otu),
    detail: t(
      "L'esposizione all'ossigeno si somma fra le immersioni della giornata: il CNS recupera a metà ogni novanta minuti in superficie, le OTU non recuperano affatto e si sommano anche da un giorno all'altro.",
    ),
    evidence,
    target: t('CNS sotto il 100% nella giornata e OTU sotto le 300 quando si fanno più giorni di fila.'),
    drills: [
      t(
        "Allunga l'intervallo di superficie fra la prima e la seconda: novanta minuti dimezzano il CNS accumulato.",
      ),
      t('Su più giorni di fila guarda le OTU, non il CNS: sono loro a limitare.'),
      t(
        'Se usi miscele ricche, la stessa immersione costa più ossigeno: controlla la PPO2 di fondo prima di scegliere il gas.',
      ),
    ],
    priority: cns >= 80 ? 66 : 34,
    basis: o.eligible,
  };
};

/**
 * Forma del profilo: dente di sega e parte profonda per prima.
 *
 * «Saw tooth profiles or dives with many big swings in depth should be avoided.
 * Ideally, dives should be conducted with the deeper portion of the dive occurring
 * first» (TDI Advanced Nitrox 2013, p. 38). Il manuale non dà una soglia numerica,
 * quindi la regola non ne inventa una: confronta le immersioni con le proprie e
 * parla solo quando la differenza è netta.
 */
const ruleProfileShape: Rule = (agg, _dives, t) => {
  const n = agg.sawtooth.length;
  if (n < BENCHMARK.minBasis || agg.deepestFirstEligible < BENCHMARK.minBasis) return null;
  const median = medianOf(agg.sawtooth.map((p) => p.value))!;
  const worst = Math.max(...agg.sawtooth.map((p) => p.value));
  const firstRate = agg.deepestFirstDives / agg.deepestFirstEligible;

  // LA SOGLIA INVENTATA CHE NON C'È PIÙ.
  //
  // Questa regola diceva «profili puliti» sotto i 15 m/h di ridiscese. Quindici
  // non viene da nessuna parte: il manuale sconsiglia i profili a dente di sega e
  // si guarda bene dal quantificarli, quindi il numero l'avevo scelto io perché
  // sembrava ragionevole — che è esattamente la cosa che questo progetto dice di
  // non fare. Al suo posto ci sono le immersioni fuori scala rispetto alle
  // PROPRIE: quante stanno sopra il terzo quartile dell'archivio, cioè quante
  // sono anomale per chi le ha fatte. È un giudizio relativo, ed è l'unico che i
  // dati sostengono.
  const ref = agg.sawtoothRef;
  // «Oltre il doppio del terzo quartile» degenera quando il quartile è zero: su un
  // archivio quasi perfetto (otto immersioni a 0 m/h, due a 0.4) qualunque valore
  // positivo diventava un'anomalia. Serve anche uno scarto assoluto rispetto alla
  // mediana, e il riferimento resta l'archivio stesso: si è fuori scala quando si
  // sta oltre il doppio del quartile E almeno cinque metri l'ora sopra la mediana,
  // che è la differenza che si vede nel profilo disegnato.
  const outliers = ref
    ? agg.sawtooth.filter((p) => p.value > ref.p75 * 2 && p.value > ref.p50 + 5).length
    : 0;
  const trendM = medianOf(agg.depthTrend.map((p) => p.value));

  const evidence = [
    frase(
      t,
      "Ridiscese dopo essere già risalito: {0} metri l'ora di mediana, {1} nel caso peggiore, su {2} immersioni.",
      median.toFixed(0),
      worst.toFixed(0),
      n,
    ),
    frase(
      t,
      'Parte profonda per prima in {0} immersioni su {1}{2}.',
      agg.deepestFirstDives,
      agg.deepestFirstEligible,
      trendM !== undefined
        ? frase(
            t,
            ', con la prima metà mediamente {0} m {1} della seconda',
            Math.abs(trendM).toFixed(1),
            trendM >= 0 ? t('più profonda') : t('più alta'),
          )
        : '',
    ),
    ref
      ? frase(
          t,
          'Il tuo quarto peggiore comincia a {0} m/h{1}.',
          ref.p75.toFixed(0),
          outliers > 0
            ? frase(t, ', e {0} immersioni stanno oltre il doppio di quella soglia', outliers)
            : '',
        )
      : t('Troppe poche immersioni per dire dove cade una rispetto alle altre.'),
    t(
      'La didattica sconsiglia i profili a dente di sega senza dare una soglia: questo indice va letto contro le tue immersioni, non contro un limite.',
    ),
  ];

  if (outliers === 0 && firstRate >= 0.8) {
    return {
      id: 'shape-good',
      area: 'ascent',
      severity: 'good',
      headline: t('Profili regolari: parte profonda per prima, nessuno fuori scala'),
      detail: t(
        'È la forma che la didattica raccomanda, e quella su cui i modelli decompressivi sono tarati meglio. Nessuna delle tue immersioni si stacca dalle altre.',
      ),
      evidence,
      drills: [],
      priority: 7,
      basis: n,
    };
  }

  return {
    id: 'shape',
    area: 'ascent',
    severity: 'warning',
    // Il titolo deve nominare il motivo per cui la regola è scattata.
    //
    // Prima poteva dire «Profili a dente di sega: 4 m/h» quando il ramo era stato
    // scelto per il VERSO del profilo, citando come prova il valore mediano —
    // cioè la normalità di quell'archivio — come se fosse un'accusa.
    headline:
      firstRate < 0.8
        ? frase(
            t,
            'La parte profonda non viene per prima in {0} immersioni su {1}',
            agg.deepestFirstEligible - agg.deepestFirstDives,
            agg.deepestFirstEligible,
          )
        : outliers === 1
          ? frase(t, '{0} immersione si stacca dalle tue per ridiscese', outliers)
          : frase(t, '{0} immersioni si staccano dalle tue per ridiscese', outliers),
    detail: t(
      'Risalire e riscendere carica e scarica i tessuti veloci più volte, e il modello decompressivo non lo gestisce come un profilo che scende una volta sola e poi risale. Andare prima sul punto più profondo e poi risalire progressivamente è la forma da cercare.',
    ),
    evidence,
    target: t("Un solo passaggio: giù al punto più profondo all'inizio, poi verso l'alto."),
    drills: [
      t("Pianifica il giro in modo che il punto più profondo sia all'inizio, non a metà."),
      t('Quando risali per superare un ostacolo, resta alla quota nuova invece di riscendere.'),
    ],
    priority: 26,
    basis: n,
  };
};

/**
 * Cambi di gas fatti sotto la MOD del gas di destinazione.
 *
 * È l'unico errore di procedura che un logbook può verificare da solo, e non è
 * un'imprecisione: respirare una miscela ricca sotto la sua profondità operativa è
 * il modo classico di arrivare a una crisi iperossica.
 */
const ruleGasSwitch: Rule = (agg, _dives, t) => {
  if (agg.badGasSwitches === 0) return null;
  return {
    id: 'gas-switch',
    area: 'deco',
    severity: 'critical',
    headline: frase(t, '{0} cambi di gas fatti sotto la profondità operativa del gas', agg.badGasSwitches),
    detail: t(
      'Passare a una miscela più ricca prima di essere risaliti alla sua profondità operativa massima porta la pressione parziale di ossigeno oltre il limite: prima di cambiare erogatore va verificata la profondità.',
    ),
    evidence: [
      t(
        'Rilevati sui profili con più di una bombola, confrontando la profondità del cambio con la MOD a 1.6 bar del gas di destinazione.',
      ),
    ],
    target: t('Zero. Non è un obiettivo da migliorare gradualmente.'),
    drills: [
      t(
        'Quattro gesti nell’ordine, prima di ogni cambio gas: mostra la bombola al compagno, aprila, verifica la PROFONDITÀ, poi cambia erogatore.',
      ),
      t('Etichetta le bombole con la MOD in numeri grandi, non con la percentuale.'),
    ],
    priority: 95,
    basis: agg.count,
  };
};

/**
 * Il prezzo delle ripetitive.
 *
 * PERCHÉ UNA REGOLA A SÉ. Perché è l'unica cosa in tutto il progetto che si può
 * dire solo guardando DUE immersioni insieme, e per questo non la dice nessun
 * computer subacqueo: il computer sa che sei più carico, ma non sa dirti quanto ti
 * è costato quell'intervallo di superficie rispetto a non averne avuto bisogno.
 * Noi rigiochiamo la stessa immersione da tessuti puliti e confrontiamo.
 *
 * COSA NON DICE. Non dice di allungare l'intervallo, e nemmeno di accorciarlo. La
 * durata di una pausa dipende dalla barca, dal gruppo, dal sito e dal freddo, e
 * un'app che dicesse «aspetta due ore» ignorerebbe tutto questo. Dice il numero,
 * e a chi lo legge la decisione.
 */
const ruleRepetitive: Rule = (agg, _dives, t) => {
  const n = agg.repetitiveDives;
  if (n < 3 || agg.repetitiveCostMedian === undefined) return null;
  const median = agg.repetitiveCostMedian;
  const worst = agg.repetitiveCostWorst;

  const evidence = [
    frase(
      t,
      "{0} immersioni dell'archivio sono ripetitive: sono cominciate con dell'azoto ancora in circolo.",
      n,
    ),
    frase(t, "Il carico residuo costa in mediana {0} punti di GF99 all'uscita.", median.toFixed(1)),
    worst
      ? frase(
          t,
          'Il caso peggiore è {0}{1}: {2} punti in più di quanti ne avresti avuti partendo da tessuti puliti.',
          worst.dive.startTime.slice(0, 10),
          worst.surfaceIntervalMin !== undefined
            ? frase(t, ' dopo {0} minuti di superficie', worst.surfaceIntervalMin)
            : '',
          worst.points.toFixed(1),
        )
      : '',
    agg.surfaceIntervalMedian !== undefined
      ? frase(t, 'Intervallo di superficie mediano: {0} minuti.', agg.surfaceIntervalMedian)
      : '',
    t(
      'Calcolato rigiocando la stessa immersione da tessuti puliti con Bühlmann ZH-L16C: è un confronto fra due esecuzioni dello stesso profilo, non una stima.',
    ),
  ].filter(Boolean);

  if (median < 2 && (worst?.points ?? 0) < 5) {
    return {
      id: 'repetitive-good',
      area: 'deco',
      severity: 'good',
      headline: frase(t, 'Le tue ripetitive costano poco: {0} punti di GF99', median.toFixed(1)),
      detail: t(
        'Gli intervalli di superficie che tieni bastano a smaltire quasi tutto: la seconda immersione della giornata esce quasi come se fosse la prima.',
      ),
      evidence,
      drills: [],
      priority: 9,
      basis: n,
    };
  }

  return {
    id: 'repetitive',
    area: 'deco',
    // Non è un difetto: è un fatto della fisica che vale la pena conoscere prima
    // di scendere la seconda volta. «warning» perché va guardato, non perché sia
    // stato fatto qualcosa di sbagliato.
    severity: 'warning',
    headline: frase(t, 'Le ripetitive escono {0} punti di GF99 più alte', median.toFixed(1)),
    detail: t(
      'È il prezzo dell’azoto che ti porti dietro dalla prima immersione: la stessa identica seconda immersione, fatta da tessuti puliti, finirebbe più bassa di così. Le due leve sono l’intervallo di superficie e la forma della seconda immersione — una più bassa e più corta paga molto meno.',
    ),
    evidence,
    target: t('Sapere, prima di scendere la seconda volta, con quanto margine in meno stai partendo.'),
    drills: [
      t('Apri la seconda immersione di una giornata: la scheda dice quanti punti è costata la pausa.'),
      t(
        'Nel pianificatore, modalità tecnica, scegli l’immersione precedente e l’intervallo: la tabella cambia sotto gli occhi.',
      ),
    ],
    priority: 22,
    basis: n,
  };
};

const RULES: Rule[] = [
  ruleRepetitive,
  ruleGasSwitch,
  ruleOxygen,
  ruleFinalAscent,
  ruleProfileShape,
  ruleCeilingViolations,
  ruleAscentRate,
  ruleBuoyancy,
  ruleGasLevel,
  ruleGasTrend,
  ruleSafetyStop,
  ruleGasReserve,
  ruleCurrency,
  ruleDataQuality,
  ruleGf99,
  ruleDecoExposure,
];

// ---------------------------------------------------------------------------
// Preparazione all'obiettivo
// ---------------------------------------------------------------------------

/**
 * I criteri sono riferimenti costruiti sulla pratica didattica corrente, NON i
 * prerequisiti formali di una didattica specifica: quelli vanno verificati con
 * l'agenzia e con l'istruttore. Servono a rispondere alla domanda "sono pronto
 * per il prossimo passo?" con dei numeri invece che con una sensazione.
 */
/**
 * I conteggi CUMULATIVI, che non dipendono dalla finestra scelta a schermo.
 *
 * IL DIFETTO CHE CHIUDE. La scheda di prontezza riceveva le aggregate della
 * finestra, e la finestra predefinita è dodici mesi: «Immersioni registrate» —
 * un criterio di brevetto, cioè il totale storico — mostrava 14 invece di 120, e
 * la prontezza per il tecnico crollava dal 44% al 22%. Con la finestra a sei
 * mesi, la riga «Immersioni negli ultimi 12 mesi» mostrava un conteggio su sei.
 * L'interfaccia non nomina il periodo accanto ai criteri, quindi non c'era modo
 * di accorgersene. `ruleCurrency` aveva già risolto lo stesso problema per il
 * testo introducendo il periodo; la prontezza no.
 *
 * Si calcolano su TUTTO l'archivio, perché è quello che chiede la didattica: un
 * brevetto non si perde cambiando il filtro della pagina.
 */
export interface Storico {
  count: number;
  deepDives24: number;
  deepDives30: number;
  divesLast12m: number;
}

export function storicoDi(dives: Dive[], now = Date.now()): Storico {
  const unAnnoFa = now - 365 * 86_400_000;
  let deepDives24 = 0;
  let deepDives30 = 0;
  let divesLast12m = 0;
  for (const d of dives) {
    if (d.maxDepth >= 24) deepDives24++;
    if (d.maxDepth >= 30) deepDives30++;
    if (Date.parse(d.startTime) >= unAnnoFa) divesLast12m++;
  }
  return { count: dives.length, deepDives24, deepDives30, divesLast12m };
}

function readinessFor(goal: Goal, agg: Aggregates, storico: Storico, t: Traduci): Readiness {
  /*
   * LE ETICHETTE SI TRADUCONO QUI, le note no.
   *
   * `Coach.tsx` fa già `t()` su entrambe quando le disegna. Ma il verdetto qui
   * sotto rimonta le etichette dentro una frase sua — «Manca un criterio: consumo
   * di superficie» — e quella frase esce di qui già composta: se l'etichetta non
   * fosse tradotta adesso, resterebbe italiana in mezzo a una frase inglese, e
   * non ci sarebbe nessun punto più avanti in cui rimediare.
   */
  const items: ReadinessItem[] = [];

  if (goal.id === 'tec') {
    items.push(
      {
        label: t('Immersioni registrate'),
        have: storico.count,
        need: 24,
        unit: '',
        met: storico.count >= 24,
      },
      {
        label: t('Immersioni oltre i 30 m'),
        have: storico.deepDives30,
        need: 10,
        unit: '',
        met: storico.deepDives30 >= 10,
      },
      {
        label: t('Immersioni negli ultimi 12 mesi'),
        have: storico.divesLast12m,
        need: 12,
        unit: '',
        met: storico.divesLast12m >= 12,
        note: 'Continuità: conta più del totale storico.',
      },
      {
        label: t('Consumo di superficie'),
        have: agg.avgRmv,
        need: BENCHMARK.rmvGood,
        unit: 'L/min',
        met: agg.avgRmv !== undefined && agg.avgRmv <= BENCHMARK.rmvGood,
        lowerIsBetter: true,
        note: 'Serve un valore noto e stabile: la pianificazione del gas si basa su questo.',
      },
      {
        label: t('Oscillazione a quota tenuta'),
        have: agg.avgTrim,
        need: BENCHMARK.trimGood,
        unit: 'm/min',
        met: agg.avgTrim !== undefined && agg.avgTrim <= BENCHMARK.trimGood,
        lowerIsBetter: true,
      },
      {
        label: t('Immersioni con risalite fuori limite'),
        have: agg.fastAscentRate === undefined ? undefined : Math.round(agg.fastAscentRate * 100),
        need: 10,
        unit: '%',
        met: (agg.fastAscentRate ?? 1) <= BENCHMARK.fastAscentRate,
        lowerIsBetter: true,
      },
      {
        label: t('Soste di sicurezza completate'),
        have: agg.safetyStopRate === undefined ? undefined : Math.round(agg.safetyStopRate * 100),
        need: 90,
        unit: '%',
        met: (agg.safetyStopRate ?? 0) >= BENCHMARK.safetyStopRate,
      },
      {
        label: t('Immersioni con soste decompressive'),
        have: agg.decoDives,
        need: 5,
        unit: '',
        met: agg.decoDives >= 5,
        note: 'Anche soste brevi e pianificate, sotto supervisione.',
      },
      {
        label: t('Violazioni del tetto'),
        have: agg.ceilingViolations,
        need: 0,
        unit: '',
        met: agg.ceilingViolations === 0,
        lowerIsBetter: true,
      },
    );
  } else if (goal.id === 'deep-recreational') {
    items.push(
      // Era rimasto indietro sul conteggio della FINESTRA: il ramo `tec` qui sopra
      // usava già `storico`, questo no, e cambiare periodo dalla pagina faceva
      // scendere un criterio di brevetto. Vedi il commento di `Storico`.
      {
        label: t('Immersioni registrate'),
        have: storico.count,
        need: 40,
        unit: '',
        met: storico.count >= 40,
      },
      // Il criterio è 24 m e adesso il numero è quello: prima usava il conteggio
      // oltre i 30, quindi otto immersioni a 27 m risultavano zero.
      {
        label: t('Immersioni oltre i 24 m'),
        have: storico.deepDives24,
        need: 5,
        unit: '',
        met: storico.deepDives24 >= 5,
      },
      {
        label: t('Immersioni negli ultimi 12 mesi'),
        have: storico.divesLast12m,
        need: 10,
        unit: '',
        met: storico.divesLast12m >= 10,
      },
      {
        label: t('Consumo di superficie'),
        have: agg.avgRmv,
        need: BENCHMARK.rmvHigh,
        unit: 'L/min',
        met: agg.avgRmv !== undefined && agg.avgRmv <= BENCHMARK.rmvHigh,
        lowerIsBetter: true,
      },
      {
        label: t('Soste di sicurezza completate'),
        have: agg.safetyStopRate === undefined ? undefined : Math.round(agg.safetyStopRate * 100),
        need: 90,
        unit: '%',
        met: (agg.safetyStopRate ?? 0) >= BENCHMARK.safetyStopRate,
      },
    );
  } else {
    items.push(
      {
        label: t('Immersioni negli ultimi 12 mesi'),
        have: storico.divesLast12m,
        need: 12,
        unit: '',
        met: storico.divesLast12m >= 12,
      },
      {
        label: t('Consumo di superficie'),
        have: agg.avgRmv,
        need: BENCHMARK.rmvGood,
        unit: 'L/min',
        met: agg.avgRmv !== undefined && agg.avgRmv <= BENCHMARK.rmvGood,
        lowerIsBetter: true,
      },
      {
        label: t('Oscillazione a quota tenuta'),
        have: agg.avgTrim,
        need: BENCHMARK.trimGood,
        unit: 'm/min',
        met: agg.avgTrim !== undefined && agg.avgTrim <= BENCHMARK.trimGood,
        lowerIsBetter: true,
      },
      {
        label: t('Soste di sicurezza completate'),
        have: agg.safetyStopRate === undefined ? undefined : Math.round(agg.safetyStopRate * 100),
        need: 90,
        unit: '%',
        met: (agg.safetyStopRate ?? 0) >= BENCHMARK.safetyStopRate,
      },
    );
  }

  const met = items.filter((i) => i.met).length;
  const score = items.length ? met / items.length : 0;
  const missing = items.filter((i) => !i.met);

  const verdict =
    score === 1
      ? t(
          "Tutti i criteri di riferimento sono soddisfatti. Il passo successivo è una verifica in acqua con l'istruttore, non un altro numero.",
        )
      : missing.length === 1
        ? frase(t, 'Manca un criterio: {0}.', missing[0].label.toLowerCase())
        : frase(
            t,
            'Mancano {0} criteri su {1}. I più vicini: {2}.',
            missing.length,
            items.length,
            missing
              .slice(0, 2)
              .map((i) => i.label.toLowerCase())
              .join(', '),
          );

  return { goal, score: Math.round(score * 100) / 100, items, verdict };
}

// ---------------------------------------------------------------------------

export function buildPlan(
  dives: Dive[],
  agg: Aggregates,
  goalId: GoalId = 'general',
  /**
   * I conteggi su TUTTO l'archivio, per i criteri di prontezza che non
   * dipendono dalla finestra. Vedi `storicoDi`. Se non arriva si ricava dalle
   * immersioni ricevute, che è il comportamento di prima.
   */
  storico?: Storico,
  t: Traduci = comeSta,
): Plan {
  const goal = GOALS.find((g) => g.id === goalId) ?? GOALS[2];
  const findings = RULES.map((rule) => {
    try {
      return rule(agg, dives, t);
    } catch {
      return null;
    }
  })
    .filter((f): f is Finding => f !== null)
    .sort((a, b) => b.priority - a.priority);

  const issues = findings.filter((f) => f.severity !== 'good');
  return {
    generatedAt: new Date().toISOString(),
    goal,
    findings,
    focus: issues.slice(0, 3),
    strengths: findings.filter((f) => f.severity === 'good'),
    readiness: readinessFor(goal, agg, storico ?? storicoDi(dives), t),
  };
}

// ---------------------------------------------------------------------------
// Debrief di una singola immersione
// ---------------------------------------------------------------------------

export interface Observation {
  severity: Severity;
  text: string;
}

/** Osservazioni su una sola immersione, per la scheda. */
export function debriefDive(dive: Dive, t: Traduci = comeSta): Observation[] {
  const m = dive.metrics;
  if (!m) return [];
  const out: Observation[] = [];

  if (m.ceilingViolationS > 10) {
    out.push({
      severity: 'critical',
      text: frase(
        t,
        '{0} sopra il tetto di decompressione (max {1} m).',
        formatDuration(m.ceilingViolationS),
        m.maxCeilingM?.toFixed(1) ?? '—',
      ),
    });
  }
  if (m.fastAscentS >= 30 || m.fastShallowAscentS >= 30) {
    out.push({
      severity: m.fastShallowAscentS >= 60 ? 'serious' : 'warning',
      text: frase(
        t,
        'Risalita oltre il limite per {0}, picco {1} m/min{2}.',
        formatDuration(m.fastAscentS + m.fastShallowAscentS),
        m.maxAscentRateMpm?.toFixed(0) ?? '—',
        m.fastShallowAscentS >= 30 ? ' ' + t('(anche sopra i 10 m)') : '',
      ),
    });
  }
  if (m.bottomVerticalTravelMpm !== undefined) {
    out.push(
      m.bottomVerticalTravelMpm <= LIMITS.goodTrimMpm
        ? {
            severity: 'good',
            text: frase(
              t,
              'Quota tenuta bene: {0} m/min di oscillazione.',
              m.bottomVerticalTravelMpm.toFixed(1),
            ),
          }
        : {
            severity: m.bottomVerticalTravelMpm > 4 ? 'serious' : 'warning',
            text: frase(
              t,
              '{0} m/min di oscillazione a quota tenuta (obiettivo sotto {1}).',
              m.bottomVerticalTravelMpm.toFixed(1),
              LIMITS.goodTrimMpm,
            ),
          },
    );
  }
  /*
   * LA SOSTA DI SICUREZZA SI GIUDICA SOLO DOVE SI PUÒ MISURARE.
   *
   * Senza `hasProfile` la scheda scriveva «Nessuna sosta di sicurezza fra 3 e
   * 6 m» su un'immersione importata da CSV, che un profilo non ce l'ha: lì
   * `safetyStopS = 0` vuol dire «non misurabile», non «non fatta», ed è il
   * principio che questo file dichiara in testa — un consumo sconosciuto non è
   * un consumo di zero. Le statistiche la escludevano già correttamente
   * (`aggregate` filtra su `withProfile`), quindi la stessa immersione veniva
   * rimproverata sulla scheda e ignorata nel tasso di soste completate.
   *
   * E in apnea la sosta di sicurezza non esiste: `aggregate` esclude anche
   * quelle, la scheda no.
   */
  if (dive.maxDepth >= 10 && m.decoS < 60 && m.quality.hasProfile && dive.mode !== 'freedive') {
    out.push(
      m.didSafetyStop
        ? { severity: 'good', text: frase(t, 'Sosta di sicurezza di {0}.', formatDuration(m.safetyStopS)) }
        : {
            severity: 'warning',
            text:
              m.safetyStopS > 0
                ? frase(t, 'Sosta di sicurezza breve: {0} fra 3 e 6 m.', formatDuration(m.safetyStopS))
                : t('Nessuna sosta di sicurezza fra 3 e 6 m.'),
          },
    );
  }
  if (m.endPressureBar !== undefined) {
    out.push(
      m.endPressureBar < LIMITS.minReserveBar
        ? {
            severity: 'serious',
            text: frase(
              t,
              'Uscita a {0} bar, sotto la riserva di {1} bar.',
              m.endPressureBar,
              LIMITS.minReserveBar,
            ),
          }
        : { severity: 'good', text: frase(t, 'Uscita a {0} bar.', m.endPressureBar) },
    );
  }
  if (m.rmvLpm !== undefined) {
    out.push({
      severity: m.rmvLpm <= BENCHMARK.rmvGood ? 'good' : m.rmvLpm > BENCHMARK.rmvHigh ? 'serious' : 'warning',
      text:
        m.avgDepth !== undefined
          ? frase(
              t,
              'Consumo di superficie {0} L/min a {1} m di media.',
              m.rmvLpm.toFixed(1),
              m.avgDepth.toFixed(1),
            )
          : frase(t, 'Consumo di superficie {0} L/min.', m.rmvLpm.toFixed(1)),
    });
  }
  if (m.maxPpo2 !== undefined && m.maxPpo2 > LIMITS.maxPpo2Bottom) {
    out.push({
      severity: m.maxPpo2 > LIMITS.maxPpo2Deco ? 'critical' : 'warning',
      text: frase(
        t,
        'PPO2 di picco {0} bar, oltre il limite di fondo di {1} bar.',
        m.maxPpo2.toFixed(2),
        LIMITS.maxPpo2Bottom,
      ),
    });
  }

  const order: Severity[] = ['critical', 'serious', 'warning', 'good'];
  return out.sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity));
}

// ---------------------------------------------------------------------------

const pct = (v: number) => `${Math.round(v * 100)}%`;
const rmv2 = (v: number) => v.toFixed(1);
const signed = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)}`;

function mean(v: number[]): number | undefined {
  if (v.length === 0) return undefined;
  return v.reduce((a, b) => a + b, 0) / v.length;
}

/**
 * La data dentro le frasi del piano, nella lingua scelta.
 *
 * Queste date NON stanno in un documento: finiscono in mezzo a frasi che passano
 * dal dizionario — «Ultima immersione: {0}.» — quindi una data italiana dentro
 * una frase inglese è la stessa incoerenza che il registro dei locale esiste per
 * togliere. Il locale arriva da lì e non da un parametro perché `coaching.ts` sta
 * nel nucleo, non vede React, e le sue funzioni prendono già `t`: aggiungere un
 * secondo argomento di lingua accanto a uno che la lingua ce l'ha dentro
 * significherebbe poterli far divergere.
 */
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(localeCorrente(), {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}
