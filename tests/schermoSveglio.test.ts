import { describe, expect, it } from 'vitest';

import {
  righeDelloSchermo,
  tieniSvegliaLoSchermo,
  type ApiSchermo,
  type ResocontoSchermo,
} from '../src/core/schermoSveglio';

/**
 * Un browser finto: si può spegnere e riaccendere la pagina a comando, e
 * l'orologio va avanti solo quando glielo si dice.
 */
function fintoBrowser(
  opzioni: {
    saFarlo?: boolean;
    visibileAllInizio?: boolean;
    nativo?: boolean;
    /** Come un telefono: lo schermo che si spegne ferma lo scarico. */
    fermaLoScarico?: boolean;
  } = {},
) {
  const saFarlo = opzioni.saFarlo ?? true;
  // Il valore per difetto è **falso**: è il browser, dove il nativo non c'è.
  // Le prove che vogliono la strada nativa lo dicono.
  const nativo = opzioni.nativo ?? false;
  let visibile = opzioni.visibileAllInizio ?? true;
  let orologio = 1000;
  let ascoltatore: (() => void) | null = null;
  const stato = { chieste: 0, rilasci: 0, nativeChieste: 0, nativeSpente: 0 };

  const api: ApiSchermo = {
    chiediIlBloccoNativo: async (acceso: boolean) => {
      if (!acceso) {
        stato.nativeSpente += 1;
        return false;
      }
      stato.nativeChieste += 1;
      return nativo;
    },
    chiediIlBlocco: async () => {
      stato.chieste += 1;
      if (!saFarlo) return null;
      return {
        rilascia: async () => {
          stato.rilasci += 1;
        },
      };
    },
    visibile: () => visibile,
    ascoltaLaVisibilita: (quando) => {
      ascoltatore = quando;
      return () => {
        ascoltatore = null;
      };
    },
    adesso: () => orologio,
    loSchermoFermaLoScarico: () => opzioni.fermaLoScarico ?? true,
  };

  return {
    api,
    stato,
    avanza: (ms: number) => {
      orologio += ms;
    },
    /** La pagina sparisce (schermo spento, cambio applicazione). */
    async sparisci() {
      visibile = false;
      ascoltatore?.();
      await Promise.resolve();
    },
    async torna() {
      visibile = true;
      ascoltatore?.();
      await Promise.resolve();
    },
    get ascoltato() {
      return ascoltatore !== null;
    },
  };
}

