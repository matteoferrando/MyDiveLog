/**
 * Tenere acceso lo schermo mentre il computer subacqueo parla, e accorgersi se
 * si spegne lo stesso.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ► IL CONTO CHE HA FATTO NASCERE QUESTO FILE. ◄
 *
 * Il diario del Puck 4 dell'11 settembre 2026 dice: 64 236 byte, 284 notifiche,
 * 285 comandi, **due** immersioni. Sono 226 byte a notifica — niente
 * frammentazione, una risposta per comando — e **142 comandi e 32 KB per
 * immersione**. Quindi un archivio di quarantacinque immersioni non è «poco più
 * di quello che è passato»: sono circa **6 400 comandi e 1,4 MB**, cioè
 * ventidue volte la strada già fatta, e a un giro di andata e ritorno per
 * comando vuol dire **parecchi minuti** di trasferimento ininterrotto.
 *
 * Parecchi minuti, su un telefono, con una sola applicazione in primo piano che
 * mostra una barra che avanza e nessun dito che tocca lo schermo. *È
 * esattamente la situazione che il blocco automatico dello schermo esiste per
 * interrompere*, e il valore predefinito su iPhone si misura in decine di
 * secondi.
 *
 * E quando lo schermo si spegne, su iOS l'applicazione viene sospesa: i thread
 * si fermano, le notifiche Bluetooth non vengono più consegnate. Dal punto di
 * vista di libdivecomputer è un computer che ha smesso di rispondere — cioè una
 * lettura scaduta, cioè il primo anello della catena che il 10 settembre ha
 * ucciso lo scarico.
 *
 * ► QUESTO FILE NON DIMOSTRA CHE SIA ANDATA COSÌ. ◄ È un'ipotesi, e le ipotesi
 * in questa storia hanno già perso una volta. Per questo fa **due** cose, e la
 * seconda vale quanto la prima: chiede al sistema di non spegnere lo schermo, e
 * **conta le volte in cui la pagina è sparita comunque**. Se il prossimo diario
 * dice «la pagina è sparita 1 volta» accanto a uno scarico rotto, l'ipotesi è
 * confermata da una osservazione e non da un ragionamento; se dice «non è mai
 * sparita» e lo scarico si rompe uguale, è morta, e si guarda altrove.
 */

import { invoke } from '@tauri-apps/api/core';

import { isTauri } from '../storage/index';

/** Il pezzo di browser che serve, isolato per poterlo sostituire nelle prove. */
export type ApiSchermo = {
  /**
   * La strada NATIVA: `UIApplication.setIdleTimerDisabled:` su iOS, attraverso
   * un comando Rust. Risponde `true` solo se ha fatto qualcosa davvero.
   *
   * ► SI PROVA PER PRIMA, E LA RAGIONE È COSTATA UNA VERSIONE. ◄ La 1.8.10
   * aveva solo la strada del web, e la strada del web **non esiste dentro una
   * WKWebView** — cioè esattamente dove gira MyDiveLog su iOS e su macOS. Il
   * rimedio è stato inerte dal momento in cui è stato spedito, e a dirlo è
   * stata solo la misura che gli era stata messa accanto per dubitarne.
   *
   * *Da qui la regola: su tutto ciò che tocca l'hardware, il web è il ripiego,
   * non la prima scelta.*
   */
  chiediIlBloccoNativo(acceso: boolean): Promise<boolean>;
  /**
   * Chiede al sistema di non spegnere lo schermo. `null` vuol dire «non so
   * farlo» — ed è la risposta onesta di Safari prima della 16.4, di un browser
   * senza il permesso, e di qualunque pagina non in primo piano.
   */
  chiediIlBlocco(): Promise<{ rilascia(): Promise<void> } | null>;
  /** Se la pagina è visibile adesso. */
  visibile(): boolean;
  /** Si mette in ascolto dei cambi di visibilità; torna la funzione per smettere. */
  ascoltaLaVisibilita(quando: () => void): () => void;
  /** L'orologio, in millisecondi. */
  adesso(): number;
};

