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
import { medianOf, type Aggregates } from '../core/analysis/aggregate';
import type { Contingency, GasPlan, MeasuredRmv, SimilarDives } from '../core/analysis/gasPlan';
import type { Plan } from '../core/analysis/coaching';
import {
  label as gasLabel,
  switchDepthOf,
  type DecoContingency,
  type DecoResult,
  type DecoSettings,
  type PlanGas,
  type PlanLevel,
} from '../core/analysis/deco';
import { formatDuration } from '../core/units';

/** Quanti punti del profilo entrano nel contesto di una singola immersione. */
const PROFILE_POINTS = 48;

/**
 * JSON leggibile senza sprecare una riga per numero.
 *
 * `JSON.stringify(x, null, 1)` mette OGNI elemento di ogni array su una riga
 * sua. Su un oggetto di configurazione va benissimo; su un profilo di 104
 * campioni da otto colonne diventano quasi novecento righe, ognuna con un solo
 * numero e una virgola. Misurato sul contesto di una immersione
 * dell'archivio dimostrativo: 3400 token, di cui oltre due terzi erano
 * parentesi quadre e a capo.
 *
 * Non è solo il costo. Una tabella scritta un numero per riga NON SI LEGGE come
 * una tabella: la riga «tempo, profondità, temperatura…» dichiarata in
 * `colonne` è la chiave per interpretare i punti, e se le colonne sono
 * verticali quella chiave non aggancia più niente. Il contesto è più caro e
 * dice meno.
 *
 * Qui le righe di soli valori scalari stanno su una riga sola, il resto resta
 * indentato. Non è cosmesi: è la differenza fra mandare una tabella e mandare
 * un elenco di cifre.
 */
export function compactJson(value: unknown, livello = 0): string {
  const pad = ' '.repeat(livello);
  const padInterno = ' '.repeat(livello + 1);

  if (value === null || value === undefined) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);

  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    // Una riga di valori: è una riga di tabella, e va scritta come tale.
    const tuttiScalari = value.every((v) => v === null || typeof v !== 'object');
    if (tuttiScalari) return `[${value.map((v) => JSON.stringify(v ?? null)).join(', ')}]`;
    const dentro = value.map((v) => padInterno + compactJson(v, livello + 1));
    return `[\n${dentro.join(',\n')}\n${pad}]`;
  }

  const voci = Object.entries(value as Record<string, unknown>);
  if (voci.length === 0) return '{}';
  const dentro = voci.map(([k, v]) => `${padInterno}${JSON.stringify(k)}: ${compactJson(v, livello + 1)}`);
  return `{\n${dentro.join(',\n')}\n${pad}}`;
}

/*
 * I CODICI INTERNI TRADOTTI, perché il contesto è in italiano.
 *
 * `"acqua": "salt"` e `"modalita": "oc"` arrivavano nudi in mezzo a chiavi e
 * valori italiani. Su `oc` e `salt` la traduzione è facile anche per un
 * modello; su `gauge` e `scr` no, ed è proprio lì che conta — un'immersione in
 * modalità profondimetro NON HA né NDL né tetto, e se il modello non lo capisce
 * commenta l'assenza di dati che non possono esistere.
 *
 * Che non fosse una convenzione ma una dimenticanza lo dimostra
 * `decoPlanContext`, che la stessa salinità la traduce già.
 */
const ACQUA: Record<string, string> = { salt: 'salata (mare)', fresh: 'dolce (lago)' };
const MODALITA: Record<string, string> = {
  oc: 'circuito aperto',
  ccr: 'rebreather a circuito chiuso',
  scr: 'rebreather semichiuso',
  gauge: 'profondimetro (nessun calcolo decompressivo a bordo)',
  freedive: 'apnea',
};
const DIREZIONE: Record<string, string> = {
  improving: 'in miglioramento',
  worsening: 'in peggioramento',
  flat: 'stabile',
};
const REGOLA_RISERVA: Record<string, string> = {
  rockBottom: 'riserva calcolata (rock bottom)',
  fixed: 'riserva fissa in bar',
};
const REGOLA_RIENTRO: Record<string, string> = {
  thirds: 'regola dei terzi',
  half: 'metà del gas',
  none: 'nessuna regola di rientro',
};
const tradotto = (tabella: Record<string, string>, v: string | undefined) =>
  v === undefined ? null : (tabella[v] ?? v);

