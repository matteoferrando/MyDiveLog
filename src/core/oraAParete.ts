/**
 * L'ora che il computer subacqueo ti ha MOSTRATO, e come si trasforma in un
 * istante vero.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * IL DIFETTO CHE QUESTO FILE CHIUDE, misurato su due immersioni vere del
 * 24 agosto 2026.
 *
 * Lo stesso tuffo, letto dai due computer via Bluetooth, è entrato in archivio
 * DUE VOLTE, a 59 minuti e 27 secondi di distanza. Profondità 12.27 e 12.30 m,
 * durata 3180 e 3300 s: la stessa immersione, senza dubbio possibile. Solo
 * l'orario non tornava, e per questo la deduplica non le ha unite.
 *
 * La prova che il tempo letto non era UTC sta nello scarico stesso: il
 * Peregrine dichiarava l'inizio alle 09:24:02Z, mentre lo scarico è avvenuto
 * alle 09:05:36Z. Un'immersione cominciata DICIOTTO MINUTI DOPO essere stata
 * scaricata. Un istante impossibile è una dimostrazione, non un indizio.
 *
 * Le due cause, diverse fra loro:
 *
 *  - Il **Peregrine** non ha nessun fuso da dichiarare. `libdivecomputer`, in
 *    `shearwater_predator_parser.c`, legge quei secondi con `dc_datetime_gmtime`
 *    e poi scrive `datetime->timezone = DC_TIMEZONE_NONE`: nella sua convenzione
 *    il `datetime` è l'ora LOCALE, quindi quei secondi sono l'ora a parete, non
 *    UTC. Noi li etichettavamo come UTC — due ore di errore in estate.
 *
 *  - L'**Aladin** il fuso ce l'ha, e `uwatec_smart_parser.c` lo somma al
 *    timestamp per ottenere l'ora locale. Ma quel byte sull'apparecchio è fermo
 *    sull'ora solare (+60 il 24 agosto): l'UTC che il computer crede di
 *    dichiarare è sbagliato di un'ora.
 *
 * Errori diversi, in direzioni diverse, che fra loro lasciano i 59 minuti.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * PERCHÉ NON SI VEDEVA. Le immersioni del Peregrine non portano
 * `utcOffsetMinutes`, quindi l'applicazione mostrava l'UTC — che era di nuovo
 * l'ora a parete, cioè quella giusta. Quelle dell'Aladin mostravano UTC+60, di
 * nuovo l'ora a parete. **Sullo schermo comparivano le stesse 09:24 in tutti e
 * due i casi.** Sbagliato era solo l'istante assoluto, che guarda una cosa
 * sola: la deduplica. Un difetto che si annulla da sé all'unico posto in cui
 * qualcuno lo guarderebbe.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * COSA FACCIAMO ADESSO, ed è quello che fanno già LogTRAK e Shearwater Cloud —
 * verificato dal proprietario, che in quelle applicazioni l'ora giusta la vede.
 *
 * **Il dato affidabile è l'ora a parete.** Un computer subacqueo sa che ora
 * segnava quando sei entrato in acqua; non sa in che fuso si trovava, e quando
 * crede di saperlo spesso sbaglia. Quindi si prende l'ora a parete e la si
 * àncora al fuso del dispositivo che sta scaricando, alla DATA di
 * quell'immersione — così l'ora legale è quella che valeva allora, non quella
 * di oggi.
 *
 * È esattamente il motivo per cui il nostro lettore del file Shearwater Cloud è
 * corretto: dentro quel file c'è già un istante vero, calcolato dal programma
 * del produttore al momento dello scarico con questo stesso ragionamento.
 *
 * IL LIMITE, dichiarato: immersioni fatte all'estero e scaricate una volta
 * tornati a casa prendono il fuso di casa. È lo stesso limite di
 * `libdivecomputer` e delle applicazioni dei produttori, e non è chiudibile —
 * l'informazione non esiste da nessuna parte nel computer. Quando il computer
 * un fuso ce l'ha davvero (i Teric lo scrivono nel log) quello vince, ed è il
 * motivo per cui `fusoDichiarato` esiste come parametro.
 */

/**
 * Da ora a parete a istante vero.
 *
 * @param oraAParete millisecondi dell'ora a parete letta come se fosse UTC —
 *   cioè esattamente quello che producevano i due driver prima di questa
 *   correzione.
 * @param fusoMinuti minuti di scarto del fuso in cui l'immersione è avvenuta.
 * @returns l'istante vero, in millisecondi.
 */