/** Com'è andata: quello che finisce nel diario. */
export type ResocontoSchermo = {
  /** Il blocco è stato ottenuto almeno una volta, per una delle due strade. */
  ottenuto: boolean;
  /** Per quale strada: serve a sapere quale delle due ha funzionato davvero. */
  come: 'nativo' | 'web' | 'niente';
  /** Quante volte la pagina è sparita durante lo scarico. */
  sparizioni: number;
  /** Quanto è stata via in tutto, in millisecondi. */
  viaMs: number;
};

export type SchermoSveglio = {
  /**
   * Se si è riusciti a tenere acceso lo schermo, **saputo subito**.
   *
   * ► SERVE ALL'INTERFACCIA, NON AL DIARIO. ◄ Il diario lo racconta alla fine,
   * quando ormai è successo tutto; chi ha il telefono in mano deve saperlo
   * **prima**, mentre la barra avanza, perché è l'unico momento in cui può fare
   * qualcosa — mettere il blocco automatico su «Mai» e restare sulla
   * schermata. *Un'applicazione che sa di non poter difendere uno scarico e non
   * lo dice sceglie di farlo fallire in silenzio.*
   */
  ottenuto: boolean;
  /** Rilascia il blocco e racconta com'è andata. */
  lascia(): Promise<ResocontoSchermo>;
};

/**
 * L'API vera del browser, quando c'è.
 *
 * Tutto è avvolto in un `try`: `navigator.wakeLock` non esiste su Firefox e su
 * Safari vecchi, e `request` **getta** — non torna `null` — quando la pagina
 * non è visibile o il documento non lo permette. Una promessa rifiutata qui
 * dentro fermerebbe uno scarico per un blocco dello schermo, che è il modo
 * peggiore possibile di aggiungere una comodità.
 */
export function apiDelBrowser(): ApiSchermo {
  return {
    async chiediIlBloccoNativo(acceso: boolean) {
      // Fuori da Tauri il comando non esiste, e chiederlo getta: non è un
      // guasto, è un browser.
      if (!isTauri()) return false;
      try {
        return (await invoke<boolean>('tieni_acceso_lo_schermo', { acceso })) === true;
      } catch {
        return false;
      }
    },
    async chiediIlBlocco() {
      try {
        const nav = navigator as Navigator & {
          wakeLock?: { request(tipo: 'screen'): Promise<{ release(): Promise<void> }> };
        };
        if (!nav.wakeLock) return null;
        const blocco = await nav.wakeLock.request('screen');
        return { rilascia: () => blocco.release() };
      } catch {
        return null;
      }
    },
    visibile: () => {
      try {
        return document.visibilityState === 'visible';
      } catch {
        return true;
      }
    },
    ascoltaLaVisibilita: (quando) => {
      try {
        document.addEventListener('visibilitychange', quando);
        return () => document.removeEventListener('visibilitychange', quando);
      } catch {
        return () => {};
      }
    },
    adesso: () => Date.now(),
  };
}

/**
 * Tiene acceso lo schermo finché non si chiama `lascia()`.
 *
 * ► IL BLOCCO SI RIPRENDE QUANDO LA PAGINA TORNA. ◄ Non è una raffinatezza: la
 * specifica dice che il blocco viene **rilasciato dal sistema** appena la
 * pagina smette di essere visibile, e non torna da solo. Senza questa riga, la
 * prima notifica che copre l'applicazione per un istante spegnerebbe la
 * protezione per tutto il resto dello scarico — cioè proprio nei minuti in cui
 * serve di più.
 */
