import { useRef, useState } from 'react';
import { ACCEPTED_EXTENSIONS, PARSERS } from '../../core/parsers';
import { imm } from '../format';
import { useDiveLog, type ImportOutcome } from '../state';

export function ImportPage({ onDone }: { onDone: () => void }) {
  const { importFiles, dives, storeLocation, clearAll } = useDiveLog();
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [outcomes, setOutcomes] = useState<ImportOutcome[] | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handle = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    setOutcomes(null);
    try {
      const result = await importFiles([...files]);
      setOutcomes(result);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const totalAdded = outcomes?.reduce((a, o) => a + o.added, 0) ?? 0;

  return (
    <div className="page">
      <div className="page-title-row">
        <h1 className="page-title">Importa immersioni</h1>
        <span className="muted" style={{ fontSize: 12 }}>
          {imm(dives.length)} in archivio · {storeLocation}
        </span>
      </div>

      <div
        className={`dropzone${over ? ' over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void handle(e.dataTransfer.files);
        }}
      >
        <p style={{ margin: '0 0 12px', fontWeight: 600 }}>
          Trascina qui i file, o scegli dal disco
        </p>
        <p className="muted" style={{ margin: '0 0 16px', fontSize: 12 }}>
          Puoi selezionarne più di uno: le immersioni presenti in due file diversi vengono unite, non
          duplicate.
        </p>
        <label className="btn btn-primary">
          {busy ? 'Lettura in corso…' : 'Scegli file'}
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={ACCEPTED_EXTENSIONS.join(',')}
            style={{ display: 'none' }}
            onChange={(e) => void handle(e.target.files)}
            disabled={busy}
          />
        </label>
      </div>

      {outcomes && (
        <div className="card">
          <h2>Esito dell'import</h2>
          <p className="card-sub">
            {totalAdded > 0
              ? `${imm(totalAdded)} ${totalAdded === 1 ? 'nuova aggiunta' : 'nuove aggiunte'} all'archivio.`
              : 'Nessuna immersione nuova: tutto era già presente.'}
          </p>
          <table>
            <thead>
              <tr>
                <th>File</th>
                <th className="num">Trovate</th>
                <th className="num">Nuove</th>
                <th className="num">Arricchite</th>
                <th className="num">Già presenti</th>
              </tr>
            </thead>
            <tbody>
              {outcomes.map((o) => (
                <tr key={o.fileName}>
                  <td>
                    <div style={{ fontWeight: 550 }}>{o.fileName}</div>
                    {o.error && <div style={{ color: 'var(--critical)', fontSize: 12 }}>{o.error}</div>}
                    {o.warnings.map((w) => (
                      <div key={w} className="muted" style={{ fontSize: 12 }}>
                        {w}
                      </div>
                    ))}
                  </td>
                  <td className="num">{o.found}</td>
                  <td className="num">{o.added}</td>
                  <td className="num">{o.merged}</td>
                  <td className="num">{o.duplicates}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {totalAdded > 0 && (
            <div className="row" style={{ marginTop: 14 }}>
              <button className="btn btn-primary" onClick={onDone}>
                Vai al logbook
              </button>
            </div>
          )}
        </div>
      )}

      <div className="card">
        <h2>Formati supportati</h2>
        <p className="card-sub">
          Il formato viene riconosciuto dal contenuto del file, non dall'estensione: un `.xml` può
          essere UDDF, Subsurface o Shearwater e vengono distinti correttamente.
        </p>
        <table>
          <thead>
            <tr>
              <th>Formato</th>
              <th>Estensioni</th>
              <th>Come ottenerlo</th>
            </tr>
          </thead>
          <tbody>
            {PARSERS.map((p) => (
              <tr key={p.format}>
                <td style={{ fontWeight: 550 }}>{p.label}</td>
                <td className="muted tabular">{p.extensions.join(' ')}</td>
                <td className="secondary">{HOWTO[p.format] ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Cosa aspettarsi da ciascuna fonte</h2>
        <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--text-secondary)', fontSize: 13 }}>
          <li>
            <b>Shearwater</b> (XML o UDDF): profilo completo, temperatura, tetto deco, PPO2. Nell'export
            UDDF il collegamento fra bombole e miscele è incompleto — un limite noto del formato — quindi
            verifica il gas nella scheda.
          </li>
          <li>
            <b>Garmin FIT</b>: profilo completo e pressione dai trasmettitori. Il volume della bombola non
            esiste nel formato: viene dedotto da <code>tank_summary</code> quando possibile, altrimenti va
            inserito a mano una volta.
          </li>
          <li>
            <b>Export FIT dell'app Suunto</b>: leggibile ma povero — manca il gas del trasmettitore e la
            composizione della miscela. Vanno completati nella scheda.
          </li>
          <li>
            <b>Scubapro LogTRAK</b>: profilo, temperatura, volume e pressioni della bombola, zavorra,
            fuso orario e condizioni. Il formato Uwatec non contiene dati di decompressione — né tetto né
            NDL — quindi le soste obbligatorie vengono riconosciute dal profilo e non dal file. Le
            immersioni inserite a mano in LogTRAK non hanno profilo: entrano con i soli dati di sintesi.
          </li>
          <li>
            <b>CSV</b>: nessun profilo, solo riepilogo. Utile per recuperare uno storico da foglio di
            calcolo; le metriche di assetto e risalita non saranno disponibili per quelle immersioni.
          </li>
        </ul>
      </div>

      {dives.length > 0 && (
        <div className="card">
          <h2>Azzera l'archivio</h2>
          <p className="card-sub">
            Cancella tutte le {dives.length} immersioni e i profili. Non è reversibile: i file di origine
            restano dove sono, quindi si può reimportare.
          </p>
          <button
            className="btn btn-danger"
            onClick={() => {
              if (confirm(`Cancellare tutte le ${dives.length} immersioni dall'archivio?`)) void clearAll();
            }}
          >
            Cancella tutto
          </button>
        </div>
      )}
    </div>
  );
}

const HOWTO: Record<string, string> = {
  uddf: 'Shearwater Cloud Desktop → Export → UDDF',
  subsurface: 'Subsurface → File → Salva con nome (.ssrf)',
  'shearwater-xml': 'Shearwater Cloud Desktop → Export → XML',
  'shearwater-cloud': 'Il database di Shearwater Cloud Desktop, o il suo backup .db',
  'garmin-fit': 'Garmin Connect → attività → esporta FIT, oppure dalla cartella ACTIVITY del dispositivo',
  logtrak: 'App o desktop Scubapro LogTRAK → Esporta → file .logtrak',
  csv: 'Qualsiasi foglio di calcolo con una riga per immersione e le intestazioni in prima riga',
};