export function istanteDaOraAParete(oraAParete: number, fusoMinuti: number): number {
  return oraAParete - fusoMinuti * 60_000;
}

/**
 * Quanti minuti di scarto aveva il fuso di QUESTO dispositivo a quella data.
 *
 * Non è `new Date().getTimezoneOffset()`: quello è il fuso di ADESSO, e
 * applicato a un'immersione di gennaio scaricata a luglio sposterebbe la data di
 * un'ora. Si chiede l'offset alla data dell'immersione, così l'ora legale è
 * quella che valeva davvero quel giorno.
 *
 * Vive qui e non in `src/core` perché legge l'ambiente: il nucleo la riceve come
 * parametro e resta deterministico, che è anche ciò che tiene verdi i test nei
 * fusi estremi (`npm run test:tz` gira a Kiritimati, UTC+14, e a Midway, UTC−11).
 */
export type Fuso = (oraAParete: number) => number;

/**
 * Il fuso del dispositivo, valutato alla data giusta.
 *
 * `getTimezoneOffset` restituisce i minuti da aggiungere all'ora locale per
 * ottenere UTC, cioè il segno OPPOSTO a quello che usa `utcOffsetMinutes` in
 * tutta l'applicazione: a Roma d'estate dà −120, e a noi serve +120.
 *
 * Il valore si chiede su una data costruita con l'ora a parete: è
 * un'approssimazione che sbaglia solo nelle due ore di stacco dell'ora legale,
 * dove nessuna risposta è quella giusta perché quell'ora a parete è ambigua o
 * non esiste.
 */
export function fusoDelDispositivo(oraAParete: number): number {
  return -new Date(oraAParete).getTimezoneOffset();
}

/**
 * L'ISTANTE DI UN TESTO, O NIENTE — E UN CONFRONTO CHE NON RESTITUISCE MAI `NaN`.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ► IL DIFETTO MISURATO IL 16 SETTEMBRE 2026. ◄
 *
 * `Date.parse` di un testo che non è una data restituisce `NaN`, e undici
 * ordinamenti di questo progetto facevano `Date.parse(a) - Date.parse(b)`.
 * Un comparatore che restituisce `NaN` non è «un comparatore che sbaglia»: per
 * la specifica del linguaggio il risultato dell'ordinamento è **indefinito**,
 * cioè dipende dall'algoritmo del motore e dall'ordine in cui gli elementi
 * gli arrivano.
 *
 * In `numerazione.ts` il danno si vede tutto: lì il confronto per orario ha un
 * secondo criterio — l'identificativo — messo apposta perché «il numero non
 * cambi da un avvio all'altro sulla stessa immersione». Con una data
 * illeggibile il primo confronto restituiva `NaN` e **lo spareggio non veniva
 * mai raggiunto**. Misurato: le stesse quattro immersioni, passate in tre
 * ordini diversi, ricevevano tre numerazioni diverse.
 *
 * *Il numero progressivo è quello che si scrive sul libretto a valore legale.*
 *
 * ► LE IMMERSIONI SENZA DATA VANNO IN FONDO, e non è indifferente. ◄ Una
 * senza data non ha un posto nella sequenza cronologica: mettendola in mezzo
 * sposterebbe il numero di tutte quelle dopo. In fondo, i numeri di quelle
 * datate restano quelli, e l'ordine fra le indatabili lo decide comunque un
 * criterio stabile scelto da chi chiama.
 */
export function istanteDi(quando: string | undefined | null): number | undefined {
  if (!quando) return undefined;
  const t = Date.parse(quando);
  return Number.isFinite(t) ? t : undefined;
}

/**
 * Un comparatore cronologico stabile, da dare a `sort`.
 *
 * `verso` decide solo l'ordine fra le date: **le voci senza data restano in
 * fondo in tutti e due i versi**, perché «non so quando» non è né recente né
 * vecchio. A parità — stessa data, o nessuna delle due — restituisce 0, e
 * quindi lascia decidere allo spareggio di chi chiama.
 */
export function perData<T>(
  quando: (x: T) => string | undefined,
  verso: 'crescente' | 'decrescente' = 'crescente',
): (a: T, b: T) => number {
  const segno = verso === 'crescente' ? 1 : -1;
  return (a, b) => {
    const ta = istanteDi(quando(a));
    const tb = istanteDi(quando(b));
    if (ta === undefined || tb === undefined) {
      if (ta === tb) return 0;
      return ta === undefined ? 1 : -1;
    }
    return ta === tb ? 0 : segno * (ta < tb ? -1 : 1);
  };
}