export async function tieniSvegliaLoSchermo(api: ApiSchermo = apiDelBrowser()): Promise<SchermoSveglio> {
  /*
   * ► PRIMA IL NATIVO, POI IL WEB, E SOLO SE IL NATIVO HA DETTO DI NO. ◄
   * Chiedere tutti e due quando il primo ha funzionato vorrebbe dire tenere due
   * blocchi sullo stesso schermo e doverne rilasciare due — e su iOS il secondo
   * non funziona comunque.
   */
  const nativo = await api.chiediIlBloccoNativo(true);
  let blocco = nativo ? null : await api.chiediIlBlocco();
  let ottenuto = nativo || blocco !== null;
  let come: ResocontoSchermo['come'] = nativo ? 'nativo' : blocco ? 'web' : 'niente';
  let sparizioni = 0;
  let viaMs = 0;
  let viaDa: number | null = api.visibile() ? null : api.adesso();
  // Se la pagina era già nascosta quando si comincia, quella è una sparizione
  // in corso: contarla solo alla fine la farebbe sparire dal conto.
  if (viaDa !== null) sparizioni = 1;

  const smettiDiAscoltare = api.ascoltaLaVisibilita(() => {
    if (!api.visibile()) {
      if (viaDa === null) {
        viaDa = api.adesso();
        sparizioni += 1;
      }
      return;
    }
    if (viaDa !== null) {
      viaMs += api.adesso() - viaDa;
      viaDa = null;
    }
    /*
     * Tornata visibile: il sistema ha buttato il blocco, si richiede. Vale per
     * tutte e due le strade — su iOS `idleTimerDisabled` viene azzerato quando
     * l'applicazione va in secondo piano, e la specifica del web dice
     * esplicitamente che il blocco si rilascia quando la pagina si nasconde.
     */
    void api.chiediIlBloccoNativo(true).then((rifatto) => {
      if (rifatto) {
        ottenuto = true;
        come = 'nativo';
        return;
      }
      void api.chiediIlBlocco().then((nuovo) => {
        if (nuovo) {
          blocco = nuovo;
          ottenuto = true;
          come = 'web';
        }
      });
    });
  });

  return {
    ottenuto,
    async lascia() {
      smettiDiAscoltare();
      if (viaDa !== null) {
        viaMs += api.adesso() - viaDa;
        viaDa = null;
      }
      // Il rilascio può fallire se il sistema lo ha già tolto: non è un guasto
      // e non deve diventare un'eccezione dentro un `finally`.
      try {
        await blocco?.rilascia();
      } catch {
        /* già rilasciato dal sistema */
      }
      // Il blocco nativo si spegne SEMPRE, anche se non era stato acceso da
      // noi: costa una chiamata e chiude il caso in cui un tentativo precedente
      // lo aveva lasciato acceso. Un telefono che non si spegne più perché
      // un'applicazione di logbook ha dimenticato una riga è un difetto che si
      // paga in recensioni.
      await api.chiediIlBloccoNativo(false).catch(() => false);
      return { ottenuto, come, sparizioni, viaMs };
    },
  };
}

/**
 * Le righe di diario che descrivono com'è andata, o nessuna quando non c'è
 * niente da dire.
 *
 * ► SI TACE QUANDO TUTTO È ANDATO BENE E IL BLOCCO C'ERA. ◄ «Lo schermo è
 * rimasto acceso» sotto uno scarico riuscito è una riga che non ha mai fatto
 * cambiare idea a nessuno. Si parla quando **il blocco non c'era** (e allora
 * chi legge sa che quel diario va letto con un sospetto in più) o quando **la
 * pagina è sparita davvero** (e allora è la cosa più importante del diario).
 */
export function righeDelloSchermo(r: ResocontoSchermo): string[] {
  const righe: string[] = [];
  if (!r.ottenuto) {
    righe.push('il sistema non sa tenere acceso lo schermo: se si spegne, lo scarico si ferma');
  } else {
    // ► SI DICE ANCHE QUANDO HA FUNZIONATO, E PER UNA VOLTA È GIUSTO. ◄ La
    // 1.8.10 credeva di tenere acceso lo schermo e non lo teneva. Sapere PER
    // QUALE STRADA ci è riuscito è la differenza fra «il rimedio c'è» e «il
    // rimedio c'è sulla carta»: in un diario di guasto è la prima cosa da
    // controllare.
    righe.push(`schermo tenuto acceso per la strada ${r.come === 'nativo' ? 'nativa' : 'del web'}`);
  }
  if (r.sparizioni > 0) {
    righe.push(
      `► l'applicazione è sparita dallo schermo ${r.sparizioni} ${r.sparizioni === 1 ? 'volta' : 'volte'}` +
        ` durante lo scarico, per ${Math.round(r.viaMs / 1000)} s in tutto`,
    );
  }
  return righe;
}
