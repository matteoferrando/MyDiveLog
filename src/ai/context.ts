/**
 * Costruzione del contesto per le analisi.
 *
 * IL PUNTO DI QUESTO FILE: un modello linguistico non deve *stimare* niente che
 * l'app sappia già. Quindi il contesto è fatto di numeri misurati, con le unità
 * accanto, e distingue sempre tre cose che sarebbe facile confondere:
 *
 *  - ciò che il COMPUTER ha registrato (GF99 all'uscita, tetto, NDL, CNS);
 *  - ciò che l'app ha CALCOLATO dal profilo (consumo, assetto, velocità);
 *  - ciò che non si sa, dichiarato come tale.
 *
 * L'ultima categoria è la più importante. Un'immersione senza pressioni bombola
 * non ha un consumo, e mandare al modello un campo assente senza dirlo lo invita a
 * riempirlo con un valore plausibile — che poi finirebbe in un piano di gas.
 *
 * SUL VOLUME DEI DATI: il profilo di un'immersione sono centinaia di campioni, e
 * l'archivio ne ha 85. Mandarli tutti costerebbe molto e non aggiungerebbe niente:
 * per giudicare la forma di un'immersione bastano ~40 punti, e per l'archivio
 * bastano una riga per immersione più le aggregate già calcolate. Il
 * sottocampionamento è documentato nel contesto stesso, così il modello sa che sta
 * guardando una versione ridotta.
 */

import type { Dive, Sample } from '../core/model';
import { LIMITS } from '../core/model';
import type { Aggregates } from '../core/analysis/aggregate';
import type { Contingency, GasPlan, MeasuredRmv, SimilarDives } from '../core/analysis/gasPlan';
import type { Plan } from '../core/analysis/coaching';
import {
  label as gasLabel,
  type DecoContingency,
  type DecoResult,
  type DecoSettings,
  type PlanGas,
  type PlanLevel,
} from '../core/analysis/deco';
import { formatDuration } from '../core/units';

/** Quanti punti del profilo entrano nel contesto di una singola immersione. */
const PROFILE_POINTS = 48;

const n1 = (v: number | undefined) => (v === undefined ? null : Math.round(v * 10) / 10);
const n2 = (v: number | undefined) => (v === undefined ? null : Math.round(v * 100) / 100);

/**
 * Sottocampiona un profilo mantenendo i punti che contano.
 *
 * Non è un campionamento uniforme: il minimo e il massimo di ogni intervallo
 * vengono tenuti entrambi, altrimenti una risalita rapida di 20 secondi sparisce
 * — ed è proprio il genere di dettaglio su cui si giudica un'immersione.
 */
export function reduceProfile(samples: Sample[], points = PROFILE_POINTS): Sample[] {
  if (samples.length <= points) return samples;
  const bucket = Math.ceil(samples.length / points);
  const out: Sample[] = [];
  for (let i = 0; i < samples.length; i += bucket) {
    const slice = samples.slice(i, i + bucket);
    const deepest = slice.reduce((a, b) => (b.depth > a.depth ? b : a));
    const shallowest = slice.reduce((a, b) => (b.depth < a.depth ? b : a));
    const first = slice[0];
    // In ordine di tempo, senza duplicati.
    for (const s of [first, shallowest, deepest].sort((a, b) => a.t - b.t)) {
      if (out[out.length - 1]?.t !== s.t) out.push(s);
    }
  }
  return out;
}