const n1 = (v: number | undefined) => (v === undefined ? null : Math.round(v * 10) / 10);

/**
 * I gradient factor come li aveva impostati QUEL computer, o niente.
 *
 * Due difetti in una riga sola, tutti e due già corretti nell'interfaccia e
 * rimasti qui — il che è istruttivo: il contesto delle analisi è l'unico posto
 * che nessuno guarda.
 *
 * Il primo: `${low}/${high}` con l'alto assente produce la stringa letterale
 * `"40/undefined"`. Parecchi computer scrivono solo il GF basso, e il sistema
 * dice esplicitamente al modello di stare attento ai cambi di GF nel tempo: una
 * stringa così viene letta come un valore, e «undefined» in un contesto
 * altrimenti fatto di numeri è il genere di cosa che un modello prova a
 * interpretare.
 *
 * Il secondo: quando i GF non ci sono, questa colonna metteva `''`. Il contesto
 * dichiara due righe più sotto che «un campo nullo significa dato assente»: una
 * stringa vuota non è un campo nullo, e la convenzione che si è appena promessa
 * viene rotta proprio sul campo di cui si è chiesto di diffidare.
 */
const gfString = (c: { gfLow?: number; gfHigh?: number } | undefined): string | null =>
  c?.gfLow != null && c?.gfHigh != null ? `${c.gfLow}/${c.gfHigh}` : null;
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

/**
 * Il profilo come tabella, senza le colonne che nessuno ha scritto.
 *
 * Le colonne possibili sono otto, ma quali esistano dipende dal computer: solo
 * gli Shearwater scrivono tetto, NDL, TTS e CNS a ogni campione, e la pressione
 * bombola c'è solo con un trasmettitore. Su un'immersione dell'Aladin quelle
 * cinque colonne sono `null` per TUTTI i campioni — cento righe di
 * `null, null, null, null, null` che costano token e non dicono niente.
 *
 * Peggio: dichiarare in `colonne` un dato che poi è sempre vuoto è un invito a
 * commentarne l'assenza. L'informazione «questo computer non registra la
 * decompressione» va detta UNA volta, in una frase, non centoquattro volte in
 * forma di buchi.
 *
 * Quindi si costruisce la tabella, si guarda quali colonne hanno almeno un
 * valore, e si tengono solo quelle — con l'elenco di ciò che è stato tolto,
 * perché «assente» resta un'informazione e sparire in silenzio no.
 */
const COLONNE_PROFILO: { nome: string; leggi: (s: Sample) => number | null }[] = [
  { nome: 'tempo(s)', leggi: (s) => s.t },
  { nome: 'profondità(m)', leggi: (s) => n1(s.depth) },
  { nome: 'temperatura(°C)', leggi: (s) => n1(s.tempC) },
  { nome: 'tetto(m)', leggi: (s) => (s.ceiling != null ? n1(s.ceiling) : null) },
  { nome: 'ndl(min)', leggi: (s) => (s.ndlS != null ? Math.round(s.ndlS / 60) : null) },
  { nome: 'tts(min)', leggi: (s) => (s.ttsS != null ? Math.round(s.ttsS / 60) : null) },
  { nome: 'cns(%)', leggi: (s) => s.cns ?? null },
  {
    nome: 'bombola(bar)',
    leggi: (s) => {
      const p = s.pressureBar?.find((x) => x !== undefined);
      return p === undefined ? null : Math.round(p);
    },
  },
];

