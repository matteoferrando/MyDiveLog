/**
 * La sosta di sicurezza, per come si fa in acqua e non per come si disegna.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ► LA SPECIFICA, DETTATA DA CHI LA FA. ◄
 *
 * «Tre minuti a fine immersione fra 6,5 e 3,5 metri, e deve contare.» Non è
 * un'approssimazione della regola dei cinque metri: è la regola vera. Il
 * contatore del computer parte già a sei metri, il subacqueo si stabilizza dove
 * riesce, e in tre minuti a bombola quasi vuota la quota si muove di un metro
 * senza che nessuno stia sbagliando niente.
 *
 * ► COSA HA PRESO QUESTO FILE, IL GIORNO IN CUI È NATO. ◄
 *
 * La regola precedente — fascia `[3, 6]`, azzeramento al primo campione fuori —
 * contava una sosta tenuta **a sei metri** nell'1% dei casi, e una tenuta **a
 * tre metri** idem, anche con assetto perfetto: sui bordi di una fascia
 * inclusiva metà campioni cadono dall'altra parte. Gli estremi dichiarati erano
 * inutilizzabili, e la fascia che funzionava davvero era 4–5.
 *
 * ► PERCHÉ QUESTE PROVE SONO SINTETICHE, E PERCHÉ VA BENE COSÌ. ◄
 *
 * Un archivio vero non si può mettere in un repository pubblico, e uno finto
 * costruito «a mano» proverebbe solo che il codice fa quello che il codice fa.
 * Qui i profili sono **generati con un'oscillazione dichiarata** — ampiezza,
 * periodo, rumore del sensore, passo di campionamento — cioè con i parametri
 * che il difetto aveva reso decisivi. È la differenza fra una prova che ripete
 * l'implementazione e una che la interroga.
 */

import { describe, expect, it } from 'vitest';
import { computeMetrics } from '../src/core/analysis/metrics';
import { LIMITS } from '../src/core/model';
import type { Dive, Sample } from '../src/core/model';

/** Numeri pseudocasuali riproducibili: una prova che cambia esito a ogni giro non è una prova. */
function dado(seme: number) {
  let x = seme;
  return () => {
    x = (x * 1103515245 + 12345) % 2147483648;
    return x / 2147483648;
  };
}

interface Spec {
  /** Quota attorno a cui si tiene la sosta, metri. */
  quotaM: number;
  /** Ampiezza dell'oscillazione durante la sosta, metri. */
  ampiezzaM: number;
  /** Durata della sosta, secondi. */
  sostaS: number;
  /** Passo di campionamento del computer, secondi. */
  passoS: number;
  seme: number;
  /** Se dato, la sosta scivola da questa quota a `quotaM` invece di restare ferma. */
  daM?: number;
}

/** Un'immersione quadrata a 25 m con la sosta descritta da `spec`. */
function immersione(spec: Spec): Dive {
  const { quotaM, ampiezzaM, sostaS, passoS, seme, daM } = spec;
  const rnd = dado(seme);
  const s: Sample[] = [];
  let t = 0;
  const push = (d: number) => {
    // Un decimo di metro: la risoluzione con cui i computer registrano, ed è
    // quella che sui bordi della fascia decideva l'esito.
    s.push({ t, depth: Math.max(0, Math.round(d * 10) / 10) });
    t += passoS;
  };
  for (let i = 0; i * passoS < 90; i++) push((25 * i * passoS) / 90);
  for (let i = 0; i * passoS < 1200; i++) push(25 + (rnd() - 0.5));
  const partenza = daM ?? quotaM;
  const risalitaS = ((25 - partenza) / 9) * 60;
  for (let i = 0; i * passoS < risalitaS; i++) push(25 - ((25 - partenza) * i * passoS) / risalitaS);
  const fase = rnd() * Math.PI * 2;
  for (let i = 0; i * passoS < sostaS; i++) {
    const tt = i * passoS;
    const centro = daM === undefined ? quotaM : partenza + ((quotaM - partenza) * tt) / sostaS;
    push(centro + ampiezzaM * Math.sin(fase + (2 * Math.PI * tt) / 30) + (rnd() - 0.5) * 0.2);
  }
  const finaleS = (quotaM / 6) * 60;
  for (let i = 0; i * passoS <= finaleS; i++) push(quotaM - (quotaM * i * passoS) / finaleS);
  return {
    id: 'prova',
    startTime: '2026-01-01T10:00:00Z',
    durationS: t,
    maxDepth: 25,
    mode: 'oc',
    cylinders: [],
    samples: s,
  } as unknown as Dive;
}