/** Contesto di una singola immersione. */
export function diveContext(dive: Dive): string {
  const m = dive.metrics;
  const samples = dive.samples ?? [];
  const reduced = reduceProfile(samples);

  const context = {
    immersione: {
      numero: dive.number ?? null,
      quando: dive.startTime,
      fusoDelSito: dive.utcOffsetMinutes ?? null,
      sito: dive.site?.name ?? null,
      zona: dive.site?.region ?? null,
      coordinate: dive.site?.lat != null ? [dive.site.lat, dive.site.lon] : null,
      profonditaMassimaM: n1(dive.maxDepth),
      profonditaMediaM: n1(dive.avgDepth),
      durata: formatDuration(dive.durationS),
      durataS: dive.durationS,
      acqua: dive.salinity ?? null,
      modalita: dive.mode,
      temperaturaMinimaC: n1(dive.minTempC),
      temperaturaAriaC: n1(dive.airTempC),
      zavorraKg: dive.weightKg ?? null,
      muta: dive.suit ?? null,
      compagno: dive.buddy ?? null,
      visibilitaM: dive.visibilityM ?? null,
      valutazione: dive.rating ?? null,
      note: dive.notes ?? null,
      condizioni: dive.tags?.length ? dive.tags : null,
      annotazioniDelLogbook: dive.annotations ?? null,
      intervalloDiSuperficieS: dive.surfaceIntervalS ?? null,
    },
    bombole: dive.cylinders.map((c) => ({
      miscela: `O2 ${Math.round(c.mix.o2 * 100)}% He ${Math.round(c.mix.he * 100)}%`,
      litri: c.sizeL ?? null,
      materiale: c.material ?? null,
      barIniziali: c.startBar ?? null,
      barFinali: c.endBar ?? null,
    })),
    computer: [dive.computer, ...(dive.otherComputers ?? [])].filter(Boolean).map((c) => ({
      modello: c!.model ?? null,
      firmware: c!.firmware ?? null,
      modelloDecompressivo: c!.decoModel ?? null,
      gfImpostati: c!.gfLow != null ? `${c!.gfLow}/${c!.gfHigh}` : null,
      conservatorismo: c!.conservatism ?? null,
      densitaImpostataKgM3: c!.waterDensityKgM3 ?? null,
      limitePpo2Bar: c!.ppo2MaxBar ?? null,
      passoCampionamentoS: c!.sampleIntervalS ?? null,
      integrazioneAria: c!.aiMode ?? null,
    })),
    lettoDalComputer: dive.reported
      ? {
          gf99AllUscitaPct: dive.reported.gf99End ?? null,
          obbligoDecompressivoS: dive.reported.maxDecoObligationS ?? null,
          ndlMinimoS: dive.reported.minNdlS ?? null,
          consumoDichiarato: dive.reported.avgSac ?? null,
        }
      : 'nessun dato di sintesi dal computer',
    calcolatoDallApp: m
      ? {
          gf99AllUscitaPct: m.gf99Pct ?? null,
          gf99MassimoPct: m.gf99MaxPct ?? null,
          compartimentoCheComanda: m.leadingCompartment ?? null,
          intervalloDiSuperficieMin: m.surfaceIntervalMin ?? null,
          azotoResiduoIngressoBar: m.residualN2Bar ?? null,
          gf99SenzaResiduoPct: m.gf99CleanPct ?? null,
          consumoDiSuperficieLMin: n1(m.rmvLpm),
          consumoBarMin: n2(m.sacBarPerMin),
          pressioneFinaleBar: m.endPressureBar ?? null,
          oscillazioneAQuotaTenutaMMin: n1(m.bottomVerticalTravelMpm),
          tempoAQuotaTenuta: m.holdingS ? formatDuration(m.holdingS) : null,
          velocitaRisalitaMassimaMMin: n1(m.maxAscentRateMpm),
          secondiSopraILimiteDiRisalita: m.fastAscentS ?? null,
          secondiSopraILimiteNeiPrimi10m: m.fastShallowAscentS ?? null,
          sostaDiSicurezzaS: m.safetyStopS ?? null,
          tempoInDecoS: m.decoS ?? null,
          secondiSopraIlTetto: m.ceilingViolationS ?? null,
          ppo2DiPicco: n2(m.maxPpo2),
          minutiSopraPpo2_1_4: n1(m.minutesAbovePpo214),
          minutiSopraPpo2_1_6: n1(m.minutesAbovePpo216),
          // Due CNS con due modelli diversi, e il modello va detto: se arrivassero
          // come un numero solo, chi legge concluderebbe che uno dei due sbaglia.
          cnsFinalePctLettoDalComputer: n1(m.cnsEndPct),
          cnsPctCalcolatoDallAppTabelleNoaa: n1(m.cnsPct),
          otuCalcolateDallApp: n1(m.otu),
          velocitaUltimoTrattoMMin: n1(m.finalAscentRateMpm),
          ultimoTrattoDaM: n1(m.finalAscentFromM),
          sostaProfondaS: m.deepStopS || null,
          sostaProfondaAM: n1(m.deepStopDepthM),
          ridisceseMetriPerOra: n1(m.sawtoothMPerHour),
          parteProfondaPerPrima: m.deepestPartFirst ?? null,
          cambiDiGasSottoLaMod: m.badGasSwitches || null,
          ppo2Minima: n2(m.minPpo2),
          endM: n1(m.endM),
          fasi: m.phases
            ? {
                discesa: formatDuration(m.phases.descentS),
                fondo: formatDuration(m.phases.bottomS),
                risalita: formatDuration(m.phases.ascentS),
              }
            : null,
          affidabilita: {
            campioni: m.quality.sampleCount,
            passoS: n1(m.quality.sampleIntervalS),
            avvertenze: m.quality.caveats.length ? m.quality.caveats : 'nessuna',
          },
        }
      : 'nessuna metrica: immersione senza profilo campionato',
    segnalibriPremutiSulComputer: dive.events?.length
      ? dive.events.map((e) => ({ quando: formatDuration(e.t), bussola: e.bearing ?? null }))
      : null,
    profilo: {
      nota: `${reduced.length} punti sottocampionati dai ${samples.length} originali, tenendo i minimi e i massimi di ogni intervallo`,
      colonne: 'tempo(s), profondità(m), temperatura(°C), tetto(m), ndl(min), tts(min), cns(%), bombola(bar)',
      punti: reduced.map((s) => [
        s.t,
        n1(s.depth),
        n1(s.tempC),
        s.ceiling != null ? n1(s.ceiling) : null,
        s.ndlS != null ? Math.round(s.ndlS / 60) : null,
        s.ttsS != null ? Math.round(s.ttsS / 60) : null,
        s.cns ?? null,
        (() => {
          const p = s.pressureBar?.find((x) => x !== undefined);
          return p === undefined ? null : Math.round(p);
        })(),
      ]),
    },
    fonti: [dive.source, ...(dive.extraSources ?? [])].map((s) => s.format),
  };

  return JSON.stringify(context, null, 1);
}

