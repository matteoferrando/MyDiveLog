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
function fintoBrowser(opzioni: { saFarlo?: boolean; visibileAllInizio?: boolean } = {}) {
  const saFarlo = opzioni.saFarlo ?? true;
  let visibile = opzioni.visibileAllInizio ?? true;
  let orologio = 1000;
  let ascoltatore: (() => void) | null = null;
  const stato = { chieste: 0, rilasci: 0 };

  const api: ApiSchermo = {
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
    expect(b.stato.chieste, 'tornata visibile, il blocco si riprende').toBe(2);
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
    const bene: ResocontoSchermo = { ottenuto: true, sparizioni: 0, viaMs: 0 };
    expect(righeDelloSchermo(bene), 'una riga che dice «tutto a posto» non ha mai aiutato nessuno').toEqual(
      [],
    );

    const senzaBlocco = righeDelloSchermo({ ottenuto: false, sparizioni: 0, viaMs: 0 });
    expect(senzaBlocco).toHaveLength(1);
    expect(senzaBlocco[0]).toContain('non sa tenere acceso lo schermo');

    const sparita = righeDelloSchermo({ ottenuto: true, sparizioni: 1, viaMs: 42_000 });
    expect(sparita).toHaveLength(1);
    expect(sparita[0]).toContain('1 volta');
    expect(sparita[0], 'i secondi servono a capire se è stato il blocco automatico').toContain('42 s');
  });
});
