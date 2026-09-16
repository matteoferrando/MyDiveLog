/**
 * «Il tuo profilo»: chi si immerge, non come funziona il programma.
 *
 * ► PERCHÉ ESISTE UNA PAGINA APPOSTA, dal 15 settembre 2026. ◄
 *
 * Queste due carte stavano dentro Impostazioni, in mezzo all'accesso, alla
 * sincronizzazione, al backup e al cestino. Su un telefono quella pagina era
 * lunga sei schermate, e le due cose che ci sono qui — il tuo nome e i tuoi
 * brevetti — non hanno niente a che vedere con le altre: sono DATI TUOI, non
 * comandi del programma. Chi cercava «dove registro il brevetto» doveva
 * scorrere oltre il pulsante «Sincronizza» e oltre l'esportazione, cioè oltre
 * roba che non stava cercando.
 *
 * La separazione è quella che ha chiesto chi usa l'app: **le pagine di dati
 * stanno con le pagine di dati, le pagine di funzioni con le funzioni.** Qui
 * ci sono i dati; le funzioni sono rimaste in Impostazioni.
 *
 * ► PERCHÉ NON C'È ANCHE L'ATTREZZATURA. ◄ Perché è già una scheda sua, ed è
 * grande: bombole, mute, zavorra, computer. Accorparla qui vorrebbe dire fare
 * di nuovo la pagina lunga che si è appena smontata. Nel foglio «Altro» le due
 * voci stanno però sotto la stessa intestazione — «Tu» — che è dove l'occhio le
 * cerca insieme.
 */

import { useMemo, useState } from 'react';
import { useDiveLog } from '../state';
import { useLingua } from '../lingua';
import { campoModificato } from '../modificato';
import { Brevetti } from '../components/Brevetti';
import { CERT_LEVEL_LABEL, etichettaBrevetto, sortCertifications } from '../../core/analysis/gear';
import { scartoDiNumerazione } from '../../core/numerazione';
import { frase } from '../../core/frase';

export function ProfiloPage() {
  const { t } = useLingua();
  return (
    <div className="page">
      <div className="page-title-row">
        <h1 className="page-title">{t('Il tuo profilo')}</h1>
      </div>

      <LibrettoCard />

      {/*
       * I brevetti stanno sotto la carta che li USA, e non viceversa: il campo
       * «Brevetto» qui sopra sceglie da questo elenco, e chi trova la tendina
       * vuota ha la risposta — «riempila qui» — nella riga immediatamente
       * successiva, non in un'altra pagina.
       */}
      <Brevetti />
    </div>
  );
}

/**
 * Chi tiene il libretto: nome e brevetto.
 *
 * ► PERCHÉ ESISTE UNA CARTA APPOSTA. ◄ L'art. 12, comma 8 della legge 7 maggio
 * 2026, n. 70 elenca tredici dati che il libretto delle immersioni deve
 * contenere — «anche in formato digitale», dice il testo. Undici li sa già
 * l'applicazione, perché stanno nell'immersione. Due no: **le generalità del
 * subacqueo e il brevetto posseduto**, che non cambiano a ogni immersione e
 * quindi non hanno senso dentro la scheda di una singola. Cambiano una volta
 * ogni qualche anno, e stanno qui.
 *
 * ► NON È UN ADEMPIMENTO, E NON DEVE SEMBRARLO. ◄ Niente campi obbligatori,
 * niente avvisi, niente rosso. Chi non li compila continua a usare
 * l'applicazione esattamente come prima: perde solo due righe sulla stampa del
 * libretto. Due ragioni: le altre lettere presuppongono un centro e una guida, e
 * un'immersione fra amici non li ha; e il comma 8 sta dentro l'articolo sui
 * centri, quindi se l'obbligo valga anche per chi si immerge per conto proprio
 * il testo non lo chiarisce. Trasformare un'ambiguità in un errore rosso
 * significherebbe dare un parere legale al posto di un avvocato.
 *
 * ► RESTANO SUL DISPOSITIVO. ◄ Come tutto il resto dell'archivio. Escono solo se
 * si fa l'accesso e si preme Sincronizza, o se si stampa il libretto — che è
 * esattamente il punto: un documento da mostrare a qualcuno.
 */