/** Contesto dell'intero archivio: aggregate calcolate più una riga per immersione. */
export function archiveContext(
  dives: Dive[],
  aggregates: Aggregates,
  windowLabel = 'tutto l’archivio',
): string {
  const a = aggregates;
  const rows = [...dives]
    .sort((x, y) => Date.parse(x.startTime) - Date.parse(y.startTime))
    .map((d) => [
      d.startTime.slice(0, 10),
      d.site?.name ?? '',
      n1(d.maxDepth),
      Math.round(d.durationS / 60),
      n1(d.avgDepth),
      n1(d.metrics?.rmvLpm),
      n1(d.metrics?.bottomVerticalTravelMpm),
      n1(d.metrics?.maxAscentRateMpm),
      d.metrics?.safetyStopS ?? null,
      d.metrics?.endPressureBar ?? null,
      d.metrics?.gf99Pct ?? null,
      d.computer?.gfLow != null ? `${d.computer.gfLow}/${d.computer.gfHigh}` : '',
      n1(d.minTempC),
      d.cylinders[0]?.mix
        ? `${Math.round(d.cylinders[0].mix.o2 * 100)}/${Math.round(d.cylinders[0].mix.he * 100)}`
        : '',
    ]);

  const context = {
    archivio: {
      finestraTemporale: windowLabel,
      nota: 'i dati qui sotto riguardano SOLO le immersioni in questa finestra',
      immersioni: a.count,
      conProfiloCampionato: a.withProfile,
      oreTotali: n1(a.totalS / 3600),
      primaImmersione: a.firstDive?.slice(0, 10) ?? null,
      ultimaImmersione: a.lastDive?.slice(0, 10) ?? null,
      giorniDallUltima: a.daysSinceLastDive ?? null,
      profonditaMassimaM: n1(a.maxDepthEver),
      profonditaMassimaMediaM: n1(a.avgMaxDepth),
      durataMediaMin: Math.round(a.avgDurationS / 60),
      immersioniUltimi90Giorni: a.divesLast90d,
      immersioniUltimi12Mesi: a.divesLast12m,
      mediaMensileUltimi12Mesi: n1(a.perMonthLast12m),
      oltre30m: a.deepDives30,
      oltre40m: a.deepDives40,
      conObbligoDeco: a.decoDives,
      inAcquaFredda: a.coldDives,
    },
    medieETendenze: {
      consumoMedioLMin: n1(a.avgRmv),
      immersioniSuCuiSiBasaIlConsumo: a.rmv.length,
      tendenzaConsumo: trend(a.rmvTrend),
      assettoMedioMMin: n1(a.avgTrim),
      immersioniSuCuiSiBasaLAssetto: a.trim.length,
      tendenzaAssetto: trend(a.trimTrend),
      tendenzaVelocitaRisalita: trend(a.ascentTrend),
      gf99Medio: n1(a.avgGf99),
      gf99Massimo: n1(a.maxGf99),
      frazioneImmersioniConRisaliteFuoriLimite: n2(a.fastAscentRate),
      frazioneSostaDiSicurezzaCompletata: n2(a.safetyStopRate),
      immersioniValutabiliPerLaSosta: a.safetyStopEligible,
      frazioneUsciteSotto50Bar: n2(a.lowReserveRate),
      immersioniConPressioneNota: a.lowReserveEligible,
      superamentiDelTetto: a.ceilingViolations,
      immersioniConIlTettoRegistrato: a.ceilingEligible,
      velocitaMedianaUltimoTrattoMMin: n1(
        a.finalAscent.length
          ? [...a.finalAscent.map((p) => p.value)].sort((x, y) => x - y)[Math.floor(a.finalAscent.length / 2)]
          : undefined,
      ),
      immersioniConUltimoTrattoSopra60MMin: a.fastFinalAscents,
      conSostaProfonda: [a.deepStopDives, a.deepStopEligible],
      conParteProfondaPerPrima: [a.deepestFirstDives, a.deepestFirstEligible],
      cambiDiGasSottoLaMod: a.badGasSwitches,
    },
    esposizioneAllOssigeno: {
      nota: "CNS e OTU calcolati dall'app sul profilo con le tabelle NOAA dei manuali TDI; il CNS usa i limiti per singola esposizione e si dimezza ogni 90 minuti in superficie, le OTU non recuperano mai.",
      immersioniConIlDato: a.oxygen.eligible,
      giornatePeggiori: {
        cnsPct: a.oxygen.worstCnsDay
          ? [a.oxygen.worstCnsDay.date, a.oxygen.worstCnsDay.peakCnsPercent, a.oxygen.worstCnsDay.dives]
          : null,
        otu: a.oxygen.worstOtuDay ? [a.oxygen.worstOtuDay.date, a.oxygen.worstOtuDay.otu] : null,
      },
      giornateSopra300Otu: a.oxygen.daysOverOtu300,
      giornateDiImmersione: a.oxygen.days.length,
    },
    distribuzioni: {
      perAnno: a.byYear.map((b) => [b.label, b.value]),
      perFasciaDiProfondita: a.byDepthBand.map((b) => [b.label, b.value]),
      perMiscela: a.byMix.map((b) => [b.label, b.value]),
      sitiPrincipali: a.topSites.map((s) => [s.name, s.dives, n1(s.maxDepth)]),
    },
    limitiDiRiferimentoUsatiDallApp: {
      risalitaSottoI10mMMin: LIMITS.ascentRateDeepMpm,
      risalitaSopraI10mMMin: LIMITS.ascentRateShallowMpm,
      assettoBuonoMMin: LIMITS.goodTrimMpm,
      riservaMinimaBar: LIMITS.minReserveBar,
      sostaDiSicurezzaMinimaS: LIMITS.safetyStopMinS,
      doseOtuGiornalieraTdi: 300,
      limiteCnsPct: 100,
      velocitaMediaUltimoTrattoMisurataDaDan: 60,
    },
    immersioni: {
      colonne:
        "data, sito, profMax(m), durata(min), profMedia(m), consumo(L/min), assetto(m/min), risalitaMax(m/min), sostaSicurezza(s), barFinali, gf99(calcolato dall'app), gfImpostati, tempMin(°C), miscela(O2/He)",
      nota: 'un campo nullo significa dato assente, non zero',
      righe: rows,
    },
  };
  return JSON.stringify(context, null, 1);
}