/** Su quante prove su cento la sosta risulta fatta. */
function percentualeFatta(base: Omit<Spec, 'seme'>, prove = 200): number {
  let ok = 0;
  for (let k = 0; k < prove; k++) {
    if (computeMetrics(immersione({ ...base, seme: k * 7919 + 1 })).didSafetyStop) ok++;
  }
  return (100 * ok) / prove;
}

const QUOTE = [3.5, 4, 4.5, 5, 5.5, 6, 6.5];
const PASSI = [2, 5, 10, 20];

/**
 * Un profilo scritto a segmenti: `[quota, durata]`, in ordine.
 *
 * Serve alle prove sulla tolleranza, dove conta il **secondo esatto** dentro e
 * fuori fascia e un'oscillazione sinusoidale renderebbe illeggibile il conto.
 */
function daSegmenti(segmenti: [number, number][], passoS: number): Dive {
  const s: Sample[] = [];
  let t = 0;
  for (const [quota, durata] of segmenti) {
    for (let i = 0; i * passoS < durata; i++) {
      s.push({ t, depth: quota });
      t += passoS;
    }
  }
  return {
    id: 'prova',
    startTime: '2026-01-01T10:00:00Z',
    durationS: t,
    maxDepth: Math.max(...segmenti.map(([q]) => q)),
    mode: 'oc',
    cylinders: [],
    samples: s,
  } as unknown as Dive;
}

