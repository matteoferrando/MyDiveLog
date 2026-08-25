/**
 * «Che computer hai?» — il selettore per quando il nome annunciato non basta.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * A CHI SERVE, che non è tutti.
 *
 * I driver scritti in casa riconoscono Shearwater e Scubapro/Uwatec dal nome
 * con cui si annunciano: chi ha uno di quelli non vede mai questa schermata, e
 * sono il 57% dei subacquei ricreativi. Questa serve agli altri due su cinque —
 * e a chi ha un apparecchio che si annuncia con un nome che non ci aspettavamo,
 * che è successo davvero: l'Aladin Sport Matrix si presenta «Aladin Sport»,
 * non «Aladin», e per una versione intera l'app gli ha detto in faccia «non
 * riconosciuto come computer subacqueo».
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ► LE TRE RISPOSTE, E PERCHÉ NESSUNA È «NIENTE». ◄
 *
 * Il catalogo ha 105 modelli e i driver ne leggono 22. Un elenco che ne mostra
 * 105 e ne onora 22 insegna due cose sbagliate: che l'app è rotta, e che
 * segnalarlo non serve. Quindi ogni scelta dice cosa succede — si scarica
 * adesso, non ancora, oppure mai via radio (Garmin) — e nel secondo e terzo
 * caso dice anche la strada che funziona OGGI, cioè l'esportazione
 * dall'applicazione del costruttore e l'importazione qui.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * L'ORDINE DELLE MARCHE È PER DIFFUSIONE, e c'è un test che lo difende.
 *
 * Ordinare per numero di modelli — l'ordine in cui la libreria li elenca —
 * metterebbe primo Ratio, che ha 25 modelli e un subacqueo su settanta, e in
 * fondo Suunto, che ne ha 4 ed è la seconda marca al mondo. Il ragionamento per
 * esteso, con i numeri dell'indagine, sta in `core/ble/catalogo.ts`.
 *
 * PRIMA IL CAMPO DI RICERCA, comunque. Chi sa cosa ha al polso scrive «perdix»
 * e ha finito in tre lettere, senza dover sapere che Shearwater è la prima
 * marca dell'elenco. L'elenco ordinato serve a chi il nome esatto non se lo
 * ricorda — ed è la minoranza, ma è quella che senza elenco si arena.
 */

import { useMemo, useState } from 'react';
import {
  cercaModelli,
  marchePerDiffusione,
  type ModelloComputer,
} from '../../core/ble/catalogo';
import { esitoPer } from '../../core/ble/scelta';
import { useLingua } from '../lingua';