/** Contesto del piano: i risultati delle regole dell'app, non un riassunto. */
export function planContext(plan: Plan, aggregates: Aggregates, windowLabel = 'tutto l’archivio'): string {
  const context = {
    finestraTemporale: windowLabel,
    obiettivoScelto: { id: plan.goal.id, nome: plan.goal.label, descrizione: plan.goal.description },
    prontezza: {
      punteggio: plan.readiness.score,
      giudizio: plan.readiness.verdict,
      criteriSoddisfatti: plan.readiness.items
        .filter((c) => c.met)
        .map((c) => `${c.label}: ${c.have === undefined ? 'non misurato' : `${c.have} ${c.unit}`}`),
      criteriMancanti: plan.readiness.items
        .filter((c) => !c.met)
        .map(
          (c) =>
            `${c.label}: ${c.have === undefined ? 'non misurato' : c.have} di ${c.need} ${c.unit}${
              c.note ? ` (${c.note})` : ''
            }`,
        ),
    },
    risultatiDelleRegole: plan.findings.map((f) => ({
      area: f.area,
      gravita: f.severity,
      titolo: f.headline,
      dettaglio: f.detail,
      prove: f.evidence,
      obiettivo: f.target ?? null,
      esercizi: f.drills,
      priorita: f.priority,
      immersioniSuCuiSiBasa: f.basis,
    })),
    contestoNumerico: {
      immersioni: aggregates.count,
      consumoMedioLMin: n1(aggregates.avgRmv),
      immersioniSuCuiSiBasaIlConsumo: aggregates.rmv.length,
      assettoMedioMMin: n1(aggregates.avgTrim),
      frazioneRisaliteFuoriLimite: n2(aggregates.fastAscentRate),
      frazioneSostaCompletata: n2(aggregates.safetyStopRate),
      frazioneUsciteSotto50Bar: n2(aggregates.lowReserveRate),
      gf99Medio: n1(aggregates.avgGf99),
      immersioniUltimi90Giorni: aggregates.divesLast90d,
    },
  };
  return JSON.stringify(context, null, 1);
}