function profileTable(reduced: Sample[], originali: number) {
  const valori = COLONNE_PROFILO.map((c) => reduced.map((s) => c.leggi(s)));
  // Le prime due non si tolgono mai: senza tempo e profondità non c'è profilo,
  // e una colonna di zeri è comunque un dato.
  const tenute = COLONNE_PROFILO.map((_, i) => i < 2 || valori[i].some((v) => v !== null));
  const scartate = COLONNE_PROFILO.filter((_, i) => !tenute[i]).map((c) => c.nome);

  return {
    nota:
      `${reduced.length} punti sottocampionati dai ${originali} originali, tenendo i minimi e i massimi di ogni intervallo` +
      (scartate.length
        ? `. Questo computer non registra ${scartate.join(', ')}: le colonne sono state omesse perché vuote su tutti i campioni, non perché i valori fossero zero`
        : ''),
    colonne: COLONNE_PROFILO.filter((_, i) => tenute[i])
      .map((c) => c.nome)
      .join(', '),
    punti: reduced.map((s) => COLONNE_PROFILO.filter((_, i) => tenute[i]).map((c) => c.leggi(s))),
  };
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
      acqua: tradotto(ACQUA, dive.salinity),
      modalita: tradotto(MODALITA, dive.mode),
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
      /*
       * In MINUTI, come l'altro, e con un nome che dice da dove viene.
       *
       * Prima c'erano `intervalloDiSuperficieS` (secondi, dal file del
       * computer) e `intervalloDiSuperficieMin` (minuti, dalla catena dei
       * tessuti): due nomi che differiscono per una lettera e differiscono per
       * un fattore sessanta. Su un'immersione reale il primo diceva 3600 e il
       * secondo `null`, cioè «tre ore» accanto a «non è una ripetitiva» —
       * entrambe le letture sbagliate, e nessun modo di accorgersene.
       *
       * Stessa unità, nomi che si distinguono, e la provenienza scritta nel
       * nome. Restano due campi perché sono due misure diverse: quella del
       * computer c'è anche senza profilo, la nostra tiene conto dell'archivio.
       */
      intervalloDiSuperficieDichiaratoDalComputerMin:
        dive.surfaceIntervalS === undefined ? null : Math.round(dive.surfaceIntervalS / 60),
    },
    bombole: dive.cylinders.map((c) => ({
      miscela: `O2 ${Math.round(c.mix.o2 * 100)}% He ${Math.round(c.mix.he * 100)}%`,
      litri: c.sizeL ?? null,
      materiale: c.material ?? null,
      barIniziali: c.startBar ?? null,
      barFinali: c.endBar ?? null,
    })),
    /*
     * `filter(Boolean)` non basta: un oggetto VUOTO è vero.
     *
     * Sull'archivio dimostrativo `otherComputers` contiene `[{}]`, e nel
     * contesto compariva un secondo computer con nove campi nulli — cioè un
     * secondo strumento con impostazioni ignote, che invita a commentare la
     * discordanza fra due computer che in realtà è uno solo. Si tiene una voce
     * solo se ha almeno un campo scritto.
     */
    computer: [dive.computer, ...(dive.otherComputers ?? [])]
      .filter((c) => c && Object.values(c).some((v) => v !== undefined && v !== null))
      .map((c) => ({
        modello: c!.model ?? null,
        firmware: c!.firmware ?? null,
        modelloDecompressivo: c!.decoModel ?? null,
        gfImpostati: gfString(c!),
        conservatorismo: c!.conservatism ?? null,
        densitaImpostataKgM3: c!.waterDensityKgM3 ?? null,
        limitePpo2Bar: c!.ppo2MaxBar ?? null,
        passoCampionamentoS: c!.sampleIntervalS ?? null,
        integrazioneAria: c!.aiMode ?? null,
      })),
    /*
     * QUELLO CHE HA SCRITTO IL COMPUTER, tutto quanto e in un posto solo.
     *
     * Il CNS finale stava dentro `calcolatoDallApp`, sotto il nome
     * `cnsFinalePctLettoDalComputer`. Il nome era corretto e la posizione no, e
     * la combinazione produceva la contraddizione peggiore possibile: sulle
     * immersioni senza `reported` il contesto diceva «nessun dato di sintesi dal
     * computer» e due righe sotto, dentro il blocco dell'app, compariva un
     * numero del computer. Le istruzioni ripetono tre volte che letto e
     * calcolato vanno distinti: qualunque frase attribuisse quel valore sarebbe
     * stata sbagliata in un senso o nell'altro.
     *
     * Ora il blocco esiste se c'è ALMENO una cosa letta, e la stringa «nessun
     * dato» compare solo quando è vero.
     */
    lettoDalComputer:
      dive.reported || m?.cnsEndPct !== undefined
        ? {
            gf99AllUscitaPct: dive.reported?.gf99End ?? null,
            obbligoDecompressivoS: dive.reported?.maxDecoObligationS ?? null,
            ndlMinimoS: dive.reported?.minNdlS ?? null,
            consumoDichiarato: dive.reported?.avgSac ?? null,
            cnsFinalePct: n1(m?.cnsEndPct),
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
          consumoBarMinDellaPrimaBombola: n2(m.sacBarPerMin),
          // Il nome dichiara la bombola: il consumo in L/min sopra somma tutte
          // le bombole, questa pressione è solo della prima. Due insiemi
          // diversi con nomi che si assomigliavano.
          pressioneFinaleDellaPrimaBombolaBar: m.endPressureBar ?? null,
          oscillazioneAQuotaTenutaMMin: n1(m.bottomVerticalTravelMpm),
          tempoAQuotaTenuta: m.holdingS ? formatDuration(m.holdingS) : null,
          velocitaRisalitaMassimaMMin: n1(m.maxAscentRateMpm),
          /*
           * Due fasce DISGIUNTE, e i nomi devono dirlo.
           *
           * Si chiamavano `secondiSopraILimiteDiRisalita` e
           * `secondiSopraILimiteNeiPrimi10m`: la lettura naturale è «tot in
           * totale, di cui tot in alto», e invece il primo conta solo sotto i
           * dieci metri. Sull'immersione dimostrativa i valori sono 0 e 20 —
           * cioè «nessuna violazione» seguito da venti secondi di violazione.
           * Il totale non è nessuno dei due: è la somma.
           */
          secondiSopraILimiteSottoI10m: m.fastAscentS ?? null,
          secondiSopraILimiteSopraI10m: m.fastShallowAscentS ?? null,
          secondiSopraILimiteInTutto:
            m.fastAscentS === undefined && m.fastShallowAscentS === undefined
              ? null
              : (m.fastAscentS ?? 0) + (m.fastShallowAscentS ?? 0),
          sostaDiSicurezzaS: m.safetyStopS ?? null,
          tempoInDecoS: m.decoS ?? null,
          secondiSopraIlTetto: m.ceilingViolationS ?? null,
          ppo2DiPicco: n2(m.maxPpo2),
          minutiSopraPpo2_1_4: n1(m.minutesAbovePpo214),
          minutiSopraPpo2_1_6: n1(m.minutesAbovePpo216),
          // Il CNS del computer sta in `lettoDalComputer`, non qui: sono due
          // modelli diversi e la differenza è il punto. Qui resta il nostro.
          cnsPctCalcolatoDallAppTabelleNoaa: n1(m.cnsPct),
          otuCalcolateDallApp: n1(m.otu),
          velocitaUltimoTrattoMMin: n1(m.finalAscentRateMpm),
          ultimoTrattoDaM: n1(m.finalAscentFromM),
          sostaProfondaS: m.deepStopS || null,
          sostaProfondaAM: n1(m.deepStopDepthM),
          ridisceseMetriPerOra: n1(m.sawtoothMPerHour),
          parteProfondaPerPrima: m.deepestPartFirst ?? null,
          // Il numero con segno, non solo il booleano sopra: esiste perché due
          // metri di differenza fra le due metà e venti davano lo stesso «sì».
          tendenzaProfonditaM: n1(m.depthTrendM),
          // Quanto la profondità oscilla al fondo, che è cosa diversa
          // dall'oscillazione a quota TENUTA qui sopra.
          scartoTipicoDellaProfonditaAlFondoM: n1(m.bottomDepthStdM),
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
            /*
             * Se i tessuti sono STIMATI va detto qui, non dedotto.
             *
             * Quando l'immersione precedente non ha un profilo, la catena
             * sintetizza un profilo quadro per non spezzarsi — è la scelta
             * giusta, un buco nella catena falsa il GF99 di tutte quelle dopo —
             * ma il carico d'ingresso di questa immersione è allora una stima,
             * non una misura. Il contesto lo taceva, e ogni numero della
             * saturazione qui sopra arrivava con la stessa apparente
             * affidabilità degli altri.
             */
            saturazioneDIngressoStimata: m.tissuesEstimated ?? false,
            campioni: m.quality.sampleCount,
            passoS: n1(m.quality.sampleIntervalS),
            avvertenze: m.quality.caveats.length ? m.quality.caveats : 'nessuna',
          },
        }
      : 'nessuna metrica: immersione senza profilo campionato',
    segnalibriPremutiSulComputer: dive.events?.length
      ? dive.events.map((e) => ({ quando: formatDuration(e.t), bussola: e.bearing ?? null }))
      : null,
    profilo: profileTable(reduced, samples.length),
    fonti: [dive.source, ...(dive.extraSources ?? [])].map((s) => s.format),
  };

  return compactJson(context);
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
      // `null` e non `''`: la nota sotto la tabella promette che un campo nullo
      // significa «assente», e una stringa vuota in mezzo a stringhe piene si
      // legge come un sito che si chiama così.
      d.site?.name ?? null,
      n1(d.maxDepth),
      Math.round(d.durationS / 60),
      n1(d.avgDepth),
      n1(d.metrics?.rmvLpm),
      n1(d.metrics?.bottomVerticalTravelMpm),
      n1(d.metrics?.maxAscentRateMpm),
      d.metrics?.safetyStopS ?? null,
      d.metrics?.endPressureBar ?? null,
      d.metrics?.gf99Pct ?? null,
      gfString(d.computer),
      n1(d.minTempC),
      d.cylinders[0]?.mix
        ? `${Math.round(d.cylinders[0].mix.o2 * 100)}/${Math.round(d.cylinders[0].mix.he * 100)}`
        : null,
      /*
       * QUATTRO COLONNE CHE MANCAVANO, e senza le quali il prompt chiede
       * l'impossibile.
       *
       * `passoCampionamentoS`: il prompt dell'archivio chiede espressamente di
       * sospettare che una tendenza venga «da un cambio di impostazioni del
       * computer o di attrezzatura». Il caso vero, documentato in questo
       * progetto, è esattamente questo: un profilo campionato a 10 s legge
       * l'oscillazione d'assetto UN TERZO più bassa di uno a 4 s, e cambiando
       * computer la tendenza dell'assetto sembra migliorare senza che niente
       * sia cambiato. Chiedere di sospettarlo senza dare il passo è chiedere di
       * indovinare.
       *
       * `zavorraKg`: il prompt suggerisce la correlazione zavorra/assetto e la
       * zavorra non era in nessuna riga.
       *
       * `ridisceseMPerOra` e `tendenzaProfonditaM`: il prompt chiede le
       * immersioni «fuori scala», e questi sono i due indicatori su cui l'app
       * stessa le riconosce. Il secondo esiste come numero con segno proprio
       * perché un booleano appiattiva casi molto diversi.
       */
      d.metrics?.quality.sampleIntervalS ?? null,
      d.weightKg ?? null,
      n1(d.metrics?.sawtoothMPerHour),
      n1(d.metrics?.depthTrendM),
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
      // MEDIA, non mediana: due statistiche diverse convivevano nello stesso
      // contesto sotto nomi che si assomigliano — qui `gf99Medio` (media) e nel
      // piano la prova «GF99 mediano all'uscita». Il criterio di verifica che
      // il modello scrive va misurato sulla grandezza giusta, e per saperlo
      // deve leggerla nel nome.
      gf99MedioAritmeticoAllUscitaPct: n1(a.avgGf99),
      gf99MedianoAllUscitaPct: n1(medianOf(a.gf99.map((p) => p.value))),
      gf99Massimo: n1(a.maxGf99),
      frazioneImmersioniConRisaliteFuoriLimite: n2(a.fastAscentRate),
      frazioneSostaDiSicurezzaCompletata: n2(a.safetyStopRate),
      immersioniValutabiliPerLaSosta: a.safetyStopEligible,
      frazioneUsciteSotto50Bar: n2(a.lowReserveRate),
      immersioniConPressioneNota: a.lowReserveEligible,
      superamentiDelTetto: a.ceilingViolations,
      immersioniConIlTettoRegistrato: a.ceilingEligible,
      // `medianOf` e non l'elemento centrale: con un numero pari di valori non
      // sono la stessa cosa, ed è lo stesso difetto già corretto altrove.
      velocitaMedianaUltimoTrattoMMin: n1(medianOf(a.finalAscent.map((p) => p.value))),
      // Due contatori sullo stesso tratto, con due soglie diverse, e la
      // differenza va detta: la prima è una citazione da verificare (vedi
      // `danFinalAscentMpm`), la seconda è il limite con cui l'app giudica.
      immersioniConUltimoTrattoSopraILimiteDellApp: a.finalAscentsOverAppLimit,
      immersioniConUltimoTrattoSopra60MMin: a.fastFinalAscents,
      // Coppie «quante su quante»: senza dirlo, `[1, 48]` si legge come un
      // intervallo o come due grandezze diverse.
      conSostaProfonda: { quante: a.deepStopDives, suQuanteVerificabili: a.deepStopEligible },
      conParteProfondaPerPrima: {
        quante: a.deepestFirstDives,
        suQuanteVerificabili: a.deepestFirstEligible,
      },
      cambiDiGasSottoLaMod: a.badGasSwitches,
      /*
       * IL RISCONTRO CON I COMPUTER, misurato su QUESTO archivio.
       *
       * Le istruzioni di sistema affermano che i due GF99 «distano meno di un
       * punto», e il contesto del piano deco cita 0.8 punti di scarto medio. Sono
       * numeri veri ma misurati su un ALTRO archivio, quello di validazione: su
       * un archivio senza computer Shearwater le due misure non coesistono su
       * nessuna immersione, e l'affermazione resta appesa a niente. Qui il dato
       * è quello di chi legge, con il suo denominatore.
       */
      riscontroDeiDueGf99: {
        nota: 'differenza media fra il GF99 che scriviamo noi e quello scritto dal computer, sulle immersioni in cui esistono entrambi',
        immersioniConEntrambi: a.gf99AgreementCount,
        differenzaMediaPunti: n1(a.gf99Agreement),
      },
    },
    /*
     * Le ripetitive, che sono l'unica cosa che un logbook sa dire e un computer no.
     *
     * Le istruzioni dedicano un paragrafo intero ai campi delle ripetitive e
     * dicono al modello di usarli «quando ci sono». Nel contesto dell'archivio
     * non c'era niente che dicesse quante ce ne fossero: il modello poteva solo
     * dedurlo dalle date, una per una.
     */
    ripetitive: {
      quante: a.repetitiveDives,
      intervalloDiSuperficieMedianoMin: n1(a.surfaceIntervalMedian),
      prezzoMedianoInPuntiDiGf99: n1(a.repetitiveCostMedian),
      casoPeggiore: a.repetitiveCostWorst
        ? {
            giorno: a.repetitiveCostWorst.dive.startTime.slice(0, 10),
            puntiDiGf99InPiu: n1(a.repetitiveCostWorst.points),
            intervalloDiSuperficieMin: n1(a.repetitiveCostWorst.surfaceIntervalMin),
          }
        : null,
    },
    esposizioneAllOssigeno: {
      nota: "CNS e OTU calcolati dall'app sul profilo con le tabelle NOAA dei manuali TDI; il CNS usa i limiti per singola esposizione e si dimezza ogni 90 minuti in superficie, le OTU non recuperano mai.",
      immersioniConIlDato: a.oxygen.eligible,
      giornatePeggiori: {
        cnsPct: a.oxygen.worstCnsDay
          ? {
              giorno: a.oxygen.worstCnsDay.date,
              piccoPct: a.oxygen.worstCnsDay.peakCnsPercent,
              immersioni: a.oxygen.worstCnsDay.dives,
            }
          : null,
        otu: a.oxygen.worstOtuDay
          ? { giorno: a.oxygen.worstOtuDay.date, otu: a.oxygen.worstOtuDay.otu }
          : null,
      },
      giornateSopra300Otu: a.oxygen.daysOverOtu300,
      giornateDiImmersione: a.oxygen.days.length,
    },
    distribuzioni: {
      nota: 'ogni voce è [etichetta, immersioni]',
      // In ordine di ANNO, non di conteggio: qui sopra il prompt chiede
      // tendenze temporali, e un elenco ordinato per frequenza le nasconde.
      perAnno: [...a.byYear].sort((x, y) => x.label.localeCompare(y.label)).map((b) => [b.label, b.value]),
      perFasciaDiProfondita: a.byDepthBand.map((b) => [b.label, b.value]),
      perMiscela: a.byMix.map((b) => [b.label, b.value]),
      // Mancava, e un'immersione in modalità profondimetro o rebreather non ha
      // gli stessi dati delle altre: senza questa riga il modello non sa che
      // l'archivio ne contiene.
      perModalita: a.byMode.map((b) => [b.label, b.value]),
      sitiPrincipali: {
        colonne: 'sito, immersioni, profondità MASSIMA raggiunta lì (m)',
        // La legenda mancava, ed era l'unica tabella senza. Il terzo numero si
        // leggeva come una media — nello stesso oggetto in cui
        // `profonditaMassimaMediaM` insegna che il numero-profondità è una
        // media — con uno scarto del 50% sul sito abituale.
        righe: a.topSites.map((s) => [s.name, s.dives, n1(s.maxDepth)]),
      },
    },
    limitiDiRiferimentoUsatiDallApp: {
      nota: 'sono le soglie con cui l’app giudica; non sono raccomandazioni didattiche',
      risalitaSottoI10mMMin: LIMITS.ascentRateDeepMpm,
      risalitaSopraI10mMMin: LIMITS.ascentRateShallowMpm,
      assettoBuonoMMin: LIMITS.goodTrimMpm,
      riservaMinimaBar: LIMITS.minReserveBar,
      sostaDiSicurezzaMinimaS: LIMITS.safetyStopMinS,
      doseOtuGiornalieraTdi: 300,
      limiteCnsPct: 100,
    },
    /*
     * I 60 m/min di DAN non sono un limite, e stavano fra i limiti.
     *
     * Il commento nel modello lo dice chiaro: «non è un limite raccomandato, è
     * il comportamento reale misurato». Messo accanto a
     * `risalitaSopraI10mMMin: 6` diventava una soglia dieci volte più larga
     * nello stesso elenco — e il contatore che gli sta accanto vale zero mentre
     * la regola dell'app conta quattordici immersioni fuori limite. Un modello
     * che legge quei due numeri insieme conclude che negli ultimi metri l'app
     * tollera dieci volte tanto.
     */
    riferimentiOsservatiNonSoglie: {
      nota: 'valori misurati da altri su popolazioni di subacquei, utili per confronto: NON sono limiti dell’app',
      velocitaMediaUltimoTrattoAttribuitaADanMMin: LIMITS.danFinalAscentMpm,
      avvertenzaSuQuelNumero:
        'Citazione da verificare: 60 m/min sono 197 ft/min, implausibili come media misurata, e la fonte potrebbe dire 60 ft/min. Non usarlo per giudicare un tratto finale — per quello c’è il limite dell’app, 6 m/min sopra i 10 metri.',
    },
    immersioni: {
      colonne:
        "data, sito, profMax(m), durata(min), profMedia(m), consumo(L/min), assetto(m/min), risalitaMax(m/min), sostaSicurezza(s), barFinali(prima bombola), gf99(calcolato dall'app), gfImpostati, tempMin(°C), miscela(O2/He), passoCampionamento(s), zavorra(kg), ridiscese(m/h), tendenzaProfondità(m)",
      nota: 'un campo nullo significa dato assente, non zero',
      righe: rows,
    },
  };
  return compactJson(context);
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
      gf99MedioAritmeticoAllUscitaPct: n1(aggregates.avgGf99),
      gf99MedianoAllUscitaPct: n1(medianOf(aggregates.gf99.map((p) => p.value))),
      immersioniUltimi90Giorni: aggregates.divesLast90d,
    },
  };
  return compactJson(context);
}