export function ScegliComputer({
  onScegli,
  onAnnulla,
  conLibdivecomputer = false,
}: {
  /**
   * Il modello scelto, con l'esito già calcolato da chi lo riceve.
   *
   * Il componente NON scarica e non decide: dice solo cosa ha scelto la
   * persona. Chi lo usa sa se c'è un dispositivo collegato a cui mandare
   * quella scelta — qui dentro quel contesto non c'è, e fingere di averlo
   * vorrebbe dire duplicare la logica dello scarico in un selettore.
   */
  onScegli: (modello: ModelloComputer) => void;
  onAnnulla: () => void;
  /**
   * Vero se questa copia dell'applicazione ha dentro libdivecomputer.
   *
   * Cambia l'etichetta di ottantatré modelli su centocinque: senza, dicono
   * «non ancora via Bluetooth»; con, non dicono niente perché si scaricano. Il
   * valore lo sa solo chi ha chiesto al guscio Rust — qui arriva, non si
   * indovina, e il difetto è **spento**, che è la risposta prudente.
   */
  conLibdivecomputer?: boolean;
}) {
  const { t } = useLingua();
  const [testo, setTesto] = useState('');
  const [marcaAperta, setMarcaAperta] = useState<string | null>(null);

  const marche = useMemo(() => marchePerDiffusione(), []);
  const trovati = useMemo(() => cercaModelli(testo), [testo]);
  const cercando = testo.trim().length > 0;

  return (
    <div className="catalogo-computer">
      <label className="stack" style={{ gap: 4 }}>
        <span className="muted" style={{ fontSize: 12 }}>
          {t('Cerca la marca o il modello')}
        </span>
        <input
          type="search"
          value={testo}
          autoFocus
          placeholder={t('per esempio: perdix')}
          onChange={(e) => setTesto(e.target.value)}
        />
      </label>

      {cercando ? (
        trovati.length === 0 ? (
          /*
           * LA RICERCA A VUOTO NON È UN VICOLO CIECO.
           *
           * «Nessun risultato» davanti a chi ha il computer in mano è la
           * schermata che fa chiudere l'applicazione. Qui si dice cosa vuol
           * dire davvero — che quel modello via BLE non parla, o che si chiama
           * in un altro modo — e si offre la strada che comunque funziona.
           */
          <p className="muted" style={{ fontSize: 13 }}>
            {t(
              'Nessun modello con questo nome. Può darsi che si chiami in un altro modo, o che quel computer i dati via Bluetooth non li dia: in tutti e due i casi puoi esportare le immersioni dall’applicazione del costruttore e importare qui il file.',
            )}
          </p>
        ) : (
          <ElencoModelli modelli={trovati} onScegli={onScegli} conLdc={conLibdivecomputer} />
        )
      ) : (
        <ul className="marche">
          {marche.map(({ marca, modelli, automatica }) => (
            <li key={marca}>
              <button
                className="btn secondary"
                aria-expanded={marcaAperta === marca}
                onClick={() => setMarcaAperta(marcaAperta === marca ? null : marca)}
              >
                <span>{marca}</span>
                {/*
                 * «riconosciuto da solo» accanto alle due marche che l'app
                 * riconosce senza chiedere niente. Non è vanteria: chi ha uno
                 * Shearwater e sta guardando questo elenco ha un problema
                 * DIVERSO — il nome annunciato — e sapere che di norma non
                 * serviva sceglierlo gli dice dove cercare.
                 */}
                {automatica && (
                  <span className="muted" style={{ fontSize: 11 }}>
                    {t('di solito riconosciuto da solo')}
                  </span>
                )}
              </button>
              {marcaAperta === marca && (
                <ElencoModelli modelli={modelli} onScegli={onScegli} conLdc={conLibdivecomputer} />
              )}
            </li>
          ))}
        </ul>
      )}

      <button className="btn secondary" onClick={onAnnulla}>
        {t('Annulla')}
      </button>
    </div>
  );
}

function ElencoModelli({
  modelli,
  onScegli,
  conLdc,
}: {
  modelli: readonly ModelloComputer[];
  onScegli: (m: ModelloComputer) => void;
  conLdc: boolean;
}) {
  const { t } = useLingua();
  return (
    <ul className="modelli">
      {modelli.map((m) => {
        const esito = esitoPer(m, conLdc);
        return (
          <li key={`${m.marca}|${m.modello}`}>
            <button
              className="btn"
              /*
               * ANCHE I MODELLI CHE NON SI SCARICANO SONO PREMIBILI, e non è
               * una svista. Un pulsante spento non dice PERCHÉ è spento, e la
               * spiegazione — «esporta dall'app del costruttore e importa
               * qui» — è esattamente quello che serve a chi ha quel computer.
               * Disabilitandolo si nasconde l'unica risposta utile dietro un
               * grigio.
               */
              onClick={() => onScegli(m)}
            >
              <span>
                {m.marca} {m.modello}
              </span>
              {/*
               * L'ETICHETTA SOTTO IL NOME DICE COSA SUCCEDE PREMENDO, e i
               * quattro casi sono quattro frasi diverse perché sono quattro
               * cose diverse. In particolare «via libdivecomputer» non è
               * decorazione: quel modello lo legge una libreria che qui dentro,
               * con quell'apparecchio, potrebbe non essere mai stata eseguita —
               * mentre i due driver di casa hanno letto centinaia di immersioni
               * vere. Chi preme ha diritto di sapere su quale delle due strade
               * sta mettendo il piede.
               */}
              {esito.tipo !== 'si-scarica' && (
                <span className="muted" style={{ fontSize: 11 }}>
                  {esito.tipo === 'mai-via-radio'
                    ? t('solo importando il file')
                    : esito.tipo === 'si-scarica-ldc'
                      ? t('via libdivecomputer, mai provato su questo modello')
                      : t('non ancora via Bluetooth')}
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