function trend(
  t:
    { slopePerYear: number; firstHalf: number; secondHalf: number; n: number; direction: string } | undefined,
) {
  if (!t) return null;
  return {
    direzione: t.direction,
    variazionePerAnno: n2(t.slopePerYear),
    primaMeta: n1(t.firstHalf),
    secondaMeta: n1(t.secondHalf),
    puntiConfrontati: t.n,
  };
}

/**
 * Contesto del pianificatore di gas.
 *
 * Il piano è tutto calcolato dall'app: qui non c'è niente letto da un computer, e
 * il modello deve saperlo. La cosa che rende utile questa analisi è il confronto
 * fra il piano e le immersioni vere a profondità simile — un piano che promette
 * un'uscita più generosa di quelle è ottimista, e nessuna formula lo dice.
 */
export function gasPlanContext(
  plan: GasPlan,
  contingency: Contingency[],
  similar: SimilarDives,
  rmv: MeasuredRmv,
  windowLabel: string,
): string {
  const i = plan.input;
  return JSON.stringify(
    {
      nota: 'Tutti i numeri qui sono CALCOLATI da questa app dal piano dichiarato, nessuno è letto da un computer subacqueo. Il consumo viene dalle immersioni vere in archivio.',
      periodoDelConsumoMisurato: windowLabel,
      consumoMisurato: {
        immersioniConIlDato: rmv.n,
        medianaLMin: rmv.median ?? null,
        percentile75LMin: rmv.p75 ?? null,
        peggioreLMin: rmv.max ?? null,
        usatoNelPiano: plan.planningRmvLpm,
        èQuelloDelCompagno: plan.buddyDrivesPlan,
      },
      piano: {
        profonditaMassimaM: i.depthM,
        profonditaMediaDelFondoM: i.avgDepthM,
        minutiAllaMassima: i.maxTimeMin,
        profonditaDelRestoDelFondoM: plan.restDepthM ?? null,
        tempoDiFondoMin: i.bottomMin,
        durataTotaleMin: plan.totalRuntimeMin,
        distribuzioneDelTempo: plan.split,
        velocitaDiRisalitaRisultanteMMin: plan.plannedAscentRateMpm ?? null,
        mediaDellInteraImmersioneM: plan.wholeDiveAvgDepthM,
        bombolaL: i.tankL,
        partenzaBar: i.startBar,
        miscela: { o2: i.mix.o2, he: i.mix.he },
        acqua: i.salinity,
      },
      risultato: {
        gasPianificatoL: plan.plannedL,
        uscitaPrevistaBar: plan.expectedEndBar,
        riservaBar: plan.reserveBar,
        regolaDellaRiserva: i.reserveRule,
        pressioneDiRientroBar: plan.turnBar ?? null,
        regolaDiRientro: i.turnRule,
        tempoDiFondoConsentitoDalGasMin: plan.gasLimitedBottomMin,
        nonCiSta: plan.overBudget,
      },
      ossigenoENarcosi: {
        ppo2AllaMassima: plan.ppo2AtDepth,
        modA1_4M: plan.modWorkM,
        modA1_6M: plan.modDecoM,
        miscelaMiglioreO2: plan.bestMixO2,
        ppn2AllaMassimaAta: plan.ppn2AtDepth,
        endM: plan.endM,
        cnsPct: plan.oxygen.cnsPercent,
        otu: plan.oxygen.otu,
        minutiSopra1_4: plan.oxygen.minutesAbove14,
      },
      gasDiDecompressione: plan.deco
        ? {
            miscela: plan.deco.mix,
            profonditaDiPassaggioM: plan.deco.switchDepthM,
            minutiDiSosta: plan.deco.minutes,
            litriEffettivi: plan.deco.litres,
            litriDaPortareColMargine1_5: plan.deco.requiredL,
            barRichiesti: plan.deco.requiredBar,
            nonBasta: plan.deco.short,
          }
        : 'nessuna bombola di decompressione separata: le soste si pagano col gas di fondo',
      avvertenzeGiaProdotteDallApp: plan.warnings.map((w) => `${w.level}: ${w.text}`),
      schedulediContingenza: contingency.map((c) => ({
        scenario: c.label,
        cosaCambia: c.change,
        uscitaPrevistaBar: c.plan.expectedEndBar,
        differenzaBar: c.endBarDelta,
        ciSta: c.fits,
      })),
      immersioniVereAProfonditaSimile: similar.n
        ? {
            quante: similar.n,
            uscitaTipicaBar: similar.medianEndBar ?? null,
            uscitaPiuBassaBar: similar.minEndBar ?? null,
            durataTipicaMin: similar.medianBottomMin ?? null,
            quanteSottoLaRiservaMinima: similar.belowReserve,
          }
        : 'nessuna immersione confrontabile nel periodo',
    },
    null,
    1,
  );
}