function trend(
  t:
    { slopePerYear: number; firstHalf: number; secondHalf: number; n: number; direction: string } | undefined,
) {
  if (!t) return null;
  return {
    direzione: tradotto(DIREZIONE, t.direction),
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
  return compactJson({
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
      // Le chiavi di `split` sono in inglese: si rinominano qui, non si spedisce
      // un oggetto con `bottomMin`/`ascentMin` in mezzo a `tempoDiFondoMin`.
      distribuzioneDelTempoMin: {
        fondo: plan.split.bottomMin,
        risalita: plan.split.ascentMin,
        spostamenti: plan.split.travelMin,
        soste: plan.split.stopsMin,
      },
      velocitaDiRisalitaRisultanteMMin: plan.plannedAscentRateMpm ?? null,
      mediaDellInteraImmersioneM: plan.wholeDiveAvgDepthM,
      bombolaL: i.tankL,
      partenzaBar: i.startBar,
      miscela: { o2: i.mix.o2, he: i.mix.he },
      acqua: tradotto(ACQUA, i.salinity),
    },
    risultato: {
      gasPianificatoL: plan.plannedL,
      uscitaPrevistaBar: plan.expectedEndBar,
      riservaBar: plan.reserveBar,
      regolaDellaRiserva: tradotto(REGOLA_RISERVA, i.reserveRule),
      pressioneDiRientroBar: plan.turnBar ?? null,
      regolaDiRientro: tradotto(REGOLA_RIENTRO, i.turnRule),
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
    /*
     * Il confronto col passato, con i suoi due limiti dichiarati.
     *
     * Il prompt costruisce una sezione intera su questo blocco e chiede di
     * «quantificare lo scarto» fra l'uscita prevista e quelle vere. Ma sono
     * BAR, e i bar di una bombola da 15 litri non si confrontano con quelli di
     * una da 24: lo stesso numero è una quantità di gas diversa. E quando
     * l'insieme filtrato sulla durata si svuota, il codice allarga il criterio
     * alla sola profondità — cosa che il commento di `gasPlan.ts` dice di
     * dichiarare, e che al contesto non veniva dichiarata: si finiva a
     * confrontare un piano da 33 minuti con immersioni da 51.
     */
    immersioniVereAProfonditaSimile: similar.n
      ? {
          quante: similar.n,
          uscitaTipicaBar: similar.medianEndBar ?? null,
          uscitaPiuBassaBar: similar.minEndBar ?? null,
          durataTipicaMin: similar.medianBottomMin ?? null,
          quanteSottoLaRiservaMinima: similar.belowReserve,
          filtrateAncheSullaDurata: similar.byDurationToo,
          avvertenza:
            (similar.byDurationToo
              ? 'Confronto filtrato su profondità e durata simili. '
              : 'ATTENZIONE: non ci sono abbastanza immersioni di durata simile, quindi il confronto è filtrato SOLO sulla profondità e la durata tipica qui sopra può essere molto diversa da quella pianificata. ') +
            'I bar non sono confrontabili fra bombole di volume diverso: uno scarto in bar va letto come indicativo, non come una quantità di gas.',
        }
      : 'nessuna immersione confrontabile nel periodo',
  });
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
  return compactJson({
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
    livelli: {
      // La nota vale SOLO per il primo livello: ripetuta su ognuno era falsa su
      // tutti gli altri, e con tre livelli compariva tre volte.
      nota: 'il tempo del PRIMO livello comprende la discesa; gli altri no',
      righe: levels.map((l) => ({
        profonditaM: l.depthM,
        minuti: l.minutes,
        setpointBar: l.setpointBar ?? null,
      })),
    },
    /*
     * La profondità di cambio EFFETTIVA, non solo quella scritta a mano.
     *
     * `g.switchDepthM` è indefinito quasi sempre — è il campo che l'utente
     * compila per forzare un cambio, e quasi nessuno lo compila — quindi la
     * colonna arrivava tutta `null`. Ma il prompt chiede espressamente di
     * verificare «profondità di cambio incoerenti con la MOD», e l'app la MOD
     * la calcola: `switchDepthOf` è la stessa funzione che il motore usa per
     * decidere i cambi. Mandare `null` dove esiste un numero significa chiedere
     * un controllo e negare il dato per farlo.
     */
    miscele: gases.map((g, i) => ({
      indice: i,
      nome: gasLabel(g),
      o2: g.mix.o2,
      he: g.mix.he,
      ruolo: g.role,
      profonditaDiCambioM: switchDepthOf(g, settings),
      profonditaDiCambioImpostataAMano: g.switchDepthM ?? null,
      modConIlLimiteDelSuoRuoloM: switchDepthOf({ ...g, switchDepthM: undefined }, settings),
      limitePpo2UsatoBar: g.role === 'deco' ? settings.maxPpo2Deco : settings.maxPpo2Work,
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
      /*
       * IL NUMERO PIÙ PERICOLOSO DEL CONTESTO, e viaggiava nudo.
       *
       * `timeToFly` restituisce il momento in cui il TETTO calcolato alla
       * pressione di cabina scende a zero: su un piano tecnico può valere 1.
       * Il commento della funzione dice espressamente che «non sostituisce le
       * 12/18/24 ore delle didattiche» e che il numero «va confrontato con
       * quelle, non usato al loro posto» — ma il contesto spediva l'intero
       * nudo, sotto un nome che suona come una prescrizione, a un modello a cui
       * si ordina di usare solo i numeri presenti. Alla domanda «cosa questo
       * piano non dice» l'unico dato sul volo valeva 1.
       *
       * Il caveat viaggia col numero, nello stesso campo: separarli significa
       * che uno dei due può essere citato senza l'altro.
       */
      primaDiVolare: {
        oreSecondoIlModello: result.timeToFlyH ?? null,
        avvertenza:
          'È il momento in cui il tetto calcolato alla pressione di cabina scende a zero, NON un tempo di attesa raccomandato. Le didattiche prescrivono 12, 18 o 24 ore secondo il tipo di immersione, e sono regole di prudenza costruite su statistiche: questo numero va confrontato con quelle, mai usato al loro posto.',
      },
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
  });
}