function LibrettoCard() {
  const { subacqueo, saveSubacqueo, gear, dives } = useDiveLog();
  const { t } = useLingua();
  const [nome, setNome] = useState(subacqueo.nome ?? '');
  /*
   * Lo scarto si tiene come TESTO finché è sotto le dita.
   *
   * Un `number` di React su una casella numerica non permette lo stato «vuota»:
   * cancellando l'ultima cifra il valore diventa `NaN` e la casella si
   * ripopolerebbe di zero sotto il dito di chi sta scrivendo. Si normalizza
   * quando si esce dalla casella, non mentre si digita — `scartoDiNumerazione`
   * fa comunque da rete all'altro capo, dentro `numeriProgressivi`.
   */
  const [precedenti, setPrecedenti] = useState(
    subacqueo.immersioniPrecedenti ? String(subacqueo.immersioniPrecedenti) : '',
  );

  /*
   * ► IL BREVETTO NON SI SCRIVE PIÙ A MANO. ◄
   *
   * Era un campo di testo libero, e sembrava la scelta comoda: una riga, la
   * scrivi come vuoi. Il risultato è che l'applicazione aveva DUE verità sullo
   * stesso fatto — l'elenco dei brevetti registrati e questa riga — che non si
   * parlavano. Chi scriveva «Advanced PADI» qui e registrava «Advanced Open
   * Water Diver» nell'elenco stampava sul libretto una cosa che nel suo archivio
   * non esisteva, e nessuna delle due parti sapeva dell'altra. Peggio: la riga
   * restava com'era anche dopo aver preso un brevetto nuovo, perché niente la
   * collegava a niente.
   *
   * Ora si SCEGLIE, e le voci sono i brevetti registrati qui sotto. Un dato
   * solo, in un posto solo.
   */
  const brevetti = useMemo(() => sortCertifications(gear.certifications), [gear.certifications]);
  /*
   * Ogni voce ha una CHIAVE e un TESTO, e non sono la stessa cosa.
   *
   * La chiave è quella che si salva e che finisce sul libretto: italiana
   * sempre, perché è una chiave d'archivio (vedi `etichettaBrevetto`). Il testo
   * è quello che si legge nella tendina, e passa dal dizionario come tutto il
   * resto. `<option>` permette esattamente questo — un valore e un'etichetta
   * diversi — ed è il motivo per cui cambiare lingua non fa perdere la scelta.
   *
   * I doppioni si scartano perché due voci identiche nella stessa tendina non
   * si possono distinguere: due brevetti della stessa didattica allo stesso
   * livello sono, per il libretto, la stessa riga.
   */
  const scelte = useMemo(() => {
    const viste = new Set<string>();
    const voci: { chiave: string; testo: string }[] = [];
    for (const c of brevetti) {
      const chiave = etichettaBrevetto(c);
      if (!chiave || viste.has(chiave)) continue;
      viste.add(chiave);
      voci.push({
        chiave,
        /*
         * Il testo segue la STESSA regola della chiave, o le due si
         * scollegherebbero: quando il brevetto viene dal catalogo il nome è già
         * un nome proprio — «Deep Diver», «3° Grado AR» — e non si traduce,
         * quindi testo e chiave coincidono. Quando è scritto a mano si ripiega
         * sul livello, che invece passa dal dizionario.
         */
        testo:
          c.didatticaId && c.name.trim()
            ? chiave
            : [c.agency.trim(), t(CERT_LEVEL_LABEL[c.level])].filter(Boolean).join(' '),
      });
    }
    return voci;
  }, [brevetti, t]);
  const brevetto = subacqueo.brevetto ?? '';
  /*
   * Quello che c'era scritto prima può non corrispondere a nessuna voce.
   * Cancellarlo di nascosto sarebbe la cosa peggiore: è un dato che una persona
   * ha scritto, e sparirebbe dal libretto senza che nessuno glielo dica. Resta
   * come voce della tendina, con una riga che spiega da dove viene, finché non
   * ne sceglie un'altra.
   */
  const fuoriElenco = brevetto !== '' && !scelte.some((v) => v.chiave === brevetto);

  // Stesso difetto di `dirty`, stessa cura: `salvaNome` scrive `nome.trim()`,
  // quindi il confronto deve ripulire tutti e due i lati. Qui il sintomo era più
  // discreto — un pulsante «Salva» che non spariva più dopo aver salvato — ma la
  // causa è identica: normalizzare da un lato solo del confronto.
  const nomeSporco = campoModificato(nome, subacqueo.nome);
  const scarto = scartoDiNumerazione(Number(precedenti));
  const precedentiSporco = scarto !== (subacqueo.immersioniPrecedenti ?? 0);
  /*
   * ► UNA SCRITTURA SOLA PER I DUE CAMPI, e non è pignoleria. ◄
   *
   * `saveSubacqueo` riceve l'oggetto INTERO: due chiamate di fila, ognuna che
   * parte dal `subacqueo` che aveva in mano quando è stata creata, si
   * sovrascrivono a vicenda e l'ultima vince portandosi dietro il valore
   * vecchio dell'altro campo. Con un `await` di mezzo — e c'è — è il caso
   * normale, non quello raro.
   */
  const salva = () => {
    // La casella si mette in ordine quando si esce: «35.5» diventa «35», «-2»
    // diventa vuoto. Vedere il proprio valore corretto è l'unico modo per
    // sapere che è stato corretto.
    setPrecedenti(scarto === 0 ? '' : String(scarto));
    void saveSubacqueo({
      ...subacqueo,
      nome: nome.trim() || undefined,
      immersioniPrecedenti: scarto || undefined,
    });
  };
  const salvaBrevetto = (scelto: string) => {
    void saveSubacqueo({ ...subacqueo, brevetto: scelto || undefined });
  };

  return (
    <div className="card">
      <h2>{t('Dati per il LogBook')}</h2>
      <p className="card-sub">
        {t(
          'Nome e brevetto finiscono sul PDF del libretto, che è l’unico posto dove servono. Non sono obbligatori.',
        )}
      </p>
      <div className="grid grid-2" style={{ marginBottom: 12 }}>
        <label className="stack" style={{ gap: 4, fontSize: 12 }}>
          <span className="muted">{t('Nome e cognome')}</span>
          <input type="text" value={nome} onChange={(e) => setNome(e.target.value)} onBlur={salva} />
        </label>
        <label className="stack" style={{ gap: 4, fontSize: 12 }}>
          <span className="muted">{t('Brevetto')}</span>
          {/* Una tendina si salva al cambio e non alla perdita di fuoco: non c'è
              niente da digitare, quindi non c'è un momento in cui la scelta è
              «a metà». */}
          <select
            value={brevetto}
            onChange={(e) => salvaBrevetto(e.target.value)}
            disabled={scelte.length === 0 && !fuoriElenco}
          >
            <option value="">
              {scelte.length === 0 ? t('nessun brevetto registrato') : t('— scegli —')}
            </option>
            {fuoriElenco && <option value={brevetto}>{brevetto}</option>}
            {scelte.map((voce) => (
              <option key={voce.chiave} value={voce.chiave}>
                {voce.testo}
              </option>
            ))}
          </select>
        </label>
      </div>
      {/*
        ════════════════════════════════════════════════════════════════════
        ► LA NUMERAZIONE CHE RIPARTE DA DOVE FINISCE LA CARTA. ◄

        Segnalazione del 16 settembre 2026: *«ho scaricato dal mio computer 148
        immersioni e l'ultima mi compare immersione #148 ma in realtà sarebbe la
        #183»*. Trentacinque immersioni su un logbook di carta, e nessun modo di
        dirlo all'applicazione.

        ► PERCHÉ LA RIGA SOTTO LA CASELLA È LA META' DELLA FUNZIONE. ◄ Chiedere
        «quante immersioni prima?» è ambiguo di suo: si scrive 35 o 36? il
        numero dell'ultima di carta o quello della prima nuova? Invece di
        spiegarlo con una frase, la casella MOSTRA il risultato — «numerate
        dalla #36 alla #183» — e chi guarda smette di ragionare e confronta col
        proprio libretto. Una riga che si aggiorna vale tre righe di
        istruzioni.
      */}
      <label className="stack" style={{ gap: 4, fontSize: 12, maxWidth: 320, marginBottom: 4 }}>
        <span className="muted">{t('Immersioni fatte prima di questo archivio')}</span>
        <input
          type="number"
          inputMode="numeric"
          min={0}
          max={99999}
          step={1}
          value={precedenti}
          placeholder="0"
          onChange={(e) => setPrecedenti(e.target.value)}
          onBlur={salva}
        />
      </label>
      <p className="muted" style={{ fontSize: 11, margin: '0 0 10px' }}>
        {dives.length === 0
          ? frase(t, 'Non c’è ancora niente in archivio: la prima sarà la #{0}.', scarto + 1)
          : frase(
              t,
              'In archivio ci sono {0} immersioni: numerate dalla #{1} alla #{2}.',
              dives.length,
              scarto + 1,
              scarto + dives.length,
            )}{' '}
        {t(
          'Se hai un logbook di carta alle spalle, scrivi qui quante immersioni contiene: il numero riparte da lì su tutto — elenco, schede, PDF e libretto.',
        )}
      </p>
      {(nomeSporco || precedentiSporco) && (
        <button className="btn" onClick={salva}>
          {t('Salva')}
        </button>
      )}
      {scelte.length === 0 && !fuoriElenco && (
        <p className="muted" style={{ fontSize: 11, margin: '0 0 10px' }}>
          {t('La tendina si riempie con i brevetti che registri qui sotto.')}
        </p>
      )}
      {fuoriElenco && (
        <p className="muted" style={{ fontSize: 11, margin: '0 0 10px' }}>
          {t(
            'Il brevetto scelto è scritto a mano e non è fra quelli registrati. Continua a valere sul libretto; se lo aggiungi qui sotto, resta legato al tuo elenco.',
          )}
        </p>
      )}
      <p className="muted" style={{ fontSize: 11, margin: '10px 0 0' }}>
        {t(
          'Servono alle lettere a) e b) del libretto delle immersioni previsto dall’art. 12, comma 8 della legge 70/2026, che ammette espressamente il formato digitale.',
        )}
      </p>
    </div>
  );
}