/**
 * Il piano di decompressione, per farlo leggere a qualcun altro.
 *
 * PERCHÉ VALE LA PENA. Un piano tecnico è la cosa che si controlla in due: si
 * scrive, si passa al compagno, e quello guarda se torna. Da soli, davanti allo
 * schermo che ha appena prodotto la tabella, si vede quello che ci si aspetta di
 * vedere. Questo contesto contiene il piano intero — livelli, miscele con le
 * profondità di cambio, soste con il runtime, gas per bombola, ossigeno,
 * contingenze — così la domanda «cosa non torna qui dentro» si può fare davvero.
 *
 * Nessun numero è misurato: è tutto calcolato dal piano dichiarato. Il contesto lo
 * dice in testa, perché è la distinzione che regge tutte le altre analisi e non
 * deve saltare proprio qui.
 */
export function decoPlanContext(
  result: DecoResult,
  levels: PlanLevel[],
  gases: PlanGas[],
  settings: DecoSettings,
  contingencies: DecoContingency[],
  modelLabel: string,
): string {
  return JSON.stringify(
    {
      nota:
        'Tutti i numeri qui sono CALCOLATI da questa app dal piano dichiarato: nessuno è stato misurato in acqua. ' +
        'Il modello decompressivo è indicato sotto; il motore Bühlmann è validato contro Shearwater su 38 immersioni reali: scarto medio ASSOLUTO 0.8 punti di GF99, massimo 2.6. ' +
        'Lo 0.1 che si legge altrove è la media con segno, cioè una cancellazione fra scarti opposti, e non dice quanto i due numeri distano su una singola immersione.',
      modello: modelLabel,
      impostazioni: {
        gradientFactor: `${Math.round(settings.gfLow * 100)}/${Math.round(settings.gfHigh * 100)}`,
        velocitaRisalitaMMin: settings.ascentRateMpm,
        velocitaDiscesaMMin: settings.descentRateMpm,
        ultimaSostaM: settings.lastStopM,
        passoFraSosteM: settings.stopIntervalM,
        acqua: settings.salinity === 'salt' ? 'salata' : 'dolce',
        pressioneSuperficieBar: n2(settings.surfacePressureBar),
        consumoFondoLMin: settings.rmvLpm,
        consumoDecoLMin: settings.decoRmvLpm,
        sostaDiSicurezza: settings.safetyStop
          ? `${settings.safetyStop.minutes} min a ${settings.safetyStop.depthM} m`
          : 'non prevista',
        circuitoChiuso: result.ccr
          ? `setpoint dai livelli, MOR ${settings.morLpm}/${settings.decoMorLpm} L/min`
          : 'no',
      },
      livelli: levels.map((l) => ({
        profonditaM: l.depthM,
        minuti: l.minutes,
        setpointBar: l.setpointBar ?? null,
        nota: 'il tempo del primo livello comprende la discesa',
      })),
      miscele: gases.map((g, i) => ({
        indice: i,
        nome: gasLabel(g),
        o2: g.mix.o2,
        he: g.mix.he,
        ruolo: g.role,
        profonditaDiCambioM: g.switchDepthM ?? null,
        bombolaL: g.tankL ?? null,
        barDiPartenza: g.startBar ?? null,
      })),
      risultato: {
        runtimeMin: n1(result.runtimeMin),
        risalitaMin: n1(result.ascentMin),
        decompressioneMin: result.decoMin,
        sostaDiSicurezzaMin: result.safetyStopMin,
        restaInCurva: result.noDeco,
        limiteInCurvaAlPrimoLivelloMin: n1(result.ndlMin),
        primaSostaM: result.firstStopM ?? null,
        iniziaDesaturazioneAM: result.offgassingFromM ?? null,
        gf99PrevistoAllUscita: n1(result.gf99EndPct),
        oreDiAttesaPrimaDelVolo: result.timeToFlyH ?? null,
      },
      soste: result.stops.map((s) => ({
        profonditaM: s.depthM,
        minuti: s.minutes,
        runtimeMin: s.runtimeMin,
        gas: gasLabel(gases[s.gasIndex]),
        obbligatoria: s.mandatory,
      })),
      gas: result.gasUsage
        .filter((u) => u.litres > 0)
        .map((u) => ({
          nome: gasLabel(gases[u.gasIndex]),
          litri: u.litres,
          bar: u.bar ?? null,
          barABordo: u.startBar ?? null,
          nonBasta: u.insufficient,
        })),
      circuitoChiuso: result.ccr
        ? {
            ossigenoMetabolicoL: result.ccr.o2Litres,
            diluenteL: result.ccr.diluentLitres,
            ossigenoBar: result.ccr.o2Bar ?? null,
            nonBasta: result.ccr.insufficientO2,
          }
        : null,
      ossigeno: {
        cnsPct: n1(result.oxygen.cnsPercent),
        otu: n1(result.oxygen.otu),
        minutiSopra14: n1(result.oxygen.minutesAbove14),
        minutiSopra16: n1(result.oxygen.minutesAbove16),
      },
      controdiffusioneIsobarica: result.icd.map((w) => ({
        profonditaM: w.atDepthM,
        da: w.fromLabel,
        a: w.toLabel,
        aumentoAzotoBar: w.n2RiseBar,
        caloElioBar: w.heDropBar,
      })),
      avvisi: result.warnings.map((w) => ({ gravita: w.level, testo: w.text })),
      contingenze: contingencies.map((c) => ({
        scenario: c.label,
        descrizione: c.description,
        runtimeMin: n1(c.result.runtimeMin),
        runtimeInPiuMin: c.extraRuntimeMin,
        decompressioneInPiuMin: c.extraDecoMin,
        ilGasNonBasta: c.breaks,
      })),
    },
    null,
    1,
  );
}