describe('► tenere acceso lo schermo mentre il computer parla ◄', () => {
  it('chiede il blocco e lo rilascia alla fine', async () => {
    const b = fintoBrowser();
    const sveglio = await tieniSvegliaLoSchermo(b.api);
    expect(b.stato.chieste).toBe(1);
    const r = await sveglio.lascia();
    expect(r.ottenuto).toBe(true);
    expect(r.sparizioni).toBe(0);
    expect(b.stato.rilasci).toBe(1);
    expect(b.ascoltato, 'l’ascolto va tolto, o resta appeso a ogni scarico').toBe(false);
  });

  it('► si prova PRIMA la strada nativa, e se funziona il web non si tocca ◄', async () => {
    /*
     * ════════════════════════════════════════════════════════════════════════
     * LA PROVA NATA DA UNA VERSIONE SPEDITA A VUOTO.
     *
     * La 1.8.10 aveva solo `navigator.wakeLock`, che è la strada del web, e la
     * strada del web **non esiste dentro una WKWebView** — cioè esattamente
     * dove gira MyDiveLog su iOS e su macOS. Il rimedio principale di quella
     * versione è stato inerte dal momento in cui è stato spedito, e a dirlo è
     * stata soltanto la misura che gli era stata messa accanto per dubitarne.
     *
     * *Su tutto ciò che tocca l'hardware, il web è il ripiego e non la prima
     * scelta.* E quando il nativo funziona, il blocco del web non si chiede
     * nemmeno: sarebbero due blocchi sullo stesso schermo e due da rilasciare.
     */
    const b = fintoBrowser({ nativo: true });
    const sveglio = await tieniSvegliaLoSchermo(b.api);
    expect(b.stato.nativeChieste).toBe(1);
    expect(b.stato.chieste, 'con il nativo acceso non si chiede anche il web').toBe(0);
    const r = await sveglio.lascia();
    expect(r.come).toBe('nativo');
    expect(b.stato.nativeSpente, 'e alla fine si spegne').toBe(1);
  });

  it('se il nativo dice di no, si ripiega sul web e lo si dichiara', async () => {
    const b = fintoBrowser({ nativo: false, saFarlo: true });
    const sveglio = await tieniSvegliaLoSchermo(b.api);
    expect(b.stato.nativeChieste).toBe(1);
    expect(b.stato.chieste, 'il ripiego si prova').toBe(1);
    const r = await sveglio.lascia();
    expect(r.come).toBe('web');
  });

  it('il blocco nativo si spegne SEMPRE, anche se non era stato acceso da noi', async () => {
    // Un telefono che non si spegne più perché un'applicazione di logbook ha
    // dimenticato una riga è un difetto che si paga in recensioni. Costa una
    // chiamata, e chiude anche il caso di un tentativo precedente che lo aveva
    // lasciato acceso.
    const b = fintoBrowser({ nativo: false, saFarlo: false });
    const sveglio = await tieniSvegliaLoSchermo(b.api);
    const r = await sveglio.lascia();
    expect(r.ottenuto).toBe(false);
    expect(r.come).toBe('niente');
    expect(b.stato.nativeSpente).toBe(1);
  });

  it('► quando la pagina torna, il blocco si RICHIEDE ◄', async () => {
    /*
     * ════════════════════════════════════════════════════════════════════════
     * LA PROVA PIÙ IMPORTANTE DI QUESTO FILE.
     *
     * La specifica dice che il blocco viene rilasciato **dal sistema** appena
     * la pagina smette di essere visibile, e non torna da solo. Senza la
     * richiesta nuova, la prima notifica che copre l'applicazione per un
     * istante spegnerebbe la protezione per tutto il resto dello scarico —
     * cioè proprio nei minuti in cui serve di più, e senza che niente lo dica.
     */
    const b = fintoBrowser();
    const sveglio = await tieniSvegliaLoSchermo(b.api);
    expect(b.stato.chieste).toBe(1);
    await b.sparisci();
    expect(b.stato.chieste, 'da nascosta non si chiede niente').toBe(1);
    await b.torna();
    await Promise.resolve();
    expect(b.stato.chieste, 'tornata visibile, il blocco si riprende').toBe(2);
    await sveglio.lascia();
  });

  it('e il blocco che si riprende vale anche per la strada nativa', async () => {
    /*
     * ► NON È UNA COPIA DELLA PROVA QUI SOPRA. ◄ Quella usa il ripiego del web,
     * e con il ripiego una mutazione che toglie la ripresa del NATIVO resta
     * verde — l'ho vista restare verde. Su iOS `idleTimerDisabled` viene
     * azzerato quando l'applicazione va in secondo piano: senza questa riga, la
     * prima notifica che copre l'app spegnerebbe la protezione per tutto il
     * resto dello scarico, che è il caso peggiore e il più probabile.
     */
    const b = fintoBrowser({ nativo: true });
    const sveglio = await tieniSvegliaLoSchermo(b.api);
    expect(b.stato.nativeChieste).toBe(1);
    await b.sparisci();
    await b.torna();
    await Promise.resolve();
    expect(b.stato.nativeChieste, 'tornata visibile, il blocco nativo si riprende').toBe(2);
    expect(b.stato.chieste, 'e non si ripiega sul web quando il nativo funziona').toBe(0);
    await sveglio.lascia();
  });

  it('conta le sparizioni e per quanto tempo, che è la misura che serve', async () => {
    const b = fintoBrowser();
    const sveglio = await tieniSvegliaLoSchermo(b.api);
    await b.sparisci();
    b.avanza(12_000);
    await b.torna();
    b.avanza(3_000);
    await b.sparisci();
    b.avanza(8_000);
    const r = await sveglio.lascia();
    expect(r.sparizioni).toBe(2);
    // Anche la sparizione ancora in corso alla fine dev'essere contata: è
    // proprio quella dello scarico che muore mentre lo schermo è spento.
    expect(r.viaMs).toBe(20_000);
  });

  it('una pagina già nascosta in partenza conta come una sparizione', async () => {
    // Succede: si avvia lo scarico e si cambia applicazione subito. Contarla
    // solo se «cambia» la visibilità la farebbe sparire dal conto proprio nel
    // caso più grave.
    const b = fintoBrowser({ visibileAllInizio: false });
    const sveglio = await tieniSvegliaLoSchermo(b.api);
    b.avanza(5_000);
    const r = await sveglio.lascia();
    expect(r.sparizioni).toBe(1);
    expect(r.viaMs).toBe(5_000);
  });

  it('un browser che non sa tenere acceso lo schermo non rompe niente', async () => {
    // Firefox, Safari prima della 16.4, una pagina senza permesso: `null` o
    // un'eccezione. Uno scarico non si ferma per una comodità.
    const b = fintoBrowser({ saFarlo: false });
    const sveglio = await tieniSvegliaLoSchermo(b.api);
    const r = await sveglio.lascia();
    expect(r.ottenuto).toBe(false);
    expect(b.stato.rilasci).toBe(0);
  });

  it('il diario tace quando è andato tutto bene, e parla quando c’è qualcosa da dire', () => {
    /*
     * ► LA STRADA CHE HA FUNZIONATO SI SCRIVE SEMPRE. ◄ La 1.8.10 credeva di
     * tenere acceso lo schermo e non lo teneva: `navigator.wakeLock` non esiste
     * dentro una WKWebView. Sapere PER QUALE STRADA ci è riuscito è la prima
     * cosa da controllare in un diario di guasto, e distingue «il rimedio c'è»
     * da «il rimedio c'è sulla carta».
     */
    const nativo: ResocontoSchermo = {
      ottenuto: true,
      come: 'nativo',
      contaDavvero: true,
      sparizioni: 0,
      viaMs: 0,
    };
    expect(righeDelloSchermo(nativo)[0]).toContain('strada nativa');

    const web = righeDelloSchermo({
      ottenuto: true,
      come: 'web',
      contaDavvero: true,
      sparizioni: 0,
      viaMs: 0,
    });
    expect(web[0]).toContain('strada del web');

    const senzaBlocco = righeDelloSchermo({
      ottenuto: false,
      come: 'niente',
      contaDavvero: true,
      sparizioni: 0,
      viaMs: 0,
    });
    expect(senzaBlocco).toHaveLength(1);
    expect(senzaBlocco[0]).toContain('non sa tenere acceso lo schermo');

    /*
     * ► E SU UN COMPUTER QUELLA STESSA RIGA NON SI SCRIVE. ◄ La prima versione
     * la scriveva sempre, e l'11 settembre 2026 è comparsa sotto uno scarico
     * RIUSCITO sul Mac, dicendo «se si spegne, lo scarico si ferma» — che su un
     * Mac è falso: lo schermo spento non sospende l'applicazione.
     *
     * *Una riga di diario che afferma una cosa che non succede è peggio di
     * nessuna riga.* L'ha trovata una prova di cinque minuti su un apparecchio
     * che funzionava, fatta la sera prima invece che il giorno dopo.
     */
    const suUnComputer = righeDelloSchermo({
      ottenuto: false,
      come: 'niente',
      contaDavvero: false,
      sparizioni: 0,
      viaMs: 0,
    });
    expect(suUnComputer, 'su un computer non c’è niente da avvertire').toEqual([]);

    const sparita = righeDelloSchermo({
      ottenuto: true,
      come: 'nativo',
      contaDavvero: true,
      sparizioni: 1,
      viaMs: 42_000,
    });
    expect(sparita).toHaveLength(2);
    expect(sparita[1]).toContain('1 volta');
    expect(sparita[1], 'i secondi servono a capire se è stato il blocco automatico').toContain('42 s');
  });
});