describe('la sosta di sicurezza come si fa davvero', () => {
  /*
   * ► LA PROVA CHE VALE PER TUTTE LE ALTRE. ◄
   *
   * Tre minuti a qualunque quota fra 6,5 e 3,5, con l'oscillazione di un
   * subacqueo normale: sempre fatta. Non «quasi sempre» — la percentuale è
   * secca, perché una sosta fatta contata all'84% è una sosta che una volta su
   * sei sparisce senza che nessuno sappia perché.
   */
  it.each(QUOTE)('tre minuti a %s m contano, con oscillazione fino a ±0,8 m', (quotaM) => {
    for (const passoS of PASSI) {
      for (const ampiezzaM of [0, 0.3, 0.5, 0.8]) {
        expect(
          percentualeFatta({ quotaM, ampiezzaM, sostaS: 190, passoS }),
          `${quotaM} m ±${ampiezzaM} m, campionamento ${passoS} s`,
        ).toBe(100);
      }
    }
  });

  /*
   * LA SOSTA CHE SCIVOLA, che è come viene alla maggior parte della gente: si
   * arriva a 6,5 col contatore che parte e si finisce sui 4 senza accorgersene.
   * Non è una quota tenuta male: è la fascia intera percorsa in tre minuti.
   */
  it('vale anche se la quota scivola da 6,5 a 3,5 nei tre minuti', () => {
    for (const passoS of PASSI) {
      expect(percentualeFatta({ daM: 6.5, quotaM: 3.5, ampiezzaM: 0.5, sostaS: 190, passoS })).toBe(100);
    }
  });

  /*
   * ► L'ESITO NON DIPENDE DA COME È IMPOSTATO IL COMPUTER. ◄
   *
   * Era il difetto peggiore, perché invisibile: la stessa sosta risultava fatta
   * nell'84% dei casi a 10 s di campionamento e nel 30% a 2 s. Due subacquei
   * affiancati, stesso profilo, giudizi diversi — e quello col computer più
   * preciso usciva peggio.
   */
  it('la stessa sosta dà lo stesso esito a qualunque passo di campionamento', () => {
    const esiti = PASSI.map((passoS) => percentualeFatta({ quotaM: 5, ampiezzaM: 1, sostaS: 190, passoS }));
    expect(new Set(esiti).size, `esiti per passo ${PASSI.join('/')} s: ${esiti.join('/')}`).toBe(1);
  });

  /*
   * ► E IL SALISCENDI RESTA «NON FATTA». ◄
   *
   * È la difesa che c'era prima e che non si perde: due transiti da cento
   * secondi a quattro metri con una ridiscesa a dodici in mezzo sommavano a più
   * di tre minuti, ma non sono una sosta. La ridiscesa dura sei volte la
   * tolleranza — la tolleranza serve a un respiro, non a un secondo giro.
   */
  it('due passaggi in fascia con una ridiscesa in mezzo non sono una sosta', () => {
    for (const passoS of PASSI) {
      const s: Sample[] = [];
      let t = 0;
      const push = (d: number) => {
        s.push({ t, depth: d });
        t += passoS;
      };
      for (let i = 0; i * passoS < 600; i++) push(30);
      for (let i = 0; i * passoS < 100; i++) push(4);
      for (let i = 0; i * passoS < 120; i++) push(12);
      for (let i = 0; i * passoS < 100; i++) push(4);
      for (let i = 0; i * passoS < 40; i++) push(0);
      const m = computeMetrics({
        id: 'x',
        startTime: '2026-01-01T10:00:00Z',
        durationS: t,
        maxDepth: 30,
        mode: 'oc',
        cylinders: [],
        samples: s,
      } as unknown as Dive);
      expect(m.didSafetyStop, `passo ${passoS} s`).toBe(false);
    }
  });

  /*
   * ► UNA SOSTA CORTA RESTA CORTA, e questa prova è nata sbagliata. ◄
   *
   * Chiedeva che una sosta di **120 s** non contasse, e falliva: il profilo ne
   * misurava 162-180 in fascia. Non era un difetto del codice — era il mio
   * conto sbagliato. Con la fascia larga, la risalita finale da 5 m a 2,5 m e
   * l'avvicinamento da 7,5 m a 5 m stanno **dentro** la finestra, e sono una
   * quarantina di secondi in cui il subacqueo è davvero lì. *La fascia misura
   * il tempo passato negli ultimi metri, non il tempo passato immobili: era la
   * prova a pretendere una cosa che la definizione non dice.*
   *
   * Riscritta su un minuto, che è corto per qualunque conto. Quello che difende
   * resta: **la tolleranza mette in pausa il conteggio, non regala secondi** —
   * il tempo fuori fascia non entra nel totale, o «tolleranza» diventerebbe
   * «sconto».
   */
  it('un minuto resta un minuto, e non basta', () => {
    for (const passoS of PASSI) {
      expect(percentualeFatta({ quotaM: 5, ampiezzaM: 0.5, sostaS: 60, passoS }), `passo ${passoS} s`).toBe(
        0,
      );
    }
  });

  /*
   * ► LA TOLLERANZA SERVE, E QUESTA È LA PROVA CHE LO DIMOSTRA. ◄
   *
   * Senza di lei le prove qui sopra passerebbero lo stesso — con la fascia
   * larga un'oscillazione di ottanta centimetri non esce mai — e una tolleranza
   * che nessuna prova distingue non è una scelta, è una riga. *Il caso vero è
   * chi tiene 5 m e si fa scappare un respiro: dieci secondi a nove metri, in
   * mezzo a tre minuti. È una sosta, e prima non lo era.*
   */
  it('dieci secondi fuori fascia non buttano via la sosta', () => {
    for (const passoS of PASSI) {
      const d = daSegmenti(
        [
          [25, 600],
          [5, 90],
          [9, 10],
          [5, 100],
          [0, 60],
        ],
        passoS,
      );
      expect(computeMetrics(d).didSafetyStop, `passo ${passoS} s`).toBe(true);
    }
  });

  /*
   * MA UN MINUTO FUORI SÌ. Fra un respiro e una ridiscesa c'è una differenza, e
   * sta tutta in quanto dura: sessanta secondi a dodici metri sono un pezzo di
   * immersione, non un'escursione d'assetto. È il confine della tolleranza,
   * guardato dalla parte in cui deve dire di no.
   */
  it('un minuto fuori fascia interrompe la sosta', () => {
    for (const passoS of PASSI) {
      const d = daSegmenti(
        [
          [25, 600],
          [5, 90],
          [12, 60],
          [5, 100],
          [0, 60],
        ],
        passoS,
      );
      expect(computeMetrics(d).didSafetyStop, `passo ${passoS} s`).toBe(false);
    }
  });

  /*
   * ► E IL TEMPO PASSATO FUORI NON SI REGALA. ◄
   *
   * La pausa è una pausa. Sei tratti da venticinque secondi in fascia fanno 150
   * secondi — meno di tre minuti — anche se fra l'uno e l'altro ci sono
   * settantacinque secondi passati a nove metri. Sommandoli si arriverebbe a
   * 225 e la sosta risulterebbe fatta: sarebbe di nuovo il difetto dei due
   * transiti sommati, rientrato dalla finestra della tolleranza.
   *
   * *Le durate sono multipli del passo di campionamento più grosso usato qui, e
   * non è pignoleria: alla prima scrittura erano 28 e 18, che a passo 5 s
   * diventano 30 e 15 — e trenta per sei fa esattamente 180. La prova falliva
   * per l'arrotondamento invece che per il difetto.*
   */
  it('il tempo fuori fascia non entra nel totale', () => {
    for (const passoS of [2, 5]) {
      const segmenti: [number, number][] = [[25, 600]];
      for (let i = 0; i < 6; i++) {
        segmenti.push([5, 25]);
        if (i < 5) segmenti.push([9, 15]);
      }
      segmenti.push([0, 60]);
      const m = computeMetrics(daSegmenti(segmenti, passoS));
      expect(m.didSafetyStop, `passo ${passoS} s, sosta misurata ${m.safetyStopS} s`).toBe(false);
    }
  });

  /*
   * ► LA SOSTA PROFONDA AVEVA LO STESSO DIFETTO, PIÙ NASCOSTO. ◄
   *
   * La sua fascia è proporzionale — da 0,4 a 0,6 volte la profondità massima —
   * e su un'immersione a 40 m è larga otto metri: un'oscillazione d'assetto non
   * la attraversa, e per questo il difetto è rimasto invisibile più a lungo.
   * **Ma i bordi restano bordi.** Chi sceglie di fermarsi al 40% o al 60% —
   * quote che si scelgono, non che capitano — cadeva esattamente sul confine, e
   * la sosta veniva riconosciuta dallo 0 al 58% delle volte a seconda della
   * profondità e del passo di campionamento.
   *
   * *La fascia NON è stata allargata, ed è una scelta: 0,35 × 20 m fa 7 metri,
   * cioè dentro la fascia della sosta di sicurezza, e tornerebbe il doppio
   * conteggio che portava le statistiche al 114%. Basta la tolleranza.*
   */
  it.each([0.4, 0.45, 0.5, 0.55, 0.6])(
    'una sosta profonda a %s volte la massima viene riconosciuta',
    (frazione) => {
      for (const max of [24, 30, 40]) {
        for (const passoS of [2, 10]) {
          const quota = max * frazione;
          const s: Sample[] = [];
          let t = 0;
          const push = (d: number) => {
            s.push({ t, depth: Math.max(0, Math.round(d * 10) / 10) });
            t += passoS;
          };
          for (let i = 0; i * passoS < 120; i++) push((max * i * passoS) / 120);
          for (let i = 0; i * passoS < 900; i++) push(max);
          const ris = ((max - quota) / 10) * 60;
          for (let i = 0; i * passoS < ris; i++) push(max - ((max - quota) * i * passoS) / ris);
          // Novanta secondi con l'oscillazione di chi tiene la quota a metà risalita.
          for (let i = 0; i * passoS < 90; i++) push(quota + 0.8 * Math.sin((2 * Math.PI * i * passoS) / 30));
          const r2 = ((quota - 5) / 9) * 60;
          for (let i = 0; i * passoS < r2; i++) push(quota - ((quota - 5) * i * passoS) / r2);
          for (let i = 0; i * passoS < 190; i++) push(5);
          for (let i = 0; i * passoS <= 50; i++) push(5 - (5 * i * passoS) / 50);
          const m = computeMetrics({
            id: 'x',
            startTime: '2026-01-01T10:00:00Z',
            durationS: t,
            maxDepth: max,
            mode: 'oc',
            cylinders: [],
            samples: s,
          } as unknown as Dive);
          expect(m.deepStopS, `${frazione} × ${max} m, passo ${passoS} s`).toBeGreaterThanOrEqual(60);
        }
      }
    },
  );

  /*
   * LA FASCIA E LA SOSTA PROFONDA NON SI TOCCANO, e questa prova è qui perché
   * il doppio conteggio è già successo una volta: le statistiche arrivavano al
   * 114% di immersioni con sosta profonda perché la stessa permanenza veniva
   * contata due volte con due nomi. Il tetto della fascia sta sotto il fondo
   * della sosta profonda alla profondità minima in cui questa si cerca.
   */
  it('il tetto della fascia sta sotto la sosta profonda più bassa possibile', () => {
    const [, tetto] = LIMITS.safetyStopBandM;
    const [frazioneBassa] = LIMITS.deepStopBandFraction;
    expect(tetto).toBeLessThan(20 * frazioneBassa);
  });
});
